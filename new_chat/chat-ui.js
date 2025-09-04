/**
 * @fileoverview The ChatUI component is responsible for displaying chat messages in the DOM.
 * It is designed to be self-contained and reusable.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./chat-data.js').ChatLog} ChatLog
 * @typedef {import('./chat-data.js').Message} Message
 */

/**
 * Manages the rendering of a ChatLog instance into a designated HTML element.
 * @class
 */
export class ChatUI {
    /**
     * @param {HTMLElement} container - The DOM element to render the chat messages into.
     */
    constructor(container) {
        if (!container) {
            throw new Error('ChatUI container element is required.');
        }
        /** @type {HTMLElement} */
        this.container = container;
        /** @type {ChatLog | null} */
        this.chatLog = null;
        /** @type {() => void} */
        this.boundUpdate = this.update.bind(this);
    }

    /**
     * Connects a ChatLog instance to this UI component.
     * The UI will automatically update when the ChatLog changes.
     * @param {ChatLog} chatLog - The chat log to display.
     */
    setChatLog(chatLog) {
        if (this.chatLog) {
            this.chatLog.unsubscribe(this.boundUpdate);
        }
        this.chatLog = chatLog;
        this.chatLog.subscribe(this.boundUpdate);
        this.update();
    }

    /**
     * Renders the chat log content into the container.
     * This method is typically called automatically when the connected ChatLog is updated.
     */
    update() {
        if (!this.chatLog) {
            this.container.innerHTML = '';
            return;
        }

        const shouldScroll = this.isScrolledToBottom();
        this.container.innerHTML = ''; // Clear previous content

        const fragment = document.createDocumentFragment();
        let current = this.chatLog.rootAlternatives ? this.chatLog.rootAlternatives.getActiveMessage() : null;

        while (current) {
            const messageEl = this.formatMessage(current);
            fragment.appendChild(messageEl);
            current = current.getActiveAnswer();
        }

        this.container.appendChild(fragment);

        if (shouldScroll) {
            this.scrollToBottom();
        }
    }

    /**
     * Creates an HTML element for a single message.
     * @param {Message} message - The message object to format.
     * @returns {HTMLElement} The formatted message element.
     * @private
     */
    formatMessage(message) {
        const el = document.createElement('div');
        el.classList.add('message', `role-${message.value.role}`);

        const roleEl = document.createElement('strong');
        roleEl.textContent = message.value.role;

        const contentEl = document.createElement('div');
        contentEl.textContent = message.value.content || '';

        // Allow plugins to modify the content element (e.g., for rich formatting)
        pluginManager.trigger('onFormatMessageContent', contentEl, message);

        el.appendChild(roleEl);
        el.appendChild(contentEl);

        return el;
    }

    /**
     * Checks if the container is scrolled to the bottom.
     * @returns {boolean}
     * @private
     */
    isScrolledToBottom() {
        const { scrollHeight, clientHeight, scrollTop } = this.container;
        // A little buffer of 5px
        return scrollHeight - clientHeight <= scrollTop + 5;
    }

    /**
     * Scrolls the container to the bottom.
     * @private
     */
    scrollToBottom() {
        this.container.scrollTop = this.container.scrollHeight;
    }
}
