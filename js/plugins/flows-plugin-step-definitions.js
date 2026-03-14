/**
 * @fileoverview This file contains the definitions for all standard, built-in
 * steps that can be used in the "Flows" feature. It includes helper functions for
 * processing chat history and a main registration function that defines the
 * UI, data structure, and execution logic for each step type.
 * @version 1.0.0
 */

'use strict';

/**
 * @typedef {import('./flows-plugin.js').FlowManager} FlowManager
 * @typedef {import('../chat-data.js').ChatLog} ChatLog
 * @typedef {import('../chat-data.js').Message} Message
 */

/**
 * A mapping from internal role names to display-friendly names.
 * @const {Object.<string, string>}
 */
const roleMapping = {
    user: 'User',
    assistant: 'AI',
    system: 'System',
    tool: 'Tool',
    log: 'Log',
};

/**
 * Finds the last message in the active chat history that has more than one
 * alternative answer. This is used by steps like the 'Consolidator' to find
 * the conversational branch point to work from.
 * @param {ChatLog} chatLog The chat log to search.
 * @returns {Message | null} The message with alternatives, or `null` if not found.
 * @private
 */
function _findLastMessageWithAlternatives(chatLog) {
    const messages = chatLog.getActiveMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg && msg.answerAlternatives && msg.answerAlternatives.messages.length > 1) {
            return msg;
        }
    }
    return null;
}

/**
 * Extracts the full text content from one or more conversational branches starting from a given message.
 * It recursively traverses all paths from the `startMessage` to each leaf node.
 * @param {Message} startMessage The message to start the traversal from.
 * @param {boolean} onlyLast If `true`, only the content of the very last message in each branch is returned.
 * If `false`, the entire conversational path is formatted and returned.
 * @returns {string} The concatenated content of all found branches, separated by '---'.
 * @private
 */
function _extractContentFromBranch(startMessage, onlyLast) {
    const contents = [];

    const traverse = (message, currentPath) => {
        if (!message || !message.value) return;

        const role = roleMapping[message.value.role] || message.value.role;
        const formattedMessage = `**${role}:**\n${message.value.content || ''}`;
        const newPath = [...currentPath, formattedMessage];

        const hasAnswers = message.answerAlternatives && message.answerAlternatives.messages.length > 0;

        if (!hasAnswers) { // It's a leaf node
            if (onlyLast) {
                contents.push(message.value.content || '');
            } else {
                contents.push(newPath.join('\n\n'));
            }
            return;
        }

        for (const alt of message.answerAlternatives.messages) {
            traverse(alt, newPath);
        }
    }

    traverse(startMessage, []);
    return contents.join('\n\n---\n\n'); // Join content from different leaf branches
}

/**
 * Groups messages from the active chat history into "turns". A turn consists of a
 * non-AI message (user, system) followed by all subsequent AI messages (assistant, tool)
 * until the next non-AI message.
 * @param {ChatLog} chatLog The chat log to process.
 * @returns {Message[][]} An array of turns, where each turn is an array of messages.
 * @private
 */
function _getTurns(chatLog) {
    const messages = chatLog.getActiveMessages();
    const turns = [];
    let currentTurn = []; // A turn is an array of messages
    messages.forEach(msg => {
        const role = msg.value.role;
        if (role === 'log') return; // Skip log messages — they are display-only.
        if (role !== 'assistant' && role !== 'tool') {
            // A non-AI message starts a new turn.
            if (currentTurn.length > 0) {
                turns.push(currentTurn);
            }
            turns.push([msg]); // The new turn starts with this message.
            currentTurn = [];
        } else {
            // Add assistant/tool messages to the current turn.
            currentTurn.push(msg);
        }
    });
    if (currentTurn.length > 0) {
        turns.push(currentTurn);
    }
    return turns;
}

// --- Reusable Helpers for Flow Step Definitions ---

/**
 * A reusable onUpdate handler for flow steps that saves the target element's
 * value to the step's data object using the target's data-key attribute.
 * @param {object} step - The flow step object.
 * @param {HTMLElement} target - The input element that triggered the update.
 */
const _defaultOnUpdate = (step, target) => {
    step.data[target.dataset.key] = target.type === 'checkbox' ? target.checked : target.value;
};

/**
 * Generates HTML for multiple named output connectors at the bottom of a flow step.
 * Each output is a labeled connector dot that can be wired to a different next step.
 * @param {object} step - The flow step object.
 * @param {Array<{name: string, label: string}>} outputs - Output definitions.
 * @returns {string} HTML string for the connector group.
 */
function _renderOutputConnectors(step, outputs) {
    const connectors = outputs.map(o =>
        `<div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="${o.name}"><span class="connector-label">${o.label}</span></div>`
    ).join('');
    return `<div class="connector-group labels">${connectors}</div>`;
}

/**
 * Evaluates a condition against a text string using the specified matching strategy.
 * Used by the 'branch' and 'conditional-stop' flow step types.
 * @param {string} text - The text to test against.
 * @param {string} conditionType - One of 'contains', 'matches', or 'regex'.
 * @param {string} condition - The condition string or regex pattern.
 * @returns {boolean} Whether the condition matches.
 * @throws {Error} If conditionType is 'regex' and the pattern is invalid.
 */
function _evaluateCondition(text, conditionType, condition) {
    switch (conditionType) {
        case 'regex':
            try {
                return new RegExp(condition).test(text);
            } catch (e) {
                console.error('Invalid regex in flow condition:', e.message);
                return false;
            }
        case 'matches': return text === condition;
        default: return text.includes(condition);
    }
}

/**
 * Returns the HTML for a condition-type dropdown and condition textarea.
 * Used by the 'branch' and 'conditional-stop' flow step render functions.
 * @param {object} step - The flow step object.
 * @returns {string} HTML string for the condition UI controls.
 */
/**
 * Returns the content of the last non-log message in the active chat history.
 * Skips log messages since they are display-only and not part of the conversation.
 * @param {ChatLog} chatLog The chat log to search.
 * @returns {string} The content of the last relevant message, or an empty string.
 * @private
 */
function _getLastResponseContent(chatLog) {
    const messages = chatLog.getActiveMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].value.role !== 'log') {
            return messages[i].value.content || '';
        }
    }
    return '';
}

function _getConditionUI(step) {
    return `<label>Last Response Condition:</label>` +
        `<select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType">` +
        `<option value="contains" ${step.data.conditionType === 'contains' ? 'selected' : ''}>Contains String</option>` +
        `<option value="matches" ${step.data.conditionType === 'matches' ? 'selected' : ''}>Matches String</option>` +
        `<option value="regex" ${step.data.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option>` +
        `</select>` +
        `<textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.data.condition || ''}</textarea>`;
}

/**
 * Extracts formatted content from the last AI turn in the chat history.
 * Used by 'echo-answer' and 'agent-call-from-answer' flow steps.
 * @param {Message[][]} turns - The array of turns from _getTurns().
 * @param {boolean} onlyLastAnswer - If true, returns only the last message's content.
 *   If false, formats all messages in the turn with role labels.
 * @returns {{ content: string } | { error: string }} The extracted content or an error.
 */
function _extractLastAiTurnContent(turns, onlyLastAnswer) {
    if (turns.length < 1) {
        return { error: 'Not enough turns in the chat.' };
    }
    const lastTurn = turns[turns.length - 1];
    const isLastTurnAi = lastTurn.every(msg => msg.value.role === 'assistant' || msg.value.role === 'tool');
    if (!isLastTurnAi) {
        return { error: 'Last turn is not an AI turn.' };
    }
    if (onlyLastAnswer) {
        return { content: lastTurn[lastTurn.length - 1].value.content || '' };
    }
    const formatted = lastTurn.map(msg => {
        const role = roleMapping[msg.value.role] || msg.value.role;
        return `**${role}:** ${msg.value.content || ''}`;
    }).join('\n\n');
    return { content: formatted };
}

/**
 * Substitutes the ${LAST_RESPONSE} placeholder in a tool call JSON string
 * with the JSON-escaped content of the last message.
 * @param {string} toolCallStr - The raw tool call JSON string with optional ${LAST_RESPONSE} placeholders.
 * @param {string} lastMessageContent - The raw content of the last chat message.
 * @returns {string} The tool call string with the placeholder substituted.
 */
function _substituteLastResponse(toolCallStr, lastMessageContent) {
    const escaped = JSON.stringify(lastMessageContent).slice(1, -1);
    return toolCallStr.replace(/\${LAST_RESPONSE}/g, escaped);
}

/**
 * Formats the result of an MCP tool call into a display string.
 * @param {object} result - The MCP tool call result object.
 * @returns {string} A formatted string representation of the result.
 */
function _formatMcpResult(result) {
    if (result.isError) {
        if (typeof result.content === 'object' && result.content !== null && result.content.message) {
            return `Error: ${result.content.message}`;
        }
        return `Error: ${JSON.stringify(result.content)}`;
    }
    if (result.content && Array.isArray(result.content) && result.content[0]?.text) {
        return result.content[0].text;
    }
    return JSON.stringify(result.content, null, 2);
}

/**
 * Submits a prompt to the chat via the message input, optionally using a specific agent.
 * This is the standard way for flow steps to trigger a new AI response.
 * @param {object} context - The flow execution context.
 * @param {string} prompt - The text to submit.
 * @param {string} [agentId=''] - The agent ID to use for the response.
 */
function _submitPrompt(context, prompt, agentId = '') {
    context.app.dom.messageInput.value = prompt;
    context.app.chatManager.handleFormSubmit({ agentId });
}


/**
 * Registers all the standard flow step definitions with the `FlowManager`.
 * Each step is defined with its label, default data, rendering logic (`render`),
 * UI update handler (`onUpdate`), and execution logic (`execute`).
 * @param {FlowManager} flowManager The instance of the FlowManager to which the steps will be added.
 */
export function registerFlowStepDefinitions(flowManager) {
    const getAgentsDropdown = (step, agentOptions) => `
        <label>Agent:</label>
        <select class="flow-step-agent flow-step-input" data-id="${step.id}" data-key="agentId">
            <option value="">Default (Active Agent)</option>${agentOptions}
        </select>`;

    const getTextarea = (step, key, label, rows = 2) =>
        `<label>${label}:</label><textarea class="flow-step-input" rows="${rows}" data-id="${step.id}" data-key="${key}">${step.data[key] || ''}</textarea>`;

    const getCheckbox = (step, key, label) =>
        `<label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-input" data-id="${step.id}" data-key="${key}" ${step.data[key] ? 'checked' : ''}> ${label}</label>`;

    // --- Reusable UI and Logic for History Clearing ---

    const getClearHistoryUI = (step) => `
        <div class="clear-history-options">
            <label>From turn #:</label>
            <input type="number" class="flow-step-input" data-id="${step.id}" data-key="clearFrom" value="${step.data.clearFrom || 1}" min="1">
            <div class="clear-history-to-container" style="${step.data.clearToBeginning ? 'display: none;' : ''}">
                <label>To turn #:</label>
                <input type="number" class="flow-step-input" data-id="${step.id}" data-key="clearTo" value="${step.data.clearTo || 1}" min="1">
            </div>
            ${getCheckbox(step, 'clearToBeginning', 'Clear to beginning')}
            <small>(1 is the last turn)</small>
        </div>`;

    const handleClearHistoryUpdate = (step, target, renderAndConnect) => {
        const key = target.dataset.key;
        const value = target.type === 'checkbox' ? target.checked : parseInt(target.value, 10);
        step.data[key] = value;
        if (key === 'clearToBeginning') {
            renderAndConnect();
        }
    };

    const executeHistoryClearing = (stepData, chatLog, context) => {
        const turns = _getTurns(chatLog);
        const totalTurns = turns.length;
        let clearFrom = stepData.clearFrom || 1;
        let clearTo = stepData.clearToBeginning ? totalTurns : (stepData.clearTo || 1);

        // Clamp values
        if (clearFrom < 1) clearFrom = 1;
        if (clearTo > totalTurns) clearTo = totalTurns;

        const count = clearTo - clearFrom + 1;
        if (count <= 0) {
            return `At least one turn must be selected but ${count} turns selected.`;
        }

        for (let i = totalTurns - clearFrom; i >= totalTurns - clearTo; i--) {
            if (!turns[i]) continue;
            turns[i].forEach(msg => {
                const alternatives = chatLog.findAlternatives(msg);
                if (!alternatives) return;
                const activeMessage = alternatives.getActiveMessage();
                const messagesToDelete = [...alternatives.messages];
                messagesToDelete.forEach(altMsg => {
                    if (altMsg === activeMessage) {
                        chatLog.deleteMessageAndPreserveChildren(altMsg);
                    } else {
                        chatLog.deleteMessage(altMsg);
                    }
                });
            });
        }
        return null; // No error
    };


    flowManager._defineStep('simple-prompt', {
        label: 'Simple Prompt',
        triggersAIResponse: true,
        color: 'hsla(0, 0%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
        getDefaults: () => ({ prompt: 'Hello, world!', agentId: '' }),
        render: function(step, agentOptions) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}${getTextarea(step, 'prompt', 'Prompt', 3)}</div>`;
        },
        onUpdate: _defaultOnUpdate,
        execute: (step, context) => {
            if (!step.data.prompt) return context.stopFlow('Simple Prompt step not configured.');
            _submitPrompt(context, step.data.prompt, step.data.agentId);
        },
    });


    flowManager._defineStep('multi-prompt', {
        label: 'Multi Prompt',
        triggersAIResponse: true,
        color: 'hsla(145, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><path d="M14 10H6" /><path d="M14 6H6" /></svg>',
        getDefaults: () => ({ prompt: '', count: 2, agentId: '' }),
        render: function(step, agentOptions) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}${getTextarea(step, 'prompt', 'Prompt', 3)}<label>Number of alternatives:</label><input type="number" class="flow-step-count flow-step-input" data-id="${step.id}" data-key="count" value="${step.data.count || 1}" min="1" max="10"></div>`;
        },
        onUpdate: (step, target) => { step.data[target.dataset.key] = target.dataset.key === 'count' ? parseInt(target.value, 10) : target.value; },
        execute: (step, context) => {
            if (!step.data.prompt) return context.stopFlow('Multi Prompt step is not configured.');

            const runner = flowManager.activeFlowRunner;
            if (!runner) return context.stopFlow('Flow runner not active.');

            const chat = context.app.chatManager.getActiveChat();
            if (!chat) return context.stopFlow('No active chat.');

            // Add the user message that starts the multi-prompt
            chat.log.addMessage({ role: 'user', content: step.data.prompt }, {});
            // Add a placeholder for the first assistant message
            const assistantPlaceholder = chat.log.addMessage({ role: 'assistant', content: null, agent: step.data.agentId }, {});

            runner.multiPromptInfo = {
                active: true,
                step: step,
                counter: 1,
                // The first message is the one we will add alternatives to
                baseMessage: assistantPlaceholder,
            };

            // Trigger the processing of the pending message
            context.app.responseProcessor.scheduleProcessing(context.app);
        },
    });


    flowManager._defineStep('consolidator', {
        label: 'Alt. Consolidator',
        triggersAIResponse: true,
        color: 'hsla(280, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>',
        getDefaults: () => ({
            prePrompt: 'Please choose the best of the following answers (or if better than any single answer the best parts of the best answers combined):',
            postPrompt: 'Explain your choice.',
            agentId: '',
            onlyLastAnswer: false,
            // History clearing defaults
            clearHistory: false,
            clearFrom: 1,
            clearTo: 1,
            clearToBeginning: true
        }),
        render: function(step, agentOptions) {
            return `<h4>${this.icon} ${this.label}</h4>
            <div class="flow-step-content">
                ${getAgentsDropdown(step, agentOptions)}
                ${getTextarea(step, 'prePrompt', 'Text before alternatives')}
                ${getTextarea(step, 'postPrompt', 'Text after alternatives')}
                ${getCheckbox(step, 'onlyLastAnswer', 'Only include each last AI answer')}
                <hr class="divider">
                ${getCheckbox(step, 'clearHistory', 'Clear history before consolidating')}
                <div class="consolidator-clear-history-container" style="${step.data.clearHistory ? '' : 'display: none;'}">
                    ${getClearHistoryUI(step)}
                </div>
            </div>`;
        },
        onUpdate: (step, target, renderAndConnect) => {
            _defaultOnUpdate(step, target);
            const key = target.dataset.key;
            if (key === 'clearHistory') {
                renderAndConnect();
            } else if (key.startsWith('clear')) {
                handleClearHistoryUpdate(step, target, renderAndConnect);
            }
        },
        execute: (step, context) => {
            const chatLog = context.app.chatManager.getActiveChat()?.log;
            if (!chatLog) return context.stopFlow('No active chat.');

            const sourceMessage = _findLastMessageWithAlternatives(chatLog);
            if (!sourceMessage) {
                return context.stopFlow('Consolidator could not find a preceding step with alternatives.');
            }

            const consolidatedContent = sourceMessage.answerAlternatives.messages.map((alternativeStartMessage, i) => {
                const turnContent = _extractContentFromBranch(alternativeStartMessage, step.data.onlyLastAnswer);
                return `--- ALTERNATIVE ${i + 1} ---\n\n${turnContent}`;
            }).join('\n\n') + '\n\n--- END OF ALTERNATIVES ---';

            const finalPrompt = `${step.data.prePrompt || ''}\n\n${consolidatedContent}\n\n${step.data.postPrompt || ''}`;

            if (step.data.clearHistory) {
                const error = executeHistoryClearing(step.data, chatLog, context);
                if (error) {
                    return context.stopFlow(error);
                }
            }

            _submitPrompt(context, finalPrompt, step.data.agentId);
        },
    });


    flowManager._defineStep('echo-answer', {
        label: 'Echo Answer',
        triggersAIResponse: true,
        color: 'hsla(200, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 22L10 19M10 19L13 16M10 19H15C18.866 19 22 15.866 22 12C22 9.2076 20.3649 6.7971 18 5.67363M6 18.3264C3.63505 17.2029 2 14.7924 2 12C2 8.13401 5.13401 5 9 5H14M14 5L11 2M14 5L11 8"></path></svg>',
        getDefaults: () => ({
            prePrompt: 'Is this idea and code correct? Be concise.\n\n\n',
            postPrompt: '',
            agentId: '',
            deleteAIAnswer: true,
            deleteUserMessage: true,
            onlyLastAnswer: false,
        }),
        render: function(step, agentOptions) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content">
                ${getAgentsDropdown(step, agentOptions)}
                ${getTextarea(step, 'prePrompt', 'Text before AI answer')}
                ${getTextarea(step, 'postPrompt', 'Text after AI answer')}
                ${getCheckbox(step, 'onlyLastAnswer', 'Only include last AI answer')}
                <hr class="divider">
                <label>Before sending the message:</label>
                ${getCheckbox(step, 'deleteAIAnswer', 'Delete original AI answer')}
                ${getCheckbox(step, 'deleteUserMessage', 'Delete original user message')}
            </div>`;
        },
        onUpdate: (step, target, renderAndConnect) => {
            _defaultOnUpdate(step, target);
            const key = target.dataset.key;
            // If 'deleteUserMessage' is checked, 'deleteAIAnswer' must also be checked.
            if (key === 'deleteUserMessage' && step.data.deleteUserMessage) {
                step.data.deleteAIAnswer = true;
                renderAndConnect();
            }
            if (key === 'deleteAIAnswer' && !step.data.deleteAIAnswer && step.data.deleteUserMessage) {
                step.data.deleteUserMessage = false;
                renderAndConnect();
            }
        },
        execute: (step, context) => {
            const chatLog = context.app.chatManager.getActiveChat()?.log;
            if (!chatLog) return context.stopFlow('No active chat.');

            const turns = _getTurns(chatLog);
            if (turns.length < 2) {
                return context.stopFlow('Echo Answer: Not enough turns in the chat.');
            }

            const result = _extractLastAiTurnContent(turns, step.data.onlyLastAnswer);
            if (result.error) return context.stopFlow(`Echo Answer: ${result.error}`);

            const lastTurn = turns[turns.length - 1];
            const userTurn = turns[turns.length - 2];
            const newPrompt = `${step.data.prePrompt || ''}${result.content}${step.data.postPrompt || ''}`;

            if (step.data.deleteUserMessage) {
                // This will delete the user message and the entire AI turn that follows it.
                const userMessageToDelete = userTurn[0];
                chatLog.deleteMessage(userMessageToDelete);
            } else if (step.data.deleteAIAnswer) {
                // Delete each message in the AI turn individually.
                [...lastTurn].reverse().forEach(msg => chatLog.deleteMessage(msg));
            }

            _submitPrompt(context, newPrompt, step.data.agentId);
        },
    });


    flowManager._defineStep('log-message', {
        label: 'Log Message',
        color: 'hsla(210, 15%, 40%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
        getDefaults: () => ({ message: '' }),
        render: function(step) {
            return `<h4>${this.icon} ${this.label}</h4>
            <div class="flow-step-content">
                ${getTextarea(step, 'message', 'Message (leave empty for NOP)')}
            </div>`;
        },
        onUpdate: _defaultOnUpdate,
        execute: (step, context) => {
            if (step.data.message) {
                const chat = context.app.chatManager.getActiveChat();
                if (chat) {
                    chat.log.addMessage({ role: 'log', content: step.data.message });
                }
            }
            const nextStep = context.getNextStep(step.id);
            if (nextStep) return context.executeStep(nextStep);
            else context.stopFlow('Flow finished.');
        },
    });


    flowManager._defineStep('clear-history', {
        label: 'Clear History',
        color: 'hsla(0, 12%, 34%, 0.80)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>',
        getDefaults: () => ({ clearFrom: 2, clearTo: 3, clearToBeginning: true }),
        render: function(step) {
            return `<h4>${this.icon} ${this.label}</h4>
            <div class="flow-step-content">
                ${getClearHistoryUI(step)}
            </div>`;
        },
        onUpdate: (step, target, renderAndConnect) => {
            handleClearHistoryUpdate(step, target, renderAndConnect);
        },
        execute: (step, context) => {
            const chatLog = context.app.chatManager.getActiveChat()?.log;
            if (!chatLog) return context.stopFlow('No active chat.');

            const error = executeHistoryClearing(step.data, chatLog, context);
            if (error) {
                return context.stopFlow(error);
            }

            const nextStep = context.getNextStep(step.id);
            if (nextStep) return context.executeStep(nextStep); else context.stopFlow();
        },
    });


    flowManager._defineStep('branch', {
        label: 'Branch',
        color: 'hsla(30, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="4" r="2"></circle><circle cx="7" cy="20" r="2"></circle><circle cx="17" cy="20" r="2"></circle><path d="M7 18V6"></path><path d="M7 7c0 1.66 1.34 3 3 3h5c1.1 0 2 .9 2 2v6"></path></svg>',
        getDefaults: () => ({ conditionType: 'contains', condition: '' }),
        outputNames: ['pass', 'fail'],
        render: function(step) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content">${_getConditionUI(step)}</div>`;
        },
        renderOutputConnectors: (step) => _renderOutputConnectors(step, [{name: 'pass', label: 'Pass'}, {name: 'fail', label: 'Fail'}]),
        onUpdate: _defaultOnUpdate,
        execute: (step, context) => {
            const chatLog = context.app.chatManager.getActiveChat()?.log;
            if (!chatLog) return context.stopFlow('No active chat.');
            const lastContent = _getLastResponseContent(chatLog);
            let isMatch = false;
            try {
                isMatch = _evaluateCondition(lastContent, step.data.conditionType, step.data.condition);
            } catch (e) { return context.stopFlow('Invalid regex in branching step.'); }
            const nextStep = context.getNextStep(step.id, isMatch ? 'pass' : 'fail');
            if (nextStep) return context.executeStep(nextStep); else context.stopFlow();
        },
    });


    flowManager._defineStep('token-count-branch', {
        label: 'Token Count Branch',
        color: 'hsla(30, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="4" r="2"></circle><circle cx="7" cy="20" r="2"></circle><circle cx="17" cy="20" r="2"></circle><path d="M7 18V6"></path><path d="M7 7c0 1.66 1.34 3 3 3h5c1.1 0 2 .9 2 2v6"></path></svg>',
        getDefaults: () => ({ tokenCount: 500 }),
        outputNames: ['pass', 'fail'],
        render: function(step) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content"><label>If token count is over:</label><input type="number" class="flow-step-token-count flow-step-input" data-id="${step.id}" data-key="tokenCount" value="${step.data.tokenCount || 500}" min="0"></div>`;
        },
        renderOutputConnectors: (step) => _renderOutputConnectors(step, [{name: 'pass', label: 'Over'}, {name: 'fail', label: 'Under'}]),
        onUpdate: (step, target) => { step.data[target.dataset.key] = parseInt(target.value, 10); },
        execute: (step, context) => {
            const chatLog = context.app.chatManager.getActiveChat()?.log;
            if (!chatLog) return context.stopFlow('No active chat.');

            if (typeof GPTTokenizer_cl100k_base === 'undefined') {
                console.error('GPT-Tokenizer not found. Make sure the library is loaded.');
                return context.stopFlow('Tokenizer library not available.');
            }

            const allMessagesContent = chatLog.getActiveMessages().map(msg => msg.value.content || '').join('\n');
            const tokenCount = GPTTokenizer_cl100k_base.encode(allMessagesContent).length;

            const isOverThreshold = tokenCount > (step.data.tokenCount || 500);

            const nextStep = context.getNextStep(step.id, isOverThreshold ? 'pass' : 'fail');
            if (nextStep) {
                return context.executeStep(nextStep);
            } else {
                context.stopFlow();
            }
        },
    });


    flowManager._defineStep('conditional-stop', {
        label: 'Conditional Stop',
        color: 'hsla(0, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>',
        getDefaults: () => ({ conditionType: 'contains', condition: '', onMatch: 'stop' }),
        render: function(step) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content">${_getConditionUI(step)}<label>On Match:</label><select class="flow-step-on-match flow-step-input" data-id="${step.id}" data-key="onMatch"><option value="stop" ${step.data.onMatch === 'stop' ? 'selected' : ''}>Stop flow</option><option value="continue" ${step.data.onMatch === 'continue' ? 'selected' : ''}>Must match to continue</option></select></div>`;
        },
        onUpdate: _defaultOnUpdate,
        execute: (step, context) => {
            const chatLog = context.app.chatManager.getActiveChat()?.log;
            if (!chatLog) return context.stopFlow('No active chat.');
            const lastContent = _getLastResponseContent(chatLog);
            let isMatch = false;
            try {
                isMatch = _evaluateCondition(lastContent, step.data.conditionType, step.data.condition);
            } catch (e) { return context.stopFlow('Invalid regex in conditional step.'); }
            if ((isMatch && step.data.onMatch === 'stop') || (!isMatch && step.data.onMatch === 'continue')) {
                return context.stopFlow('Flow stopped by conditional stop.');
            }
            const nextStep = context.getNextStep(step.id);
            if (nextStep) return context.executeStep(nextStep); else context.stopFlow();
        },
    });


    flowManager._defineStep('agent-call-from-answer', {
        label: 'Agent Call from Answer',
        triggersAIResponse: true,
        color: 'hsla(60, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 1-10 10h12a5 5 0 0 0 0-10Z"/></svg>',
        getDefaults: () => ({
            prePrompt: '',
            postPrompt: '',
            agentId: '',
            includeLastAnswer: true,
            onlyLastAnswer: false,
            fullContext: false,
        }),
        render: function(step, agentOptions) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content">
                ${getAgentsDropdown(step, agentOptions)}
                ${getTextarea(step, 'prePrompt', 'Text before AI answer (optional)')}
                ${getTextarea(step, 'postPrompt', 'Text after AI answer (optional)')}
                ${getCheckbox(step, 'includeLastAnswer', 'Include AI answer in prompt')}
                <div class="agent-call-answer-options" style="${!step.data.includeLastAnswer ? 'display: none;' : ''}">
                    ${getCheckbox(step, 'onlyLastAnswer', 'Only include last AI answer')}
                </div>
                <div class="agent-call-context-options" style="${step.data.includeLastAnswer ? 'display: none;' : ''}">
                    ${getCheckbox(step, 'fullContext', 'Prepend full conversation context')}
                </div>
            </div>`;
        },
        onUpdate: (step, target, renderAndConnect) => {
            _defaultOnUpdate(step, target);
            if (target.dataset.key === 'includeLastAnswer') renderAndConnect();
        },
        execute: (step, context) => {
            const chat = context.app.chatManager.getActiveChat();
            const chatLog = chat?.log;
            if (!chatLog) return context.stopFlow('No active chat.');

            const agentId = step.data.agentId;
            if (!agentId) return context.stopFlow('Agent Call: No agent selected.');

            const turns = _getTurns(chatLog);
            let contentToInclude = '';
            if (step.data.includeLastAnswer) {
                const result = _extractLastAiTurnContent(turns, step.data.onlyLastAnswer);
                if (result.error) return context.stopFlow(`Agent Call: ${result.error}`);
                contentToInclude = result.content;
            }

            const promptText = `${step.data.prePrompt || ''}${contentToInclude}${step.data.postPrompt || ''}`.trim();
            const isFullContext = !step.data.includeLastAnswer && step.data.fullContext;

            if (!promptText && !isFullContext) {
                return context.stopFlow('Agent Call: The prompt is empty and no context is included. The agent has nothing to do.');
            }

            const lastMessage = chatLog.getLastMessage();
            const lastDepth = lastMessage ? lastMessage.depth : -1;
            const newDepth = isFullContext ? lastDepth : lastDepth + 1;

            const messageToUpdate = chatLog.addMessage({
                role: 'tool',
                content: '', // Will be filled by streaming
                agent: agentId,
                is_full_context_call: isFullContext,
            }, { depth: newDepth });

            const messagesForAgent = chatLog.getHistoryForAgentCall(messageToUpdate, isFullContext);
            if (!messagesForAgent) {
                messageToUpdate.value.content = '<error>Could not reconstruct message history for agent call.</error>';
                chatLog.notify();
                return;
            }
            messagesForAgent.push({ role: 'user', content: promptText });

            return context.app.apiService.executeStreamingAgentCall(
                context.app,
                chat,
                messageToUpdate,
                messagesForAgent,
                agentId
            ).then(() => {
                const nextStep = context.getNextStep(step.id);
                if (nextStep) {
                    return context.executeStep(nextStep);
                } else {
                    context.stopFlow('Flow finished after agent call.');
                }
            }).catch(error => {
                context.stopFlow(`Error during agent call: ${error.message}`);
            });
        },
    });


    flowManager._defineStep('manual-mcp-call', {
        label: 'Manual MCP Call',
        triggersAIResponse: true,
        color: 'hsla(85, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 1-10 10h12a5 5 0 0 0 0-10Z"/></svg>',
        getDefaults: () => ({
            mcpServer: '',
            toolName: '',
            toolCall: '',
            createPrompt: false,
            prePrompt: '',
            postPrompt: ''
        }),
        render: function(step, agentOptions) {
            return `<h4>${this.icon} ${this.label}</h4>
            <div class="flow-step-content">
                <label>MCP Server URL (leave blank for Default Agent's MCP Server):</label>
                <div class="setting__control-wrapper">
                    <input type="text" class="flow-step-input" data-key="mcpServer" value="${step.data.mcpServer || ''}" placeholder="MCP Server URL">
                    <button class="mcp-refresh-btn">Refresh</button>
                </div>

                <label>Tool:</label>
                <select class="flow-step-input mcp-tool-select" data-key="toolName">
                    <option value="">Select a tool...</option>
                </select>

                <label>Tool Call (use \${LAST_RESPONSE} for substitution):</label>
                <textarea class="flow-step-input mcp-tool-call" data-key="toolCall" rows="4">${step.data.toolCall || ''}</textarea>
                <button class="mcp-test-btn">Test</button>

                <hr class="divider">

                ${getCheckbox(step, 'createPrompt', 'Create new prompt from call result')}

                <div class="mcp-prompt-options" style="${step.data.createPrompt ? '' : 'display: none;'}">
                    ${getTextarea(step, 'prePrompt', 'Text before result')}
                    ${getTextarea(step, 'postPrompt', 'Text after result')}
                </div>
            </div>`;
        },
        onUpdate: (step, target, renderAndConnect) => {
            _defaultOnUpdate(step, target);
            if (target.dataset.key === 'createPrompt') renderAndConnect();
        },

        onMount: (step, card, app) => {
            const mcpServerInput = card.querySelector('[data-key="mcpServer"]');
            const refreshBtn = card.querySelector('.mcp-refresh-btn');
            const toolSelect = card.querySelector('.mcp-tool-select');
            const toolCallTextarea = card.querySelector('.mcp-tool-call');
            const testBtn = card.querySelector('.mcp-test-btn');

            let tools = [];

            const fetchTools = async () => {
                const mcpServerUrl = step.data.mcpServer || app.agentManager.getEffectiveApiConfig().toolSettings.mcpServer;
                if (!mcpServerUrl) {
                    alert('Please set an MCP Server URL in the Default Agent settings or in this step.');
                    return;
                }
                try {
                    tools = await app.mcp.getTools(mcpServerUrl, true);
                    toolSelect.innerHTML = '<option value="">Select a tool...</option>';
                    tools.forEach(tool => {
                        const option = document.createElement('option');
                        option.value = tool.name;
                        option.textContent = tool.name;
                        toolSelect.appendChild(option);
                    });
                    toolSelect.value = step.data.toolName;
                } catch (error) {
                    alert(`Failed to fetch tools: ${error.message}`);
                }
            };

            refreshBtn.addEventListener('click', fetchTools);

            toolSelect.addEventListener('change', () => {
                const toolName = toolSelect.value;
                const tool = tools.find(t => t.name === toolName);
                if (tool) {
                    const params = tool.inputSchema?.properties || {};
                    const toolCall = {
                        tool: tool.name,
                        arguments: Object.fromEntries(
                            Object.entries(params).map(([key, value]) => [key, value.default ?? ''])
                        )
                    };
                    toolCallTextarea.value = JSON.stringify(toolCall, null, 2);
                    step.data.toolCall = toolCallTextarea.value;
                    step.data.toolName = toolName;
                }
            });

            testBtn.addEventListener('click', async () => {
                const chatLog = app.chatManager.getActiveChat()?.log;
                const lastMessage = chatLog ? _getLastResponseContent(chatLog) : '';
                const toolCallStr = _substituteLastResponse(toolCallTextarea.value, lastMessage);
                try {
                    const toolCall = JSON.parse(toolCallStr);
                    // Auto-inject __hidden_stack_id for stack tools so each chat has its own stack.
                    if (toolCall.tool?.startsWith('stack_')) {
                        toolCall.arguments = { ...toolCall.arguments, __hidden_stack_id: app.chatManager?.activeChatId || 'default' };
                    }
                    const result = await app.mcp.rpc('tools/call', { name: toolCall.tool, arguments: toolCall.arguments }, step.data.mcpServer);
                    alert(`Tool Result:\n${_formatMcpResult(result)}`);
                } catch (error) {
                    alert(`Error testing tool: ${error.message}`);
                }
            });

            // Initial fetch
            fetchTools();
        },

        execute: (step, context) => {
            const chatLog = context.app.chatManager.getActiveChat()?.log;
            const lastMessage = chatLog ? _getLastResponseContent(chatLog) : '';
            const toolCallStr = _substituteLastResponse(step.data.toolCall, lastMessage);

            try {
                const toolCall = JSON.parse(toolCallStr);
                // Auto-inject __hidden_stack_id for stack tools so each chat has its own stack.
                if (toolCall.tool?.startsWith('stack_')) {
                    toolCall.arguments = { ...toolCall.arguments, __hidden_stack_id: context.app.chatManager?.activeChatId || 'default' };
                }
                return context.app.mcp.rpc('tools/call', { name: toolCall.tool, arguments: toolCall.arguments }, step.data.mcpServer)
                    .then(result => {
                        const resultStr = _formatMcpResult(result);

                        if (step.data.createPrompt) {
                            const newPrompt = `${step.data.prePrompt || ''}${resultStr}${step.data.postPrompt || ''}`;
                            _submitPrompt(context, newPrompt);
                        } else {
                            const chat = context.app.chatManager.getActiveChat();
                            if (chat) {
                                chat.log.addMessage({
                                    role: 'tool',
                                    content: resultStr,
                                    metadata: { tool_call: toolCall }
                                });
                            }
                            const nextStep = context.getNextStep(step.id);
                            if (nextStep) {
                                return context.executeStep(nextStep);
                            } else {
                                context.stopFlow();
                            }
                        }
                    })
                    .catch(error => {
                        context.stopFlow(`Error in Manual MCP Call: ${error.message}`);
                    });
            } catch (error) {
                context.stopFlow(`Invalid JSON in tool call: ${error.message}`);
            }
        },
    });


    flowManager._defineStep('pop-from-stack', {
        label: 'Pop from Stack',
        triggersAIResponse: true,
        continueOutputName: 'next',
        outputNames: ['next', 'empty'],
        color: 'hsla(180, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v 8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8"/><path d="M21 11v 8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2v-8"/><path d="M11 11v 8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2v-8"/><path d="M7 11h14"/><path d="M9 7h10"/><path d="M11 3h6"/></svg>',
        getDefaults: () => ({ agentId: '' }),
        render: function(step, agentOptions) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}</div>`;
        },
        renderOutputConnectors: (step) => _renderOutputConnectors(step, [{name: 'next', label: 'Next'}, {name: 'empty', label: 'Empty'}]),
        onUpdate: _defaultOnUpdate,
        execute: (step, context) => {
            const chatId = context.app.chatManager?.activeChatId || 'default';
            return context.app.mcp.rpc('tools/call', { name: 'stack_pop_from_stack', arguments: { __hidden_stack_id: chatId } })
                .then(result => {
                    const prompt = result.content && result.content[0] ? result.content[0].text : '';
                    if (prompt) {
                        _submitPrompt(context, prompt, step.data.agentId);
                    } else {
                        const nextStep = context.getNextStep(step.id, 'empty');
                        if (nextStep) return context.executeStep(nextStep); else context.stopFlow();
                    }
                })
                .catch(error => {
                    context.stopFlow(`Error popping from stack: ${error.message}`);
                });
        },
    });

}
