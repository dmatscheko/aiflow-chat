/**
 * @fileoverview Manages the queue and execution of AI response generation and tool calls.
 * @version 2.0.0
 */

'use strict';

import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./main.js').Chat} Chat
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./tool-processor.js').ToolCall} ToolCall
 */

/**
 * Manages the queue and execution of AI response generation and tool calls.
 * It operates a robust loop that prioritizes work in the following order:
 * 1. Execute pending tool calls from the ToolCallProcessor stack.
 * 2. Generate responses for pending assistant messages.
 * 3. Allow plugins to take action on an idle AI state (e.g., for flows).
 * This cycle continues until no more work is pending.
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
     * Initializes the ResponseProcessor with the main app instance.
     * @param {App} app The main application instance.
     */
    init(app) {
        this.app = app;
    }

    /**
     * Schedules a processing check. If not already processing, it starts the main processing loop.
     */
    scheduleProcessing() {
        if (!this.isProcessing) {
            this.processLoop();
        }
    }

    /**
     * Finds the next pending assistant message across all chats.
     * A pending message is one with `role: 'assistant'` and `content: null`.
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
     * The main processing loop. It robustly handles a cycle of AI responses and tool calls.
     * @private
     */
    async processLoop() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            while (true) {
                // 1. Highest priority: Process any pending tool calls.
                if (this.app.toolCallProcessor.hasPendingCalls()) {
                    await this.app.toolCallProcessor.processNext();
                    continue; // Loop again to ensure stack is cleared.
                }

                // 2. If no tool calls, check for pending assistant messages to generate.
                const workItem = this._findNextPendingMessage();
                if (workItem) {
                    const { chat, message } = workItem;
                    await this.processMessage(chat, message); // Generate the AI response.

                    // After generating, collect any tool call requests from the response.
                    /** @type {ToolCall[]} */
                    const toolCalls = [];
                    // This is a data-passing hook that allows plugins to contribute tool calls.
                    pluginManager.trigger('onToolCallParse', toolCalls, message, chat);

                    if (toolCalls.length > 0) {
                        // If there are tool calls, add them to the processor's stack.
                        this.app.toolCallProcessor.addBatch(message, toolCalls);
                    }
                    // After a message is generated, we just loop again.
                    // If it had tool calls, they'll be processed on the next iteration.
                    // If not, we'll eventually hit the idle-state check for flows.
                    continue; // Loop again to process newly added tool calls or other work.
                }

                // 3. If AI is idle, check if any plugin wants to take a follow-up action.
                const activeChat = this.app.chatManager.getActiveChat();
                if (activeChat) {
                    // Trigger with a null message to signify an idle-state check.
                    const aHandlerTookAction = await pluginManager.triggerSequentially('onResponseComplete', null, activeChat);
                    if (aHandlerTookAction) {
                        // A plugin (e.g., flows-plugin) took action. Loop again.
                        continue;
                    }
                }

                // If we reach this point, all work is complete.
                break;
            }
        } catch (error) {
            console.error('Error in processing loop:', error);
            // Optionally, update the UI to show a global error state.
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

        if (assistantMsg.value.role !== 'assistant' || assistantMsg.value.content !== null) {
            console.warn('Response processor asked to process an invalid message.', assistantMsg);
            return;
        }

        app.dom.stopButton.style.display = 'block';
        app.abortController = new AbortController();

        try {
            const messages = chat.log.getHistoryBeforeMessage(assistantMsg);
            if (!messages) {
                throw new Error("Could not find message history for processing.");
            }

            const agentId = assistantMsg.value.agent;
            const agent = agentId ? app.agentManager.getAgent(agentId) : null;
            const effectiveConfig = app.agentManager.getEffectiveApiConfig(agentId);

            const finalSystemPrompt = await pluginManager.triggerAsync('onSystemPromptConstruct', effectiveConfig.systemPrompt, effectiveConfig, agent);

            if (finalSystemPrompt) {
                messages.unshift({ role: 'system', content: finalSystemPrompt });
            }

            const payload = {
                model: effectiveConfig.model,
                messages: messages,
                stream: true,
                temperature: parseFloat(effectiveConfig.temperature),
                top_p: effectiveConfig.top_p ? parseFloat(effectiveConfig.top_p) : undefined,
            };

            assistantMsg.value.model = payload.model;
            assistantMsg.value.content = ''; // Initialize content
            chat.log.notify(); // Show the empty message bubble

            const reader = await app.apiService.streamChat(
                payload, effectiveConfig.apiUrl, effectiveConfig.apiKey, app.abortController.signal
            );

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
                            return JSON.parse(line).choices[0].delta.content;
                        } catch (e) {
                            console.error("Failed to parse stream chunk:", line, e);
                            return null;
                        }
                    })
                    .filter(Boolean);

                if (deltas.length > 0) {
                    assistantMsg.value.content += deltas.join('');
                    chat.log.notify();
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                assistantMsg.value.content = assistantMsg.value.content ? `${assistantMsg.value.content}\n\n<error>Error: ${error.message}</error>` : `<error>Error: ${error.message}</error>`;
            } else {
                assistantMsg.value.content += '\n\n[Aborted by user]';
            }
        } finally {
            app.abortController = null;
            app.dom.stopButton.style.display = 'none';
            chat.log.notify(); // Final notification for any error messages

            // Auto-generate chat title from the first user message.
            if (chat.title === 'New Chat') {
                const firstUserMessage = chat.log.getActiveMessageValues().find(m => m.role === 'user');
                if (firstUserMessage?.content) {
                    const userContent = firstUserMessage.content;
                    const titleLimit = 25;
                    chat.title = userContent.length > titleLimit
                        ? userContent.substring(0, titleLimit).trim() + '...'
                        : userContent;

                    app.chatManager.saveChats();
                    app.chatManager.renderChatList();
                    if (app.activeView.id === chat.id) {
                        app.renderMainView(); // Re-render to update title bar if visible
                    }
                }
            }
        }
    }
}

export const responseProcessor = new ResponseProcessor();