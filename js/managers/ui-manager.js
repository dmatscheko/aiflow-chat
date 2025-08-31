/**
 * @fileoverview Manages all UI interactions and DOM manipulations for the chat.
 */

'use strict';

import { log, triggerError } from '../utils/logger.js';
import { hooks } from '../hooks.js';

class UIManager {
    constructor(store, chatLogManager) {
        this.store = store;
        this.chatLogManager = chatLogManager;
        this.container = document.getElementById('chat');
        this.onUpdate = null; // Callback for after updates.

        // Subscribe to chatlog changes to re-render
        this.chatLogManager.subscribe(this.render.bind(this));
    }

    /**
     * Adds a message with content to the chat.
     * If parent is provided, adds it as an alternative to the parent.
     * @param {object} value - The message value (e.g., { role: 'user', content: 'Hello' }).
     * @param {Message} [parent=null] - The parent message.
     * @returns {Message} The newly created message.
     */
    addMessageWithContent(value, parent = null) {
        let message;
        if (parent) {
            message = this.chatLogManager.addAlternative(parent, value);
        } else {
            message = this.chatLogManager.addMessage(value);
        }
        this.render();
        return message;
    }

    /**
     * Adds a message without content, typically for streaming AI responses.
     * @param {Message} [parent=null] - The parent message.
     * @returns {Message} The newly created (empty) message.
     */
    addMessageWithoutContent(parent = null) {
        return this.addMessageWithContent(null, parent);
    }

    /**
     * Deletes a message.
     * @param {Message} message - The message to delete.
     * @param {boolean} [deleteAllAfter=false] - If true, deletes all subsequent messages.
     */
    deleteMessage(message, deleteAllAfter = false) {
        if (deleteAllAfter) {
            // This is more complex, requires traversing and deleting.
            // For now, we only implement deleting the message and its direct children.
            const alternatives = this.chatLogManager.findAlternativesForMessage(message);
            if (alternatives) {
                const parent = this.chatLogManager.findParentOfAlternatives(alternatives);
                if (parent) {
                    parent.answerAlternatives = null;
                } else {
                    this.chatLogManager.chatlog.rootAlternatives = null;
                }
            }
        } else {
            this.chatLogManager.deleteMessage(message);
        }
        this.render();
    }

    /**
     * Changes the text content of a message. Used for streaming and editing.
     * @param {Message} message - The message to update.
     * @param {string} newText - The new text content.
     */
    changeMessageText(message, newText) {
        message.setContent(newText);
        this.render();
    }

    /**
     * Appends text to a message's content. Used for streaming.
     * @param {Message} message - The message to append to.
     * @param {string} delta - The text to append.
     */
    appendMessageText(message, delta) {
        message.appendContent(delta);
        this.chatLogManager.notify();
    }

    /**
     * Sets a message into editing mode in the UI.
     * This implementation is slightly different from the request.
     * It caches the original content and displays '🤔...'.
     * @param {Message} message - The message to put into edit mode.
     */
    setMessageToEditMode(message) {
        message.originalContent = message.value.content;
        message.setContent('🤔...');
        this.render(false); // Re-render without scrolling
    }

    resetEditing() {
        const currentEditingPos = this.store.get('editingPos');
        if (currentEditingPos !== null) {
            const prevMsg = this.chatLogManager.getNthMessage(currentEditingPos);
            if (prevMsg) {
                if (prevMsg.originalContent) {
                    // This was an existing message being edited. Restore content.
                    prevMsg.setContent(prevMsg.originalContent);
                    delete prevMsg.originalContent;
                    this.render(false);
                } else if (prevMsg.value.content === null) {
                    // This was a new alternative that was never filled. Delete it.
                    this.chatLogManager.deleteMessage(prevMsg); // This will trigger a render via notification
                }
            }
            this.store.set('editingPos', null);
        }
    }

    /**
     * Renders the entire chat log.
     * @param {boolean} [scroll=true] - Whether to scroll to the bottom.
     */
    render(scroll = true) {
        log(5, 'UIManager: render called, scroll:', scroll);
        if (!this.chatLogManager.chatlog) {
            this.container.innerHTML = '';
            return;
        }

        const shouldScrollDown = scroll && this.#isScrolledToBottom();
        const fragment = document.createDocumentFragment();
        let alternative = this.chatLogManager.chatlog.rootAlternatives;
        let lastRole = 'assistant';
        let pos = 0;

        while (alternative) {
            const message = alternative.getActiveMessage();
            if (!message) break;
            if (message.cache) {
                fragment.appendChild(message.cache);
                lastRole = message.value.role;
                alternative = message.answerAlternatives;
                pos++;
                continue;
            }
            const msgIdx = alternative.activeMessageIndex;
            const msgCnt = alternative.messages.length;
            if (!message.value) {
                const role = lastRole === 'assistant' ? 'user' : 'assistant';
                const messageEl = this.formatMessage({ value: { role, content: '🤔...' } }, pos, msgIdx, msgCnt);
                fragment.appendChild(messageEl);
                break;
            }
            if (message.value.content === null) {
                const messageEl = this.formatMessage({ value: { role: message.value.role, content: '🤔...' } }, pos, msgIdx, msgCnt);
                fragment.appendChild(messageEl);
                break;
            }
            const messageEl = this.formatMessage(message, pos, msgIdx, msgCnt);
            fragment.appendChild(messageEl);
            message.cache = messageEl;
            lastRole = message.value.role;
            alternative = message.answerAlternatives;
            pos++;
        }
        this.container.replaceChildren(fragment);
        if (shouldScrollDown) {
            this.container.parentElement.scrollTop = this.container.parentElement.scrollHeight;
        }
        if (this.onUpdate) this.onUpdate();
    }

    #isScrolledToBottom() {
        log(5, 'UIManager: #isScrolledToBottom called');
        const { scrollHeight, clientHeight, scrollTop } = this.container.parentElement;
        return scrollHeight - clientHeight <= scrollTop + 5;
    }

    formatMessage(message, pos, msgIdx, msgCnt) {
        log(5, 'UIManager: formatMessage called for pos', pos);
        const el = document.createElement('div');
        el.classList.add('message', message.value.role === 'assistant' ? 'pong' : 'ping');
        if (message.value.role === 'system') el.classList.add('system');
        el.dataset.pos = pos;

        const msgTitleStrip = document.createElement('small');
        const roleEl = document.createElement('b');
        roleEl.textContent = message.value.role;
        msgTitleStrip.appendChild(roleEl);

        if (message.metadata?.model) {
            const modelEl = document.createElement('span');
            modelEl.classList.add('right');
            modelEl.textContent = ` ${message.metadata.model}         `;
            msgTitleStrip.appendChild(modelEl);
        }

        const controlsContainer = document.createElement('span');
        controlsContainer.classList.add('message-controls', 'nobreak');
        hooks.onRenderMessageControls.forEach(fn => fn(controlsContainer, message, this, this.chatLogManager));
        msgTitleStrip.appendChild(controlsContainer);

        el.appendChild(msgTitleStrip);
        el.appendChild(document.createElement('br'));
        el.appendChild(document.createElement('br'));

        const formattedContent = this.#formatContent(message.value.content, message, pos);
        if (formattedContent) {
            el.appendChild(formattedContent);
        }

        hooks.onRenderMessage.forEach(fn => fn(el, message, this));
        return el;
    }

    #formatContent(text, message, pos) {
        log(5, 'UIManager: #formatContent called');
        if (!text) return null;
        try {
            text = text.trim();
            let html = text;
            hooks.onFormatContent.forEach(fn => { html = fn(html, pos); });
            const wrapper = document.createElement('div');
            wrapper.classList.add('content');
            wrapper.innerHTML = html;
            hooks.onPostFormatContent.forEach(fn => { fn(wrapper, message, pos); });
            return wrapper;
        } catch (error) {
            log(1, 'UIManager: Formatting error', error);
            triggerError('Formatting error:', error);
            const wrapper = document.createElement('div');
            wrapper.classList.add('content');
            wrapper.innerHTML = `<p>Error formatting content: ${error.message}</p><pre>${text}</pre>`;
            return wrapper;
        }
    }
}

export default UIManager;
