/**
 * @fileoverview Renders the chat interface.
 * @licence MIT
 */

'use strict';

import { Chatlog, Message } from './data.js';

/**
 * Manages the rendering of the chat UI.
 */
export class ChatUI {
    /**
     * @param {HTMLElement} container - The DOM element to render the chat in.
     * @param {Chatlog} chatlog - The chatlog data object.
     */
    constructor(container, chatlog) {
        /** @type {HTMLElement} */
        this.container = container;
        /** @type {Chatlog} */
        this.chatlog = chatlog;

        // Bind the update method to this instance and subscribe to chatlog changes.
        this.boundUpdate = this.update.bind(this);
        this.chatlog.subscribe(this.boundUpdate);

        this.update();
    }

    /**
     * Renders the chatlog to the DOM.
     */
    update() {
        // Clear the existing content
        this.container.innerHTML = '';

        const fragment = document.createDocumentFragment();
        let alternative = this.chatlog.rootAlternatives;

        // Traverse the active path through the chatlog's data structure
        while (alternative) {
            const message = alternative.getActiveMessage();
            if (!message) break;

            // Create and append the message element if it has content
            if (message.value && message.value.content) {
                const messageEl = this.formatMessage(message);
                fragment.appendChild(messageEl);
            }

            // Move to the next set of alternatives in the conversation
            alternative = message.answerAlternatives;
        }

        this.container.appendChild(fragment);
        // Always scroll to the latest message
        this.container.scrollTop = this.container.scrollHeight;
    }

    /**
     * Formats a single message object into an HTML element.
     * @param {Message} message - The message object to format.
     * @returns {HTMLElement} The formatted message element.
     */
    formatMessage(message) {
        const el = document.createElement('div');
        // Use the role to assign a CSS class ('user' or 'assistant')
        el.classList.add('message', message.value.role);

        // For simplicity, we'll just use the raw text content.
        // In a real app, you'd sanitize this and convert markdown.
        el.textContent = message.value.content;

        return el;
    }
}
