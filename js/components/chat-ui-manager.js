/**
 * @fileoverview Manages the chat UI and interactions.
 */

'use strict';

import { ChatBox } from './chatbox.js';
import { Chatlog, Message } from './chatlog.js';
import { log } from '../utils/logger.js';

/**
 * @class ChatUIManager
 * Encapsulates the chatlog and chatBox, providing a high-level API for chat interactions.
 */
class ChatUIManager {
    /**
     * @param {import('../state/store.js').default} store - The application's state store.
     */
    constructor(store) {
        log(3, 'ChatUIManager: Constructor called');
        this.store = store;
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
    resetEditing() {
        if (!this.chatlog) return;
        const currentEditingPos = this.store.get('editingPos');
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
            this.store.set('editingPos', null);
            this.chatBox.update(false);
        }
    }
}

export { ChatUIManager };
