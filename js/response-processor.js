/**
 * @fileoverview Manages the queue and execution of AI response generation.
 * This file is responsible for orchestrating the process of generating AI
 * responses, handling streaming from the API, and managing a processing loop
 * that allows for complex, multi-step interactions involving agents and tools.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./plugins/chats-plugin.js').Chat} Chat
 * @typedef {import('./chat-data.js').Message} Message
 */

/**
 * Manages the queue and execution of AI response generation.
 * It scans for pending messages (assistant turns with null content), processes them
 * by calling the AI API, and then allows plugins to handle the completed response,
 * which might in turn create more pending messages (e.g., for tool calls or sub-agents).
 * This cycle continues until no more work is pending and no plugin takes further action.
 * It also manages a stack for nested agent calls, ensuring control returns to parent agents.
 * @class
 */
class ResponseProcessor {
    /**
     * Creates an instance of the ResponseProcessor.
     * @constructor
     */
    constructor() {
        /**
         * A flag to prevent multiple concurrent processing loops, ensuring that only
         * one `processLoop` runs at a time.
         * @type {boolean}
         */
        this.isProcessing = false;
        /**
         * The main application instance, providing access to other components like
         * `chatManager`, `agentManager`, and `apiService`.
         * @type {App | null}
         * @private
         */
        this.app = null;
        /**
         * A stack to manage nested agent calls. When a sub-agent is called, its parent
         * is pushed onto this stack. When the sub-agent finishes, the parent is popped
         * and its turn is resumed.
         * @type {Array<{agentId: string, depth: number}>}
         */
        this.agentCallStack = [];
    }

    /**
     * Schedules a processing check. If the processor is not already running,
     * this method kicks off the main processing loop. This is the primary entry point
     * for initiating all AI response generation and subsequent actions.
     * @param {App} app - The main application instance, which is stored for the duration of the processing cycle.
     */
    scheduleProcessing(app) {
        this.app = app;
        if (!this.isProcessing) {
            this.processLoop();
        }
    }

    /**
     * Finds the next pending message across all chats.
     * It iterates through all chats and uses their `findNextPendingMessage` method.
     * A pending message is defined as one with a role of 'assistant' or 'tool' and `null` content.
     * @returns {{chat: Chat, message: Message} | null} An object containing the chat instance
     * and the pending message, or `null` if no pending messages exist in any chat.
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
     * The main processing loop that drives the AI interaction cycle.
     * It robustly handles a sequence of events:
     * 1. It first prioritizes and processes any pending AI message by calling `processMessage`.
     * 2. After a message is generated, it immediately triggers the `onResponseComplete` hook,
     *    allowing plugins (like tool processors) to react.
     * 3. If a plugin takes action (e.g., queues a new tool call), the loop restarts to handle the new work.
     * 4. If no messages are pending, it triggers `onResponseComplete` with a `null` context
     *    to allow plugins to perform actions in an idle state (e.g., starting a new "flow").
     * 5. If the agent call stack is not empty, it pops the parent agent to resume its turn.
     * 6. The loop only terminates when a full pass results in no pending messages, no plugin actions,
     *    and an empty agent call stack, ensuring all work is truly complete.
     * @private
     * @async
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
     * Processes a single pending assistant or tool message by making an API call.
     * It constructs the appropriate payload, including the system prompt and message history,
     * calls the `apiService` to get a streaming response, and updates the message
     * content in real-time.
     * @param {Chat} chat - The chat object the message belongs to.
     * @param {Message} assistantMsg - The pending assistant or tool message to be filled with content.
     * @private
     * @async
     */
    async processMessage(chat, assistantMsg) {
        const app = this.app;
        if (!app) return;

        const role = assistantMsg.value.role;
        if ((role !== 'assistant' && role !== 'tool') || assistantMsg.value.content !== null) {
            console.warn('Response processor asked to process an invalid message.', assistantMsg);
            return;
        }

        const messages = chat.log.getMessageValuesBefore(assistantMsg);
        if (!messages) {
            assistantMsg.value.content = 'Error: Could not reconstruct message history.';
            chat.log.notify();
            return;
        }

        await app.apiService.executeStreamingAgentCall(
            app,
            chat,
            assistantMsg,
            messages,
            assistantMsg.agent
        );

        if (chat.title === 'New Chat') {
            const firstUserMessage = chat.log.getActiveMessageValues().find(m => m.role === 'user');
            if (firstUserMessage) {
                chat.title = firstUserMessage.content.substring(0, 20) + '...';
                app.chatManager.dataManager.save();
                if (app.activeView.id === chat.id) {
                    app.renderMainView();
                }
            }
        }
        if (app.chatManager.listPane) {
            app.chatManager.listPane.renderList();
        }
    }
}

export const responseProcessor = new ResponseProcessor();
