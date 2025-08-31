/**
 * @fileoverview Plugin for agents and flow management.
 */

'use strict';

import { log, triggerError } from '../../utils/logger.js';
import { hooks } from '../../hooks.js';
import { stepTypes } from './agent-step-definitions.js';
import { parseFunctionCalls } from '../../utils/parsers.js';
import { processToolCalls, exportJson, importJson } from '../../utils/shared.js';
import { defaultEndpoint } from '../../config.js';
import { AgentFlowExecutor } from './agents-flow-executor.js';
import { renderAgentList, showAgentForm, hideAgentForm, renderFlow } from './agents-ui.js';

const INTERACTIVE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'LABEL'];

/**
 * @class AgentsPlugin
 * @classdesc The main class for the Agents and Flow plugin.
 * This plugin adds functionality for creating agents and defining execution flows.
 */
class AgentsPlugin {
    constructor() {
        this.name = 'agents';
        this.app = null;
        this.store = null;
        this.flowExecutor = null;
        this._flowRunning = false;
        this._currentStepId = null;
        this._stepCounter = 0;
        this.maxSteps = 20;
        this._dragInfo = { active: false, target: null, offsetX: 0, offsetY: 0 };
        this._panInfo = { active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 };
        this._connectionInfo = { active: false, fromNode: null, fromConnector: null, tempLine: null };
        this._multiMessageInfo = { active: false, step: null, counter: 0, messageToBranchFrom: null };

        // Bind hook methods to this instance
        this.hooks.onModifySystemPrompt = this.hooks.onModifySystemPrompt.bind(this);
        this.hooks.onMessageComplete = this.hooks.onMessageComplete.bind(this);
    }

    /**
     * Initializes the plugin, setting up tabs, UI elements, and event listeners.
     * @param {import('../../app.js').default} app - The main application instance.
     */
    init(app) {
        this.app = app;
        this.store = app.store;
        this.flowExecutor = new AgentFlowExecutor(this);

        // Dynamically add tabs
        const tabs = document.getElementById('main-tabs');
        const agentsTabButton = document.createElement('button');
        agentsTabButton.classList.add('tab-button');
        agentsTabButton.dataset.tab = 'agents';
        agentsTabButton.textContent = 'Agents';
        tabs.appendChild(agentsTabButton);

        const flowTabButton = document.createElement('button');
        flowTabButton.classList.add('tab-button');
        flowTabButton.dataset.tab = 'flow';
        flowTabButton.textContent = 'Flow';
        tabs.appendChild(flowTabButton);

        // Dynamically add tab panes
        const tabContent = document.getElementById('tab-content');
        this.createAgentsTab(tabContent);
        this.createFlowTab(tabContent);

        // --- Event Listeners ---
        this.setupEventListeners();

        // --- Store Subscription ---
        this.store.subscribe('currentChat', () => {
            renderAgentList(this.store);
            setTimeout(() => renderFlow(this.store), 0);
        });

        // --- Hooks ---
        hooks.onCancel.push(() => {
            if (this._flowRunning) this.flowExecutor.stopFlow('Execution cancelled by user.');
        });
    }

    /**
     * Creates the 'Agents' tab and its content.
     * @param {HTMLElement} tabContent - The parent element for the tab pane.
     * @private
     */
    createAgentsTab(tabContent) {
        const agentsTabPane = document.createElement('div');
        agentsTabPane.classList.add('tab-pane');
        agentsTabPane.id = 'agents-tab-pane';
        agentsTabPane.innerHTML = `
            <div class="agents-flow-toolbar">
                <button id="add-agent-btn" class="agents-flow-btn">Add Agent</button>
                <button id="export-agents-btn" class="agents-flow-btn">Export Agents</button>
                <button id="import-agents-btn" class="agents-flow-btn">Import Agents</button>
            </div>
            <div id="agent-list"></div>
            <div id="agent-form-container" style="display: none;">
                <form id="agent-form">
                    <input type="hidden" id="agent-id" value="">
                    <label for="agent-name">Name:</label>
                    <input type="text" id="agent-name" required>
                    <label for="agent-description">Description:</label>
                    <textarea id="agent-description" rows="2"></textarea>
                    <label for="agent-system-prompt">System Prompt:</label>
                    <textarea id="agent-system-prompt" rows="5"></textarea>
                    <label>
                        <input type="checkbox" id="agent-available-as-tool">
                        Available as a tool
                    </label>
                    <label>
                        <input type="checkbox" id="agent-use-custom-settings">
                        Custom Model Parameters
                    </label>
                    <div id="agent-model-settings" style="display: none;"></div>
                    <div id="agent-form-buttons">
                        <button type="submit" class="agents-flow-btn">Save Agent</button>
                        <button type="button" id="cancel-agent-form" class="agents-flow-btn">Cancel</button>
                    </div>
                </form>
            </div>
        `;
        tabContent.appendChild(agentsTabPane);
    }

    /**
     * Creates the 'Flow' tab and its content.
     * @param {HTMLElement} tabContent - The parent element for the tab pane.
     * @private
     */
    createFlowTab(tabContent) {
        const flowTabPane = document.createElement('div');
        flowTabPane.classList.add('tab-pane');
        flowTabPane.id = 'flow-tab-pane';
        const dropdownContent = Object.entries(stepTypes)
            .map(([type, { label }]) => `<a href="#" data-step-type="${type}">${label}</a>`)
            .join('');
        flowTabPane.innerHTML = `
            <div class="agents-flow-toolbar">
                <div class="dropdown">
                    <button id="add-flow-step-btn-dropdown" class="agents-flow-btn">Add Step &#9662;</button>
                    <div id="add-step-dropdown-content" class="dropdown-content">
                        ${dropdownContent}
                    </div>
                </div>
                <button id="run-flow-btn" class="agents-flow-btn">Run Flow</button>
                <button id="export-flow-btn" class="agents-flow-btn">Export Flow</button>
                <button id="import-flow-btn" class="agents-flow-btn">Load Flow</button>
            </div>
            <div id="flow-canvas-wrapper">
                <div id="flow-canvas">
                    <svg id="flow-svg-layer"></svg>
                    <div id="flow-node-container"></div>
                </div>
            </div>
        `;
        tabContent.appendChild(flowTabPane);
    }

    /**
     * Sets up all the event listeners for the plugin's UI.
     * @private
     */
    setupEventListeners() {
        // Tab switching
        document.getElementById('tabs').addEventListener('click', this.handleTabClick.bind(this));
        // Agent UI
        document.getElementById('add-agent-btn').addEventListener('click', () => showAgentForm(null, this.store));
        document.getElementById('cancel-agent-form').addEventListener('click', hideAgentForm);
        document.getElementById('agent-form').addEventListener('submit', this.saveAgent.bind(this));
        document.getElementById('agent-list').addEventListener('click', this.handleAgentListClick.bind(this));
        document.getElementById('export-agents-btn').addEventListener('click', this.exportAgents.bind(this));
        document.getElementById('import-agents-btn').addEventListener('click', this.importAgents.bind(this));
        // Flow UI
        document.getElementById('add-flow-step-btn-dropdown').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('add-step-dropdown-content').classList.toggle('show');
        });
        document.getElementById('add-step-dropdown-content').addEventListener('click', (e) => {
            if (e.target.tagName === 'A') {
                const stepType = e.target.dataset.stepType;
                this.addFlowStep(stepType);
                document.getElementById('add-step-dropdown-content').classList.remove('show');
            }
        });
        document.getElementById('run-flow-btn').addEventListener('click', () => this.flowExecutor.toggleFlow());
        document.getElementById('export-flow-btn').addEventListener('click', this.exportFlow.bind(this));
        document.getElementById('import-flow-btn').addEventListener('click', this.importFlow.bind(this));

        window.addEventListener('click', (e) => {
            if (!e.target.matches('#add-flow-step-btn-dropdown')) {
                const dropdown = document.getElementById('add-step-dropdown-content');
                if (dropdown.classList.contains('show')) {
                    dropdown.classList.remove('show');
                }
            }
        });
        const canvas = document.getElementById('flow-canvas');
        canvas.addEventListener('mousedown', this.handleFlowCanvasMouseDown.bind(this));
        canvas.addEventListener('mousemove', this.handleFlowCanvasMouseMove.bind(this));
        canvas.addEventListener('mouseup', this.handleFlowCanvasMouseUp.bind(this));
        canvas.addEventListener('change', this.handleFlowStepChange.bind(this));
        canvas.addEventListener('click', this.handleFlowCanvasClick.bind(this));
    }

    // --- Event Handlers ---
    /**
     * Handles tab switching.
     * @param {Event} e - The click event.
     */
    handleTabClick(e) {
        if (e.target.classList.contains('tab-button')) {
            const tabName = e.target.dataset.tab;
            if (tabName === 'flow') {
                setTimeout(() => renderFlow(this.store), 0);
            }
            document.querySelectorAll('#tabs .tab-button, #tab-content .tab-pane').forEach(el => el.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(`${tabName}-tab-pane`).classList.add('active');
        }
    }

    /**
     * Saves a new agent or updates an existing one based on the form data.
     * @param {Event} e - The form submission event.
     */
    saveAgent(e) {
        e.preventDefault();
        const id = document.getElementById('agent-id').value;
        const chat = this.store.get('currentChat');
        if (!chat.agents) chat.agents = [];

        const existingAgent = id ? chat.agents.find(a => a.id === id) : null;

        const useCustomSettings = document.getElementById('agent-use-custom-settings').checked;
        const agentData = {
            id: id || `agent-${Date.now()}`,
            name: document.getElementById('agent-name').value,
            description: document.getElementById('agent-description').value,
            systemPrompt: document.getElementById('agent-system-prompt').value,
            availableAsTool: document.getElementById('agent-available-as-tool').checked,
            useCustomModelSettings: useCustomSettings,
            modelSettings: existingAgent ? existingAgent.modelSettings : {},
        };

        if (!useCustomSettings) {
            agentData.modelSettings = {};
        }

        const index = existingAgent ? chat.agents.findIndex(a => a.id === id) : -1;

        if (index > -1) {
            chat.agents[index] = agentData;
        } else {
            chat.agents.push(agentData);
        }
        this.store.set('currentChat', { ...chat });
        hideAgentForm();
    }

    /**
     * Handles clicks on the agent list (activate, edit, delete).
     * @param {Event} e - The click event.
     */
    handleAgentListClick(e) {
        const id = e.target.dataset.id;
        if (!id) return;
        const chat = this.store.get('currentChat');
        if (e.target.classList.contains('activate-agent-btn')) {
            chat.activeAgentId = chat.activeAgentId === id ? null : id;
        } else if (e.target.classList.contains('edit-agent-btn')) {
            const agent = chat.agents.find(a => a.id === id);
            showAgentForm(agent, this.store);
        } else if (e.target.classList.contains('delete-agent-btn')) {
            if (confirm(`Delete agent?`)) {
                chat.agents = chat.agents.filter(a => a.id !== id);
                if (chat.activeAgentId === id) chat.activeAgentId = null;
            }
        }
        this.store.set('currentChat', { ...chat });
    }

    /**
     * Adds a new step to the flow canvas.
     * @param {string} [type='simple-prompt'] - The type of the step to add.
     */
    addFlowStep(type = 'simple-prompt') {
        const chat = this.store.get('currentChat');
        if (!chat.flow) chat.flow = { steps: [], connections: [] };

        const stepDefinition = stepTypes[type];
        if (!stepDefinition) {
            triggerError(`Unknown step type: ${type}`);
            return;
        }

        const newStep = {
            id: `step-${Date.now()}`,
            type: type,
            x: 50,
            y: 50,
            isMinimized: false,
            ...stepDefinition.getDefaults(),
        };

        chat.flow.steps.push(newStep);
        this.store.set('currentChat', { ...chat });
    }

    /**
     * Handles changes to input fields within a flow step.
     * @param {Event} e - The change event.
     */
    handleFlowStepChange(e) {
        const id = e.target.dataset.id;
        const chat = this.store.get('currentChat');
        const step = chat.flow.steps.find(s => s.id === id);
        if (!step) return;

        const stepDefinition = stepTypes[step.type];
        if (stepDefinition && stepDefinition.onUpdate) {
            stepDefinition.onUpdate(step, e.target, renderFlow, this.store);
        }

        this.store.set('currentChat', { ...chat });
    }

    /**
     * Handles clicks on the flow canvas for deleting steps or connections.
     * @param {Event} e - The click event.
     */
    handleFlowCanvasClick(e) {
        const chat = this.store.get('currentChat');
        let chatModified = false;

        const minimizeBtn = e.target.closest('.minimize-flow-step-btn');
        if (minimizeBtn) {
            const stepId = minimizeBtn.dataset.id;
            const step = chat.flow.steps.find(s => s.id === stepId);
            if (step) {
                step.isMinimized = !step.isMinimized;
                chatModified = true;
            }
        }

        const stepDeleteBtn = e.target.closest('.delete-flow-step-btn');
        if (stepDeleteBtn) {
            const stepId = stepDeleteBtn.dataset.id;
            if (stepId && confirm('Are you sure you want to delete this step?')) {
                chat.flow.steps = chat.flow.steps.filter(s => s.id !== stepId);
                chat.flow.connections = (chat.flow.connections || []).filter(c => c.from !== stepId && c.to !== stepId);
                chatModified = true;
            }
        }

        const connDeleteBtn = e.target.closest('.delete-connection-btn');
        if (connDeleteBtn) {
            const fromId = connDeleteBtn.dataset.from;
            const toId = connDeleteBtn.dataset.to;
            const outputName = connDeleteBtn.dataset.outputName;
            if (fromId && toId) {
                chat.flow.connections = (chat.flow.connections || []).filter(c =>
                    !(c.from === fromId && c.to === toId && (c.outputName || 'default') === outputName)
                );
                chatModified = true;
            }
        }

        if (chatModified) {
            this.store.set('currentChat', { ...chat });
        }
    }

    _handleConnectorMouseDown(target) {
        this._connectionInfo.active = true;
        this._connectionInfo.fromNode = target.closest('.flow-step-card');
        this._connectionInfo.fromConnector = target;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('stroke', 'red');
        line.setAttribute('stroke-width', '2');
        this._connectionInfo.tempLine = line;
        document.getElementById('flow-svg-layer').appendChild(line);
    }

    _handleNodeDragMouseDown(target, e) {
        e.preventDefault();
        this._dragInfo.active = true;
        this._dragInfo.target = target.closest('.flow-step-card');
        this._dragInfo.offsetX = e.clientX - this._dragInfo.target.offsetLeft;
        this._dragInfo.offsetY = e.clientY - this._dragInfo.target.offsetTop;
    }

    _handleCanvasPanMouseDown(e) {
        e.preventDefault();
        const canvasWrapper = document.getElementById('flow-canvas-wrapper');
        this._panInfo.active = true;
        this._panInfo.startX = e.clientX;
        this._panInfo.startY = e.clientY;
        this._panInfo.scrollLeft = canvasWrapper.scrollLeft;
        this._panInfo.scrollTop = canvasWrapper.scrollTop;
        e.target.closest('#flow-canvas').classList.add('panning');
    }

    /**
     * Handles the mouse down event on the flow canvas for dragging, panning, and creating connections.
     * @param {Event} e - The mouse down event.
     */
    handleFlowCanvasMouseDown(e) {
        const target = e.target;
        if (target.closest('.flow-step-card') && INTERACTIVE_TAGS.includes(target.tagName)) return;

        if (target.classList.contains('connector')) {
            this._handleConnectorMouseDown(target);
        } else if (target.closest('.flow-step-card')) {
            this._handleNodeDragMouseDown(target, e);
        } else if (['flow-canvas', 'flow-node-container', 'flow-svg-layer'].includes(target.id)) {
            this._handleCanvasPanMouseDown(e);
        }
    }

    _handleNodeDragMouseMove(e) {
        const newX = e.clientX - this._dragInfo.offsetX;
        const newY = e.clientY - this._dragInfo.offsetY;
        this._dragInfo.target.style.left = `${newX}px`;
        this._dragInfo.target.style.top = `${newY}px`;
        const step = this.store.get('currentChat').flow.steps.find(s => s.id === this._dragInfo.target.dataset.id);
        if (step) {
            step.x = newX;
            step.y = newY;
        }
        renderFlow(this.store);
    }

    _handleConnectorMouseMove(e) {
        const fromRect = this._connectionInfo.fromConnector.getBoundingClientRect();
        const canvasWrapper = document.getElementById('flow-canvas-wrapper');
        const canvasRect = canvasWrapper.getBoundingClientRect();
        const startX = fromRect.left - canvasRect.left + fromRect.width / 2 + canvasWrapper.scrollLeft;
        const startY = fromRect.top - canvasRect.top + fromRect.height / 2 + canvasWrapper.scrollTop;
        this._connectionInfo.tempLine.setAttribute('x1', startX);
        this._connectionInfo.tempLine.setAttribute('y1', startY);
        this._connectionInfo.tempLine.setAttribute('x2', e.clientX - canvasRect.left + canvasWrapper.scrollLeft);
        this._connectionInfo.tempLine.setAttribute('y2', e.clientY - canvasRect.top + canvasWrapper.scrollTop);
    }

    _handleCanvasPanMouseMove(e) {
        e.preventDefault();
        const canvasWrapper = document.getElementById('flow-canvas-wrapper');
        const dx = e.clientX - this._panInfo.startX;
        const dy = e.clientY - this._panInfo.startY;
        canvasWrapper.scrollLeft = this._panInfo.scrollLeft - dx;
        canvasWrapper.scrollTop = this._panInfo.scrollTop - dy;
    }

    /**
     * Handles the mouse move event on the flow canvas.
     * @param {Event} e - The mouse move event.
     */
    handleFlowCanvasMouseMove(e) {
        if (this._dragInfo.active) {
            this._handleNodeDragMouseMove(e);
        } else if (this._connectionInfo.active) {
            this._handleConnectorMouseMove(e);
        } else if (this._panInfo.active) {
            this._handleCanvasPanMouseMove(e);
        }
    }

    _handleConnectionMouseUp(e) {
        const toConnector = e.target.classList.contains('connector') ? e.target : e.target.closest('.connector');
        if (toConnector && toConnector.dataset.type === 'in' && toConnector !== this._connectionInfo.fromConnector) {
            const toNode = toConnector.closest('.flow-step-card');
            const fromNode = this._connectionInfo.fromNode;
            const fromConnector = this._connectionInfo.fromConnector;
            const chat = this.store.get('currentChat');

            if (!chat.flow.connections) chat.flow.connections = [];

            const newConnection = {
                from: fromNode.dataset.id,
                to: toNode.dataset.id,
                outputName: fromConnector.dataset.outputName
            };

            const connectionExists = chat.flow.connections.some(c =>
                c.from === newConnection.from && c.outputName === newConnection.outputName
            );

            if (!connectionExists) {
                chat.flow.connections.push(newConnection);
                this.store.set('currentChat', { ...chat });
            } else {
                log(2, "Connection from this output port already exists.");
            }
        }
        this._connectionInfo.tempLine.remove();
    }

    /**
     * Handles the mouse up event on the flow canvas.
     * @param {Event} e - The mouse up event.
     */
    handleFlowCanvasMouseUp(e) {
        if (this._dragInfo.active) {
            this.store.set('currentChat', { ...this.store.get('currentChat') });
        } else if (this._connectionInfo.active) {
            this._handleConnectionMouseUp(e);
        } else if (this._panInfo.active) {
            document.getElementById('flow-canvas').classList.remove('panning');
        }
        this._dragInfo.active = false;
        this._connectionInfo.active = false;
        this._panInfo.active = false;
    }

    /**
     * Exports the current flow to a JSON file.
     */
    exportFlow() {
        const chat = this.store.get('currentChat');
        if (!chat || !chat.flow) {
            triggerError('No flow to export.');
            return;
        }
        const filenameBase = `flow_${chat.title.replace(/\s/g, '_')}`;
        exportJson(chat.flow, filenameBase);
    }

    /**
     * Imports a flow from a JSON file.
     */
    importFlow() {
        importJson('application/json', (importedFlow) => {
            if (importedFlow && Array.isArray(importedFlow.steps) && Array.isArray(importedFlow.connections)) {
                const chat = this.store.get('currentChat');
                chat.flow = importedFlow;
                this.store.set('currentChat', { ...chat });
            } else {
                triggerError('Invalid flow file format.');
            }
        });
    }

    /**
     * Exports the agents from the current chat to a JSON file.
     */
    exportAgents() {
        const chat = this.store.get('currentChat');
        if (!chat || !chat.agents || chat.agents.length === 0) {
            triggerError('No agents to export.');
            return;
        }
        const filenameBase = `agents_${chat.title.replace(/\s/g, '_')}`;
        exportJson(chat.agents, filenameBase);
    }

    /**
     * Imports agents from a JSON file into the current chat.
     */
    importAgents() {
        importJson('application/json', (importedAgents) => {
            if (!Array.isArray(importedAgents)) {
                triggerError('Invalid agents file format. Expected a JSON array.');
                return;
            }

            const chat = this.store.get('currentChat');
            if (!chat.agents) chat.agents = [];

            const existingAgentIds = new Set(chat.agents.map(a => a.id));

            importedAgents.forEach(importedAgent => {
                if (existingAgentIds.has(importedAgent.id)) {
                    const index = chat.agents.findIndex(a => a.id === importedAgent.id);
                    chat.agents[index] = importedAgent;
                } else {
                    chat.agents.push(importedAgent);
                }
            });

            this.store.set('currentChat', { ...chat });
        });
    }

    hooks = {
        onModifySystemPrompt(systemContent) {
            // Always remove any existing agent definition first.
            let newSystemContent = systemContent
                .replace(/\n\n--- AGENT DEFINITION ---\n[\s\S]*?\n--- END AGENT DEFINITION ---/g, '')
                .replace(/\n\n--- AGENT TOOLS ---\n[\s\S]*?\n--- END AGENT TOOLS ---/g, '');

            const store = this.store;
            if (!store) return newSystemContent;

            const chat = store.get('currentChat');
            const agent = chat ? chat.agents.find(a => a.id === chat.activeAgentId) : null;

            if (agent) {
                // A valid agent is active. Add its definition and tools.
                newSystemContent += `\n\n--- AGENT DEFINITION ---\n${agent.systemPrompt}\n--- END AGENT DEFINITION ---`;

                const tools = chat.agents.filter(a => a.availableAsTool && a.id !== chat.activeAgentId);
                if (tools.length > 0) {
                    newSystemContent += '\n\n--- AGENT TOOLS ---\n';
                    newSystemContent += `### Agent Tools:\n\nTo call an agent tool, use: <dma:tool_call name="agent_name_agent"><parameter name="prompt">...</parameter></dma:tool_call>\n### Available Tools:\n\n`;
                    tools.forEach(t => { newSystemContent += `- ${t.name}: ${t.description}\n`; });
                    newSystemContent += '\n--- END AGENT TOOLS ---';
                }
            }
            return newSystemContent;
        },
        async onMessageComplete(message, chatlog, chatbox) {
            if (!message.value) return; // Defend against null message value
            const { toolCalls } = parseFunctionCalls(message.value.content);

            // --- Multi-Message Continuation ---
            if (this._flowRunning && this._multiMessageInfo.active) {
                if (toolCalls.length > 0) return; // Wait for tool calls to complete

                const { step, counter, messageToBranchFrom } = this._multiMessageInfo;
                if (counter < step.count) {
                    this._multiMessageInfo.counter++;
                    const chat = this.store.get('currentChat');
                    chat.activeAgentId = step.agentId;
                    this.store.set('currentChat', { ...chat });
                    this.app.chatUIManager.addMessageWithoutContent(messageToBranchFrom);
                    hooks.onGenerateAIResponse.forEach(fn => fn({}, chatlog));
                    return;
                } else {
                    this._multiMessageInfo = { active: false, step: null, counter: 0, messageToBranchFrom: null };
                }
            }

            // --- Agent Tool Call Processing ---
            const context = {
                app: this.app,
                store: this.store,
            };
            await processToolCalls(message, chatlog, chatbox, this._filterAgentCalls.bind(this), this._executeAgentCall.bind(this), context);

            // --- Flow Continuation ---
            // Re-parse *after* processToolCalls might have added its own messages.
            const newToolCalls = parseFunctionCalls(message.value.content).toolCalls;
            if (this._flowRunning && newToolCalls.length === 0) {
                const currentChat = this.store.get('currentChat');
                const currentStep = currentChat.flow.steps.find(s => s.id === this._currentStepId);

                if (currentStep && currentStep.type === 'prompt-and-clear') {
                    const activeMessages = chatlog.getActiveMessageValues();
                    const userMessageIndex = activeMessages.length - 2;
                    const firstMessage = chatlog.getFirstMessage();
                    const hasSystemPrompt = firstMessage && firstMessage.value.role === 'system';
                    const startIndex = hasSystemPrompt ? 1 : 0;
                    for (let i = userMessageIndex - 1; i >= startIndex; i--) {
                        chatlog.deleteNthMessage(i);
                    }
                }

                const { steps, connections } = currentChat.flow;
                const nextStep = this.flowExecutor.getNextStep(this._currentStepId);
                if (nextStep) {
                    this.flowExecutor.executeStep(nextStep);
                } else {
                    this.flowExecutor.stopFlow('Flow execution complete.');
                }
            }
        }
    }

    _filterAgentCalls(call) {
        return call.name.endsWith('_agent');
    }

    async _executeAgentCall(call, context) {
        const { app, store } = context;
        const currentChat = store.get('currentChat');
        const agentToCall = currentChat.agents.find(a => `${a.name.toLowerCase().replace(/\s+/g, '_')}_agent` === call.name);

        if (!agentToCall) {
            return { id: call.id, error: `Agent "${call.name}" not found.` };
        }
        const prompt = call.params.prompt;
        if (typeof prompt !== 'string') {
            return { id: call.id, error: `Agent call to "${call.name}" is missing the "prompt" parameter.` };
        }

        const payload = {
            model: app.configService.getItem('model', ''),
            messages: [
                { role: 'system', content: agentToCall.systemPrompt },
                { role: 'user', content: prompt }
            ],
            temperature: Number(app.ui.temperatureEl.value),
            top_p: Number(app.ui.topPEl.value),
            stream: true
        };

        try {
            const reader = await app.apiService.streamAPIResponse(payload, app.configService.getItem('endpoint', defaultEndpoint), app.configService.getItem('apiKey', ''), new AbortController().signal);
            let responseContent = '';
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                chunk.split('\n').forEach(line => {
                    if (line.startsWith('data: ')) {
                        const data = line.substring(6);
                        if (data.trim() !== '[DONE]') {
                            try {
                                responseContent += JSON.parse(data).choices[0]?.delta?.content || '';
                            } catch (e) {
                                log(2, 'Error parsing agent response chunk', e);
                            }
                        }
                    }
                });
            }
            return { id: call.id, content: responseContent };
        } catch (error) {
            log(1, 'Agent call failed', error);
            return { id: call.id, error: error.message || 'Unknown error during agent execution.' };
        }
    }
}

const agentsPlugin = new AgentsPlugin();
export { agentsPlugin };
