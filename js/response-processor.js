/**
 * @fileoverview Manages the queue and execution of AI response generation.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';
import { parseToolCalls, toolCallManager } from './tool-processor.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./main.js').Chat} Chat
 * @typedef {import('./chat-data.js').Message} Message
 */

/**
 * Manages the queue and execution of AI response generation.
 * It scans for pending messages, generates AI responses, and then hands off
 * to the ToolCallManager if tool calls are present. This cycle continues
 * until no more work is pending.
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
     * subsequent actions.
     * 1. It finds and processes a pending AI message.
     * 2. After the response is generated, it checks for tool calls.
     * 3. If tool calls exist, it delegates them to the `toolCallManager`. The manager
     *    is then responsible for the rest of the flow, including queuing the next AI turn.
     * 4. If no tool calls exist, it triggers `onResponseComplete` for other plugins (e.g., flows).
     * 5. The loop terminates when a full pass results in no pending messages and no
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
                    // 1. Generate the AI response for the pending message.
                    await this.processMessage(chat, message);

                    // 2. After generation, check for tool calls in the response.
                    const parsedCalls = parseToolCalls(message.value.content);
                    if (parsedCalls.length > 0) {
                        // 3. If tools are found, delegate to the ToolCallManager.
                        // The manager will handle execution and queue the next AI turn.
                        toolCallManager.addJob(parsedCalls, message, chat);
                        // The manager works async. Continue the loop for other potential work.
                        continue;
                    }

                    // 4. If no tool calls, trigger general onResponseComplete for other plugins.
                    const aHandlerTookAction = await pluginManager.triggerSequentially('onResponseComplete', message, chat);
                    if (aHandlerTookAction) {
                        continue; // A plugin took action, so restart the loop.
                    }
                    continue; // Continue to check for more pending messages.
                }

                // If AI is idle, check if any plugin wants to take a follow-up action (e.g., flows).
                const activeChat = this.app.chatManager.getActiveChat();
                if (activeChat) {
                    // Trigger with a null message to signify an idle-state check.
                    const aHandlerTookAction = await pluginManager.triggerSequentially('onResponseComplete', null, activeChat);
                    if (aHandlerTookAction) {
                        continue; // A plugin took action. Loop again.
                    }
                }

                // All work is complete.
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

            // Construct the system prompt by allowing plugins to contribute.
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
                        this.app.renderMainView();
                    }
                }
            }
            this.app.chatManager.renderChatList();
        }
    }
}

export const responseProcessor = new ResponseProcessor();