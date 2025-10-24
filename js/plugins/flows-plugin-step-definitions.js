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
        getDefaults: () => ({ prompt: 'Hello, world!', agentId: '' }),
        render: (step, agentOptions) => `<h4>Simple Prompt</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}<label>Prompt:</label><textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.data.prompt || ''}</textarea></div>`,
        onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
        execute: (step, context) => {
            if (!step.data.prompt) return context.stopFlow('Simple Prompt step not configured.');
            context.app.dom.messageInput.value = step.data.prompt;
            context.app.chatManager.handleFormSubmit({ agentId: step.data.agentId });
        },
    });

    flowManager._defineStep('multi-prompt', {
        label: 'Multi Prompt',
        getDefaults: () => ({ prompt: '', count: 2, agentId: '' }),
        render: (step, agentOptions) => `<h4>Multi Prompt</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}<label>Prompt:</label><textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.data.prompt || ''}</textarea><label>Number of alternatives:</label><input type="number" class="flow-step-count flow-step-input" data-id="${step.id}" data-key="count" value="${step.data.count || 1}" min="1" max="10"></div>`,
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
        render: (step, agentOptions) => `<h4>Alternatives Consolidator</h4>
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
            </div>`,
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
        getDefaults: () => ({
            prePrompt: 'Is this idea and code correct? Be concise.\n\n\n',
            postPrompt: '',
            agentId: '',
            deleteAIAnswer: true,
            deleteUserMessage: true,
            onlyLastAnswer: false,
        }),
        render: (step, agentOptions) => `<h4>Echo Answer</h4><div class="flow-step-content">
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
            </div>`,
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
        getDefaults: () => ({ clearFrom: 2, clearTo: 3, clearToBeginning: true }),
        render: (step) => `<h4>Clear History</h4>
            <div class="flow-step-content">
                ${getClearHistoryUI(step)}
            </div>`,
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
        getDefaults: () => ({ conditionType: 'contains', condition: '' }),
        render: (step) => `<h4>Branch</h4><div class="flow-step-content"><label>Last Response Condition:</label><select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType"><option value="contains" ${step.data.conditionType === 'contains' ? 'selected' : ''}>Contains String</option><option value="matches" ${step.data.conditionType === 'matches' ? 'selected' : ''}>Matches String</option><option value="regex" ${step.data.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option></select><textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.data.condition || ''}</textarea></div>`,
        renderOutputConnectors: (step) => `<div class="connector-group"><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="pass"><span class="connector-label">Pass</span></div><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="fail"><span class="connector-label">Fail</span></div></div>`,
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

    flowManager._defineStep('conditional-stop', {
        label: 'Conditional Stop',
        getDefaults: () => ({ conditionType: 'contains', condition: '', onMatch: 'stop' }),
        render: (step) => `<h4>Conditional Stop</h4><div class="flow-step-content"><label>Last Response Condition:</label><select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType"><option value="contains" ${step.data.conditionType === 'contains' ? 'selected' : ''}>Contains String</option><option value="matches" ${step.data.conditionType === 'matches' ? 'selected' : ''}>Matches String</option><option value="regex" ${step.data.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option></select><textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.data.condition || ''}</textarea><label>On Match:</label><select class="flow-step-on-match flow-step-input" data-id="${step.id}" data-key="onMatch"><option value="stop" ${step.data.onMatch === 'stop' ? 'selected' : ''}>Stop flow</option><option value="continue" ${step.data.onMatch === 'continue' ? 'selected' : ''}>Must match to continue</option></select></div>`,
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

    flowManager._defineStep('manual-mcp-call', {
        label: 'Manual MCP Call',
        getDefaults: () => ({
            mcpServer: '',
            toolName: '',
            toolCall: '',
            createPrompt: false,
            prePrompt: '',
            postPrompt: ''
        }),
        render: (step, agentOptions) => `
            <h4>Manual MCP Call</h4>
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
            </div>
        `,
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
}
