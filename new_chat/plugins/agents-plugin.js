/**
 * @fileoverview Plugin for managing and using Agents with advanced settings.
 * @version 3.0.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce, createSettingsUI } from '../utils.js';

/**
 * @typedef {import('../utils.js').ToolSettings} AgentToolSettings
 */

/**
 * @typedef {object} AgentModelSettings
 * @property {string} [apiKey]
 * @property {string} [apiUrl]
 * @property {string} [model]
 * @property {number} [temperature]
 * @property {number} [top_p]
 */

/**
 * @typedef {object} Agent
 * @property {string} id
 * @property {string} name
 * @property {string} systemPrompt
 * @property {boolean} useCustomModelSettings
 * @property {AgentModelSettings} modelSettings
 * @property {boolean} useCustomToolSettings
 * @property {AgentToolSettings} toolSettings
 */

/**
 * Manages the lifecycle and storage of agents.
 * @class
 */
class AgentManager {
    constructor() {
        /** @type {Agent[]} */
        this.agents = this._loadAgents();
        /** @type {Object.<string, string>} */
        this.chatAgentMap = this._loadChatAgentMap();
    }

    _loadAgents() {
        try {
            return JSON.parse(localStorage.getItem('core_agents_v2') || '[]');
        } catch (e) {
            console.error('Failed to load agents:', e);
            return [];
        }
    }

    _saveAgents() {
        localStorage.setItem('core_agents_v2', JSON.stringify(this.agents));
    }

    _loadChatAgentMap() {
        try {
            return JSON.parse(localStorage.getItem('core_chat_agent_map_v2') || '{}');
        } catch (e) {
            console.error('Failed to load chat-agent map:', e);
            return {};
        }
    }

    _saveChatAgentMap() {
        localStorage.setItem('core_chat_agent_map_v2', JSON.stringify(this.chatAgentMap));
    }

    getAgent(id) {
        return this.agents.find(a => a.id === id);
    }

    addAgent(agentData) {
        const newAgent = {
            id: `agent-${Date.now()}`,
            name: 'New Agent',
            systemPrompt: 'You are a helpful assistant.',
            useCustomModelSettings: false,
            modelSettings: {},
            useCustomToolSettings: false,
            toolSettings: { allowAll: false, allowed: [] },
            ...agentData,
        };
        this.agents.push(newAgent);
        this._saveAgents();
        return newAgent;
    }

    updateAgent(agentData) {
        const index = this.agents.findIndex(a => a.id === agentData.id);
        if (index !== -1) {
            this.agents[index] = { ...this.agents[index], ...agentData };
            this._saveAgents();
        }
    }

    deleteAgent(id) {
        this.agents = this.agents.filter(a => a.id !== id);
        this._saveAgents();
        Object.keys(this.chatAgentMap).forEach(chatId => {
            if (this.chatAgentMap[chatId] === id) {
                delete this.chatAgentMap[chatId];
            }
        });
        this._saveChatAgentMap();
    }

    getActiveAgentForChat(chatId) {
        return this.chatAgentMap[chatId] || null;
    }

    setActiveAgentForChat(chatId, agentId) {
        if (agentId) {
            this.chatAgentMap[chatId] = agentId;
        } else {
            delete this.chatAgentMap[chatId];
        }
        this._saveChatAgentMap();
    }
}

const agentManager = new AgentManager();
/** @type {import('../main.js').App | null} */
let appInstance = null;

/** Renders the list of agents in the "Agents" tab panel. */
function renderAgentList() {
    const agentListEl = document.getElementById('agent-list');
    if (!agentListEl) return;
    agentListEl.innerHTML = '';
    agentManager.agents.forEach(agent => {
        const li = document.createElement('li');
        li.className = 'agent-list-item';
        li.dataset.id = agent.id;
        li.innerHTML = `<span>${agent.name}</span><button class="delete-agent-btn">X</button>`;
        agentListEl.appendChild(li);
    });
}

/**
 * Renders the agent editor view using the declarative createSettingsUI.
 * @param {string} agentId - The ID of the agent to edit.
 * @returns {string} The HTML content for the agent editor.
 */
function renderAgentEditor(agentId) {
    const agent = agentManager.getAgent(agentId);
    if (!agent) return `<h2>Agent not found</h2>`;

    const editorContainer = document.createElement('div');
    editorContainer.id = 'agent-editor-view';
    editorContainer.innerHTML = `<h2>Edit Agent: ${agent.name}</h2>`;

    const form = document.createElement('form');
    form.id = 'agent-editor-form';
    form.noValidate = true;
    editorContainer.appendChild(form);

    const debouncedUpdate = debounce((updatedProps) => {
        agentManager.updateAgent({ ...agent, ...updatedProps });
        if (updatedProps.name) {
            const agentListItem = document.querySelector(`.agent-list-item[data-id="${agent.id}"] span`);
            if (agentListItem) agentListItem.textContent = updatedProps.name;
        }
    }, 500);

    const settingsContext = `agent-editor-${agentId}`;

    // --- Basic Agent Settings ---
    const basicSettings = [
        {
            id: 'name', label: 'Name', type: 'text', default: agent.name,
            listeners: { 'input': (e, ctx) => debouncedUpdate({ name: ctx.getValue() }) }
        },
        {
            id: 'systemPrompt', label: 'System Prompt', type: 'textarea', default: agent.systemPrompt,
            listeners: { 'input': (e, ctx) => debouncedUpdate({ systemPrompt: ctx.getValue() }) }
        }
    ];
    form.appendChild(createSettingsUI(basicSettings, agent, 'agent-', settingsContext));
    form.appendChild(document.createElement('hr'));

    // --- Model Settings ---
    const modelSettingsContainer = document.createElement('fieldset');
    modelSettingsContainer.id = 'agent-model-settings';
    const modelLegend = document.createElement('legend');
    modelLegend.textContent = 'Model Settings';
    modelSettingsContainer.appendChild(modelLegend);

    const useCustomModelSettings = {
        id: 'useCustomModelSettings', label: 'Use Custom Model Settings', type: 'checkbox', default: agent.useCustomModelSettings,
        listeners: {
            'change': (e, ctx) => {
                const isChecked = ctx.getValue();
                modelSettingsContainer.disabled = !isChecked;
                debouncedUpdate({ useCustomModelSettings: isChecked });
            }
        }
    };
    form.appendChild(createSettingsUI([useCustomModelSettings], agent, 'agent-', settingsContext));

    const modelSettingDefs = appInstance.settings
        .filter(s => ['apiUrl', 'apiKey', 'model', 'temperature'].includes(s.id))
        .map(s => ({
            ...s, // Copy base definition
            listeners: {
                'input': (e, ctx) => {
                    const currentAgent = agentManager.getAgent(agentId);
                    const modelSettings = { ...currentAgent.modelSettings, [s.id]: ctx.getValue() };
                    debouncedUpdate({ modelSettings });
                },
                'change': (e, ctx) => { // Also save on change for selects
                    const currentAgent = agentManager.getAgent(agentId);
                    const modelSettings = { ...currentAgent.modelSettings, [s.id]: ctx.getValue() };
                    debouncedUpdate({ modelSettings });
                }
            }
        }));

    modelSettingsContainer.appendChild(createSettingsUI(modelSettingDefs, agent.modelSettings, 'agent-model-', settingsContext));
    modelSettingsContainer.disabled = !agent.useCustomModelSettings;
    form.appendChild(modelSettingsContainer);
    form.appendChild(document.createElement('hr'));

    // --- Tool Settings ---
    const toolSettingsWrapper = document.createElement('div');
    const useCustomToolSettings = {
        id: 'useCustomToolSettings', label: 'Use Custom Tool Settings', type: 'checkbox', default: agent.useCustomToolSettings,
        listeners: {
            'change': (e, ctx) => {
                const isChecked = ctx.getValue();
                const toolSettingsContainer = document.getElementById('agent-tool-settings-container');
                if (toolSettingsContainer) toolSettingsContainer.style.display = isChecked ? '' : 'none';
                debouncedUpdate({ useCustomToolSettings: isChecked });
            }
        }
    };
    toolSettingsWrapper.appendChild(createSettingsUI([useCustomToolSettings], agent, 'agent-', settingsContext));

    const toolSettingsContainer = document.createElement('div');
    toolSettingsContainer.id = 'agent-tool-settings-container';
    toolSettingsContainer.style.display = agent.useCustomToolSettings ? '' : 'none';

    if (appInstance?.mcp?.getTools) {
        const tools = appInstance.mcp.getTools();
        if (tools.length > 0) {
            const toolSettingsDef = {
                id: 'toolSettings', label: 'Tool Permissions', type: 'checkbox-list', allowAll: true,
                options: tools.map(tool => ({ value: tool.name, label: tool.name })),
                listeners: {
                    'change': (e, ctx) => {
                        debouncedUpdate({ toolSettings: ctx.getValue() });
                    }
                }
            };
            toolSettingsContainer.appendChild(createSettingsUI([toolSettingsDef], agent, 'agent-', settingsContext));
        } else {
            toolSettingsContainer.innerHTML = '<p>No tools available.</p>';
        }
    }
    toolSettingsWrapper.appendChild(toolSettingsContainer);
    form.appendChild(toolSettingsWrapper);

    return editorContainer.outerHTML;
}

/** Populates the agent selector dropdown in the chat area. */
function populateAgentSelector() {
    const selector = document.getElementById('agent-selector');
    if (!selector || !appInstance) return;

    const activeAgentId = agentManager.getActiveAgentForChat(appInstance.activeChatId);
    selector.innerHTML = '<option value="">Default AI</option>';
    agentManager.agents.forEach(agent => {
        const option = document.createElement('option');
        option.value = agent.id;
        option.textContent = agent.name;
        option.selected = agent.id === activeAgentId;
        selector.appendChild(option);
    });
}

/**
 * The main plugin object for agents.
 * @type {import('../plugin-manager.js').Plugin}
 */
const agentsPlugin = {
    name: 'Agents',

    onAppInit(app) {
        appInstance = app;
        pluginManager.registerView('agent-editor', renderAgentEditor);
        app.agentManager = agentManager;
    },

    onTabsRegistered(tabs) {
        tabs.push({
            id: 'agents',
            label: 'Agents',
            onActivate: () => {
                const contentEl = document.getElementById('agents-pane');
                contentEl.innerHTML = `
                    <div class="pane-header">
                        <h3>Agents</h3>
                        <button id="add-agent-btn" class="primary-btn">Add New Agent</button>
                    </div>
                    <ul id="agent-list"></ul>`;
                renderAgentList();

                document.getElementById('add-agent-btn').addEventListener('click', () => {
                    const addedAgent = agentManager.addAgent({});
                    renderAgentList();
                    appInstance.setView('agent-editor', addedAgent.id);
                });

                document.getElementById('agent-list').addEventListener('click', (e) => {
                    const agentItem = e.target.closest('.agent-list-item');
                    if (!agentItem) return;
                    const agentId = agentItem.dataset.id;
                    if (e.target.classList.contains('delete-agent-btn')) {
                        e.stopPropagation();
                        const agentName = agentManager.getAgent(agentId)?.name || 'this agent';
                        if (confirm(`Are you sure you want to delete "${agentName}"?`)) {
                            agentManager.deleteAgent(agentId);
                            renderAgentList();
                            populateAgentSelector();
                            if (appInstance.activeView.type === 'agent-editor' && appInstance.activeView.id === agentId) {
                                appInstance.setView('chat', appInstance.activeChatId);
                            }
                        }
                    } else {
                        appInstance.setView('agent-editor', agentId);
                    }
                });
            }
        });
        return tabs;
    },

    onChatAreaRender(currentHtml) {
        return currentHtml + `
            <div id="agent-selector-container">
                <label for="agent-selector">Active Agent:</label>
                <select id="agent-selector"><option value="">Default AI</option></select>
            </div>`;
    },

    onChatSwitched(chat) {
        populateAgentSelector();
        const agentSelector = document.getElementById('agent-selector');
        if (agentSelector) {
            const newSelector = agentSelector.cloneNode(true);
            agentSelector.parentNode.replaceChild(newSelector, agentSelector);
            newSelector.addEventListener('change', (e) => {
                const selectedAgentId = e.target.value;
                if (appInstance.activeChatId) {
                    agentManager.setActiveAgentForChat(appInstance.activeChatId, selectedAgentId || null);
                }
            });
            // Re-populate after replacing to ensure correct value is set
            populateAgentSelector();
        }
    }
};

pluginManager.register(agentsPlugin);
