/**
 * @fileoverview Plugin for managing and using Agents with advanced settings.
 * @version 2.1.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce } from '../utils.js';
import { createSettingsUI, setPropertyByPath } from '../settings-manager.js';

/**
 * @typedef {import('../main.js').Setting} Setting
 * @typedef {import('../utils.js').ToolSettings} AgentToolSettings
 */

/**
 * @typedef {object} AgentModelSettings
 * @property {string} [apiKey] - Custom API key for the agent. Overrides global setting.
 * @property {string} [apiUrl] - Custom API URL for the agent. Overrides global setting.
 * @property {string} [model] - The specific model to use for the agent. Overrides global setting.
 * @property {number} [temperature] - The temperature setting for the model. Overrides global setting.
 * @property {number} [top_p] - The top_p setting for the model. Overrides global setting.
 */

/**
 * Represents a configurable Agent with its own personality and settings.
 * @typedef {object} Agent
 * @property {string} id - The unique identifier for the agent.
 * @property {string} name - The name of the agent.
 * @property {string} systemPrompt - The system prompt for the agent.
 * @property {boolean} useCustomModelSettings - Whether to use custom model settings.
 * @property {AgentModelSettings} modelSettings - The custom model settings.
 * @property {boolean} useCustomToolSettings - Whether to use custom tool settings.
 * @property {AgentToolSettings} toolSettings - The custom tool settings.
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
        this.debouncedSave = debounce(() => this._saveAgents(), 500);
    }

    /**
     * @returns {Agent[]} The loaded agents.
     * @private
     */
    _loadAgents() {
        try {
            const agentsJson = localStorage.getItem('core_agents_v2');
            return agentsJson ? JSON.parse(agentsJson) : [];
        } catch (e) {
            console.error('Failed to load agents:', e);
            return [];
        }
    }

    /**
     * Saves the current list of agents to localStorage.
     * @private
     */
    _saveAgents() {
        localStorage.setItem('core_agents_v2', JSON.stringify(this.agents));
    }

    /**
     * @returns {Object.<string, string>} The chat-agent map.
     * @private
     */
    _loadChatAgentMap() {
        try {
            const mapJson = localStorage.getItem('core_chat_agent_map_v2');
            return mapJson ? JSON.parse(mapJson) : {};
        } catch (e) {
            console.error('Failed to load chat-agent map:', e);
            return {};
        }
    }

    /**
     * Saves the current chat-to-agent mapping to localStorage.
     * @private
     */
    _saveChatAgentMap() {
        localStorage.setItem('core_chat_agent_map_v2', JSON.stringify(this.chatAgentMap));
    }

    /**
     * @param {string} id - The ID of the agent.
     * @returns {Agent|undefined} The agent object or undefined if not found.
     */
    getAgent(id) {
        return this.agents.find(a => a.id === id);
    }

    /**
     * @param {Omit<Agent, 'id'>} agentData - The data for the new agent, without the 'id' property.
     * @returns {Agent} The newly created agent, including its generated ID.
     */
    addAgent(agentData) {
        const newAgent = {
            id: `agent-${Date.now()}`,
            name: 'New Agent',
            systemPrompt: 'You are a helpful assistant.',
            useCustomModelSettings: false,
            modelSettings: {},
            useCustomToolSettings: false,
            toolSettings: { allowAll: true, allowed: [] },
            ...agentData
        };
        this.agents.push(newAgent);
        this._saveAgents();
        return newAgent;
    }

    /**
     * @param {Agent} agentData - The updated agent data.
     */
    updateAgent(agentData) {
        const index = this.agents.findIndex(a => a.id === agentData.id);
        if (index !== -1) {
            this.agents[index] = { ...this.agents[index], ...agentData };
            this.debouncedSave();
        }
    }

    /**
     * Updates a specific property of an agent using a dot-notation path.
     * @param {string} agentId - The ID of the agent to update.
     * @param {string} path - The dot-notation path to the property (e.g., 'modelSettings.temperature').
     * @param {any} value - The new value to set.
     */
    updateAgentProperty(agentId, path, value) {
        const agent = this.getAgent(agentId);
        if (agent) {
            setPropertyByPath(agent, path, value);
            this.debouncedSave();

            // Also update the name in the agent list UI if it changes
            if (path === 'name') {
                 const agentListItem = document.querySelector(`.agent-list-item[data-id="${agentId}"] span`);
                 if (agentListItem) {
                     agentListItem.textContent = value;
                 }
            }
        }
    }

    /**
     * @param {string} id
     */
    deleteAgent(id) {
        this.agents = this.agents.filter(a => a.id !== id);
        this._saveAgents();
        for (const chatId in this.chatAgentMap) {
            if (this.chatAgentMap[chatId] === id) {
                delete this.chatAgentMap[chatId];
            }
        }
        this._saveChatAgentMap();
    }

    /**
     * @param {string} chatId
     * @returns {string|null} The active agent ID or null.
     */
    getActiveAgentForChat(chatId) {
        return this.chatAgentMap[chatId] || null;
    }

    /**
     * @param {string} chatId - The ID of the chat.
     * @param {string|null} agentId - The ID of the agent to set as active, or null to deactivate.
     */
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

/**
 * Renders the list of agents in the "Agents" tab panel.
 * @private
 */
function renderAgentList() {
    const agentListEl = document.getElementById('agent-list');
    if (!agentListEl) return;
    agentListEl.innerHTML = '';
    agentManager.agents.forEach(agent => {
        const li = document.createElement('li');
        li.className = 'agent-list-item';
        li.dataset.id = agent.id;
        li.innerHTML = `
            <span>${agent.name}</span>
            <button class="delete-agent-btn">X</button>
        `;
        agentListEl.appendChild(li);
    });
}

/**
 * Renders the agent editor view as an HTML string.
 * This is registered as a view renderer with the PluginManager.
 * @param {string} [agentId] - The ID of the agent to edit.
 * @returns {string} The HTML content for the agent editor.
 * @private
 */
function renderAgentEditor(agentId) {
    const agent = agentId ? agentManager.getAgent(agentId) : null;
    if (!agent) {
        return '<h2>Agent not found.</h2>';
    }

    // This outerHTML is just a shell. The content will be rendered by createSettingsUI.
    return `<div id="agent-editor-view" data-agent-id="${agent.id}"></div>`;
}

/**
 * This function is called when the agent editor view is rendered.
 * It builds the settings definition and uses createSettingsUI to render the form.
 * @private
 */
function initializeAgentEditor() {
    const editorView = document.getElementById('agent-editor-view');
    if (!editorView || !editorView.dataset.agentId) return;

    const agentId = editorView.dataset.agentId;
    const agent = agentManager.getAgent(agentId);
    if (!agent) return;

    const modelSettingDefs = (appInstance?.settings || [])
        .filter(s => !['systemPrompt', 'mcpServer'].includes(s.id)) // TODO: filtering out the systemPrompt here is OK, but mcpServer should be marked as not being a model setting and filtered because of that
        .map(s => {
            if (s.id === 'model') {
                return {
                    ...s,
                    actions: [{
                        id: 'agent-refresh-models',
                        label: 'Refresh',
                        onClick: (e, modelInput) => {
                            if (!modelInput || !appInstance.fetchModels) return;
                            appInstance.fetchModels(modelInput, agentId);
                        }
                    }]
                };
            }
            return s;
        })
        .map(s => {
            const { required, ...rest } = s;
            return rest;
        });

    const tools = appInstance?.mcp?.getTools() || [];

    /** @type {Setting[]} */
    const settingsDefinition = [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'systemPrompt', label: 'System Prompt', type: 'textarea', required: true },
        { type: 'divider' },
        { id: 'useCustomModelSettings', label: 'Use Custom Model Settings', type: 'checkbox' },
        {
            id: 'modelSettings',
            type: 'fieldset',
            label: 'Model Settings',
            children: modelSettingDefs,
            dependsOn: 'useCustomModelSettings',
            dependsOnValue: true
        },
        { type: 'divider' },
        { id: 'useCustomToolSettings', label: 'Use Custom Tool Settings', type: 'checkbox' },
        {
            id: 'toolSettings',
            type: 'fieldset',
            label: 'Tool Settings',
            children: [
                { id: 'allowAll', label: 'Allow all available tools', type: 'checkbox' },
                {
                    id: 'allowed',
                    type: 'checkbox-list',
                    label: '',
                    options: tools.map(t => ({ value: t.name, label: t.name })),
                    dependsOn: 'allowAll',
                    dependsOnValue: false
                }
            ],
            dependsOn: 'useCustomToolSettings',
            dependsOnValue: true
        }
    ];

    const onSettingChanged = (path, value) => {
        agentManager.updateAgentProperty(agentId, path, value);
    };

    const settingsFragment = createSettingsUI(
        settingsDefinition,
        agent,
        onSettingChanged,
        `agent-${agent.id}-`,
        'agent-editor'
    );

    editorView.innerHTML = `<h2>Edit Agent</h2>`;
    editorView.appendChild(settingsFragment);
}

/**
 * Populates the agent selector dropdown in the chat area.
 * @private
 */
function populateAgentSelector() {
    const selector = document.getElementById('agent-selector');
    if (!selector || !appInstance) return;

    const currentChatId = appInstance.activeChatId;
    const activeAgentId = currentChatId ? agentManager.getActiveAgentForChat(currentChatId) : null;

    selector.innerHTML = '<option value="">Default AI</option>';
    agentManager.agents.forEach(agent => {
        const option = document.createElement('option');
        option.value = agent.id;
        option.textContent = agent.name;
        if (agent.id === activeAgentId) {
            option.selected = true;
        }
        selector.appendChild(option);
    });
}

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').Tab} Tab
 * @typedef {import('../main.js').Chat} Chat
 * @typedef {import('../main.js').View} View
 */

/**
 * The main plugin object for agents.
 */
const agentsPlugin = {
    name: 'Agents',

    /**
     * @param {App} app
     */
    onAppInit(app) {
        appInstance = app;
        pluginManager.registerView('agent-editor', renderAgentEditor);
        app.agentManager = agentManager;
    },

    /**
     * @param {Tab[]} tabs - The array of existing tabs.
     * @returns {Tab[]} The updated array of tabs.
     */
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
                    <ul id="agent-list"></ul>
                `;
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
                        if (confirm(`Are you sure you want to delete the agent "${agentManager.getAgent(agentId)?.name}"?`)) {
                            agentManager.deleteAgent(agentId);
                            renderAgentList();
                            populateAgentSelector();
                            // If the deleted agent was being edited, switch view
                            if (appInstance.activeView.type === 'agent-editor' && appInstance.activeView.id === agentId) {
                                appInstance.showTab('agents');
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

    /**
     * @param {string} currentHtml - The current HTML of the chat controls area.
     * @returns {string} The updated HTML.
     */
    onChatAreaRender(currentHtml) {
        const agentSelectorHtml = `
            <div id="agent-selector-container">
                <label for="agent-selector">Active Agent:</label>
                <select id="agent-selector">
                    <option value="">Default AI</option>
                </select>
            </div>
        `;
        return currentHtml + agentSelectorHtml;
    },

    /**
     * @param {Chat} chat
     */
    onChatSwitched(chat) {
        populateAgentSelector();
        const agentSelector = document.getElementById('agent-selector');
        if (agentSelector) {
            // Use a fresh listener to avoid duplicates
            const newSelector = agentSelector.cloneNode(true);
            agentSelector.parentNode.replaceChild(newSelector, agentSelector);
            newSelector.addEventListener('change', (e) => {
                const selectedAgentId = e.target.value;
                if (appInstance.activeChatId) {
                    agentManager.setActiveAgentForChat(appInstance.activeChatId, selectedAgentId || null);
                }
            });
        }
    },

    /**
     * @param {View} view - The rendered view object.
     */
    onViewRendered(view) {
        if (view.type === 'agent-editor') {
            initializeAgentEditor();
        }
    }
};

pluginManager.register(agentsPlugin);
