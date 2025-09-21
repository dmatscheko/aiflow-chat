/**
 * @fileoverview Plugin for creating and executing complex, node-based flows.
 * @version 2.3.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce, importJson, exportJson, generateUniqueId, ensureUniqueId, generateUniqueName } from '../utils.js';
import { createTitleBar } from './title-bar-plugin.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').Chat} Chat
 * @typedef {import('../main.js').View} View
 * @typedef {import('../main.js').Tab} Tab
 */

/**
 * @typedef {object} FlowStep
 * @property {string} id
 * @property {string} type
 * @property {number} x
 * @property {number} y
 * @property {object} data
 */

/**
 * @typedef {object} FlowConnection
 * @property {string} from
 * @property {string} to
 * @property {string} outputName
 */

/**
 * @typedef {object} Flow
 * @property {string} id
 * @property {string} name
 * @property {FlowStep[]} steps
 * @property {FlowConnection[]} connections
 */

/**
 * @typedef {object} FlowExecutionContext
 * @property {App} app
 * @property {(fromStepId: string, outputName?: string) => FlowStep | undefined} getNextStep
 * @property {(step: FlowStep) => void} executeStep
 * @property {(message?: string) => void} stopFlow
 */

/**
 * @typedef {object} FlowStepDefinition
 * @property {string} label
 * @property {() => object} getDefaults
 * @property {(step: FlowStep, agentOptions: string) => string} render
 * @property {(step: FlowStep, target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => void} onUpdate
 * @property {(step: FlowStep, context: FlowExecutionContext) => void} execute
 */

let flowsManager = null;

/**
 * Manages the entire lifecycle, execution, and UI of flows.
 * @class
 */
class FlowsManager {
    _findLastMessageWithAlternatives(chatLog) {
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

    _extractContentFromBranch(startMessage, onlyLast) {
        const contents = [];

        const traverse = (message, currentPath) => {
            if (!message || !message.value) return;

            const role = this.roleMapping[message.value.role] || message.value.role;
            const formattedMessage = `**${role}:** ${message.value.content || ''}`;
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

    _findLastAnswerChain(chatLog) {
        const activeMessages = chatLog.getActiveMessages();
        let endOfAiAnswerRange = -1;

        for (let i = activeMessages.length - 1; i >= 0; i--) {
            if (activeMessages[i].value.role === 'assistant') {
                endOfAiAnswerRange = i;
                break;
            }
        }

        if (endOfAiAnswerRange === -1) {
            return { startMessage: null, userMessage: null };
        }

        let startOfAiAnswerRange = endOfAiAnswerRange;
        for (let i = endOfAiAnswerRange - 1; i >= 0; i--) {
            if (activeMessages[i].value.role !== 'assistant') {
                break;
            }
            startOfAiAnswerRange = i;
        }

        const userMessage = activeMessages[startOfAiAnswerRange - 1] || null;
        return {
            startMessage: activeMessages[startOfAiAnswerRange],
            userMessage: userMessage,
        };
    }

    /**
     * @param {ChatLog} chatLog
     * @returns {Message[][]}
     */
    _getTurns(chatLog) {
        const messages = chatLog.getActiveMessages();
        const turns = [];
        let currentTurn = []; // A turn is an array of messages
        messages.forEach(msg => {
            const role = msg.value.role;
            if (role !== 'assistant' && role !== 'tool') {
                if (currentTurn.length > 0) {
                    turns.push(currentTurn);
                }
                turns.push([msg]);
                currentTurn = [];
            } else {
                // Add assistant/tool messages to the current turn
                currentTurn.push(msg);
            }
        });
        if (currentTurn.length > 0) {
            turns.push(currentTurn);
        }
        return turns;
    }


    /** @param {App} app */
    constructor(app) {
        /** @type {App} */
        this.app = app;
        /** @type {Flow[]} */
        this.flows = this._loadFlows();
        /** @type {Object.<string, FlowStepDefinition & {type: string}>} */
        this.stepTypes = {};
        /** @type {FlowRunner | null} */
        this.activeFlowRunner = null;
        /** @type {object} */
        this.dragInfo = {};
        /** @type {object} */
        this.panInfo = {};
        /** @type {object} */
        this.connectionInfo = {};

        this.roleMapping = {
            user: 'User',
            assistant: 'AI',
            system: 'System',
            tool: 'Tool',
        };

        this._defineSteps();
    }

    // --- Core Flow Management ---
    _loadFlows() { try { return JSON.parse(localStorage.getItem('core_flows_v2')) || []; } catch (e) { console.error('Failed to load flows:', e); return []; } }
    _saveFlows() { localStorage.setItem('core_flows_v2', JSON.stringify(this.flows)); }
    /** @param {string} id */
    getFlow(id) { return this.flows.find(f => f.id === id); }
    /** @param {Omit<Flow, 'id'>} flowData */
    addFlow(flowData) {
        const existingIds = new Set(this.flows.map(f => f.id));
        const newFlow = { ...flowData, id: generateUniqueId('flow', existingIds) };
        this.flows.push(newFlow);
        this._saveFlows();
        return newFlow;
    }
    /** @param {Flow} flowData */
    updateFlow(flowData) { const i = this.flows.findIndex(f => f.id === flowData.id); if (i !== -1) { this.flows[i] = flowData; this._saveFlows(); } }
    /** @param {string} id */
    deleteFlow(id) { this.flows = this.flows.filter(f => f.id !== id); this._saveFlows(); }
    /** @param {Flow} flowData */
    addFlowFromData(flowData) {
        const existingIds = new Set(this.flows.map(f => f.id));
        const finalId = ensureUniqueId(flowData.id, 'flow', existingIds);

        const newFlow = { ...flowData, id: finalId };
        this.flows.push(newFlow);
        this._saveFlows();
        const flowListEl = document.getElementById('flow-list');
        if (flowListEl) this.renderFlowList();
        return newFlow;
    }

    /** @param {string} flowId */
    startFlow(flowId) {
        const flow = this.getFlow(flowId);
        if (flow) {
            this.activeFlowRunner = new FlowRunner(flow, this.app, this);
            this.activeFlowRunner.start();
        }
    }

    // --- Step Definition ---
    /** @param {string} type, @param {FlowStepDefinition} definition */
    _defineStep(type, definition) { this.stepTypes[type] = { ...definition, type }; }
    _defineSteps() {
        const getAgentsDropdown = (step, agentOptions) => `
            <label>Agent:</label>
            <select class="flow-step-agent flow-step-input" data-id="${step.id}" data-key="agentId">
                <option value="">Default (Active Agent)</option>${agentOptions}
            </select>`;

        this._defineStep('simple-prompt', {
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

        this._defineStep('multi-prompt', {
            label: 'Multi Prompt',
            getDefaults: () => ({ prompt: '', count: 2, agentId: '' }),
            render: (step, agentOptions) => `<h4>Multi Prompt</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}<label>Prompt:</label><textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.data.prompt || ''}</textarea><label>Number of alternatives:</label><input type="number" class="flow-step-count flow-step-input" data-id="${step.id}" data-key="count" value="${step.data.count || 1}" min="1" max="10"></div>`,
            onUpdate: (step, target) => { step.data[target.dataset.key] = target.dataset.key === 'count' ? parseInt(target.value, 10) : target.value; },
            execute: (step, context) => {
                if (!step.data.prompt) return context.stopFlow('Multi Prompt step is not configured.');

                const runner = flowsManager.activeFlowRunner;
                if (!runner) return context.stopFlow('Flow runner not active.');

                const chat = context.app.chatManager.getActiveChat();
                if (!chat) return context.stopFlow('No active chat.');

                // Add the user message that starts the multi-prompt
                chat.log.addMessage({ role: 'user', content: step.data.prompt });
                // Add a placeholder for the first assistant message
                const assistantPlaceholder = chat.log.addMessage({ role: 'assistant', content: null, agent: step.data.agentId });

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

        this._defineStep('consolidator', {
            label: 'Alt. Consolidator',
            getDefaults: () => ({ prePrompt: 'Please choose the best of the following answers (or if better than any single answer the best parts of the best answers combined):', postPrompt: 'Explain your choice.', agentId: '', onlyLastAnswer: false }),
            render: (step, agentOptions) => `<h4>Alternatives Consolidator</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}<label>Text before alternatives:</label><textarea class="flow-step-pre-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="prePrompt">${step.data.prePrompt || ''}</textarea><label>Text after alternatives:</label><textarea class="flow-step-post-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="postPrompt">${step.data.postPrompt || ''}</textarea><label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-only-last-answer flow-step-input" data-id="${step.id}" data-key="onlyLastAnswer" ${step.data.onlyLastAnswer ? 'checked' : ''}>Only include each last answer</label></div>`,
            onUpdate: (step, target) => {
                const key = target.dataset.key;
                if (key === 'onlyLastAnswer') {
                    step.data[key] = target.checked;
                } else {
                    step.data[key] = target.value;
                }
            },
            execute: (step, context) => {
                const chatLog = context.app.chatManager.getActiveChat()?.log;
                if (!chatLog) return context.stopFlow('No active chat.');

                const sourceMessage = this._findLastMessageWithAlternatives(chatLog);

                if (!sourceMessage) {
                    return context.stopFlow('Consolidator could not find a preceding step with alternatives.');
                }

                const consolidatedContent = sourceMessage.answerAlternatives.messages.map((alternativeStartMessage, i) => {
                    const turnContent = this._extractContentFromBranch(alternativeStartMessage, step.data.onlyLastAnswer);
                    return `--- ALTERNATIVE ${i + 1} ---\n${turnContent}`;
                }).join('\n\n');

                const finalPrompt = `${step.data.prePrompt || ''}\n\n${consolidatedContent}\n\n${step.data.postPrompt || ''}`;
                context.app.dom.messageInput.value = finalPrompt;
                context.app.chatManager.handleFormSubmit({ agentId: step.data.agentId });
            },
        });

        this._defineStep('echo-answer', {
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
                <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-delete-ai flow-step-input" data-id="${step.id}" data-key="deleteAIAnswer" ${step.data.deleteAIAnswer ? 'checked' : ''}> Delete original AI answer</label>
                <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-delete-user flow-step-input" data-id="${step.id}" data-key="deleteUserMessage" ${step.data.deleteUserMessage ? 'checked' : ''}> Delete original user message</label>
                <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-only-last-answer flow-step-input" data-id="${step.id}" data-key="onlyLastAnswer" ${step.data.onlyLastAnswer ? 'checked' : ''}> Only include last answer</label>
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

                const turns = this._getTurns(chatLog);
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
                        const role = this.roleMapping[msg.value.role] || msg.value.role;
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

        this._defineStep('clear-history', {
            label: 'Clear History',
            getDefaults: () => ({ clearFrom: 2, clearTo: 3, clearToBeginning: true }),
            render: (step) => `<h4>Clear History</h4>
                <div class="flow-step-content">
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
                    <small>(1 is the last turn)<br><br></small>
                </div>`,
            onUpdate: (step, target, renderAndConnect) => {
                const key = target.dataset.key;
                const value = target.type === 'checkbox' ? target.checked : parseInt(target.value, 10);
                step.data[key] = value;
                if (key === 'clearToBeginning') {
                    renderAndConnect();
                }
            },
            execute: (step, context) => {
                const chatLog = context.app.chatManager.getActiveChat()?.log;
                if (!chatLog) return context.stopFlow('No active chat.');

                const turns = this._getTurns(chatLog);
                const totalTurns = turns.length;
                let clearFrom = step.data.clearFrom || 1;
                let clearTo = step.data.clearToBeginning ? totalTurns : (step.data.clearTo || 1);

                // Clamp clearFrom to the minimum possible value
                if (clearFrom < 1) {
                    clearFrom = 1;
                }

                // Clamp clearTo to the maximum possible value
                if (clearTo > totalTurns) {
                    clearTo = totalTurns;
                }

                const count = clearTo - clearFrom + 1;
                if (count <= 0) {
                    context.stopFlow(`At least one turn must be selected but ${count} turns selected.`);
                    return;
                }

                for (let i = totalTurns - clearFrom; i >= totalTurns - clearTo; i--) {
                    turns[i].forEach(msg => {
                        const alternatives = chatLog.findAlternatives(msg);
                        if (!alternatives) return;
                        const activeMessage = alternatives.getActiveMessage();
                        // Create a copy of the messages array to iterate over, as we are modifying it.
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

                const nextStep = context.getNextStep(step.id);
                if (nextStep) context.executeStep(nextStep); else context.stopFlow();
            },
        });

        this._defineStep('branching-prompt', {
            label: 'Branching Prompt',
            getDefaults: () => ({ conditionType: 'contains', condition: '' }),
            render: (step) => `<h4>Branching Prompt</h4><div class="flow-step-content"><label>Last Response Condition:</label><select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType"><option value="contains" ${step.data.conditionType === 'contains' ? 'selected' : ''}>Contains String</option><option value="matches" ${step.data.conditionType === 'matches' ? 'selected' : ''}>Matches String</option><option value="regex" ${step.data.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option></select><textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.data.condition || ''}</textarea></div>`,
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

        this._defineStep('conditional-stop', {
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
    }

    // --- UI Rendering ---
    updateActiveFlowInList() {
        const flowListEl = document.getElementById('flow-list');
        if (!flowListEl || !this.app) return;
        const activeFlowId = this.app.activeView.type === 'flow-editor' ? this.app.activeView.id : null;
        flowListEl.querySelectorAll('li').forEach(item => item.classList.toggle('active', item.dataset.id === activeFlowId));
    }

    renderFlowList() {
        const listEl = document.getElementById('flow-list');
        if (!listEl) return;
        listEl.innerHTML = '';
        this.flows.forEach(flow => {
            const li = document.createElement('li');
            li.className = 'list-item';
            li.dataset.id = flow.id;
            li.innerHTML = `<span>${flow.name}</span><button class="delete-button">X</button>`;
            listEl.appendChild(li);
        });
        this.updateActiveFlowInList();
    }

    /** @param {string | null} flowId */
    renderFlowEditor(flowId) {
        if (flowId) {
            return `
                <div id="flow-editor-container" data-flow-id="${flowId}">
                    <div id="flow-canvas-wrapper"><div id="flow-canvas">
                        <svg id="flow-svg-layer"></svg>
                        <div id="flow-node-container"></div>
                    </div></div>
                </div>`;
        } else {
            return `
                <div id="flow-editor-container">
                    <div class="centered-message" style="text-align: center; padding: 2rem; color: var(--text-color-secondary);">
                        Select a flow from the list on the right, or create a new one to get started.
                    </div>
                </div>`;
        }
    }

    /** @param {Flow} flow */
    updateConnections(flow) {
        const nodeContainer = document.getElementById('flow-node-container');
        const svgLayer = document.getElementById('flow-svg-layer');
        if (!nodeContainer || !svgLayer) return;

        // Clear previous connections and buttons
        svgLayer.querySelectorAll('line').forEach(l => l.remove());
        nodeContainer.querySelectorAll('.delete-connection-btn').forEach(btn => btn.remove());

        flow.connections.forEach(conn => {
            const fromNode = nodeContainer.querySelector(`[data-id="${conn.from}"]`);
            const toNode = nodeContainer.querySelector(`[data-id="${conn.to}"]`);
            if (!fromNode || !toNode) return;

            const outConn = fromNode.querySelector(`.connector.bottom[data-output-name="${conn.outputName || 'default'}"]`);
            const inConn = toNode.querySelector('.connector.top');
            if (!outConn || !inConn) return;

            const x1 = fromNode.offsetLeft + outConn.offsetLeft + outConn.offsetWidth / 2;
            const y1 = fromNode.offsetTop + outConn.offsetTop + outConn.offsetHeight / 2;
            const x2 = toNode.offsetLeft + inConn.offsetLeft + inConn.offsetWidth / 2;
            const y2 = toNode.offsetTop + inConn.offsetTop + inConn.offsetHeight / 2;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1); line.setAttribute('y1', y1);
            line.setAttribute('x2', x2); line.setAttribute('y2', y2);
            line.setAttribute('stroke', 'var(--text-color)');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('marker-end', 'url(#arrowhead)');
            svgLayer.appendChild(line);

            // Add delete button at the midpoint of the connection
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-connection-btn';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.dataset.from = conn.from;
            deleteBtn.dataset.to = conn.to;
            deleteBtn.dataset.outputName = conn.outputName || 'default';
            deleteBtn.style.position = 'absolute';
            deleteBtn.style.left = `${(x1 + x2) / 2 - 8}px`;
            deleteBtn.style.top = `${(y1 + y2) / 2 - 8}px`;
            nodeContainer.appendChild(deleteBtn);
        });
    }

    /** @param {Flow} flow */
    renderFlow(flow) {
        const nodeContainer = document.getElementById('flow-node-container');
        if (!nodeContainer) return;
        nodeContainer.innerHTML = ''; // Clear only the nodes

        const svgLayer = document.getElementById('flow-svg-layer');
        if (svgLayer && !svgLayer.querySelector('defs')) {
            svgLayer.innerHTML = '<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="15" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-color)"></path></marker></defs>';
        }

        const agentOptions = this.app.agentManager.agents.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        flow.steps.forEach(step => {
            const stepDef = this.stepTypes[step.type];
            if (!stepDef) return;
            const node = document.createElement('div');
            const cardClass = `flow-step-card flow-step-${step.type} ${step.data.isMinimized ? 'minimized' : ''}`;
            node.className = cardClass.trim();
            node.dataset.id = step.id;
            node.style.left = `${step.x}px`;
            node.style.top = `${step.y}px`;
            const selectedAgentOptions = this.app.agentManager.agents.map(a => `<option value="${a.id}" ${step.data.agentId === a.id ? 'selected' : ''}>${a.name}</option>`).join('');
            let outputConnectors = `<div class="connector-group"><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="default"></div></div>`;
            if (step.type === 'branching-prompt') {
                outputConnectors = `<div class="connector-group"><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="pass"><span class="connector-label">Pass</span></div><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="fail"><span class="connector-label">Fail</span></div></div>`;
            }
            node.innerHTML = `<button class="minimize-flow-step-btn" data-id="${step.id}">${step.data.isMinimized ? '+' : '-'}</button><div class="connector top" data-id="${step.id}" data-type="in"></div>${stepDef.render(step, selectedAgentOptions)}<div class="flow-step-footer"><button class="delete-flow-step-btn" data-id="${step.id}">Delete</button></div>${outputConnectors}`;
            nodeContainer.appendChild(node);
        });
        // Connection rendering is now handled separately with a timeout
    }

    /** @param {string | null} activeFlowId */
    getFlowSelectorHtml(activeFlowId) {
        const optionsHtml = this.flows.map(flow => `<option value="${flow.id}" ${flow.id === activeFlowId ? 'selected' : ''}>${flow.name}</option>`).join('');
        return `<div id="flow-runner-container"><label for="flow-selector">Flow:</label><select id="flow-selector"><option value="">Select a flow</option>${optionsHtml}</select><button id="run-chat-flow-btn">Run</button></div>`;
    }

    // --- Canvas Interaction ---
    _resetInteractions() {
        const canvas = document.getElementById('flow-canvas');
        if (canvas) canvas.classList.remove('panning');
        this.dragInfo = { active: false }; this.panInfo = { active: false };
        if (this.connectionInfo.tempLine) this.connectionInfo.tempLine.remove();
        this.connectionInfo = { active: false };
    }

    /** @param {MouseEvent} e, @param {Flow} flow, @param {() => void} debouncedUpdate */
    _handleCanvasMouseDown(e, flow, debouncedUpdate) {
        const target = e.target;
        if (target.classList.contains('connector') && target.dataset.type === 'out') {
            this.connectionInfo = { active: true, fromNode: target.closest('.flow-step-card'), fromConnector: target, tempLine: document.createElementNS('http://www.w3.org/2000/svg', 'line') };
            this.connectionInfo.tempLine.setAttribute('stroke', 'red'); this.connectionInfo.tempLine.setAttribute('stroke-width', '2');
            document.getElementById('flow-svg-layer').appendChild(this.connectionInfo.tempLine);
        } else if (target.closest('.flow-step-card') && !target.matches('input, textarea, select, button')) {
            e.preventDefault();
            this.dragInfo = { active: true, target: target.closest('.flow-step-card'), offsetX: e.clientX - target.closest('.flow-step-card').offsetLeft, offsetY: e.clientY - target.closest('.flow-step-card').offsetTop };
        } else if (e.target.id === 'flow-canvas' || e.target.id === 'flow-canvas-wrapper' || e.target.id === 'flow-svg-layer' || e.target.id === 'flow-node-container') {
            e.preventDefault();
            const wrapper = document.getElementById('flow-canvas-wrapper');
            this.panInfo = { active: true, startX: e.clientX, startY: e.clientY, scrollLeft: wrapper.scrollLeft, scrollTop: wrapper.scrollTop };
            e.target.closest('#flow-canvas').classList.add('panning');
        }
    }

    /** @param {MouseEvent} e, @param {Flow} flow */
    _handleCanvasMouseMove(e, flow) {
        if (this.dragInfo.active) {
            this.dragInfo.target.style.left = `${e.clientX - this.dragInfo.offsetX}px`;
            this.dragInfo.target.style.top = `${e.clientY - this.dragInfo.offsetY}px`;
            this.updateConnections(flow);
        } else if (this.connectionInfo.active) {
            const fromNode = this.connectionInfo.fromNode;
            const outConn = this.connectionInfo.fromConnector;
            const wrapper = document.getElementById('flow-canvas-wrapper');
            const rect = wrapper.getBoundingClientRect();

            const startX = fromNode.offsetLeft + outConn.offsetLeft + outConn.offsetWidth / 2;
            const startY = fromNode.offsetTop + outConn.offsetTop + outConn.offsetHeight / 2;

            const endX = e.clientX - rect.left + wrapper.scrollLeft;
            const endY = e.clientY - rect.top + wrapper.scrollTop;

            this.connectionInfo.tempLine.setAttribute('x1', startX);
            this.connectionInfo.tempLine.setAttribute('y1', startY);
            this.connectionInfo.tempLine.setAttribute('x2', endX);
            this.connectionInfo.tempLine.setAttribute('y2', endY);
        } else if (this.panInfo.active) {
            e.preventDefault();
            const wrapper = document.getElementById('flow-canvas-wrapper');
            wrapper.scrollLeft = this.panInfo.scrollLeft - (e.clientX - this.panInfo.startX);
            wrapper.scrollTop = this.panInfo.scrollTop - (e.clientY - this.panInfo.startY);
        }
    }

    /** @param {MouseEvent} e, @param {Flow} flow, @param {() => void} debouncedUpdate */
    _handleCanvasMouseUp(e, flow, debouncedUpdate) {
        if (this.dragInfo.active) {
            const step = flow.steps.find(s => s.id === this.dragInfo.target.dataset.id);
            if (step) {
                step.x = this.dragInfo.target.offsetLeft;
                step.y = this.dragInfo.target.offsetTop;
                debouncedUpdate();
            }
        } else if (this.connectionInfo.active) {
            const toConnector = e.target.closest('.connector');
            if (toConnector && toConnector.dataset.type === 'in') {
                const toNode = toConnector.closest('.flow-step-card');
                const fromNode = this.connectionInfo.fromNode;
                if (fromNode.dataset.id !== toNode.dataset.id) {
                    flow.connections.push({ from: fromNode.dataset.id, to: toNode.dataset.id, outputName: this.connectionInfo.fromConnector.dataset.outputName });
                    debouncedUpdate();
                    // Re-render to show the new connection
                    const renderAndConnect = () => {
                        this.renderFlow(flow);
                        setTimeout(() => this.updateConnections(flow), 0);
                    };
                    renderAndConnect();
                }
            }
        }
        this._resetInteractions();
    }
}

/**
 * Executes a flow by traversing its steps and connections.
 * @class
 */
class FlowRunner {
    /**
     * @param {Flow} flow
     * @param {App} app
     * @param {FlowsManager} manager
     */
    constructor(flow, app, manager) {
        this.flow = flow;
        this.app = app;
        this.manager = manager;
        this.currentStepId = null;
        this.isRunning = false;
        this.multiPromptInfo = { active: false, step: null, counter: 0, baseMessage: null };
    }

    start() {
        if (this.isRunning) return;
        const startNode = this.flow.steps.find(s => !this.flow.connections.some(c => c.to === s.id));
        if (!startNode) return alert('Flow has no starting node!');
        this.isRunning = true;
        this.executeStep(startNode);
    }

    /** @param {string} [message='Flow stopped.'] */
    stop(message = 'Flow stopped.') {
        this.isRunning = false;
        this.currentStepId = null;
        this.multiPromptInfo = { active: false, step: null, counter: 0, baseMessage: null };
        console.log(message);
        this.manager.activeFlowRunner = null;
    }

    /** @param {FlowStep} step */
    executeStep(step) {
        if (!this.isRunning) return;
        this.currentStepId = step.id;
        const stepDef = this.manager.stepTypes[step.type];
        if (stepDef?.execute) {
            stepDef.execute(step, {
                app: this.app,
                getNextStep: (id, out) => this.getNextStep(id, out),
                executeStep: (next) => this.executeStep(next),
                stopFlow: (msg) => this.stop(msg),
            });
        } else {
            this.stop(`Unknown step type: ${step.type}`);
        }
    }

    /** @param {string} stepId, @param {string} [outputName='default'] */
    getNextStep(stepId, outputName = 'default') {
        const conn = this.flow.connections.find(c => c.from === stepId && (c.outputName || 'default') === outputName);
        return conn ? this.flow.steps.find(s => s.id === conn.to) : undefined;
    }

    /**
     * @param {Message | null} message - The message that was just completed, or null if it's an idle check.
     * @param {Chat} chat - The active chat instance.
     * @returns {boolean} - `true` if the flow proceeded and scheduled new work, `false` otherwise.
     */
    continue(message, chat) {
         // Only act when a flow is running, a step is selected, and the AI is idle
        if (!this.isRunning || !this.currentStepId || message !== null) return false;

        if (this.multiPromptInfo.active) {
            // --- Multi-Prompt Handling ---
            const info = this.multiPromptInfo;
            const step = info.step;

            if (info.counter < step.data.count) {
                info.counter++;
                // Add a new alternative with a pending message
                chat.log.addAlternative(info.baseMessage, { role: 'assistant', content: null, agent: step.data.agentId });
                // Trigger the processing of the new pending message
                flowsManager.app.responseProcessor.scheduleProcessing(flowsManager.app);
                return true; // Flow is still active, handled work.
            } else {
                // Multi-prompt is finished
                this.multiPromptInfo = { active: false, step: null, counter: 0, baseMessage: null };
                const nextStep = this.getNextStep(step.id);
                if (nextStep) {
                    this.executeStep(nextStep);
                    return true; // A new step was executed.
                } else {
                    this.stop('Flow execution complete.');
                    return false; // Flow finished, no new work.
                }
            }
        } else {
            // --- Normal Prompt Handling ---
            const stepDef = this.manager.stepTypes[this.flow.steps.find(s => s.id === this.currentStepId)?.type];
            if (stepDef?.execute?.toString().includes('handleFormSubmit')) {
                const nextStep = this.getNextStep(this.currentStepId);
                if (nextStep) {
                    this.executeStep(nextStep);
                    return true; // A new step was executed.
                } else {
                    this.stop('Flow execution complete.');
                    return false; // Flow finished, no new work.
                }
            }
        }

        return false;
    }
}


const flowsPlugin = {
    name: 'Flows',
    /** @param {App} app */
    onAppInit(app) {
        flowsManager = new FlowsManager(app);
        app.flowsManager = flowsManager;

        pluginManager.registerView('flow-editor', (id) => flowsManager.renderFlowEditor(id));
    },

    /** @param {Tab[]} tabs */
    onTabsRegistered(tabs) {
        tabs.push({
            id: 'flows',
            label: 'Flows',
            viewType: 'flow-editor',
            onActivate: () => {
                const contentEl = document.getElementById('flows-pane');
                contentEl.innerHTML = `<div class="list-pane"><ul id="flow-list" class="item-list"></ul><button id="add-flow-btn" class="add-new-button">Add New Flow</button></div>`;
                flowsManager.renderFlowList();

                document.getElementById('add-flow-btn').addEventListener('click', () => {
                    const existingNames = flowsManager.flows.map(f => f.name);
                    const name = generateUniqueName('New Flow', existingNames);
                    const newFlow = flowsManager.addFlow({ name, steps: [], connections: [] });
                    flowsManager.renderFlowList();
                    flowsManager.app.setView('flow-editor', newFlow.id);
                });

                document.getElementById('flow-list').addEventListener('click', (e) => {
                    const item = e.target.closest('.list-item');
                    if (!item) return;
                    const id = item.dataset.id;
                    if (e.target.classList.contains('delete-button')) {
                        e.stopPropagation();
                        const flow = flowsManager.getFlow(id);
                        const doDelete = () => {
                            flowsManager.deleteFlow(id);
                            flowsManager.renderFlowList();
                            // If the deleted flow was active, show the default view
                            if (flowsManager.app.activeView.id === id) {
                                flowsManager.app.setView('flow-editor', null);
                            }
                        };

                        if (flow && flow.steps.length === 0) {
                            doDelete();
                        } else if (confirm('Delete this flow?')) {
                            doDelete();
                        }
                    } else {
                        flowsManager.app.setView('flow-editor', id);
                    }
                });

                // If no flow is active when the tab is shown, set the view to the default
                if (!flowsManager.app.lastActiveIds['flow-editor']) {
                    flowsManager.app.setView('flow-editor', null);
                }
            }
        });
        return tabs;
    },

    /** @param {View} view, @param {Chat} chat */
    onViewRendered(view, chat) {
        if (view.type === 'flow-editor') {
            const existingTitleBar = document.querySelector('#main-panel .main-title-bar');
            if (existingTitleBar) {
                existingTitleBar.remove();
            }

            const mainPanel = document.getElementById('main-panel');
            const flow = flowsManager.getFlow(view.id);
            let title;
            let buttons = [];

            if (flow) {
                title = flow.name;
                const dropdownContent = Object.entries(flowsManager.stepTypes)
                    .map(([type, { label }]) => `<a href="#" data-step-type="${type}">${label}</a>`)
                    .join('');

                buttons = [
                    {
                        id: 'add-flow-step-btn',
                        label: 'Add Step',
                        className: 'primary-btn',
                        dropdownContent: dropdownContent,
                        onClick: (e) => {
                            const type = e.target.dataset.stepType;
                            if (type && flowsManager.stepTypes[type]) {
                                const stepData = flowsManager.stepTypes[type].getDefaults();
                                stepData.isMinimized = false;
                                flow.steps.push({ id: `step-${Date.now()}`, type, x: 50, y: 50, data: stepData });
                                flowsManager.updateFlow(flow);
                                renderAndConnect();
                            }
                        }
                    },
                    {
                        id: 'load-flow-btn',
                        label: 'Load Flow',
                        className: 'btn-gray',
                        onClick: () => {
                            importJson('.flow', (data) => {
                                const newFlow = flowsManager.addFlowFromData(data);
                                flowsManager.app.setView('flow-editor', newFlow.id);
                            });
                        }
                    },
                    {
                        id: 'save-flow-btn',
                        label: 'Save Flow',
                        className: 'btn-gray',
                        onClick: () => {
                            exportJson(flow, flow.name.replace(/[^a-z0-9]/gi, '_').toLowerCase(), 'flow');
                        }
                    }
                ];

                const debouncedUpdate = debounce(() => flowsManager.updateFlow(flow), 500);

                const renderAndConnect = () => {
                    flowsManager.renderFlow(flow);
                    setTimeout(() => flowsManager.updateConnections(flow), 0);
                };

                renderAndConnect(); // Initial render

                const canvas = document.getElementById('flow-canvas');
                canvas.addEventListener('mousedown', (e) => flowsManager._handleCanvasMouseDown(e, flow, debouncedUpdate));
                canvas.addEventListener('mousemove', (e) => flowsManager._handleCanvasMouseMove(e, flow));
                canvas.addEventListener('mouseup', (e) => flowsManager._handleCanvasMouseUp(e, flow, debouncedUpdate));
                canvas.addEventListener('change', (e) => {
                    const step = flow.steps.find(s => s.id === e.target.dataset.id);
                    if (step && flowsManager.stepTypes[step.type]?.onUpdate) {
                        flowsManager.stepTypes[step.type].onUpdate(step, e.target, renderAndConnect);
                        debouncedUpdate();
                    }
                });
                canvas.addEventListener('click', (e) => {
                    const target = e.target;
                    if (target.classList.contains('delete-flow-step-btn')) {
                        const stepId = target.dataset.id;
                        flow.steps = flow.steps.filter(s => s.id !== stepId);
                        flow.connections = flow.connections.filter(c => c.from !== stepId && c.to !== stepId);
                        flowsManager.updateFlow(flow);
                        renderAndConnect();
                    } else if (target.classList.contains('delete-connection-btn')) {
                        const { from, to, outputName } = target.dataset;
                        flow.connections = flow.connections.filter(c =>
                            !(c.from === from && c.to === to && (c.outputName || 'default') === outputName)
                        );
                        flowsManager.updateFlow(flow);
                        renderAndConnect();
                    } else if (target.classList.contains('minimize-flow-step-btn')) {
                        const stepId = target.dataset.id;
                        const step = flow.steps.find(s => s.id === stepId);
                        if (step) {
                            step.data.isMinimized = !step.data.isMinimized;
                            flowsManager.updateFlow(flow);
                            renderAndConnect();
                        }
                    }
                });

            } else {
                title = 'Flow Editor';
                buttons = [
                    {
                        id: 'load-flow-btn',
                        label: 'Load Flow',
                        className: 'btn-gray',
                        onClick: () => {
                            importJson('.flow', (data) => {
                                const newFlow = flowsManager.addFlowFromData(data);
                                flowsManager.app.setView('flow-editor', newFlow.id);
                            });
                        }
                    }
                ];
            }

            const titleParts = [];
            if (flow) {
                titleParts.push({
                    text: title,
                    onSave: (newName) => {
                        flow.name = newName;
                        flowsManager.updateFlow(flow);
                        flowsManager.renderFlowList();
                        flowsManager.app.setView('flow-editor', flow.id);
                    }
                });
            } else {
                titleParts.push(title);
            }

            const titleBar = createTitleBar(titleParts, [], buttons);
            mainPanel.prepend(titleBar);
        }
        flowsManager.updateActiveFlowInList();
    },

    /**
     * This handler is called by the ResponseProcessor when the AI is idle.
     * It checks if a flow is running and proceeds to the next step if the
     * previous step was a prompt that just completed.
     * @param {Message | null} message - The message that was just completed, or null if it's an idle check.
     * @param {Chat} chat - The active chat instance.
     * @returns {boolean} - `true` if the flow proceeded and scheduled new work, `false` otherwise.
     */
    onResponseComplete(message, chat) {
        if (!flowsManager.activeFlowRunner) {
            return false;
        }
        return flowsManager.activeFlowRunner.continue(message, chat);
    }
};

pluginManager.register(flowsPlugin);
