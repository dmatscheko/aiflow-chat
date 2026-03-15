/**
 * @fileoverview Manages the queue and execution of AI response generation.
 * This file is responsible for orchestrating the process of generating AI
 * responses, handling streaming from the API, and managing a processing loop
 * that allows for complex, multi-step interactions involving agents and tools.
 *
 * Supports per-chat concurrent processing: each chat runs its own independent
 * processing loop, allowing multiple chats to stream and execute tools in parallel.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./plugins/chats-plugin.js').Chat} Chat
 * @typedef {import('./chat-data.js').Message} Message
 */

/**
 * Manages the queue and execution of AI response generation on a per-chat basis.
 * Each chat has its own independent processing loop, agent call stack, and stopped state,
 * enabling true concurrent processing across multiple chats.
 * @class
 */
class ResponseProcessor {
    /**
     * Creates an instance of the ResponseProcessor.
     * @constructor
     */
    constructor() {
        /**
         * Tracks which chats currently have an active processing loop.
         * @type {Set<string>}
         * @private
         */
        this._processingChats = new Set();
        /**
         * Tracks which chats have been stopped by the user (Esc / Stop button).
         * @type {Set<string>}
         * @private
         */
        this._stoppedChats = new Set();
        /**
         * Per-chat agent call stacks. When a sub-agent is called, its parent
         * is pushed onto the chat's stack. When the sub-agent finishes, the parent
         * is popped and its turn is resumed.
         * @type {Map<string, Array<{agentId: string, depth: number, chatId: string}>>}
         * @private
         */
        this._agentCallStacks = new Map();
        /**
         * The main application instance.
         * @type {App | null}
         * @private
         */
        this.app = null;
    }

    /**
     * Returns the agent call stack for a specific chat, creating it if needed.
     * @param {string} chatId - The chat ID.
     * @returns {Array<{agentId: string, depth: number, chatId: string}>}
     */
    getAgentCallStack(chatId) {
        if (!this._agentCallStacks.has(chatId)) {
            this._agentCallStacks.set(chatId, []);
        }
        return this._agentCallStacks.get(chatId);
    }

    /**
     * Checks whether a specific chat has been stopped.
     * @param {string} chatId - The chat ID.
     * @returns {boolean}
     */
    isChatStopped(chatId) {
        return this._stoppedChats.has(chatId);
    }

    /**
     * Checks whether a specific chat is currently processing.
     * @param {string} chatId - The chat ID.
     * @returns {boolean}
     */
    isChatProcessing(chatId) {
        return this._processingChats.has(chatId);
    }

    /**
     * Immediately halts processing for a specific chat or all chats.
     * Clears the agent call stack and removes pending messages.
     * @param {string} [chatId] - If provided, stops only this chat. Otherwise stops all.
     */
    stop(chatId) {
        if (chatId) {
            this._stoppedChats.add(chatId);
            const stack = this._agentCallStacks.get(chatId);
            if (stack) stack.length = 0;
            if (this.app?.chatManager) {
                const chat = this.app.chatManager.chats.find(c => c.id === chatId);
                if (chat) chat.log.removePendingMessages();
            }
        } else {
            // Stop all chats
            if (this.app?.chatManager) {
                for (const chat of this.app.chatManager.chats) {
                    this._stoppedChats.add(chat.id);
                    const stack = this._agentCallStacks.get(chat.id);
                    if (stack) stack.length = 0;
                    chat.log.removePendingMessages();
                }
            }
        }
    }

    /**
     * Schedules a processing check for a specific chat. If the chat's processor
     * is not already running, this method kicks off a per-chat processing loop.
     * @param {App} app - The main application instance.
     * @param {string} [chatId] - The ID of the chat to process. If omitted, scans all chats.
     */
    scheduleProcessing(app, chatId) {
        this.app = app;

        if (chatId) {
            this._stoppedChats.delete(chatId);
            if (!this._processingChats.has(chatId)) {
                this._processLoopForChat(chatId);
            }
        } else {
            // Legacy/fallback: scan all chats for pending messages and start loops
            if (app.chatManager) {
                for (const chat of app.chatManager.chats) {
                    if (chat.log.findNextPendingMessage()) {
                        this._stoppedChats.delete(chat.id);
                        if (!this._processingChats.has(chat.id)) {
                            this._processLoopForChat(chat.id);
                        }
                    }
                }
            }
        }
    }

    /**
     * The per-chat processing loop. Handles the sequence of events for a single chat:
     * 1. Process any pending AI message.
     * 2. Trigger onResponseComplete hooks for plugins to react.
     * 3. Pop the agent call stack if idle.
     * 4. Check for idle-state plugin actions.
     * 5. Terminate when no more work exists for this chat.
     * @param {string} chatId - The ID of the chat to process.
     * @private
     * @async
     */
    async _processLoopForChat(chatId) {
        if (this._processingChats.has(chatId)) return;
        this._processingChats.add(chatId);

        try {
            while (true) {
                if (this._stoppedChats.has(chatId)) break;

                const chat = this.app?.chatManager?.chats.find(c => c.id === chatId);
                if (!chat) break;

                const pendingMessage = chat.log.findNextPendingMessage();
                if (pendingMessage) {
                    // Highest priority: process any pending AI response.
                    await this.processMessage(chat, pendingMessage);

                    if (this._stoppedChats.has(chatId)) break;

                    // Immediately give plugins a chance to react to the new message.
                    const aHandlerTookAction = await pluginManager.triggerSequentially('onResponseComplete', pendingMessage, chat);
                    if (this._stoppedChats.has(chatId)) break;
                    if (aHandlerTookAction) {
                        continue;
                    }
                    continue;
                }

                // If we're here, the chat is idle.
                // First priority: return control to a parent agent from the call stack.
                const stack = this.getAgentCallStack(chatId);
                if (stack.length > 0) {
                    const parentAgentContext = stack.pop();
                    const targetChat = parentAgentContext.chatId
                        ? this.app.chatManager.chats.find(c => c.id === parentAgentContext.chatId)
                        : chat;
                    if (targetChat) {
                        targetChat.log.addMessage(
                            { role: 'assistant', content: null, agent: parentAgentContext.agentId },
                            { depth: parentAgentContext.depth }
                        );
                    } else {
                        console.warn('Agent call stack: target chat no longer exists, skipping resumption.');
                    }
                    continue;
                }

                // Second priority: check if any plugin wants to take a follow-up action.
                const aHandlerTookAction = await pluginManager.triggerSequentially('onResponseComplete', null, chat);
                if (this._stoppedChats.has(chatId)) break;
                if (aHandlerTookAction) {
                    continue;
                }

                // All work is complete for this chat.
                break;
            }
        } catch (error) {
            console.error('Error in processing loop for chat:', chatId, error);
        } finally {
            this._processingChats.delete(chatId);
        }
    }

    /**
     * Processes a single pending assistant or tool message by making an API call.
     * @param {Chat} chat - The chat object the message belongs to.
     * @param {Message} assistantMsg - The pending message to be filled with content.
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

        // Filter out log messages — they are display-only and not part of the AI context.
        const filteredMessages = messages.filter(m => m.role !== 'log');

        await app.apiService.executeStreamingAgentCall(
            app,
            chat,
            assistantMsg,
            filteredMessages,
            assistantMsg.agent
        );

        if (chat.title === 'New Chat') {
            const firstUserMessage = chat.log.getActiveMessageValues().find(m => m.role === 'user');
            if (firstUserMessage?.content) {
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
