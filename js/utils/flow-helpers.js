/**
 * @fileoverview Helper functions for agent flow execution.
 */

'use strict';

/**
 * Extracts content from a chain of messages linked by answerAlternatives.
 * @param {object} startMessage - The first message in the chain.
 * @param {boolean} onlyLast - If true, only returns content from the last message in the chain.
 * @returns {string} The extracted content.
 */
function extractTurnContent(startMessage, onlyLast) {
    if (onlyLast) {
        let lastMessageInTurn = startMessage;
        while (lastMessageInTurn.answerAlternatives && lastMessageInTurn.answerAlternatives.messages.length > 0) {
            lastMessageInTurn = lastMessageInTurn.answerAlternatives.messages[0];
        }
        return lastMessageInTurn.value?.content || '';
    } else {
        let turnContent = '';
        let currentMessageInTurn = startMessage;
        while (currentMessageInTurn) {
            if (currentMessageInTurn.value) {
                const { role, content } = currentMessageInTurn.value;
                turnContent += `**${role.charAt(0).toUpperCase() + role.slice(1)}:**\n${content}\n\n`;
            }

            if (currentMessageInTurn.answerAlternatives && currentMessageInTurn.answerAlternatives.messages.length > 0) {
                currentMessageInTurn = currentMessageInTurn.answerAlternatives.messages[0];
            } else {
                currentMessageInTurn = null;
            }
        }
        return turnContent.trim();
    }
}

/**
 * Extracts content from a simple array of message objects.
 * @param {Array<object>} messages - The array of message objects to process.
 * @param {boolean} onlyLast - If true, only returns content from the last message in the array.
 * @returns {string} The extracted content.
 */
function extractMessagesContent(messages, onlyLast) {
    const messagesToProcess = onlyLast ? messages.slice(-1) : messages;
    let fullContent = '';

    for (const msg of messagesToProcess) {
        let contentToAppend = '';
        if (msg.value) {
            if (msg.value.content) {
                let content = msg.value.content;
                if (typeof content !== 'string') {
                    content = JSON.stringify(content, null, 2);
                }
                contentToAppend += content;
            }
            if (msg.value.tool_calls) {
                contentToAppend += JSON.stringify(msg.value.tool_calls, null, 2);
            }
        }
        if (contentToAppend) {
            fullContent += contentToAppend + '\n\n';
        }
    }
    return fullContent.trim();
}

export { extractTurnContent, extractMessagesContent };
