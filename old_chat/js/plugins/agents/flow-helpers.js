/**
 * @fileoverview Helper functions for agent flow execution.
 */

'use strict';

/**
 * Extracts content from a turn (a chain of messages).
 * A turn is traversed by starting with a message and following the active
 * path through its `answerAlternatives`.
 *
 * @param {object} startMessage - The first message in the turn.
 * @param {boolean} onlyLast - If true, only returns content from the last message in the turn.
 * @returns {string} The extracted content.
 */
function extractContentFromTurn(startMessage, onlyLast) {
    const messagesInTurn = [];
    let currentMessage = startMessage;
    while (currentMessage) {
        messagesInTurn.push(currentMessage);
        currentMessage = currentMessage.getAnswerMessage();
    }

    let content;
    if (onlyLast) {
        const lastMessage = messagesInTurn.length > 0 ? messagesInTurn[messagesInTurn.length - 1] : null;
        if (!lastMessage || !lastMessage.value) {
            content = '';
        } else {
            let contentToReturn = '';
            if (lastMessage.value.content) {
                let textContent = lastMessage.value.content;
                if (typeof textContent !== 'string') {
                    textContent = JSON.stringify(textContent, null, 2);
                }
                contentToReturn += textContent;
            }
            if (lastMessage.value.tool_calls) {
                contentToReturn += JSON.stringify(lastMessage.value.tool_calls, null, 2);
            }
            content = contentToReturn;
        }
    } else {
        let fullContent = '';
        for (const msg of messagesInTurn) {
            if (msg.value) {
                const { role, content, tool_calls } = msg.value;
                fullContent += `**${role.charAt(0).toUpperCase() + role.slice(1)}:**\n`;
                if (content) {
                    let textContent = content;
                     if (typeof textContent !== 'string') {
                        textContent = JSON.stringify(textContent, null, 2);
                    }
                    fullContent += textContent + '\n';
                }
                if (tool_calls) {
                    fullContent += JSON.stringify(tool_calls, null, 2) + '\n';
                }
                fullContent += '\n';
            }
        }
        content = fullContent.trim();
    }

    return {
        content: content,
        messages: messagesInTurn,
    };
}


/**
 * Finds the last message in the active chat history that has multiple alternatives.
 * @param {object} chatlog - The chatlog instance to search.
 * @returns {object | null} The message object or null if not found.
 */
function findLastMessageWithAlternatives(chatlog) {
    const activeMessages = chatlog.getActiveMessageValues().map((_, i) => chatlog.getNthMessage(i));
    for (let i = activeMessages.length - 1; i >= 0; i--) {
        const msg = activeMessages[i];
        if (msg && msg.answerAlternatives && msg.answerAlternatives.messages.length > 1) {
            return msg;
        }
    }
    return null;
}

/**
 * Finds the start of the last AI answer chain in the active chat history.
 * An answer chain is a contiguous block of messages from the assistant.
 * @param {object} chatlog - The chatlog instance to search.
 * @returns {{startMessage: object, userMessageIndexToDelete: number} | {startMessage: null, userMessageIndexToDelete: number}}
 */
function findLastAnswerChain(chatlog) {
    const rlaMessages = chatlog.getActiveMessageValues().map((_, i) => {
        const msg = chatlog.getNthMessage(i);
        if (msg) {
            // Add a temporary property to the Message instance without changing its prototype
            msg.originalIndex = i;
        }
        return msg;
    }).filter(Boolean); // Filter out any null messages if chatlog is empty

    let lastMessage = rlaMessages.length > 0 ? rlaMessages[rlaMessages.length - 1] : null;
    let endOfAiAnswerRange = rlaMessages.length - 1;

    if (lastMessage && (lastMessage.value.role === 'user' || lastMessage.value.role === 'system')) {
        endOfAiAnswerRange--;
    }

    let startOfAiAnswerRange = -1;
    let userMessageIndexToDelete = -1;
    for (let i = endOfAiAnswerRange; i >= 0; i--) {
        const msg = rlaMessages[i].value;
        if (msg.role === 'user' || msg.role === 'system') {
            startOfAiAnswerRange = i + 1;
            userMessageIndexToDelete = i;
            break;
        }
    }
    if (startOfAiAnswerRange === -1) { // No user/system message found before
        const firstMessage = chatlog.getFirstMessage();
        const hasSystemPrompt = firstMessage && firstMessage.value.role === 'system';
        startOfAiAnswerRange = hasSystemPrompt ? 1 : 0;
    }

    const startMessage = rlaMessages[startOfAiAnswerRange] || null;

    return { startMessage, userMessageIndexToDelete };
}

export { extractContentFromTurn, findLastMessageWithAlternatives, findLastAnswerChain };
