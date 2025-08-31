/**
 * @fileoverview Plugin for agents and flow management.
 */

'use strict';

import { log, triggerError } from '../../utils/logger.js';
import { hooks } from '../../hooks.js';
import { stepTypes } from './agent-step-definitions.js';
import { parseFunctionCalls } from '../../utils/parsers.js';
import { createControlButton } from '../../utils/ui.js';
import { processToolCalls, exportJson, importJson } from '../../utils/shared.js';
import { defaultEndpoint } from '../../config.js';
import { FlowCanvas } from './flow-canvas.js';

const INTERACTIVE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'LABEL'];

// --- UI Rendering Functions ---
function renderAgentList(store) {
    const agentList = document.getElementById('agent-list');
    agentList.innerHTML = '';
    const chat = store.get('currentChat');
    if (!chat || !chat.agents) return;
    chat.agents.forEach(agent => {
        const card = document.createElement('div');
        const isActive = agent.id === chat.activeAgentId;
        card.className = `agent-card ${isActive ? 'active' : ''}`;
        card.innerHTML = `
            <h3>${agent.name}</h3><p>${agent.description}</p>
            <div class="agent-card-buttons">
                <button class="agents-flow-btn activate-agent-btn" data-id="${agent.id}">${isActive ? 'Deactivate' : 'Activate'}</button>
                <button class="agents-flow-btn edit-agent-btn" data-id="${agent.id}">Edit</button>
                <button class="agents-flow-btn delete-agent-btn" data-id="${agent.id}">Delete</button>
            </div>`;
        agentList.appendChild(card);
    });
}

function showAgentForm(agent, store) {
    const formContainer = document.getElementById('agent-form-container');
    const form = document.getElementById('agent-form');
    form.reset();
    document.getElementById('agent-id').value = agent ? agent.id : '';

    const modelSettingsEl = document.getElementById('agent-model-settings');
    const useCustomSettingsCheckbox = document.getElementById('agent-use-custom-settings');

    modelSettingsEl.innerHTML = ''; // Clear previous settings

    if (agent) {
        document.getElementById('agent-name').value = agent.name;
        document.getElementById('agent-description').value = agent.description;
        document.getElementById('agent-system-prompt').value = agent.systemPrompt;
        document.getElementById('agent-available-as-tool').checked = agent.availableAsTool;
        useCustomSettingsCheckbox.checked = agent.useCustomModelSettings || false;

        modelSettingsEl.style.display = useCustomSettingsCheckbox.checked ? 'block' : 'none';

        const chat = store.get('currentChat');
        if (useCustomSettingsCheckbox.checked) {
            if (!agent.modelSettings) agent.modelSettings = {};
            hooks.onModelSettingsRender.forEach(fn => fn(modelSettingsEl, agent.modelSettings, chat.id, agent.id));
        }
    } else {
        useCustomSettingsCheckbox.checked = false;
        modelSettingsEl.style.display = 'none';
    }

    // Use a fresh listener to avoid duplicates
    const newCheckbox = useCustomSettingsCheckbox.cloneNode(true);
    useCustomSettingsCheckbox.parentNode.replaceChild(newCheckbox, useCustomSettingsCheckbox);
    newCheckbox.addEventListener('change', (e) => {
        modelSettingsEl.style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked && agent) {
             const chat = store.get('currentChat');
             if (!agent.modelSettings) agent.modelSettings = {};
             hooks.onModelSettingsRender.forEach(fn => fn(modelSettingsEl, agent.modelSettings, chat.id, agent.id));
        }
    });
    formContainer.style.display = 'block';
}

function hideAgentForm() {
    document.getElementById('agent-form-container').style.display = 'none';
}


// --- Main Plugin Object ---
const agentsPlugin = {
    name: 'agents',
    app: null,
    store: null,
    flowRunning: false,
    currentStepId: null,
    stepCounter: 0,
    maxSteps: 20,
    multiMessageInfo: { active: false, step: null, counter: 0, messageToBranchFrom: null },
    flowCanvas: null,

    init: function(app, toolCallService) {
        this.app = app;
        this.store = app.store;
        this.toolCallService = toolCallService;

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

        // --- Event Listeners ---
        // Tab switching
        document.getElementById('tabs').addEventListener('click', e => this.handleTabClick(e));
        // Agent UI
        document.getElementById('add-agent-btn').addEventListener('click', () => showAgentForm(null, this.store));
        document.getElementById('cancel-agent-form').addEventListener('click', hideAgentForm);
        document.getElementById('agent-form').addEventListener('submit', e => this.saveAgent(e));
        document.getElementById('agent-list').addEventListener('click', e => this.handleAgentListClick(e));
        document.getElementById('export-agents-btn').addEventListener('click', () => this.exportAgents());
        document.getElementById('import-agents-btn').addEventListener('click', () => this.importAgents());
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
        document.getElementById('run-flow-btn').addEventListener('click', () => this.toggleFlow());
        document.getElementById('export-flow-btn').addEventListener('click', () => this.exportFlow());
        document.getElementById('import-flow-btn').addEventListener('click', () => this.importFlow());

        window.addEventListener('click', (e) => {
            if (!e.target.matches('#add-flow-step-btn-dropdown')) {
                const dropdown = document.getElementById('add-step-dropdown-content');
                if (dropdown.classList.contains('show')) {
                    dropdown.classList.remove('show');
                }
            }
        });

        this.flowCanvas = new FlowCanvas(this.store, this);

        // --- Store Subscription ---
        this.store.subscribe('currentChat', () => {
            renderAgentList(this.store);
            this.flowCanvas.render();
        });

        // --- Hooks ---
        hooks.onCancel.push(() => {
            if (this.flowRunning) this.stopFlow('Execution cancelled by user.');
        });
    },

    // --- Event Handlers ---
    handleTabClick(e) {
        if (e.target.classList.contains('tab-button')) {
            const tabName = e.target.dataset.tab;
            if (tabName === 'flow') {
                this.flowCanvas.render();
            }
            document.querySelectorAll('#tabs .tab-button, #tab-content .tab-pane').forEach(el => el.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(`${tabName}-tab-pane`).classList.add('active');
        }
    },

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
    },

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
    },

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
    },


    exportFlow() {
        const chat = this.store.get('currentChat');
        if (!chat || !chat.flow) {
            triggerError('No flow to export.');
            return;
        }
        const filenameBase = `flow_${chat.title.replace(/\s/g, '_')}`;
        exportJson(chat.flow, filenameBase);
    },

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
    },

    exportAgents() {
        const chat = this.store.get('currentChat');
        if (!chat || !chat.agents || chat.agents.length === 0) {
            triggerError('No agents to export.');
            return;
        }
        const filenameBase = `agents_${chat.title.replace(/\s/g, '_')}`;
        exportJson(chat.agents, filenameBase);
    },

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
    },

    // --- Flow Execution Logic ---
    toggleFlow() {
        if (this.flowRunning) this.stopFlow();
        else this.startFlow();
    },

    updateRunButton(isRunning) {
        document.getElementById('run-flow-btn').textContent = isRunning ? 'Stop Flow' : 'Run Flow';
    },

    stopFlow(message = 'Flow stopped.') {
        this.flowRunning = false;
        this.currentStepId = null;
        this.multiMessageInfo = { active: false, step: null, counter: 0, messageToBranchFrom: null };
        this.updateRunButton(false);
        const chat = this.store.get('currentChat');
        if (chat) {
            chat.activeAgentId = null;
            this.store.set('currentChat', { ...chat });
        }
        log(3, message);
    },

    executeStep(step) {
        if (!this.flowRunning) return;
        if (this.stepCounter++ >= this.maxSteps) {
            triggerError('Flow execution stopped: Maximum step limit reached.');
            this.stopFlow();
            return;
        }

        this.currentStepId = step.id;
        const type = step.type || 'simple-prompt';
        const stepDefinition = stepTypes[type];

        if (stepDefinition && stepDefinition.execute) {
            const context = {
                app: this.app,
                store: this.store,
                triggerError: triggerError,
                stopFlow: (message) => this.stopFlow(message),
                getNextStep: (stepId, outputName) => this.getNextStep(stepId, outputName),
                executeStep: (nextStep) => this.executeStep(nextStep),
                multiMessageInfo: this.multiMessageInfo,
            };
            stepDefinition.execute(step, context);
        } else {
            triggerError(`Unknown or non-executable step type: ${type}`);
            this.stopFlow('Unknown step type.');
        }
    },

    startFlow() {
        log(3, 'Starting flow execution...');
        const chat = this.store.get('currentChat');
        const { steps, connections } = chat.flow;
        if (!steps || steps.length === 0) {
            triggerError('Flow has no steps.');
            return;
        }
        const nodesWithIncoming = new Set((connections || []).map(c => c.to));
        const startingNodes = steps.filter(s => !nodesWithIncoming.has(s.id));
        if (startingNodes.length !== 1) {
            triggerError('Flow must have exactly one starting node.');
            return;
        }
        this.flowRunning = true;
        this.stepCounter = 0;
        this.updateRunButton(true);
        this.executeStep(startingNodes[0]);
    },
    getNextStep(stepId, outputName = 'default') {
        const chat = this.store.get('currentChat');
        const connection = chat.flow.connections.find(c => c.from === stepId && (c.outputName || 'default') === outputName);
        return connection ? chat.flow.steps.find(s => s.id === connection.to) : null;
    },

    // --- Hooks Definition ---
    hooks: {
        onModifySystemPrompt: (systemContent) => {
            // Always remove any existing agent definition first.
            let newSystemContent = systemContent
                .replace(/\n\n--- AGENT DEFINITION ---\n[\s\S]*?\n--- END AGENT DEFINITION ---/g, '')
                .replace(/\n\n--- AGENT TOOLS ---\n[\s\S]*?\n--- END AGENT TOOLS ---/g, '');

            const store = agentsPlugin.store;
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
        onMessageComplete: async (message, chatlog, uiManager) => {
            if (!message.value) return; // Defend against null message value
            const { toolCalls } = parseFunctionCalls(message.value.content);

            // --- Multi-Message Continuation ---
            if (agentsPlugin.flowRunning && agentsPlugin.multiMessageInfo.active) {
                if (toolCalls.length > 0) return; // Wait for tool calls to complete

                const { step, counter, messageToBranchFrom } = agentsPlugin.multiMessageInfo;
                if (counter < step.count) {
                    agentsPlugin.multiMessageInfo.counter++;
                    const chat = agentsPlugin.store.get('currentChat');
                    chat.activeAgentId = step.agentId;
                    agentsPlugin.store.set('currentChat', { ...chat });
                    uiManager.addAlternative({ role: 'assistant', content: null }, messageToBranchFrom);
                    agentsPlugin.app.generateAIResponse({}, chatlog);
                    return;
                } else {
                    agentsPlugin.multiMessageInfo = { active: false, step: null, counter: 0, messageToBranchFrom: null };
                }
            }

            // --- Agent Tool Call Processing ---
            const context = {
                app: agentsPlugin.app,
                store: agentsPlugin.store,
            };
            await this.toolCallService.process(message, chatlog, uiManager, filterAgentCalls, executeAgentCall, context);

            // --- Flow Continuation ---
            // Re-parse *after* processToolCalls might have added its own messages.
            const newToolCalls = parseFunctionCalls(message.value.content).toolCalls;
            if (agentsPlugin.flowRunning && newToolCalls.length === 0) {
                const currentChat = agentsPlugin.store.get('currentChat');
                const currentStep = currentChat.flow.steps.find(s => s.id === agentsPlugin.currentStepId);

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
                const nextConnection = connections.find(c => c.from === agentsPlugin.currentStepId);
                const nextStep = nextConnection ? steps.find(s => s.id === nextConnection.to) : null;
                if (nextStep) {
                    agentsPlugin.executeStep(nextStep);
                } else {
                    agentsPlugin.stopFlow('Flow execution complete.');
                }
            }
        }
    }
};
function filterAgentCalls(call) {
    return call.name.endsWith('_agent');
}

async function executeAgentCall(call, context) {
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
        temperature: app.configService.getModelSettings().temperature,
        top_p: app.configService.getModelSettings().top_p,
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
export { agentsPlugin };
