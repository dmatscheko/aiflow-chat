/**
 * @fileoverview Defines the data structures for the chat history.
 * @licence MIT
 */

'use strict';

/**
 * @typedef {Object} MessageValue
 * @property {string} role - The role of the message author (e.g., 'user', 'assistant').
 * @property {string | null} content - The text content of the message.
 */

/**
 * Represents a single message in the chatlog.
 */
export class Message {
    /**
     * @param {MessageValue} value - The message value.
     */
    constructor(value) {
        /** @type {MessageValue} */
        this.value = value;
        /** @type {Alternatives | null} */
        this.answerAlternatives = null;
    }

    /**
     * Retrieves the active answer message if alternatives exist.
     * @returns {Message | null} The active answer message or null.
     */
    getAnswerMessage() {
        return this.answerAlternatives ? this.answerAlternatives.getActiveMessage() : null;
    }

    /**
     * Appends a delta to the content of the message.
     * @param {string} delta - The content to append.
     */
    appendContent(delta) {
        if (this.value === null) {
            this.value = { role: 'assistant', content: delta };
        } else {
            if (this.value.content === null) this.value.content = '';
            this.value.content += delta;
        }
    }
}

/**
 * Manages a set of alternative messages at a given point in the chatlog.
 */
export class Alternatives {
    constructor() {
        /** @type {Message[]} */
        this.messages = [];
        /** @type {number} */
        this.activeMessageIndex = -1;
    }

    /**
     * Adds a new message or updates the active one if it's null.
     * @param {MessageValue} value - The value for the new message.
     * @returns {Message} The new or updated message.
     */
    addMessage(value) {
        const current = this.getActiveMessage();
        if (current && current.value === null) {
            current.value = value;
            return current;
        }
        const newMessage = new Message(value);
        this.activeMessageIndex = this.messages.push(newMessage) - 1;
        return newMessage;
    }

    /**
     * Gets the currently active message.
     * @returns {Message | null} The active message or null.
     */
    getActiveMessage() {
        return this.activeMessageIndex !== -1 ? this.messages[this.activeMessageIndex] || null : null;
    }
}

/**
 * Manages the entire chat history as a tree of alternatives.
 */
export class Chatlog {
    constructor() {
        /** @type {Alternatives | null} */
        this.rootAlternatives = null;
        /** @type {Array<(scroll: boolean) => void>} */
        this.subscribers = [];
    }

    /**
     * Subscribes a callback to chatlog changes.
     * @param {(scroll: boolean) => void} cb - The callback to subscribe.
     */
    subscribe(cb) {
        this.subscribers.push(cb);
    }

    /**
     * Notifies all subscribers of a change.
     * @param {boolean} [scroll=true] - Whether to scroll to the bottom.
     */
    notify(scroll = true) {
        this.subscribers.forEach(cb => cb(scroll));
    }

    /**
     * Adds a message to the chatlog.
     * @param {MessageValue} value - The value of the message to add.
     * @returns {Message} The newly added message.
     */
    addMessage(value) {
        const lastMessage = this.getLastMessage();
        if (!lastMessage) {
            this.rootAlternatives = new Alternatives();
            const msg = this.rootAlternatives.addMessage(value);
            this.notify();
            return msg;
        }

        if (lastMessage.value === null) {
            lastMessage.value = value;
            this.notify();
            return lastMessage;
        }

        lastMessage.answerAlternatives = new Alternatives();
        const msg = lastMessage.answerAlternatives.addMessage(value);
        this.notify();
        return msg;
    }

    /**
     * Gets the first message in the active path.
     * @returns {Message | null} The first message.
     */
    getFirstMessage() {
        return this.rootAlternatives ? this.rootAlternatives.getActiveMessage() : null;
    }

    /**
     * Gets the last message in the active path.
     * @returns {Message | null} The last message.
     */
    getLastMessage() {
        const lastAlternatives = this.getLastAlternatives();
        return lastAlternatives ? lastAlternatives.getActiveMessage() : null;
    }

    /**
     * Gets the last set of alternatives in the active path.
     * @returns {Alternatives | null} The last alternatives.
     */
    getLastAlternatives() {
        let current = this.rootAlternatives;
        let last = current;
        while (current) {
            last = current;
            const activeMessage = current.getActiveMessage();
            if (!activeMessage || !activeMessage.answerAlternatives) break;
            current = activeMessage.answerAlternatives;
        }
        return last;
    }

    /**
     * Returns an array of active message values along the path.
     * @returns {MessageValue[]} The active message values.
     */
    getActiveMessageValues() {
        const result = [];
        let message = this.getFirstMessage();
        while (message && message.value) {
            result.push(message.value);
            message = message.getAnswerMessage();
        }
        return result.filter(v => v.content !== null);
    }
}
