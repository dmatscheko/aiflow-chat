/**
 * @fileoverview Defines the data structures for the chat history.
 */

'use strict';

import { log } from '../utils/logger.js';

/**
 * @class Message
 * Represents a single message in the chatlog.
 */
class Message {
    /**
     * @param {Object} value - The message value, e.g., { role: 'user', content: 'Hello' }.
     */
    constructor(value) {
        log(5, 'Message: Constructor called with value', value);
        this.value = value;
        this.metadata = null;
        this.cache = null;
        this.answerAlternatives = null;
    }

    /**
     * Retrieves the active answer message if alternatives exist.
     * @returns {Message | null} The active answer message or null.
     */
    getAnswerMessage() {
        log(5, 'Message: getAnswerMessage called');
        return this.answerAlternatives ? this.answerAlternatives.getActiveMessage() : null;
    }

    /**
     * Serializes the message to a JSON-compatible object.
     * @returns {Object} The serialized message.
     */
    toJSON() {
        log(6, 'Message: toJSON called');
        return {
            value: this.value,
            metadata: this.metadata,
            answerAlternatives: this.answerAlternatives
        };
    }

    /**
     * Sets the content of the message.
     * @param {string} content - The new content.
     */
    setContent(content) {
        log(5, 'Message: setContent called');
        this.value.content = content;
        this.cache = null;
    }

    /**
     * Appends a delta to the content of the message.
     * @param {string} delta - The content to append.
     */
    appendContent(delta) {
        log(5, 'Message: appendContent called with delta', delta);
        if (this.value === null) {
            this.value = { role: 'assistant', content: delta };
        } else {
            if (!this.value.content) this.value.content = '';
            this.value.content += delta;
        }
        this.cache = null;
    }
}

/**
 * @class Alternatives
 * Manages a set of alternative messages at a given point in the chatlog.
 */
class Alternatives {
    constructor() {
        log(5, 'Alternatives: Constructor called');
        this.messages = [];
        this.activeMessageIndex = -1;
    }

    /**
     * Adds a new message or updates the active one if it's null.
     * @param {Object} value - The value for the new message.
     * @returns {Message} The new or updated message.
     */
    addMessage(value) {
        log(5, 'Alternatives: addMessage called with value', value);
        this.clearCache();
        const current = this.getActiveMessage();
        if (current) {
            if (current && current.value === null) {
                current.value = value;
                return current;
            }
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
        log(5, 'Alternatives: getActiveMessage called');
        return this.activeMessageIndex !== -1 ? this.messages[this.activeMessageIndex] || null : null;
    }

    /**
     * Cycles to the next alternative message.
     * @returns {Message | null} The next message.
     */
    next() {
        log(5, 'Alternatives: next called');
        if (this.activeMessageIndex === -1) return null;
        if (!this.messages[this.activeMessageIndex] || this.messages[this.activeMessageIndex].value === null) {
            this.messages.splice(this.activeMessageIndex, 1);
        }
        this.activeMessageIndex = (this.activeMessageIndex + 1) % this.messages.length;
        return this.messages[this.activeMessageIndex];
    }

    /**
     * Cycles to the previous alternative message.
     * @returns {Message | null} The previous message.
     */
    prev() {
        log(5, 'Alternatives: prev called');
        if (this.activeMessageIndex === -1) return null;
        if (!this.messages[this.activeMessageIndex] || this.messages[this.activeMessageIndex].value === null) {
            this.messages.splice(this.activeMessageIndex, 1);
        }
        this.activeMessageIndex = (this.activeMessageIndex - 1 + this.messages.length) % this.messages.length;
        return this.messages[this.activeMessageIndex];
    }

    /**
     * Clears the cache for all messages in this set of alternatives.
     */
    clearCache() {
        log(5, 'Alternatives: clearCache called');
        this.messages.forEach(msg => { if (msg) msg.cache = null; });
    }

    /**
     * Serializes the alternatives to a JSON-compatible object.
     * @returns {Object} The serialized alternatives.
     */
    toJSON() {
        log(6, 'Alternatives: toJSON called');
        return {
            messages: this.messages.map(msg => msg ? msg.toJSON() : null),
            activeMessageIndex: this.activeMessageIndex
        };
    }
}

/**
 * @class Chatlog
 * A data structure for the chat history as a tree of alternatives.
 */
class Chatlog {
    constructor() {
        log(5, 'Chatlog: Constructor called');
        this.rootAlternatives = null;
    }

    addMessage(value) {
        log(4, 'Chatlog: addMessage called with role', value?.role);
        const lastMessage = this.getLastMessage();
        if (!lastMessage) {
            this.rootAlternatives = new Alternatives();
            const msg = this.rootAlternatives.addMessage(value);
            return msg;
        }
        if (lastMessage.value === null) {
            lastMessage.value = value;
            return lastMessage;
        }
        lastMessage.answerAlternatives = new Alternatives();
        const msg = lastMessage.answerAlternatives.addMessage(value);
        return msg;
    }

    getLastMessage() {
        log(5, 'Chatlog: getLastMessage called');
        const lastAlternatives = this.getLastAlternatives();
        return lastAlternatives ? lastAlternatives.getActiveMessage() : null;
    }

    getLastAlternatives() {
        log(5, 'Chatlog: getLastAlternatives called');
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

    getFirstMessage() {
        log(5, 'Chatlog: getFirstMessage called');
        return this.rootAlternatives ? this.rootAlternatives.getActiveMessage() : null;
    }

    /**
     * Loads the chatlog from serialized alternatives data.
     * This is a "dumb" load; it just reconstructs the objects.
     * The ChatLogManager is responsible for cleaning and notifying.
     * @param {Object} alternativesData - The serialized alternatives data.
     */
    load(alternativesData) {
        log(5, 'Chatlog: load called');
        let msgCount = 0;
        const buildAlternatives = (data) => {
            if (!data) return null;
            const alt = new Alternatives();
            alt.activeMessageIndex = data.activeMessageIndex;
            data.messages.forEach(parsedMsg => {
                if (!parsedMsg) return;
                const msg = new Message(parsedMsg.value);
                msg.metadata = parsedMsg.metadata;
                msg.answerAlternatives = buildAlternatives(parsedMsg.answerAlternatives);
                alt.messages.push(msg);
                msgCount++;
            });
            return alt;
        };
        this.rootAlternatives = buildAlternatives(alternativesData);
        log(3, 'Chatlog: Loaded with message count', msgCount);
    }

    /**
     * Serializes the chatlog to a JSON-compatible object.
     * @returns {Object} The serialized chatlog.
     */
    toJSON() {
        log(5, 'Chatlog: toJSON called');
        return this.rootAlternatives ? this.rootAlternatives.toJSON() : null;
    }
}

export { Chatlog, Message, Alternatives };
