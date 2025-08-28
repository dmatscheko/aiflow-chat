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


export { extractContentFromTurn };
