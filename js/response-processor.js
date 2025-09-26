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
     * The main processing loop. It robustly handles a cycle of AI responses and subsequent plugin actions.
     * 1. It first prioritizes and processes any pending AI message.
     * 2. After an assistant message is generated, it checks the message for tool calls.
     * 3. If tool calls are found, the responsible plugins are triggered.
     * 4. After all tool calls are processed, this loop queues a single new assistant turn.
     * 5. The loop only terminates when a full pass results in no pending messages and no plugin actions.
     * @private
     */
    async processLoop() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            while (true) {
                let actionTaken = false;

                // 1. Process any pending AI message generation
                const workItem = this._findNextPendingMessage();
                if (workItem) {
                    await this.processMessage(workItem.chat, workItem.message);
                    actionTaken = true;
                    // The assistant message is now generated. Continue the loop to check it for tool calls.
                    continue;
                }

                // 2. Handle completed assistant message (check for tool calls)
                const activeChat = this.app.chatManager.getActiveChat();
                if (activeChat) {
                    const messages = activeChat.log.getActiveMessages();
                    const lastMessage = messages[messages.length - 1];
                    const secondToLastMessage = messages.length > 1 ? messages[messages.length - 2] : null;

                    // Only process the last assistant message for tools if it has content
                    // and doesn't immediately follow a tool response (to prevent re-processing).
                    if (lastMessage && lastMessage.value.role === 'assistant' && lastMessage.value.content && secondToLastMessage?.value.role !== 'tool') {
                        const toolHandlerTookAction = await pluginManager.triggerSequentially('onResponseComplete', lastMessage, activeChat);

                        if (toolHandlerTookAction) {
                            // Tool calls were found and processed. The handlers have added 'tool' role messages.
                            // Now, we queue the next assistant turn to process the tool results.
                            activeChat.log.addMessage({ role: 'assistant', content: null, agent: lastMessage.value.agent });
                            actionTaken = true;
                            // Restart the loop to process the newly created pending message.
                            continue;
                        }
                    }
                }

                // 3. Handle idle state (e.g., for flows plugin)
                if (activeChat) {
                    const idleHandlerTookAction = await pluginManager.triggerSequentially('onResponseComplete', null, activeChat);
                    if (idleHandlerTookAction) {
                        actionTaken = true;
                        continue;
                    }
                }

                // If no actions were taken in a full pass, exit the loop.
                if (!actionTaken) {
                    break;
                }
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
