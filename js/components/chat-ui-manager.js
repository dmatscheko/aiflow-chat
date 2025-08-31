/**
 * @fileoverview Manages the chat UI and interactions.
 */

'use strict';

import { ChatBox } from './chatbox.js';
import { Chatlog, Message } from './chatlog.js';
import { log } from '../utils/logger.js';
import { hooks } from '../hooks.js';

/**
 * @class ChatUIManager
 * Encapsulates the chatlog and chatBox, providing a high-level API for chat interactions.
 */
class ChatUIManager {
    /**
     * @param {import('../state/store.js').default} store - The application's state store.
     * @param {import('../services/ai-service.js').AIService} aiService - The AI service.
     */
    constructor(store, aiService) {
        log(3, 'ChatUIManager: Constructor called');
        this.store = store;
        this.aiService = aiService;
        this.editingPos = null;
        this.chatlog = null;
        this.chatBox = new ChatBox(store, this);
        this.onUpdate = null;

        this.chatBox.onUpdate = () => {
            if (this.onUpdate) {
                this.onUpdate();
            }
        };
    }

    /**
     * Sets the chatlog for the manager to display and control.
     * @param {Chatlog} chatlog - The chatlog to manage.
     */
    setChatlog(chatlog) {
        log(3, 'ChatUIManager: setChatlog called');
        this.chatlog = chatlog;
        this.chatBox.setChatlog(chatlog);
    }

    /**
     * Adds a message with content to the chat.
     * @param {object} value - The message value, e.g., { role: 'user', content: 'Hello' }.
     * @param {Message} [parentMessage=null] - The parent message to add this as an alternative to.
     * @returns {Message} The newly created message.
     */
    addMessageWithContent(value, parentMessage = null) {
        if (!this.chatlog) return null;
        return parentMessage
            ? this.chatlog.addAlternative(parentMessage, value)
            : this.chatlog.addMessage(value);
    }

    /**
     * Adds a message without content to the chat, typically for streaming a response.
     * @param {Message} [parentMessage=null] - The parent message to add this as an alternative to.
     * @returns {Message} The newly created message.
     */
    addMessageWithoutContent(parentMessage = null) {
        if (!this.chatlog) return null;
        // In the original code, an empty message was added by passing `null`.
        const value = null;
        return parentMessage
            ? this.chatlog.addAlternative(parentMessage, value)
            : this.chatlog.addMessage(value);
    }

    /**
     * Deletes a message.
     * @param {Message} message - The message to delete.
     * @param {boolean} [deleteFollowing=false] - If true, deletes all messages after this one in the branch.
     */
    deleteMessage(message, deleteFollowing = false) {
        if (!this.chatlog) return;
        if (deleteFollowing) {
            this.chatlog.deleteMessage(message);
        } else {
            const pos = this.chatlog.getMessagePos(message);
            this.chatlog.deleteNthMessage(pos);
        }
    }

    /**
     * Updates the text content of a message.
     * @param {Message} message - The message to update.
     * @param {string} newText - The new text content.
     */
    updateMessageText(message, newText) {
        if (!this.chatlog) return;
        message.setContent(newText);
        this.chatlog.notify();
    }

    /**
     * Updates the role of a message.
     * @param {Message} message - The message to update.
     * @param {string} newRole - The new role.
     */
    updateMessageRole(message, newRole) {
        if (!this.chatlog) return;
        message.setRole(newRole);
        this.chatlog.notify();
    }

    /**
     * Sets a message into edit mode, changing its appearance to '🤔...'.
     * @param {Message} message - The message to put into edit mode.
     */
    setMessageToEditMode(message) {
        if (!this.chatlog) return;
        const pos = this.chatlog.getMessagePos(message);
        const activeAlternatives = this.chatlog.findAlternativesForMessage(message);
        if (!activeAlternatives) return;
        const msgIdx = activeAlternatives.messages.indexOf(message);
        const msgCnt = activeAlternatives.messages.length;

        // Create a temporary element to show the editing state.
        const tempElement = this.chatBox.formatMessage(
            { value: { role: message.value.role, content: '🤔...' } },
            pos,
            msgIdx,
            msgCnt
        );
        message.cache = tempElement;
        this.chatBox.update(false); // Update without scrolling
    }

    /**
     * Resets the editing state of a message in the chat.
     */
    setEditingPos(pos) {
        this.editingPos = pos;
    }

    resetEditing() {
        if (!this.chatlog) return;
        const currentEditingPos = this.editingPos;
        if (currentEditingPos !== null) {
            const prevMsg = this.chatlog.getNthMessage(currentEditingPos);
            if (prevMsg) {
                // If it was a new message being composed, it might be null
                if (prevMsg.value === null) {
                    this.chatlog.deleteMessage(prevMsg);
                } else {
                    // Otherwise, just clear the cache to restore original content
                    prevMsg.cache = null;
                }
            }
            this.editingPos = null;
            this.chatBox.update(false);
        }
    }

    async _handleEditSubmission(message, userRole) {
        const editedPos = this.editingPos;
        log(4, 'ChatUIManager: Editing message at pos', editedPos);
        const msg = this.chatlog.getNthMessage(editedPos);
        if (msg) {
            this.updateMessageRole(msg, userRole);
            this.updateMessageText(msg, message.trim());
        }
        this.resetEditing();
        document.getElementById('user').checked = true;

        const editedMsg = this.chatlog.getNthMessage(editedPos);
        if (editedMsg.value.role !== 'assistant' && editedMsg.answerAlternatives === null && this.chatlog.getFirstMessage() !== editedMsg) {
            this.addMessageWithContent({ role: 'assistant', content: null });
            await this.aiService.generateAIResponse(this.chatlog, this.chatBox, {});
        }
    }

    async _handleNewSubmission(message, userRole) {
        if (!this.store.get('regenerateLastAnswer') && !message) return;
        if (this.store.get('receiving')) return;

        if (userRole === 'assistant') {
            let modifiedContent = message;
            for (let fn of hooks.beforeUserMessageAdd) {
                const result = fn(modifiedContent, userRole);
                if (result === false) return;
                if (typeof result === 'string') modifiedContent = result;
            }
            const newMessage = this.addMessageWithContent({ role: userRole, content: modifiedContent });
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
            const newMessage = this.addMessageWithContent({ role: userRole, content: modifiedContent });
            hooks.afterMessageAdd.forEach(fn => fn(newMessage));
            this.addMessageWithoutContent();
        }

        this.store.set('regenerateLastAnswer', false);

        await this.aiService.generateAIResponse(this.chatlog, this.chatBox, {});

        // Final update to ensure UI is consistent after response generation, especially for flows.
        this.chatBox.update();
    }

    /**
     * Submits a user message, handles editing, and triggers AI response.
     * @param {string} message - The message to submit.
     * @param {string} userRole - The role of the user.
     */
    async submitMessage(message, userRole) {
        log(3, 'ChatUIManager: submitMessage called with role', userRole);
        if (!this.chatlog) return;

        if (this.editingPos !== null) {
            await this._handleEditSubmission(message, userRole);
        } else {
            await this._handleNewSubmission(message, userRole);
        }
    }
}

export { ChatUIManager };
