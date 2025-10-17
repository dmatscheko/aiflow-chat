/**
 * @fileoverview Defines the core data structures for managing chat history.
 * This file provides the classes (`Message`, `Alternatives`, `ChatLog`) that
 * model the chat as a tree structure, allowing for conversational branching,
 * serialization, and complex history management required for features like
 * agent calls and alternative responses. It is self-contained and has no
 * external dependencies.
 */

'use strict';

/**
 * Defines the possible roles for a message author in the chat.
 * @typedef {'user' | 'assistant' | 'system' | 'tool'} MessageRole
 */

/**
 * Represents the core content and properties of a message, designed to be
 * compatible with AI API standards (e.g., OpenAI API).
 * @typedef {object} MessageValue
 * @property {MessageRole} role - The role of the message author.
 * @property {string | null} content - The textual content of the message.
 * @property {string} [model] - The model used to generate this message (if applicable).
 * @property {object} [metadata] - Optional metadata, e.g., for tool call sources.
 */

/**
 * A JSON-serializable representation of a `Message` object.
 * @typedef {object} SerializedMessage
 * @property {MessageValue} value - The core value of the message.
 * @property {number} depth - The stack depth of the message, used for nesting agent calls.
 * @property {string} [agent] - The ID of the agent that generated this message.
 * @property {boolean} [is_full_context_call] - For agent calls, indicates if the full conversation history was provided.
 * @property {SerializedAlternatives | null} answerAlternatives - The serialized representation of the message's alternative answers.
 */

/**
 * A JSON-serializable representation of an `Alternatives` object.
 * @typedef {object} SerializedAlternatives
 * @property {SerializedMessage[]} messages - The array of serialized messages in this alternative set.
 * @property {number} activeMessageIndex - The index of the currently active message within the `messages` array.
 */

/**
 * Represents a single message node in the chat log tree.
 * Each message is a node that contains its own value (`MessageValue`) and can
 * have a child set of alternative answers (`Alternatives`), forming a tree
 * structure that allows for branching conversations.
 * @class
 */
class Message {
    /**
     * Creates an instance of a Message.
     * @param {MessageValue} value - The core message value, e.g., `{ role: 'user', content: 'Hello' }`.
     * @param {number} [depth=0] - The stack depth of the message, for indenting nested agent calls.
     * @param {string|null} [agent=null] - The ID of the agent responsible for this message.
     * @param {boolean|undefined} [is_full_context_call=undefined] - For agent calls, indicates if full context was provided.
     */
    constructor(value, depth = 0, agent = null, is_full_context_call = undefined) {
        /**
         * A unique identifier for the message.
         * @type {string}
         */
        this.id = `msg-${Date.now()}-${Math.random()}`;
        /**
         * The core properties of the message (role, content, etc.).
         * @type {MessageValue}
         */
        this.value = value;
        /**
         * The ID of the agent that generated this message, if any.
         * @type {string|null}
         */
        this.agent = agent;
        /**
         * For agent-generated messages, this flag indicates whether the agent was called
         * with the full conversation history (`true`) or a partial history (`false`).
         * @type {boolean|undefined}
         */
        this.is_full_context_call = is_full_context_call;
        /**
         * The stack depth of the message, used for visual indentation of nested agent calls.
         * @type {number}
         */
        this.depth = depth;
        /**
         * A container for alternative messages that are direct responses to this message.
         * This allows for branching the conversation. `null` if there are no alternatives.
         * @type {Alternatives | null}
         */
        this.answerAlternatives = null;
    }

    /**
     * Gets the currently active answer message from this message's alternatives.
     * @returns {Message | null} The active `Message` instance from the `answerAlternatives`,
     * or `null` if no alternatives exist or none are active.
     */
    getActiveAnswer() {
        return this.answerAlternatives ? this.answerAlternatives.getActiveMessage() : null;
    }

    /**
     * Serializes the message and its entire subtree of alternatives to a JSON-compatible object.
     * This method is automatically called by `JSON.stringify`.
     * @returns {SerializedMessage} A serializable representation of the message.
     */
    toJSON() {
        return {
            value: this.value,
            depth: this.depth,
            agent: this.agent,
            is_full_context_call: this.is_full_context_call,
            answerAlternatives: this.answerAlternatives ? this.answerAlternatives.toJSON() : null,
        };
    }
}

/**
 * Manages a set of alternative messages at a specific point in the conversation.
 * This class holds an array of `Message` objects and tracks which one is currently
 * active, allowing the user to cycle through different responses or branches.
 * @class
 */
class Alternatives {
    /**
     * Creates an instance of Alternatives.
     */
    constructor() {
        /**
         * The list of alternative messages.
         * @type {Message[]}
         */
        this.messages = [];
        /**
         * The index of the currently active message in the `messages` array.
         * @type {number}
         */
        this.activeMessageIndex = -1;
    }

    /**
     * Adds a new message to the list of alternatives and sets it as the active one.
     * @param {MessageValue} value - The value for the new message.
     * @param {number} depth - The stack depth of the message.
     * @param {string|null} [agent] - The ID of the agent responsible for the message.
     * @param {boolean|undefined} [is_full_context_call] - For agent calls, indicates if full context was provided.
     * @returns {Message} The newly created and added `Message` instance.
     */
    addMessage(value, depth, agent, is_full_context_call) {
        const newMessage = new Message(value, depth, agent, is_full_context_call);
        this.activeMessageIndex = this.messages.push(newMessage) - 1;
        return newMessage;
    }

    /**
     * Gets the currently active message in this set of alternatives.
     * @returns {Message | null} The active `Message` instance, or `null` if the list is empty.
     */
    getActiveMessage() {
        if (this.activeMessageIndex === -1 || this.messages.length === 0) {
            return null;
        }
        return this.messages[this.activeMessageIndex];
    }

    /**
     * Serializes the Alternatives object and its messages to a JSON-compatible object.
     * This method is automatically called by `JSON.stringify`.
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
 * This class is the primary data model for a single chat conversation. It uses a
 * publish-subscribe pattern to notify listeners (like the UI) of any changes.
 * @class
 */
export class ChatLog {
    /**
     * Creates an instance of ChatLog.
     */
    constructor() {
        /**
         * The root of the message tree. It's an `Alternatives` object to allow
         * even the very first message to have alternatives.
         * @type {Alternatives | null}
         */
        this.rootAlternatives = null;
        /**
         * A list of callback functions to be invoked when the chat log changes.
         * @type {Array<() => void>}
         * @private
         */
        this.subscribers = [];
    }

    /**
     * Adds a message to the currently active conversational path.
     * If it's the first message, it creates the root `Alternatives` set. Otherwise,
     * it adds the message as an answer to the last message in the active path.
     * The `depth` of the message can be explicitly set or is calculated based on the
     * previous message's depth (with user messages resetting depth to 0).
     * @param {MessageValue} value - The value of the message to add.
     * @param {object} [options] - Additional options for the message.
     * @param {number|null} [options.depth=null] - The explicit depth for the message. If null, it's calculated automatically.
     * @returns {Message} The newly created and added `Message` instance.
     */
    addMessage(value, { depth = null } = {}) {
        const { agent, is_full_context_call, ...messageValue } = value;
        const lastMessage = this.getLastMessage();
        let newMessage;

        let finalDepth = 0;
        if (depth !== null) {
            // If depth is explicitly provided, use it.
            finalDepth = depth;
        } else if (lastMessage) {
            // Otherwise, calculate based on the last message.
            // User messages always reset depth to 0.
            finalDepth = (messageValue.role === 'user') ? 0 : lastMessage.depth;
        }

        if (!lastMessage) {
            // This is the first message in the chat.
            this.rootAlternatives = new Alternatives();
            newMessage = this.rootAlternatives.addMessage(messageValue, finalDepth, agent, is_full_context_call);
        } else {
            // Add the new message as an answer to the last message.
            if (!lastMessage.answerAlternatives) {
                lastMessage.answerAlternatives = new Alternatives();
            }
            newMessage = lastMessage.answerAlternatives.addMessage(messageValue, finalDepth, agent, is_full_context_call);
        }
        this.notify();
        return newMessage;
    }

    /**
     * Traverses the active conversational path to find the very last message.
     * @returns {Message | null} The last `Message` in the active path, or `null` if the log is empty.
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
     * Returns an array of all message values (`MessageValue`) in the active conversational path,
     * from the root to the last message.
     * @returns {MessageValue[]} An array of the message values.
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
     * Returns an array of all message instances (`Message`) in the active conversational path,
     * from the root to the last message.
     * @returns {Message[]} An array of the `Message` instances.
     */
    getActiveMessages() {
        const result = [];
        if (!this.rootAlternatives) {
            return result;
        }
        let current = this.rootAlternatives.getActiveMessage();
        while (current) {
            result.push(current);
            current = current.getActiveAnswer();
        }
        return result;
    }

    /**
     * Finds the first pending message anywhere in the entire message tree.
     * A pending message is defined as one with a role of 'assistant' or 'tool' and `null` content.
     * It performs a depth-first search through all branches.
     * @returns {Message | null} The first pending `Message` found, or `null` if there are none.
     */
    findNextPendingMessage() {
        if (!this.rootAlternatives) {
            return null;
        }

        // Helper function to perform a depth-first search.
        const findInAlternatives = (alternatives) => {
            for (const message of alternatives.messages) {
                // Check the current message
                if ((message.value.role === 'assistant' || message.value.role === 'tool') && message.value.content === null) {
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
     * Gets the appropriate message history for an agent call, respecting context rules.
     * If `fullContext` is `false`, it returns an empty history.
     * If `fullContext` is `true`, it traverses the history backwards from the `callingMessage`
     * to find the correct context window, stopping at the boundary of a previous partial-context agent call.
     * This ensures that a sub-agent does not see the history of its parent's parent if the parent
     * was called with limited context.
     * @param {Message} callingMessage - The message that initiates the agent call (the message that will contain the agent's response).
     * @param {boolean} fullContext - Whether to provide the full conversation history to the agent.
     * @returns {MessageValue[]} An array of message values to be used as the context for the API call.
     */
    getHistoryForAgentCall(callingMessage, fullContext) {
        if (!fullContext) {
            return [];
        }

        const history = this.getMessagesBefore(callingMessage);
        if (!history) {
            return [];
        }

        let boundaryIndex = -1;

        // Find the boundary index by traversing backwards.
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];

            // Check if this message is the start of a new depth block.
            if (i === 0 || history[i-1].depth < msg.depth) {
                // If this block was initiated by a partial-context agent call, it's a boundary.
                if (msg.value.role === 'tool' && msg.is_full_context_call === false) {
                    boundaryIndex = i;
                    break;
                }
            }
        }

        if (boundaryIndex !== -1) {
            // If a boundary was found, return only the history from that point forward.
            return history.slice(boundaryIndex).map(msg => msg.value);
        } else {
            // No boundary found, so the agent sees the full history.
            return history.map(msg => msg.value);
        }
    }

    /**
     * Gets the history of `Message` instances leading up to a specific message in the tree.
     * It performs a depth-first search to find the path to the target message.
     * @param {Message} targetMessage - The message whose preceding history is required.
     * @returns {Message[] | null} An array of `Message` instances forming the path to the `targetMessage` (exclusive), or `null` if the message isn't found.
     */
    getMessagesBefore(targetMessage) {
        if (!this.rootAlternatives) {
            return null;
        }

        const findPath = (alternatives, path) => {
            for (const message of alternatives.messages) {
                const currentPath = [...path, message];
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
     * Gets the history of message values (`MessageValue`) leading up to a specific message.
     * @param {Message} targetMessage - The message to get the history for.
     * @returns {MessageValue[] | null} An array of `MessageValue` objects, or `null` if the message isn't found.
     */
    getMessageValuesBefore(targetMessage) {
        const messages = this.getMessagesBefore(targetMessage);
        return messages ? messages.map(message => message.value) : null;
    }

    /**
     * Finds the `Alternatives` object that directly contains the given message instance.
     * This is useful for operations that need to modify the list of alternatives a message belongs to.
     * @param {Message} targetMessage The message whose parent `Alternatives` object is to be found.
     * @returns {Alternatives | null} The `Alternatives` instance containing the `targetMessage`, or `null` if not found.
     */
    findAlternatives(targetMessage) {
        if (!this.rootAlternatives) {
            return null;
        }

        const find = (alternatives) => {
            if (alternatives.messages.includes(targetMessage)) {
                return alternatives;
            }
            for (const message of alternatives.messages) {
                if (message.answerAlternatives) {
                    const found = find(message.answerAlternatives);
                    if (found) {
                        return found;
                    }
                }
            }
            return null;
        };

        return find(this.rootAlternatives);
    }

    /**
     * Adds a new message as an alternative to an existing message.
     * This creates a new branch in the conversation at the level of the `existingMessage`.
     * @param {Message} existingMessage - The message to add an alternative to.
     * @param {MessageValue} newContent - The content for the new alternative message.
     * @returns {Message | null} The newly created `Message` instance, or `null` if the `existingMessage` was not found.
     */
    addAlternative(existingMessage, newContent) {
        const alternatives = this.findAlternatives(existingMessage);
        if (alternatives) {
            const { agent, is_full_context_call, ...messageValue } = newContent;
            const newMessage = alternatives.addMessage(messageValue, existingMessage.depth, agent, is_full_context_call);
            this.notify();
            return newMessage;
        }
        return null;
    }

    /**
     * Deletes a message and its entire subtree of replies and alternatives.
     * @param {Message} messageToDelete - The message to delete.
     */
    deleteMessage(messageToDelete) {
        const alternatives = this.findAlternatives(messageToDelete);
        if (!alternatives) return;

        const index = alternatives.messages.indexOf(messageToDelete);
        if (index > -1) {
            alternatives.messages.splice(index, 1);
            if (alternatives.messages.length === 0) {
                // If this was the last alternative, we need to remove the whole `Alternatives` node.
                // This is complex and currently left for the UI to handle by not displaying empty nodes.
            } else if (alternatives.activeMessageIndex >= index) {
                alternatives.activeMessageIndex = Math.max(0, alternatives.activeMessageIndex - 1);
            }
            this.notify();
        }
    }

    /**
     * Deletes a message but preserves its children by "re-parenting" them.
     * This is achieved by replacing the message in its parent `Alternatives` array
     * with its own direct children messages. This is useful for "collapsing" a message
     * in the conversation history without losing the subsequent replies.
     * @param {Message} messageToDelete - The message to be deleted.
     */
    deleteMessageAndPreserveChildren(messageToDelete) {
        const alternatives = this.findAlternatives(messageToDelete);
        if (!alternatives) return;

        const index = alternatives.messages.indexOf(messageToDelete);
        if (index === -1) return;

        const children = messageToDelete.answerAlternatives ? messageToDelete.answerAlternatives.messages : [];

        // Replace the message with its children in the parent's message list.
        alternatives.messages.splice(index, 1, ...children);

        // Adjust the active index to maintain a coherent conversational flow.
        if (alternatives.activeMessageIndex === index) {
            // If the deleted message was active, we try to keep the conversation flowing.
            if (messageToDelete.answerAlternatives && children.length > 0) {
                // If the deleted message had an active child, make that child the new active message.
                // This preserves the active path through the conversation tree.
                alternatives.activeMessageIndex = index + messageToDelete.answerAlternatives.activeMessageIndex;
            } else {
                // If there are no children, the active message becomes the one before the deleted one.
                alternatives.activeMessageIndex = Math.max(0, index - 1);
            }
        } else if (alternatives.activeMessageIndex > index) {
            // The active message was after the deleted one, so its index needs to be adjusted
            // by the number of children inserted minus the one message removed.
            alternatives.activeMessageIndex += children.length - 1;
        }

        this.notify();
    }

    /**
     * Cycles through the alternatives for a given message, changing the active one.
     * @param {Message} message - The message whose alternatives are to be cycled.
     * @param {'next' | 'prev'} direction - The direction to cycle ('next' or 'prev').
     */
    cycleAlternatives(message, direction) {
        const alternatives = this.findAlternatives(message);
        if (alternatives && alternatives.messages.length > 1) {
            if (direction === 'next') {
                alternatives.activeMessageIndex = (alternatives.activeMessageIndex + 1) % alternatives.messages.length;
            } else {
                alternatives.activeMessageIndex = (alternatives.activeMessageIndex - 1 + alternatives.messages.length) % alternatives.messages.length;
            }
            this.notify();
        }
    }

    /**
     * Subscribes a callback function to be invoked whenever the chat log changes.
     * @param {() => void} callback - The function to call on changes.
     */
    subscribe(callback) {
        this.subscribers.push(callback);
    }

    /**
     * Unsubscribes a previously registered callback function.
     * @param {() => void} callback - The function to remove from the subscribers list.
     */
    unsubscribe(callback) {
        this.subscribers = this.subscribers.filter(cb => cb !== callback);
    }

    /**
     * Notifies all subscribed listeners that the chat log has changed by invoking their callbacks.
     */
    notify() {
        this.subscribers.forEach(cb => cb());
    }

    /**
     * Serializes the entire chat log to a JSON-compatible object.
     * This method is automatically called by `JSON.stringify`.
     * @returns {SerializedAlternatives | null} A serializable representation of the root alternatives, or `null` if the log is empty.
     */
    toJSON() {
        return this.rootAlternatives ? this.rootAlternatives.toJSON() : null;
    }

    /**
     * Creates a `ChatLog` instance by deserializing a JSON object.
     * This static method recursively reconstructs the entire message tree from its serialized form.
     * @param {SerializedAlternatives | null} jsonData - The serialized data to load from.
     * @returns {ChatLog} A new `ChatLog` instance populated with the provided data.
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
                const message = new Message(msgData.value, msgData.depth, msgData.agent, msgData.is_full_context_call);
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
