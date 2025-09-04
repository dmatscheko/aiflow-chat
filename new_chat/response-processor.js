/**
 * @fileoverview Manages the processing of AI responses by scanning chat logs.
 * Ensures that only one AI generation is active at a time and provides
 * hooks for completion.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';

class ResponseProcessor {
    constructor() {
        this.isProcessing = false;
        this.completionSubscribers = [];
        this.app = null; // The main app instance
    }

    /**
     * Schedules a processing check. If not already processing, it starts.
     * @param {import('./main.js').App} app - The main application instance.
     */
    scheduleProcessing(app) {
        this.app = app;
        if (!this.isProcessing) {
            this.findAndProcessNext();
        }
    }

    /**
     * Subscribes a callback to be called when processing is complete.
     * @param {() => void} callback
     */
    subscribeToCompletion(callback) {
        this.completionSubscribers.push(callback);
    }

    /**
     * Notifies all completion subscribers.
     */
    notifyCompletion() {
        this.completionSubscribers.forEach(cb => cb());
        this.completionSubscribers = []; // Clear subscribers after notification
    }

    /**
     * Finds the next pending message across all chats and processes it.
     * If no message is found, it notifies completion subscribers.
     */
    async findAndProcessNext() {
        this.isProcessing = true;

        let workFound = false;
        if (this.app) {
            for (const chat of this.app.chats) {
                const pendingMessage = chat.log.findNextPendingMessage();
                if (pendingMessage) {
                    // Found a message to process
                    await this.processMessage(chat, pendingMessage);
                    workFound = true;
                    // After processing, immediately look for the next piece of work.
                    // This creates a recursive loop that continues until all work is done.
                    this.findAndProcessNext();
                    return; // Exit the current function call
                }
            }
        }

        if (!workFound) {
            // No pending messages were found in any chat
            this.isProcessing = false;
            this.notifyCompletion();
        }
    }

    /**
     * Processes a single pending message.
     * @param {object} chat - The chat object the message belongs to.
     * @param {import('./chat-data.js').Message} assistantMsg - The pending message to fill.
     */
    async processMessage(chat, assistantMsg) {
        const app = this.app;
        if (!app) return;

        if (assistantMsg.value.role !== 'assistant' || assistantMsg.value.content !== null) {
            console.warn('Response processor was asked to process an invalid message.', assistantMsg);
            return;
        }

        app.dom.stopButton.style.display = 'block';
        app.abortController = new AbortController();

        try {
            const settings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};
            // Get the history leading up to the pending message.
            const messages = chat.log.getHistoryBeforeMessage(assistantMsg);
            if (!messages) {
                console.error("Could not find message history for processing.", assistantMsg);
                assistantMsg.value.content = "Error: Could not reconstruct message history.";
                chat.log.notify();
                return;
            }

            if (settings.systemPrompt) {
                messages.unshift({ role: 'system', content: settings.systemPrompt });
            }

            let payload = {
                model: settings.model,
                messages: messages,
                stream: true,
                temperature: parseFloat(settings.temperature)
            };

            payload = pluginManager.trigger('beforeApiCall', payload, settings);

            const reader = await app.apiService.streamChat(
                payload,
                settings.apiUrl,
                settings.apiKey,
                app.abortController.signal
            );

            assistantMsg.value.content = ''; // Make it empty string to start filling
            chat.log.notify();

            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                const deltas = lines
                    .map(line => line.replace(/^data: /, '').trim())
                    .filter(line => line !== '' && line !== '[DONE]')
                    .map(line => {
                        try {
                            return JSON.parse(line);
                        } catch (e) {
                            console.error("Failed to parse stream chunk:", line, e);
                            return null;
                        }
                    })
                    .filter(Boolean)
                    .map(json => json.choices[0].delta.content)
                    .filter(content => content);

                if (deltas.length > 0) {
                    assistantMsg.value.content += deltas.join('');
                    chat.log.notify();
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                assistantMsg.value.content = `Error: ${error.message}`;
            } else {
                assistantMsg.value.content += '\n\n[Aborted by user]';
            }
            chat.log.notify();
        } finally {
            app.abortController = null;
            app.dom.stopButton.style.display = 'none';
            if (chat.title === 'New Chat') {
                const firstUserMessage = chat.log.getActiveMessageValues().find(m => m.role === 'user');
                if (firstUserMessage) {
                    chat.title = firstUserMessage.content.substring(0, 20) + '...';
                    app.saveChats(); // Save title change
                }
            }
            app.renderChatList();
            pluginManager.trigger('onResponseComplete', assistantMsg, chat);
        }
    }
}

export const responseProcessor = new ResponseProcessor();
