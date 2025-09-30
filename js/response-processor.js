/**
 * @fileoverview Manages the queue and execution of AI response generation.
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
 * It finds a pending message, processes it, and then allows plugins
 * to handle the completed response. The processing cycle is re-initiated
 * whenever new work (like a new pending message) is created.
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
         * The main application instance.
         * @type {App | null}
         * @private
         */
        this.app = null;
    }

    /**
     * Schedules a processing check. If not already processing, it starts the processing loop.
     * This is the main entry point for initiating AI work.
     * @param {App} app - The main application instance.
     */
    scheduleProcessing(app) {
        this.app = app;
        // The check for `isProcessing` prevents race conditions.
        // The loop is started without `await` to allow the caller to continue,
        // while the processing happens in the background.
        if (!this.isProcessing) {
            this.processLoop();
        }
    }

    /**
     * Finds the next pending message across all chats.
     * @returns {{chat: Chat, message: Message} | null} The chat and message to process, or null if none.
     * @private
     */
    _findNextPendingMessage() {
        if (!this.app || !this.app.chatManager) return null;
        for (const chat of this.app.chatManager.chats) {
            const pendingMessage = chat.log.findNextPendingMessage();
            if (pendingMessage) {
                return { chat, message: pendingMessage };
            }
        }
        return null;
    }

    /**
     * The main processing loop. It handles a single unit of work per invocation.
     * 1. It finds the highest-priority pending AI message.
     * 2. If found, it generates the response and then triggers `onResponseComplete`.
     *    The `tool-call-plugin` will intercept here and start the `ToolCallManager` if needed.
     *    The `ToolCallManager` is then responsible for creating the next pending message
     *    and re-scheduling the processor.
     * 3. If no message is pending, it triggers `onResponseComplete` with a null context
     *    to allow idle-state plugins (like the flows-plugin) to act.
     * The loop is designed to execute once and then terminate, relying on being
     * re-scheduled when more work is available.
     * @private
     */
    async processLoop() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const workItem = this._findNextPendingMessage();
            if (workItem) {
                // Case 1: A pending assistant message exists.
                const { chat, message } = workItem;
                await this.processMessage(chat, message);

                // After the message is filled, let plugins handle it.
                // The tool-call-plugin will pick it up here and may start a tool job.
                // The plugin manager will ensure only the first applicable plugin acts.
                await pluginManager.triggerSequentially('onResponseComplete', message, chat);
            } else {
                // Case 2: No pending messages, AI is idle. Let plugins act.
                const activeChat = this.app.chatManager.getActiveChat();
                if (activeChat) {
                    // The flows-plugin might take action here.
                    await pluginManager.triggerSequentially('onResponseComplete', null, activeChat);
                }
            }
        } catch (error) {
            console.error('Error in processing loop:', error);
        } finally {
            // The work for this cycle is done. Allow the next call to `scheduleProcessing`
            // to start a new loop.
            this.isProcessing = false;
        }
    }

    /**
     * Processes a single pending assistant message by making an API call.
     * @param {Chat} chat - The chat object the message belongs to.
     * @param {Message} assistantMsg - The pending assistant message to fill.
     * @private
     */
    async processMessage(chat, assistantMsg) {
        const app = this.app;
        if (!app) return;

        if (assistantMsg.value.role !== 'assistant' || assistantMsg.value.content !== null) {
            console.warn('Response processor asked to process an invalid message.', assistantMsg);
            return;
        }

        app.dom.stopButton.style.display = 'block';
        app.abortController = new AbortController();

        try {
            const messages = chat.log.getHistoryBeforeMessage(assistantMsg);
            if (!messages) {
                console.error("Could not find message history for processing.", assistantMsg);
                assistantMsg.value.content = "Error: Could not reconstruct message history.";
                chat.log.notify();
                return;
            }

            const agentId = assistantMsg.value.agent;
            const agent = agentId ? app.agentManager.getAgent(agentId) : null;
            const effectiveConfig = app.agentManager.getEffectiveApiConfig(agentId);

            const finalSystemPrompt = await pluginManager.triggerAsync('onSystemPromptConstruct', effectiveConfig.systemPrompt, effectiveConfig, agent);

            if (finalSystemPrompt) {
                messages.unshift({ role: 'system', content: finalSystemPrompt });
            }

            let payload = {
                model: effectiveConfig.model,
                messages: messages,
                stream: true,
                temperature: parseFloat(effectiveConfig.temperature),
                top_p: effectiveConfig.top_p ? parseFloat(effectiveConfig.top_p) : undefined,
            };

            assistantMsg.value.model = payload.model;

            const reader = await app.apiService.streamChat(
                payload,
                effectiveConfig.apiUrl,
                effectiveConfig.apiKey,
                app.abortController.signal
            );

            assistantMsg.value.content = ''; // Start filling content
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
                    this.app.chatManager.saveChats();
                    if (this.app.activeView.id === chat.id) {
                        this.app.chatManager.updateActiveChatInList(); // Just update list, don't re-render whole view
                    }
                }
            }
        }
    }
}

export const responseProcessor = new ResponseProcessor();