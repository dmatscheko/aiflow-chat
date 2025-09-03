/**
 * @fileoverview Helper functions for flow execution.
 */

'use strict';

/**
 * Finds the last message in the active chat history that has multiple alternatives.
 * @param {import('../chat-data.js').ChatLog} chatLog - The chat log to search.
 * @returns {import('../chat-data.js').Message | null} The message object or null if not found.
 */
export function findLastMessageWithAlternatives(chatLog) {
    if (!chatLog.rootAlternatives) {
        return null;
    }

    const activeMessages = [];
    let current = chatLog.rootAlternatives.getActiveMessage();
    while (current) {
        activeMessages.push(current);
        current = current.getActiveAnswer();
    }

    for (let i = activeMessages.length - 1; i >= 0; i--) {
        const msg = activeMessages[i];
        if (msg.answerAlternatives && msg.answerAlternatives.messages.length > 1) {
            return msg;
        }
    }

    return null;
}


/**
 * Extracts content from a turn (a chain of messages starting from a given message).
 * A turn is traversed by starting with a message and following the active
 * path through its `answerAlternatives`.
 * @param {import('../chat-data.js').Message} startMessage - The first message in the turn.
 * @param {boolean} onlyLast - If true, only returns content from the last message in the turn.
 * @returns {{content: string, messages: import('../chat-data.js').Message[]}}
 */
export function extractContentFromTurn(startMessage, onlyLast) {
    const messagesInTurn = [];
    let currentMessage = startMessage;
    while (currentMessage) {
        messagesInTurn.push(currentMessage);
        currentMessage = currentMessage.getActiveAnswer();
    }

    let content;
    if (onlyLast) {
        const lastMessage = messagesInTurn.length > 0 ? messagesInTurn[messagesInTurn.length - 1] : null;
        content = lastMessage ? lastMessage.value.content || '' : '';
    } else {
        content = messagesInTurn
            .map(msg => `**${msg.value.role}:**\n${msg.value.content}`)
            .join('\n\n');
    }

    return {
        content: content,
        messages: messagesInTurn,
    };
}

/**
 * Finds the start of the last AI answer chain in the active chat history.
 * @param {import('../chat-data.js').ChatLog} chatLog - The chat log to search.
 * @returns {{startMessage: import('../chat-data.js').Message | null, userMessageIndex: number}}
 */
export function findLastAnswerChain(chatLog) {
    if (!chatLog.rootAlternatives) {
        return { startMessage: null, userMessageIndex: -1 };
    }

    const activeMessages = [];
    let current = chatLog.rootAlternatives.getActiveMessage();
    while (current) {
        activeMessages.push(current);
        current = current.getActiveAnswer();
    }

    let lastUserIndex = -1;
    for (let i = activeMessages.length - 1; i >= 0; i--) {
        if (activeMessages[i].value.role === 'user') {
            lastUserIndex = i;
            break;
        }
    }

    if (lastUserIndex === -1 || lastUserIndex === activeMessages.length - 1) {
        // No user message found, or it's the last message
        return { startMessage: null, userMessageIndex: lastUserIndex };
    }

    return {
        startMessage: activeMessages[lastUserIndex + 1],
        userMessageIndex: lastUserIndex,
    };
}
