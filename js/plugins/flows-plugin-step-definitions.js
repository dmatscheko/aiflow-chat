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
    if (!chatLog.rootAlternatives) {
        return null;
    }
    const messages = [];
    let current = chatLog.rootAlternatives.getActiveMessage();
    while (current) {
        messages.push(current);
        current = current.getActiveAnswer();
    }

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

    // --- Reusable UI and Logic for History Clearing ---

    const getClearHistoryUI = (step) => `
        <div class="clear-history-options">
            <label>From turn #:</label>
            <input type="number" class="flow-step-clear-from flow-step-input" data-id="${step.id}" data-key="clearFrom" value="${step.data.clearFrom || 1}" min="1">
            <div class="clear-history-to-container" style="${step.data.clearToBeginning ? 'display: none;' : ''}">
                <label>To turn #:</label>
                <input type="number" class="flow-step-clear-to flow-step-input" data-id="${step.id}" data-key="clearTo" value="${step.data.clearTo || 1}" min="1">
            </div>
            <label class="flow-step-checkbox-label">
                <input type="checkbox" class="flow-step-clear-beginning flow-step-input" data-id="${step.id}" data-key="clearToBeginning" ${step.data.clearToBeginning ? 'checked' : ''}>
                Clear to beginning
            </label>
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
        color: 'hsla(0, 0%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
        getDefaults: () => ({ prompt: 'Hello, world!', agentId: '' }),
        render: function(step, agentOptions) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}<label>Prompt:</label><textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.data.prompt || ''}</textarea></div>`;
        },
        onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
        execute: (step, context) => {
            if (!step.data.prompt) return context.stopFlow('Simple Prompt step not configured.');
            context.app.dom.messageInput.value = step.data.prompt;
            context.app.chatManager.handleFormSubmit({ agentId: step.data.agentId });
        },
    });

    flowManager._defineStep('multi-prompt', {
        label: 'Multi Prompt',
        color: 'hsla(145, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><path d="M14 10H6" /><path d="M14 6H6" /></svg>',
        getDefaults: () => ({ prompt: '', count: 2, agentId: '' }),
        render: function(step, agentOptions) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}<label>Prompt:</label><textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.data.prompt || ''}</textarea><label>Number of alternatives:</label><input type="number" class="flow-step-count flow-step-input" data-id="${step.id}" data-key="count" value="${step.data.count || 1}" min="1" max="10"></div>`;
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
                <label>Text before alternatives:</label>
                <textarea class="flow-step-pre-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="prePrompt">${step.data.prePrompt || ''}</textarea>
                <label>Text after alternatives:</label>
                <textarea class="flow-step-post-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="postPrompt">${step.data.postPrompt || ''}</textarea>
                <label class="flow-step-checkbox-label">
                    <input type="checkbox" class="flow-step-only-last-answer flow-step-input" data-id="${step.id}" data-key="onlyLastAnswer" ${step.data.onlyLastAnswer ? 'checked' : ''}>
                    Only include each last AI answer
                </label>
                <hr class="divider">
                <label class="flow-step-checkbox-label">
                    <input type="checkbox" class="flow-step-clear-history-toggle flow-step-input" data-id="${step.id}" data-key="clearHistory" ${step.data.clearHistory ? 'checked' : ''}>
                    Clear history before consolidating
                </label>
                <div class="consolidator-clear-history-container" style="${step.data.clearHistory ? '' : 'display: none;'}">
                    ${getClearHistoryUI(step)}
                </div>
            </div>`;
        },
        onUpdate: (step, target, renderAndConnect) => {
            const key = target.dataset.key;
            const isCheckbox = target.type === 'checkbox';
            const value = isCheckbox ? target.checked : target.value;

            step.data[key] = value;

            if (key === 'clearHistory') {
                renderAndConnect(); // Re-render to show/hide the history options
            } else if (Object.keys(step.data).some(k => k.startsWith('clear'))) {
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

            context.app.dom.messageInput.value = finalPrompt;
            context.app.chatManager.handleFormSubmit({ agentId: step.data.agentId });
        },
    });

    flowManager._defineStep('echo-answer', {
        label: 'Echo Answer',
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
                <label>Text before AI answer:</label>
                <textarea class="flow-step-pre-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="prePrompt">${step.data.prePrompt || ''}</textarea>
                <label>Text after AI answer:</label>
                <textarea class="flow-step-post-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="postPrompt">${step.data.postPrompt || ''}</textarea>
                <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-only-last-answer flow-step-input" data-id="${step.id}" data-key="onlyLastAnswer" ${step.data.onlyLastAnswer ? 'checked' : ''}> Only include last AI answer</label>
                <hr class="divider">
                <label>Before sending the message:</label>
                <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-delete-ai flow-step-input" data-id="${step.id}" data-key="deleteAIAnswer" ${step.data.deleteAIAnswer ? 'checked' : ''}> Delete original AI answer</label>
                <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-delete-user flow-step-input" data-id="${step.id}" data-key="deleteUserMessage" ${step.data.deleteUserMessage ? 'checked' : ''}> Delete original user message</label>
            </div>`;
        },
        onUpdate: (step, target, renderAndConnect) => {
            const key = target.dataset.key;
            const value = target.type === 'checkbox' ? target.checked : target.value;
            step.data[key] = value;

            // If 'deleteUserMessage' is checked, 'deleteAIAnswer' must also be checked.
            if (key === 'deleteUserMessage' && value) {
                step.data.deleteAIAnswer = true;
                // We need to re-render to update the checkbox state visually
                renderAndConnect();
            }
            if (key === 'deleteAIAnswer' && !value && step.data.deleteUserMessage) {
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

            const lastTurn = turns[turns.length - 1];
            const userTurn = turns[turns.length - 2];

            const isLastTurnAi = lastTurn.every(msg => msg.value.role === 'assistant' || msg.value.role === 'tool');

            if (!isLastTurnAi) {
                return context.stopFlow('Echo Answer: Last turn is not an AI turn.');
            }

            let contentToEcho = '';
            if (step.data.onlyLastAnswer) {
                const lastMessage = lastTurn[lastTurn.length - 1];
                contentToEcho = lastMessage.value.content || '';
            } else {
                contentToEcho = lastTurn.map(msg => {
                    const role = roleMapping[msg.value.role] || msg.value.role;
                    return `**${role}:** ${msg.value.content || ''}`;
                }).join('\n\n');
            }

            const newPrompt = `${step.data.prePrompt || ''}${contentToEcho}${step.data.postPrompt || ''}`;

            if (step.data.deleteUserMessage) {
                // This will delete the user message and the entire AI turn that follows it.
                const userMessageToDelete = userTurn[0];
                chatLog.deleteMessage(userMessageToDelete);
            } else if (step.data.deleteAIAnswer) {
                // Delete each message in the AI turn individually.
                [...lastTurn].reverse().forEach(msg => chatLog.deleteMessage(msg));
            }

            context.app.dom.messageInput.value = newPrompt;
            context.app.chatManager.handleFormSubmit({ agentId: step.data.agentId });
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
            if (nextStep) context.executeStep(nextStep); else context.stopFlow();
        },
    });

    flowManager._defineStep('branch', {
        label: 'Branch',
        color: 'hsla(30, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="4" r="2"></circle><circle cx="7" cy="20" r="2"></circle><circle cx="17" cy="20" r="2"></circle><path d="M7 18V6"></path><path d="M7 7c0 1.66 1.34 3 3 3h5c1.1 0 2 .9 2 2v6"></path></svg>',
        getDefaults: () => ({ conditionType: 'contains', condition: '' }),
        render: function(step) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content"><label>Last Response Condition:</label><select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType"><option value="contains" ${step.data.conditionType === 'contains' ? 'selected' : ''}>Contains String</option><option value="matches" ${step.data.conditionType === 'matches' ? 'selected' : ''}>Matches String</option><option value="regex" ${step.data.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option></select><textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.data.condition || ''}</textarea></div>`;
        },
        renderOutputConnectors: (step) => `<div class="connector-group labels"><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="pass"><span class="connector-label">Pass</span></div><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="fail"><span class="connector-label">Fail</span></div></div>`,
        onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
        execute: (step, context) => {
            const lastMessage = context.app.chatManager.getActiveChat()?.log.getLastMessage()?.value.content || '';
            let isMatch = false;
            try {
                switch(step.data.conditionType) {
                    case 'regex': isMatch = new RegExp(step.data.condition).test(lastMessage); break;
                    case 'matches': isMatch = (lastMessage === step.data.condition); break;
                    default: isMatch = lastMessage.includes(step.data.condition); break;
                }
            } catch (e) { return context.stopFlow('Invalid regex in branching step.'); }
            const nextStep = context.getNextStep(step.id, isMatch ? 'pass' : 'fail');
            if (nextStep) context.executeStep(nextStep); else context.stopFlow();
        },
    });

    flowManager._defineStep('token-count-branch', {
        label: 'Token Count Branch',
        color: 'hsla(30, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="4" r="2"></circle><circle cx="7" cy="20" r="2"></circle><circle cx="17" cy="20" r="2"></circle><path d="M7 18V6"></path><path d="M7 7c0 1.66 1.34 3 3 3h5c1.1 0 2 .9 2 2v6"></path></svg>',
        getDefaults: () => ({ tokenCount: 500 }),
        render: function(step) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content"><label>If token count is over:</label><input type="number" class="flow-step-token-count flow-step-input" data-id="${step.id}" data-key="tokenCount" value="${step.data.tokenCount || 500}" min="0"></div>`;
        },
        renderOutputConnectors: (step) => `<div class="connector-group labels"><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="pass"><span class="connector-label">Over</span></div><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="fail"><span class="connector-label">Under</span></div></div>`,
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
                context.executeStep(nextStep);
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
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content"><label>Last Response Condition:</label><select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType"><option value="contains" ${step.data.conditionType === 'contains' ? 'selected' : ''}>Contains String</option><option value="matches" ${step.data.conditionType === 'matches' ? 'selected' : ''}>Matches String</option><option value="regex" ${step.data.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option></select><textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.data.condition || ''}</textarea><label>On Match:</label><select class="flow-step-on-match flow-step-input" data-id="${step.id}" data-key="onMatch"><option value="stop" ${step.data.onMatch === 'stop' ? 'selected' : ''}>Stop flow</option><option value="continue" ${step.data.onMatch === 'continue' ? 'selected' : ''}>Must match to continue</option></select></div>`;
        },
        onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
        execute: (step, context) => {
            const lastMessage = context.app.chatManager.getActiveChat()?.log.getLastMessage()?.value.content || '';
            let isMatch = false;
            try {
                switch(step.data.conditionType) {
                    case 'regex': isMatch = new RegExp(step.data.condition).test(lastMessage); break;
                    case 'matches': isMatch = (lastMessage === step.data.condition); break;
                    default: isMatch = lastMessage.includes(step.data.condition); break;
                }
            } catch (e) { return context.stopFlow('Invalid regex in conditional step.'); }
            if ((isMatch && step.data.onMatch === 'stop') || (!isMatch && step.data.onMatch === 'continue')) {
                return context.stopFlow('Flow stopped by conditional stop.');
            }
            const nextStep = context.getNextStep(step.id);
            if (nextStep) context.executeStep(nextStep); else context.stopFlow();
        },
    });

    flowManager._defineStep('agent-call-from-answer', {
        label: 'Agent Call from Answer',
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
                <label>Text before AI answer (optional):</label>
                <textarea class="flow-step-pre-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="prePrompt">${step.data.prePrompt || ''}</textarea>
                <label>Text after AI answer (optional):</label>
                <textarea class="flow-step-post-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="postPrompt">${step.data.postPrompt || ''}</textarea>
                <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-include-last-answer flow-step-input" data-id="${step.id}" data-key="includeLastAnswer" ${step.data.includeLastAnswer ? 'checked' : ''}> Include AI answer in prompt</label>
                <div class="agent-call-answer-options" style="${!step.data.includeLastAnswer ? 'display: none;' : ''}">
                    <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-only-last-answer flow-step-input" data-id="${step.id}" data-key="onlyLastAnswer" ${step.data.onlyLastAnswer ? 'checked' : ''}> Only include last AI answer</label>
                </div>
                <div class="agent-call-context-options" style="${step.data.includeLastAnswer ? 'display: none;' : ''}">
                    <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-full-context flow-step-input" data-id="${step.id}" data-key="fullContext" ${step.data.fullContext ? 'checked' : ''}> Prepend full conversation context</label>
                </div>
            </div>`;
        },
        onUpdate: (step, target, renderAndConnect) => {
            const key = target.dataset.key;
            const value = target.type === 'checkbox' ? target.checked : target.value;
            step.data[key] = value;

            if (key === 'includeLastAnswer') {
                renderAndConnect();
            }
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
                if (turns.length < 1) {
                    return context.stopFlow('Agent Call: Not enough turns in the chat to include an answer.');
                }
                const lastTurn = turns[turns.length - 1];
                const isLastTurnAi = lastTurn.every(msg => msg.value.role === 'assistant' || msg.value.role === 'tool');

                if (!isLastTurnAi) {
                    return context.stopFlow('Agent Call: The last turn is not an AI turn, so its answer cannot be included.');
                }

                if (step.data.onlyLastAnswer) {
                    const lastMessage = lastTurn[lastTurn.length - 1];
                    contentToInclude = lastMessage.value.content || '';
                } else {
                    contentToInclude = lastTurn.map(msg => {
                        const role = roleMapping[msg.value.role] || msg.value.role;
                        return `**${role}:** ${msg.value.content || ''}`;
                    }).join('\n\n');
                }
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

            context.app.apiService.executeStreamingAgentCall(
                context.app,
                chat,
                messageToUpdate,
                messagesForAgent,
                agentId
            ).then(() => {
                const nextStep = context.getNextStep(step.id);
                if (nextStep) {
                    context.executeStep(nextStep);
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

                <label class="flow-step-checkbox-label">
                    <input type="checkbox" class="flow-step-input mcp-create-prompt" data-key="createPrompt" ${step.data.createPrompt ? 'checked' : ''}>
                    Create new prompt from call result
                </label>

                <div class="mcp-prompt-options" style="${step.data.createPrompt ? '' : 'display: none;'}">
                    <label>Text before result:</label>
                    <textarea class="flow-step-input" data-key="prePrompt" rows="2">${step.data.prePrompt || ''}</textarea>
                    <label>Text after result:</label>
                    <textarea class="flow-step-input" data-key="postPrompt" rows="2">${step.data.postPrompt || ''}</textarea>
                </div>
            </div>`;
        },
        onUpdate: (step, target, renderAndConnect) => {
            const key = target.dataset.key;
            const value = target.type === 'checkbox' ? target.checked : target.value;
            step.data[key] = value;

            if (key === 'createPrompt') {
                renderAndConnect(); // Re-render to show/hide the prompt options
            }
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
                            Object.entries(params).map(([key, value]) => [key, value.default || ''])
                        )
                    };
                    toolCallTextarea.value = JSON.stringify(toolCall, null, 2);
                    step.data.toolCall = toolCallTextarea.value;
                    step.data.toolName = toolName;
                }
            });

            testBtn.addEventListener('click', async () => {
                const lastMessage = app.chatManager.getActiveChat()?.log.getLastMessage()?.value.content || '';
                const escapedLastMessage = JSON.stringify(lastMessage).slice(1, -1);
                const toolCallStr = toolCallTextarea.value.replace(/\${LAST_RESPONSE}/g, escapedLastMessage);
                try {
                    const toolCall = JSON.parse(toolCallStr);
                    const result = await app.mcp.rpc('tools/call', { name: toolCall.tool, arguments: toolCall.arguments }, step.data.mcpServer);

                    let resultStr = '';
                    if (result.isError) {
                        if (typeof result.content === 'object' && result.content !== null && result.content.message) {
                            resultStr = `Error: ${result.content.message}`;
                        } else {
                            resultStr = `Error: ${JSON.stringify(result.content)}`;
                        }
                    } else if (result.content && Array.isArray(result.content) && result.content[0]?.text) {
                        resultStr = result.content[0].text;
                    } else {
                        resultStr = JSON.stringify(result.content, null, 2);
                    }
                    alert(`Tool Result:\n${resultStr}`);

                } catch (error) {
                    alert(`Error testing tool: ${error.message}`);
                }
            });

            // Initial fetch
            fetchTools();
        },

        execute: (step, context) => {
            const lastMessage = context.app.chatManager.getActiveChat()?.log.getLastMessage()?.value.content || '';
            const escapedLastMessage = JSON.stringify(lastMessage).slice(1, -1);
            const toolCallStr = step.data.toolCall.replace(/\${LAST_RESPONSE}/g, escapedLastMessage);

            try {
                const toolCall = JSON.parse(toolCallStr);
                context.app.mcp.rpc('tools/call', { name: toolCall.tool, arguments: toolCall.arguments }, step.data.mcpServer)
                    .then(result => {
                        let resultStr = '';
                        if (result.isError) {
                            if (typeof result.content === 'object' && result.content !== null && result.content.message) {
                                resultStr = `Error: ${result.content.message}`;
                            } else {
                                resultStr = `Error: ${JSON.stringify(result.content)}`;
                            }
                        } else if (result.content && Array.isArray(result.content) && result.content[0]?.text) {
                            resultStr = result.content[0].text;
                        } else {
                            resultStr = JSON.stringify(result.content, null, 2);
                        }

                        if (step.data.createPrompt) {
                            const newPrompt = `${step.data.prePrompt || ''}${resultStr}${step.data.postPrompt || ''}`;
                            context.app.dom.messageInput.value = newPrompt;
                            context.app.chatManager.handleFormSubmit({});
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
                                context.executeStep(nextStep);
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
        color: 'hsla(160, 20%, 35%, 0.8)',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8H3V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2zM21 14H3v-2a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2zM21 20H3v-2a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2z"/></svg>',
        getDefaults: () => ({ agentId: '' }),
        render: function(step, agentOptions) {
            return `<h4>${this.icon} ${this.label}</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}<p><small>Pops the latest entry from the MCP stack and uses it as a prompt.</small></p></div>`;
        },
        onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
        execute: (step, context) => {
            context.app.mcp.rpc('resources/read', { uri: 'stack://latest' })
                .then(result => {
                    if (result && result.contents && result.contents.length > 0) {
                        const content = result.contents[0].text;
                        if (content === "Stack is empty") {
                            return context.stopFlow('Stack is empty.');
                        }
                        context.app.dom.messageInput.value = content;
                        context.app.chatManager.handleFormSubmit({ agentId: step.data.agentId });
                    } else {
                        context.stopFlow('Stack is empty.');
                    }
                })
                .catch(err => {
                    context.stopFlow('Error popping from stack: ' + err.message);
                });
        },
    });
}
