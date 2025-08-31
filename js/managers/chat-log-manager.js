/**
 * @fileoverview Manages the chat history data structure (the "chatlog").
 */

'use strict';

import { log } from '../utils/logger.js';
import { Chatlog, Alternatives, Message } from '../components/chatlog.js';
import { hooks } from '../hooks.js';

class ChatLogManager {
    constructor(store) {
        this.store = store;
        this.chatlog = null;
        this.subscribers = [];
    }

    setChatlog(chatlog) {
        if (this.chatlog) {
            // Unsubscribe from old chatlog if needed, though notifications are now centralized
        }
        this.chatlog = chatlog;
        this.notify();
    }

    subscribe(cb) {
        log(5, 'ChatLogManager: subscribe called');
        this.subscribers.push(cb);
    }

    unsubscribe(cb) {
        log(5, 'ChatLogManager: unsubscribe called');
        this.subscribers = this.subscribers.filter(s => s !== cb);
    }

    notify(scroll = true) {
        log(5, 'ChatLogManager: notify called');
        this.subscribers.forEach(cb => cb(scroll));
        hooks.onChatUpdated.forEach(fn => fn(this.chatlog));
    }

    addMessage(value) {
        log(4, 'ChatLogManager: addMessage called with role', value?.role);
        const lastMessage = this.getLastMessage();
        if (!lastMessage) {
            this.chatlog.rootAlternatives = new Alternatives();
            const msg = this.chatlog.rootAlternatives.addMessage(value);
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

    getMessagePos(message) {
        log(5, 'ChatLogManager: getMessagePos called');
        let pos = 0;
        let current = this.chatlog.rootAlternatives;
        while (current) {
            const activeMessage = current.getActiveMessage();
            if (!activeMessage || !activeMessage.answerAlternatives || activeMessage === message) return pos;
            current = activeMessage.answerAlternatives;
            pos++;
        }
        return 0;
    }

    getFirstMessage() {
        log(5, 'ChatLogManager: getFirstMessage called');
        return this.chatlog.rootAlternatives ? this.chatlog.rootAlternatives.getActiveMessage() : null;
    }

    getLastMessage() {
        log(5, 'ChatLogManager: getLastMessage called');
        const lastAlternatives = this.getLastAlternatives();
        return lastAlternatives ? lastAlternatives.getActiveMessage() : null;
    }

    getNthMessage(n) {
        log(5, 'ChatLogManager: getNthMessage called for n', n);
        const alternatives = this.getNthAlternatives(parseInt(n));
        return alternatives ? alternatives.getActiveMessage() : null;
    }

    getNthAlternatives(n) {
        log(5, 'ChatLogManager: getNthAlternatives called for n', n);
        let pos = 0;
        let current = this.chatlog.rootAlternatives;
        while (current) {
            if (pos >= n) return current;
            const activeMessage = current.getActiveMessage();
            if (!activeMessage || !activeMessage.answerAlternatives) break;
            current = activeMessage.answerAlternatives;
            pos++;
        }
        return null;
    }

    getLastAlternatives() {
        log(5, 'ChatLogManager: getLastAlternatives called');
        let current = this.chatlog.rootAlternatives;
        let last = current;
        while (current) {
            last = current;
            const activeMessage = current.getActiveMessage();
            if (!activeMessage || !activeMessage.answerAlternatives) break;
            current = activeMessage.answerAlternatives;
        }
        return last;
    }

    getActiveMessageValues() {
        log(5, 'ChatLogManager: getActiveMessageValues called');
        const result = [];
        let message = this.getFirstMessage();
        while (message && message.value) {
            result.push(message.value);
            message = message.getAnswerMessage();
        }
        return result;
    }

    load(alternativesData) {
        log(5, 'ChatLogManager: load called');
        this.chatlog.load(alternativesData);
        this.clean();
        this.notify();
    }

    clean() {
        log(4, 'ChatLogManager: clean called');
        if (!this.chatlog.rootAlternatives) return;
        const badMessages = [];
        const stack = [this.chatlog.rootAlternatives];
        while (stack.length > 0) {
            const alt = stack.pop();
            alt.messages.forEach(msg => {
                if (msg.value === null || (msg.value && msg.value.content === null)) {
                    badMessages.push(msg);
                }
                if (msg.answerAlternatives) stack.push(msg.answerAlternatives);
            });
        }
        badMessages.forEach(msg => this.deleteMessage(msg));
        this.notify();
    }

    clearCache() {
        log(4, 'ChatLogManager: clearCache called');
        this.load(this.chatlog.rootAlternatives);
    }

    findAlternativesForMessage(messageToFind) {
        if (!this.chatlog.rootAlternatives) return null;
        const stack = [this.chatlog.rootAlternatives];
        while (stack.length > 0) {
            const alts = stack.pop();
            if (alts.messages.includes(messageToFind)) {
                return alts;
            }
            alts.messages.forEach(msg => {
                if (msg.answerAlternatives) {
                    stack.push(msg.answerAlternatives);
                }
            });
        }
        return null;
    }

    findParentOfAlternatives(alternativesToFind) {
        if (!this.chatlog.rootAlternatives || this.chatlog.rootAlternatives === alternativesToFind) {
            return null;
        }
        const stack = [this.chatlog.rootAlternatives];
        while (stack.length > 0) {
            const alts = stack.pop();
            for (const msg of alts.messages) {
                if (msg.answerAlternatives === alternativesToFind) {
                    return msg;
                }
                if (msg.answerAlternatives) {
                    stack.push(msg.answerAlternatives);
                }
            }
        }
        return null;
    }

    deleteMessage(message) {
        log(4, 'ChatLogManager: deleteMessage called for', message);
        const alternatives = this.findAlternativesForMessage(message);
        if (!alternatives) return;

        const index = alternatives.messages.indexOf(message);
        if (index === -1) return;

        alternatives.messages.splice(index, 1);

        if (alternatives.messages.length === 0) {
            const parent = this.findParentOfAlternatives(alternatives);
            if (parent) {
                parent.answerAlternatives = null;
            } else if (alternatives === this.chatlog.rootAlternatives) {
                this.chatlog.rootAlternatives = null;
            }
        } else {
            if (alternatives.activeMessageIndex === index) {
                alternatives.activeMessageIndex = Math.max(0, alternatives.messages.length - 1);
            } else if (alternatives.activeMessageIndex > index) {
                alternatives.activeMessageIndex--;
            }
        }

        alternatives.clearCache();
        this.notify();
    }

    deleteNthMessage(pos) {
        log(4, 'ChatLogManager: deleteNthMessage called for pos', pos);
        const msgToDelete = this.getNthMessage(pos);
        if (!msgToDelete) return;

        const childAlternatives = msgToDelete.answerAlternatives;

        if (pos === 0) {
            this.chatlog.rootAlternatives = childAlternatives;
        } else {
            const parentMsg = this.getNthMessage(pos - 1);
            if (parentMsg) {
                parentMsg.answerAlternatives = childAlternatives;
            }
        }
        this.notify();
    }

    cycleAlternatives(message, direction) {
        log(4, `ChatLogManager: cycleAlternatives called for`, message, `direction: ${direction}`);
        const alternatives = this.findAlternativesForMessage(message);
        if (!alternatives) return;

        if (direction === 'next') {
            alternatives.next();
        } else if (direction === 'prev') {
            alternatives.prev();
        }

        this.notify(false);
    }

    addAlternative(message, newValue) {
        log(4, `ChatLogManager: addAlternative called for`, message);
        const alternatives = this.findAlternativesForMessage(message);
        if (!alternatives) return null;

        const newMessage = alternatives.addMessage(newValue);
        this.notify();
        return newMessage;
    }

    toJSON() {
        log(5, 'ChatLogManager: toJSON called');
        return this.chatlog.toJSON();
    }
}

export default ChatLogManager;
