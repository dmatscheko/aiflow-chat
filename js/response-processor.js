/**
 * @fileoverview Manages the queue and execution of AI response generation.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';
import { parseToolCalls } from './tool-processor.js';

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

                    // After processing, check for and handle any tool calls.
                    const toolsWereCalled = await this._handleToolCalls(message, chat);
                    if (toolsWereCalled) {
                        // If tools were called, queue the next assistant turn and restart.
                        const agentId = message.value.agent;
                        chat.log.addMessage({ role: 'assistant', content: null, agent: agentId });
                        continue;
                    }

                    // If no tools were called, allow other plugins to react to the completed message.
                    // This is for features like flows that might trigger on a final text response.
                    const aHandlerTookAction = await pluginManager.triggerSequentially('onResponseComplete', message, chat);
                    if (aHandlerTookAction) {
                        continue; // A plugin took action, so restart the loop.
                    }

                    // If no handler acted, we still continue to the next pending message or idle check.
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
                }

                // If we reach this point, all work is truly complete.
                break;
            }
        } catch (error) {
            console.error('Error in processing loop:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Parses and executes all tool calls in a message, consolidating the results.
     * @param {Message} message - The message containing the tool calls.
     * @param {Chat} chat - The chat the message belongs to.
     * @returns {Promise<boolean>} True if tool calls were processed, false otherwise.
     * @private
     */
    async _handleToolCalls(message, chat) {
        if (!message.value.content) {
            return false;
        }

        const { toolCalls } = parseToolCalls(message.value.content);
        if (toolCalls.length === 0) {
            return false;
        }

        const promises = toolCalls.map(call => {
            const executor = pluginManager.getToolExecutor(call.name);
            if (executor) {
                return executor(call, message, chat);
            }
            return Promise.resolve({
                name: call.name,
                tool_call_id: call.id,
                error: `No executor found for tool "${call.name}".`,
            });
        });

        const results = await Promise.all(promises);

        let toolContents = '';
        results.forEach((tr) => {
            const inner = tr.error
                ? `<error>\n${tr.error}\n</error>`
                : `<content>\n${tr.content}\n</content>`;
            toolContents += `<dma:tool_response name="${tr.name}" tool_call_id="${tr.tool_call_id}">\n${inner}\n</dma:tool_response>\n`;
        });

        if (toolContents) {
            chat.log.addMessage({ role: 'tool', content: toolContents });
            return true;
        }
        return false;
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
