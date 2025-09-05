/**
 * @fileoverview Defines the data structures for the chat history.
 * This file is self-contained and has no external dependencies.
 */

'use strict';

/**
 * @typedef {'user' | 'assistant' | 'system' | 'tool'} MessageRole
 */

/**
 * @typedef {object} MessageValue
 * @property {MessageRole} role - The role of the message author.
 * @property {string | null} content - The content of the message.
 * @property {string} [agent] - The ID of the agent used for this message.
 * @property {object} [metadata] - Optional metadata, e.g., for sources.
 */

/**
 * @typedef {object} SerializedMessage
 * @property {MessageValue} value - The value of the message.
 * @property {SerializedAlternatives | null} answerAlternatives - The serialized answer alternatives.
 */

/**
 * @typedef {object} SerializedAlternatives
 * @property {SerializedMessage[]} messages - The serialized messages.
 * @property {number} activeMessageIndex - The index of the active message.
 */

/**
 * Represents a single message in the chat log tree.
 * Each message is a node that contains its value and can have a child set of
 * alternative answers, forming a tree structure.
 * @class
 */
class Message {
    /**
     * @param {MessageValue} value - The message value, e.g., `{ role: 'user', content: 'Hello' }`.
     */
    constructor(value) {
        /** @type {MessageValue} */
        this.value = value;
        /**
         * The set of alternative messages that are answers to this message.
         * @type {Alternatives | null}
         */
        this.answerAlternatives = null;
    }

    /**
     * Gets the currently active answer message from the alternatives.
     * @returns {Message | null} The active answer message or null if no alternatives exist.
     */
    getActiveAnswer() {
        return this.answerAlternatives ? this.answerAlternatives.getActiveMessage() : null;
    }

    /**
     * Serializes the message to a JSON-compatible object.
     * @returns {SerializedMessage} A serializable representation of the message.
     */
    toJSON() {
        return {
            value: this.value,
            answerAlternatives: this.answerAlternatives ? this.answerAlternatives.toJSON() : null,
        };
    }
}

/**
 * Manages a set of alternative messages at a specific point in the conversation.
 * This allows for branching and exploring different conversational paths.
 * @class
 */
class Alternatives {
    constructor() {
        /** @type {Message[]} */
        this.messages = [];
        /** @type {number} */
        this.activeMessageIndex = -1;
    }

    /**
     * Adds a new message to the list of alternatives and sets it as the active one.
     * @param {MessageValue} value - The value for the new message.
     * @returns {Message} The newly created message instance.
     */
    addMessage(value) {
        const newMessage = new Message(value);
        this.activeMessageIndex = this.messages.push(newMessage) - 1;
        return newMessage;
    }

    /**
     * Gets the currently active message in this set of alternatives.
     * @returns {Message | null} The active message, or null if there are no messages.
     */
    getActiveMessage() {
        if (this.activeMessageIndex === -1 || this.messages.length === 0) {
            return null;
        }
        return this.messages[this.activeMessageIndex];
    }

    /**
     * Serializes the alternatives to a JSON-compatible object.
     * @returns {SerializedAlternatives} A serializable representation of the alternatives.
     */
    toJSON() {
        return {
            messages: this.messages.map(msg => msg.toJSON()),
            activeMessageIndex: this.activeMessageIndex,
        };
    }
}

/**
 * Manages the entire chat history as a tree of messages and their alternatives.
 * @class
 */
export class ChatLog {
    constructor() {
        /**
         * The root of the message tree.
         * @type {Alternatives | null}
         */
        this.rootAlternatives = null;
        /**
         * A list of callback functions to be called on any change.
         * @type {Array<() => void>}
         */
        this.subscribers = [];
    }

    /**
     * Adds a message to the active conversational path.
     * If it's the first message, it creates the root. Otherwise, it adds it as an
     * answer to the last message in the active path.
     * @param {MessageValue} value - The value of the message to add.
     * @returns {Message} The newly added message instance.
     */
    addMessage(value) {
        const lastMessage = this.getLastMessage();
        let newMessage;
        if (!lastMessage) {
            // This is the first message in the chat.
            this.rootAlternatives = new Alternatives();
            newMessage = this.rootAlternatives.addMessage(value);
        } else {
            // Add the new message as an answer to the last message.
            if (!lastMessage.answerAlternatives) {
                lastMessage.answerAlternatives = new Alternatives();
            }
            newMessage = lastMessage.answerAlternatives.addMessage(value);
        }
        this.notify();
        return newMessage;
    }

    /**
     * Gets the last message in the active conversational path.
     * @returns {Message | null}
     */
    getLastMessage() {
        if (!this.rootAlternatives) {
            return null;
        }
        let current = this.rootAlternatives.getActiveMessage();
        while (current && current.getActiveAnswer()) {
            current = current.getActiveAnswer();
        }
        return current;
    }

    /**
     * Returns an array of all message values in the active path.
     * @returns {MessageValue[]}
     */
    getActiveMessageValues() {
        const result = [];
        if (!this.rootAlternatives) {
            return result;
        }
        let current = this.rootAlternatives.getActiveMessage();
        while (current) {
            result.push(current.value);
            current = current.getActiveAnswer();
        }
        return result;
    }

    /**
     * Finds the first pending assistant message in the log.
     * A pending message is one with a role of 'assistant' and content of null.
     * @returns {Message | null}
     */
    findNextPendingMessage() {
        if (!this.rootAlternatives) {
            return null;
        }

        // Helper function to perform a depth-first search.
        const findInAlternatives = (alternatives) => {
            for (const message of alternatives.messages) {
                // Check the current message
                if (message.value.role === 'assistant' && message.value.content === null) {
                    return message;
                }
                // Recurse into the answers of the current message
                if (message.answerAlternatives) {
                    const found = findInAlternatives(message.answerAlternatives);
                    if (found) {
                        return found;
                    }
                }
            }
            return null;
        };

        return findInAlternatives(this.rootAlternatives);
    }

    /**
     * Gets the history of message values leading up to a specific message.
     * @param {Message} targetMessage - The message to get the history for.
     * @returns {MessageValue[] | null} An array of message values, or null if the message isn't found.
     */
    getHistoryBeforeMessage(targetMessage) {
        if (!this.rootAlternatives) {
            return null;
        }

        const findPath = (alternatives, path) => {
            for (const message of alternatives.messages) {
                const currentPath = [...path, message.value];
                if (message === targetMessage) {
                    // Exclude the target message itself from the history.
                    return currentPath.slice(0, -1);
                }
                if (message.answerAlternatives) {
                    const result = findPath(message.answerAlternatives, currentPath);
                    if (result) {
                        return result;
                    }
                }
            }
            return null;
        };

        return findPath(this.rootAlternatives, []);
    }

    /**
     * Subscribes a callback function to be called on any change.
     * @param {() => void} callback
     */
    subscribe(callback) {
        this.subscribers.push(callback);
    }

    /**
     * Unsubscribes a callback function.
     * @param {() => void} callback
     */
    unsubscribe(callback) {
        this.subscribers = this.subscribers.filter(cb => cb !== callback);
    }

    /**
     * Notifies all subscribers that the chat log has changed.
     */
    notify() {
        this.subscribers.forEach(cb => cb());
    }

    /**
     * Serializes the entire chat log to a JSON-compatible object.
     * @returns {SerializedAlternatives | null} A serializable representation of the root alternatives, or null if the log is empty.
     */
    toJSON() {
        return this.rootAlternatives ? this.rootAlternatives.toJSON() : null;
    }

    /**
     * Creates a ChatLog instance from a serialized JSON object.
     * @param {SerializedAlternatives | null} jsonData - The serialized data to load from.
     * @returns {ChatLog} A new ChatLog instance populated with the provided data.
     */
    static fromJSON(jsonData) {
        const chatLog = new ChatLog();
        if (!jsonData) {
            return chatLog;
        }

        const buildAlternatives = (altData) => {
            const alternatives = new Alternatives();
            alternatives.activeMessageIndex = altData.activeMessageIndex;
            alternatives.messages = altData.messages.map(msgData => {
                const message = new Message(msgData.value);
                if (msgData.answerAlternatives) {
                    message.answerAlternatives = buildAlternatives(msgData.answerAlternatives);
                }
                return message;
            });
            return alternatives;
        };

        chatLog.rootAlternatives = buildAlternatives(jsonData);
        return chatLog;
    }
}
