/**
 * @fileoverview Manages the processing of AI responses by scanning chat logs.
 * Ensures that only one AI generation is active at a time and provides
 * hooks for completion.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./main.js').Chat} Chat
 * @typedef {import('./chat-data.js').Message} Message
 */

/**
 * Manages the queue and execution of AI response generation.
 * It scans all chats for "pending" assistant messages (content is null)
 * and processes them one by one, ensuring that only one API call is active
 * at a time.
 * @class
 */
class ResponseProcessor {
    constructor() {
        /**
         * Flag to prevent multiple concurrent processing loops.
         * @type {boolean}
         */
        this.isProcessing = false;
        /**
         * Callbacks to be executed when the entire processing queue is empty.
         * @type {Array<() => void>}
         * @private
         */
        this.completionSubscribers = [];
        /**
         * The main application instance.
         * @type {App | null}
         * @private
         */
        this.app = null;
    }

    /**
     * Schedules a processing check. If not already processing, it starts the loop.
     * @param {App} app - The main application instance.
     */
    scheduleProcessing(app) {
        this.app = app;
        if (!this.isProcessing) {
            this.findAndProcessNext();
        }
    }

    /**
     * Subscribes a callback to be called when the processing queue is empty.
     * Useful for chaining asynchronous operations that depend on AI responses.
     * @param {() => void} callback The function to call on completion.
     */
    subscribeToCompletion(callback) {
        this.completionSubscribers.push(callback);
    }

    /**
     * Notifies all completion subscribers and clears the list.
     * @private
     */
    notifyCompletion() {
        this.completionSubscribers.forEach(cb => cb());
        this.completionSubscribers = []; // Clear subscribers after notification
    }

    /**
     * Finds the next pending message across all chats and processes it.
     * This method forms a loop by calling itself after each message is processed,
     * ensuring sequential execution.
     * If no pending message is found, it stops the loop and notifies completion subscribers.
     * @private
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
     * Processes a single pending assistant message.
     * This involves fetching settings, constructing the API payload, making the
     * API call, and streaming the response back into the message content.
     * @param {Chat} chat - The chat object the message belongs to.
     * @param {Message} assistantMsg - The pending assistant message to fill.
     * @private
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
            // Get the history leading up to the pending message.
            const messages = chat.log.getHistoryBeforeMessage(assistantMsg);
            if (!messages) {
                console.error("Could not find message history for processing.", assistantMsg);
                assistantMsg.value.content = "Error: Could not reconstruct message history.";
                chat.log.notify();
                return;
            }

            // --- Get effective configuration using the new centralized method ---
            const agentId = assistantMsg.value.agent;
            const agent = agentId ? app.agentManager.getAgent(agentId) : null;
            const effectiveConfig = app.agentManager.getEffectiveApiConfig(agentId);

            // Determine the system prompt (agent's prompt takes precedence)
            const systemPrompt = agent?.systemPrompt || effectiveConfig.systemPrompt;
            if (systemPrompt) {
                messages.unshift({ role: 'system', content: systemPrompt });
            }
            // --- End of configuration ---

            let payload = {
                model: effectiveConfig.model,
                messages: messages,
                stream: true,
                temperature: parseFloat(effectiveConfig.temperature),
                top_p: effectiveConfig.top_p ? parseFloat(effectiveConfig.top_p) : undefined,
            };

            // Pass the original agent object and the final effective config to the plugin hook
            payload = pluginManager.trigger('beforeApiCall', payload, effectiveConfig, agent);

            const reader = await app.apiService.streamChat(
                payload,
                effectiveConfig.apiUrl,
                effectiveConfig.apiKey,
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
