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
 * It scans for pending messages, processes them, and then allows plugins
 * to handle the completed response, potentially creating more work. This cycle
 * continues until no more work is pending and no plugin takes further action.
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
        /**
         * A stack to manage nested agent calls.
         * @type {Array<{agentId: string, depth: number}>}
         */
        this.agentCallStack = [];
    }

    /**
     * Schedules a processing check. If not already processing, it starts the robust processing loop.
     * @param {App} app - The main application instance.
     */
    scheduleProcessing(app) {
        this.app = app;
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
        if (!this.app) return null;
        for (const chat of this.app.chatManager.chats) {
            const pendingMessage = chat.log.findNextPendingMessage();
            if (pendingMessage) {
                return { chat, message: pendingMessage };
            }
        }
        return null;
    }

    /**
     * The main processing loop. It robustly handles a cycle of AI responses and
     * subsequent plugin actions.
     * 1. It first prioritizes and processes any pending AI message.
     * 2. After processing, it immediately triggers `onResponseComplete` for that message.
     * 3. If a handler acts, the loop restarts to handle any new work.
     * 4. If no messages are pending, it triggers `onResponseComplete` with a null context
     *    to allow plugins to act on the idle state.
     * 5. The loop only terminates when a full pass results in no pending messages and no
     *    plugin actions.
     * @private
     */
    async processLoop() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            while (true) {
                const workItem = this._findNextPendingMessage();
                if (workItem) {
                    const { chat, message } = workItem;
                    // Highest priority: process any pending AI response.
                    await this.processMessage(chat, message);

                    // Immediately give plugins a chance to react to the new message.
                    const aHandlerTookAction = await pluginManager.triggerSequentially('onResponseComplete', message, chat);
                    if (aHandlerTookAction) {
                        // A plugin (e.g., mcp-plugin) took action, so new work might exist.
                        // Restart the loop to handle it immediately.
                        continue;
                    }
                    // If no handler acted on this specific message, we still continue,
                    // as there might be other pending messages.
                    continue;
                }

                // If we're here, the AI is idle. Check if any plugin wants to take a follow-up action.
                const activeChat = this.app.chatManager.getActiveChat();
                if (activeChat) {
                    // Trigger with a null message to signify an idle-state check.
                    const aHandlerTookAction = await pluginManager.triggerSequentially('onResponseComplete', null, activeChat);
                    if (aHandlerTookAction) {
                        // A plugin (e.g., flows-plugin) took action. Loop again.
                        continue;
                    }

                    // If all work is done, check if we need to return control to a parent agent.
                    if (this.agentCallStack.length > 0) {
                        const parentAgentContext = this.agentCallStack.pop();
                        activeChat.log.addMessage(
                            { role: 'assistant', content: null, agent: parentAgentContext.agentId },
                            { depth: parentAgentContext.depth }
                        );
                        // A new turn has been queued, so restart the loop.
                        continue;
                    }
                }

                // If we reach this point, it means:
                // 1. There were no pending messages to process.
                // 2. No plugin took any action on the idle state.
                // 3. The agent call stack is empty.
                // Therefore, all work is truly complete.
                break;
            }
        } catch (error) {
            console.error('Error in processing loop:', error);
        } finally {
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

        if ((assistantMsg.value.role !== 'assistant' && assistantMsg.value.role !== 'tool') || assistantMsg.value.content !== null) {
            console.warn('Response processor asked to process an invalid message.', assistantMsg);
            return;
        }

        app.dom.stopButton.style.display = 'block';
        app.abortController = new AbortController();

        try {
            const messages = chat.log.getMessageValuesBefore(assistantMsg);
            if (!messages) {
                console.error("Could not find message history for processing.", assistantMsg);
                assistantMsg.value.content = "Error: Could not reconstruct message history.";
                chat.log.notify();
                return;
            }

            const agentId = assistantMsg.agent;
            const effectiveConfig = app.agentManager.getEffectiveApiConfig(agentId);

            // Use the centralized method to construct the system prompt.
            const finalSystemPrompt = await app.agentManager.constructSystemPrompt(agentId);

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
                        this.app.renderMainView();
                    }
                }
            }
            this.app.chatManager.renderChatList();
        }
    }
}

export const responseProcessor = new ResponseProcessor();
