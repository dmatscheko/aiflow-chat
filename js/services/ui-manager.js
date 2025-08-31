/**
 * @fileoverview Manages the chat UI, including message rendering and user interactions.
 */

'use strict';

import { ChatBox } from '../components/chatbox.js';
import { log, triggerError } from '../utils/logger.js';
import { firstPrompt, defaultEndpoint } from '../config.js';
import { getDatePrompt } from '../utils/chat.js';
import { hooks } from '../hooks.js';
import { agentsPlugin } from '../plugins/agents/agents.js';

/**
 * @class ChatUIManager
 * Centralizes all UI-related logic for the chat.
 */
class ChatUIManager {
    /**
     * @param {import('../state/store.js').default} store - The application's state store.
     * @param {ChatService} chatService - The chat service instance.
     */
    constructor(store, chatService, apiService, configService) {
        log(3, 'ChatUIManager: Constructor called');
        this.store = store;
        this.chatService = chatService;
        this.apiService = apiService;
        this.configService = configService;
        this.chatBox = new ChatBox(this.store, this);
        this.chatBox.onUpdate = () => this.chatService.persistChats();

        this.store.subscribe('currentChat', (chat) => {
            this.onChatSwitched(chat);
        });
    }

    /**
     * Handles chat switching.
     * @param {Object} chat - The chat to switch to.
     */
    onChatSwitched(chat) {
        log(3, 'ChatUIManager: onChatSwitched called for chat', chat?.id);
        this.chatBox.setChatlog(chat?.chatlog || null);
        if (window.innerWidth <= 1037) {
            document.getElementById('chatListContainer').classList.add('hidden');
        }
    }

    /**
     * Adds a message to the chat.
     * @param {Object} value - The message value, e.g., { role: 'user', content: 'Hello' }.
     * @param {import('../components/chatlog.js').Message} parentMessage - The parent message to add this as an alternative to.
     * @returns {import('../components/chatlog.js').Message} The new message.
     */
    addMessage(value, parentMessage = null) {
        if (!value || typeof value.role !== 'string' || !('content' in value)) {
            triggerError('Invalid message format. Message must have a role and content.', value);
            return null;
        }
        const chatlog = this.chatBox.chatlog;
        if (!chatlog) return null;

        let message;
        if (parentMessage) {
            message = chatlog.addAlternative(parentMessage, value);
        } else {
            message = chatlog.addMessage(value);
        }

        this._updateChat();
        return message;
    }

    /**
     * Adds a streaming message placeholder to the chat.
     * @param {string} role - The role of the message.
     * @param {import('../components/chatlog.js').Message} parentMessage - The parent message.
     * @returns {import('../components/chatlog.js').Message} The new message.
     */
    addStreamingMessage(role, parentMessage = null) {
        if (typeof role !== 'string') {
            triggerError('Invalid role for streaming message. Must be a string.', role);
            return null;
        }
        return this.addMessage({ role, content: null }, parentMessage);
    }

    /**
     * Deletes a message from the chat.
    /**
     * Deletes a message from the chat.
     * @param {import('../components/chatlog.js').Message} message - The message to delete.
     * @param {boolean} deleteChildren - If true, deletes this message and all subsequent messages in its branch. If false, deletes only this message and relinks children.
     */
    deleteMessage(message, deleteChildren = false) {
        if (!message || typeof message !== 'object') {
            triggerError('Invalid message object provided to deleteMessage.', message);
            return;
        }
        const chatlog = this.chatBox.chatlog;
        if (!chatlog) return;

        if (deleteChildren) {
            chatlog.deleteMessage(message);
        } else {
            const pos = chatlog.getMessagePos(message);
            chatlog.deleteNthMessage(pos);
        }
        this._updateChat(false);
    }

    /**
     * Adds an alternative message to an existing message.
     * If no parent message is provided, it adds the alternative to the last message in the chat.
     * @param {Object} value - The message value, e.g., { role: 'user', content: 'Hello' }.
     * @param {import('../components/chatlog.js').Message} [parentMessage=null] - The message to add an alternative to.
     * @returns {import('../components/chatlog.js').Message | null} The new message, or null if no target was found.
     */
    addAlternative(value, parentMessage = null) {
        if (!value || typeof value.role !== 'string' || !('content' in value)) {
            triggerError('Invalid message format for alternative. Message must have a role and content.', value);
            return null;
        }
        const chatlog = this.chatBox.chatlog;
        if (!chatlog) return null;

        const targetMessage = parentMessage || chatlog.getLastMessage();
        if (!targetMessage) return null;

        const message = chatlog.addAlternative(targetMessage, value);

        this._updateChat();
        return message;
    }

    /**
     * Updates the content of a message.
     * @param {import('../components/chatlog.js').Message} message - The message to update.
     * @param {string} newContent - The new content.
     */
    updateMessageContent(message, newContent) {
        if (!message || typeof message !== 'object') {
            triggerError('Invalid message object provided to updateMessageContent.', message);
            return;
        }
        if (typeof newContent !== 'string') {
            triggerError('Invalid newContent provided to updateMessageContent. Must be a string.', newContent);
            return;
        }
        message.setContent(newContent);
        this._updateChat(false);
    }

    /**
     * Appends content to a message (for streaming).
     * @param {import('../components/chatlog.js').Message} message - The message to update.
     * @param {string} delta - The content to append.
     */
    appendMessageContent(message, delta) {
        if (!message || typeof message !== 'object') {
            triggerError('Invalid message object provided to appendMessageContent.', message);
            return;
        }
        if (typeof delta !== 'string') {
            triggerError('Invalid delta provided to appendMessageContent. Must be a string.', delta);
            return;
        }
        message.appendContent(delta);
        this._updateChat();
    }

    /**
     * Sets a message to edit mode.
     * @param {import('../components/chatlog.js').Message} message - The message to edit.
     */
    setEditMode(message) {
        if (!message || typeof message !== 'object') {
            triggerError('Invalid message object provided to setEditMode.', message);
            return;
        }
        const chatlog = this.chatBox.chatlog;
        if (!chatlog) return;

        const pos = chatlog.getMessagePos(message);
        this.store.set('editingPos', pos);

        const alternatives = chatlog.findAlternativesForMessage(message);
        message.cache = this.chatBox.formatMessage({ value: { role: message.value.role, content: '🤔...' } }, pos, alternatives.activeMessageIndex, alternatives.messages.length);
        this._updateChat(false);
    }

    /**
     * Creates a new chat session.
     */
    createNewChat() {
        log(3, 'ChatUIManager: createNewChat called');
        if (this.store.get('receiving')) this.store.get('controller').abort();

        const ui = this.store.get('ui');
        ui.messageEl.value = '';
        ui.messageEl.style.height = 'auto';

        this.chatService.createNewChat();
    }

    /**
     * Switches the active chat session.
     * @param {string} id - The ID of the chat to switch to.
     */
    switchChat(id) {
        if (typeof id !== 'string') {
            triggerError('Invalid id provided to switchChat. Must be a string.', id);
            return;
        }
        log(3, 'ChatUIManager: switchChat called for id', id);
        this._resetEditing();
        this.chatService.switchChat(id);
        this.scrollToBottom();
    }

    _resetEditing() {
        const chatlog = this.chatBox.chatlog;
        if (!chatlog) return;
        const currentEditingPos = this.store.get('editingPos');
        if (currentEditingPos !== null) {
            const prevMsg = chatlog.getNthMessage(currentEditingPos);
            if (prevMsg) {
                if (prevMsg.value.content === null) {
                    chatlog.deleteMessage(prevMsg); // Discard uncommitted new alternative
                } else {
                    prevMsg.cache = null; // Restore original for previous edit
                }
            }
            this.store.set('editingPos', null);
            this.chatBox.update();
        }
    }

    scrollToBottom() {
        this.chatBox.container.parentElement.scrollTop = this.chatBox.container.parentElement.scrollHeight;
    }

    /**
     * Cycles through the alternative messages for a given message.
     * @param {import('../components/chatlog.js').Message} message - The message whose alternatives to cycle.
     * @param {'next' | 'prev'} direction - The direction to cycle.
     */
    cycleAlternatives(message, direction) {
        if (!message || typeof message !== 'object') {
            triggerError('Invalid message object provided to cycleAlternatives.', message);
            return;
        }
        if (direction !== 'next' && direction !== 'prev') {
            triggerError('Invalid direction provided to cycleAlternatives. Must be "next" or "prev".', direction);
            return;
        }
        const chatlog = this.chatBox.chatlog;
        if (!chatlog) return;

        chatlog.cycleAlternatives(message, direction);
        this._updateChat(false);
    }

    _updateChat(shouldScroll = true) {
        this.chatBox.update();
        if (shouldScroll) {
            this.scrollToBottom();
        }
        hooks.onChatUpdated.forEach(fn => fn(this.chatBox.chatlog));
    }

    /**
     * Deletes a chat and handles switching to the next available chat.
     * @param {string} chatId - The ID of the chat to delete.
     */
    deleteChat(chatId) {
        if (typeof chatId !== 'string') {
            triggerError('Invalid chatId provided to deleteChat. Must be a string.', chatId);
            return;
        }
        const nextChatId = this.chatService.deleteChat(chatId);
        if (nextChatId === 'new') {
            const newChat = this.chatService.createNewChat();
            this.switchChat(newChat.id);
        } else if (nextChatId) {
            this.switchChat(nextChatId);
        }
    }

    /**
     * Submits a message from the user input, handling both new messages and edits.
     * @param {string} message - The message content from the input field.
     * @param {string} userRole - The role selected for the message.
     */
    async submitMessage(message, userRole) {
        log(3, 'ChatUIManager: submitMessage called with role', userRole);
        const editedPos = this.store.get('editingPos');
        if (editedPos !== null) {
            await this.handleMessageEditing(message, userRole);
        } else {
            await this.handleNewMessage(message, userRole);
        }
    }

    async handleMessageEditing(message, userRole) {
        const chatlog = this.chatBox.chatlog;
        if (!chatlog) return;

        const editedPos = this.store.get('editingPos');
        log(4, 'ChatUIManager: Editing message at pos', editedPos);
        const msg = chatlog.getNthMessage(editedPos);
        if (msg) {
            msg.value.role = userRole;
            this.updateMessageContent(msg, message.trim());
        }
        this.store.set('editingPos', null);
        document.getElementById('user').checked = true;
        const editedMsg = chatlog.getNthMessage(editedPos);
        if (editedMsg.value.role !== 'assistant' && editedMsg.answerAlternatives === null && chatlog.getFirstMessage() !== editedMsg) {
            this.addStreamingMessage('assistant');
            await this.generateAIResponse();
        }
    }

    async handleNewMessage(message, userRole) {
        const chatlog = this.chatBox.chatlog;
        if (!chatlog) return;

        if (!this.store.get('regenerateLastAnswer') && !message) return;
        if (this.store.get('receiving') && !agentsPlugin.flowRunning) return;

        if (userRole === 'assistant') {
            let modifiedContent = message;
            for (let fn of hooks.beforeUserMessageAdd) {
                const result = fn(modifiedContent, userRole);
                if (result === false) return;
                if (typeof result === 'string') modifiedContent = result;
            }
            const newMessage = this.addMessage({ role: userRole, content: modifiedContent });
            hooks.afterMessageAdd.forEach(fn => fn(newMessage));
            return;
        }

        if (!this.store.get('regenerateLastAnswer')) {
            message = message.trim();
            let modifiedContent = message;
            for (let fn of hooks.beforeUserMessageAdd) {
                const result = fn(modifiedContent, userRole);
                if (result === false) return;
                if (typeof result === 'string') modifiedContent = result;
            }
            const newMessage = this.addMessage({ role: userRole, content: modifiedContent });
            hooks.afterMessageAdd.forEach(fn => fn(newMessage));
            this.addStreamingMessage('assistant');
        }

        this.store.set('regenerateLastAnswer', false);
        await this.generateAIResponse();
    }

    async generateAIResponse(options = {}, targetChatlog = this.chatBox.chatlog) {
        log(3, 'App: generateAIResponse called');
        if (this.store.get('receiving')) return;

        // 1. Get settings from all scopes
        const globalSettings = this.configService.getModelSettings();
        const currentChat = this.store.get('currentChat');
        const chatSettings = currentChat?.modelSettings || {};

        let agentSettings = {};
        const activeAgentId = currentChat?.activeAgentId;
        if (activeAgentId) {
            const agent = currentChat.agents.find(a => a.id === activeAgentId);
            if (agent && agent.useCustomModelSettings) {
                agentSettings = agent.modelSettings || {};
            }
        }

        // 2. Merge settings (agent > chat > global > options)
        const mergedSettings = { ...globalSettings, ...chatSettings, ...agentSettings, ...options };

        if (!mergedSettings.model) {
            log(2, 'App: No model selected');
            triggerError('Please select a model.');
            return;
        }

        this.store.set('receiving', true);
        const targetMessage = targetChatlog.getLastMessage();
        try {
            let payload = {
                messages: targetChatlog.getActiveMessageValues().filter(m => m.content !== null),
                stream: true
            };

            // 3. Apply settings to payload via hook
            hooks.onModelSettings.forEach(fn => fn(payload, mergedSettings));

            // Don't send a request if there are no messages or only a system prompt.
            if (payload.messages.length === 0) return;
            if (payload.messages.length === 1 && payload.messages[0]?.role === 'system') return;

            const systemMessage = targetChatlog.getFirstMessage();
            if (systemMessage && systemMessage.value.role === 'system') {
                let newContent = systemMessage.value.content;
                for (const fn of hooks.onModifySystemPrompt) {
                    newContent = fn(newContent) || newContent;
                }

                if (newContent !== systemMessage.value.content) {
                    systemMessage.setContent(newContent);
                }
            }
            payload = hooks.beforeApiCall.reduce((p, fn) => fn(p, this.chatBox) || p, payload);

            const endpoint = this.configService.getItem('endpoint', defaultEndpoint)
            const apiKey = this.configService.getItem('apiKey', '');
            const abortSignal = this.store.get('controller').signal;
            const reader = await this.apiService.streamAPIResponse(payload, endpoint, apiKey, abortSignal);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const valueStr = new TextDecoder().decode(value);
                if (valueStr.startsWith('{')) {
                    const data = JSON.parse(valueStr);
                    if (data.error) throw new Error(data.error.message);
                }
                const chunks = valueStr.split('\n');
                let delta = '';
                chunks.forEach(chunk => {
                    if (!chunk.startsWith('data: ')) return;
                    chunk = chunk.substring(6);
                    if (chunk === '' || chunk === '[DONE]') return;
                    const data = JSON.parse(chunk);
                    if (data.error) throw new Error(data.error.message);
                    delta += data.choices[0].delta.content || '';
                });
                if (delta === '') continue;
                log(5, 'App: Received chunk', delta);
                hooks.onChunkReceived.forEach(fn => fn(delta));
                this.appendMessageContent(targetMessage, delta);
            }
        } catch (error) {
            this.store.set('receiving', false); // Ensure receiving is false on error
            if (error.name === 'AbortError') {
                log(3, 'App: Response aborted');
                hooks.onCancel.forEach(fn => fn());
                this.store.set('controller', new AbortController());
                const lastMessage = targetChatlog.getLastMessage();
                if (lastMessage && lastMessage.value === null) {
                    const lastAlternatives = targetChatlog.getLastAlternatives();
                    lastAlternatives.messages.pop();
                    lastAlternatives.activeMessageIndex = lastAlternatives.messages.length - 1;
                    this.chatBox.update();
                } else if (lastMessage) {
                    this.appendMessageContent(lastMessage, '\n\n[Response aborted by user]');
                }
                return;
            }
            log(1, 'App: generateAIResponse error', error);
            triggerError(error.message);
            const lastMessage = targetChatlog.getLastMessage();
            if (lastMessage.value === null) {
                lastMessage.value = { role: 'assistant', content: `[Error: ${error.message}. Retry or check connection.]` };
                hooks.afterMessageAdd.forEach(fn => fn(lastMessage));
            } else {
                this.appendMessageContent(lastMessage, `\n\n[Error: ${error.message}. Retry or check connection.]`);
            }
            lastMessage.cache = null;
        } finally {
            // Set receiving to false before calling hooks, in case a hook triggers another generation
            this.store.set('receiving', false);
            const lastMessage = targetChatlog.getLastMessage();

            // Set metadata here so hooks can use it
            if (lastMessage && lastMessage.value !== null) {
                lastMessage.cache = null;
                lastMessage.metadata = { model: mergedSettings.model, temperature: mergedSettings.temperature, top_p: mergedSettings.top_p };
                hooks.onMessageComplete.forEach(fn => fn(lastMessage, targetChatlog, this));
            }
            this.chatBox.update();
            this.chatService.persistChats();
        }
    }
}

export default ChatUIManager;
