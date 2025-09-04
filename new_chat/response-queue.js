/**
 * @fileoverview Manages a queue for processing AI responses sequentially.
 * Ensures that only one AI generation is active at a time and provides
 * hooks for completion.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';

class ResponseQueueManager {
    constructor() {
        /** @type {Array<import('./main.js').App>} */
        this.queue = [];
        this.isProcessing = false;
        this.completionSubscribers = [];
    }

    /**
     * Adds a message to the processing queue.
     * @param {import('./main.js').App} app - The main application instance.
     */
    enqueue(app) {
        this.queue.push(app);
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    /**
     * Subscribes a callback to be called when the queue is empty.
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
     * Processes the queue until it's empty.
     */
    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const app = this.queue.shift();
            const activeChat = app.getActiveChat();
            if (!activeChat) continue;

            const assistantMsg = activeChat.log.getLastMessage();
            if (assistantMsg?.value.role !== 'assistant' || assistantMsg.value.content !== null) {
                // We only process messages that are placeholders for a response.
                // This might happen if a message was added without using the queue.
                // We'll just skip it.
                continue;
            }

            app.dom.stopButton.style.display = 'block';
            app.abortController = new AbortController();

            try {
                const settings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};
                const messages = activeChat.log.getActiveMessageValues();

                if (settings.systemPrompt) {
                    messages.unshift({ role: 'system', content: settings.systemPrompt });
                }

                let payload = {
                    model: settings.model,
                    messages: messages.slice(0, -1), // Exclude the placeholder
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
                activeChat.log.notify();

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
                        activeChat.log.notify();
                    }
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    assistantMsg.value.content = `Error: ${error.message}`;
                } else {
                    assistantMsg.value.content += '\n\n[Aborted by user]';
                }
                activeChat.log.notify();
            } finally {
                app.abortController = null;
                app.dom.stopButton.style.display = 'none';
                if (activeChat.title === 'New Chat') {
                    const firstUserMessage = activeChat.log.getActiveMessageValues().find(m => m.role === 'user');
                    if (firstUserMessage) {
                        activeChat.title = firstUserMessage.content.substring(0, 20) + '...';
                        app.saveChats(); // Save title change
                    }
                }
                app.renderChatList();
                pluginManager.trigger('onResponseComplete', assistantMsg, activeChat);
            }
        }

        this.isProcessing = false;
        this.notifyCompletion();
    }
}

export const responseQueueManager = new ResponseQueueManager();
