/**
 * @fileoverview Plugin for managing and using Agents with advanced settings.
 * @version 2.1.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce, importJson, exportJson } from '../utils.js';
import { createSettingsUI, setPropertyByPath } from '../settings-manager.js';

/**
 * @typedef {import('../main.js').Setting} Setting
 * @typedef {import('../main.js').Setting} AgentToolSettings
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

const DEFAULT_AGENT_ID = 'agent-default';

/**
 * Manages the lifecycle and storage of agents.
 * @class
 */
class AgentManager {
    constructor() {
        /** @type {Agent[]} */
        this.agents = [];
        this._loadAgents(); // Populates this.agents

        this.debouncedSave = debounce(() => this._saveAgents(), 500);
    }

    /**
     * Loads agents from storage, creating and migrating a 'Default Agent' if necessary.
     * @private
     */
    _loadAgents() {
        let userAgents = [];
        try {
            const agentsJson = localStorage.getItem('core_agents_v2');
            if (agentsJson) {
                userAgents = JSON.parse(agentsJson);
            }
        } catch (e) {
            console.error('Failed to load user agents:', e);
            userAgents = [];
        }

        let defaultAgent = userAgents.find(a => a.id === DEFAULT_AGENT_ID);

        if (!defaultAgent) {
            // Try to migrate from old global settings
            const oldGlobalSettings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};

            // Create the new default agent object
            const newDefaultAgent = {
                id: DEFAULT_AGENT_ID,
                name: 'Default Agent',
                systemPrompt: oldGlobalSettings.systemPrompt || 'You are a helpful assistant.',
                useCustomModelSettings: true, // Always true for default
                modelSettings: {
                    apiUrl: oldGlobalSettings.apiUrl || '',
                    apiKey: oldGlobalSettings.apiKey || '',
                    model: oldGlobalSettings.model || '',
                    temperature: oldGlobalSettings.temperature ?? 1,
                },
                useCustomToolSettings: true, // Always true for default
                toolSettings: { allowAll: true, allowed: [] }
            };

            // If we migrated, remove the old settings key
            if (Object.keys(oldGlobalSettings).length > 0) {
                localStorage.removeItem('core_chat_settings');
            }
            // Add the new default agent to the list to be saved
            userAgents.unshift(newDefaultAgent);
            this._saveAgents(userAgents); // Save immediately
            defaultAgent = newDefaultAgent;
        }

        // Ensure Default Agent is always first.
        const finalAgents = [...userAgents];
        const defaultIdx = finalAgents.findIndex(a => a.id === DEFAULT_AGENT_ID);
        if (defaultIdx > 0) {
            // Move it to the front if it's not already there
            const defaultItem = finalAgents.splice(defaultIdx, 1)[0];
            finalAgents.unshift(defaultItem);
        }
        this.agents = finalAgents;
    }

    /**
     * Saves the current list of agents to localStorage.
     * @param {Agent[]} [agents=this.agents] - The array of agents to save.
     * @private
     */
    _saveAgents(agents = this.agents) {
        localStorage.setItem('core_agents_v2', JSON.stringify(agents));
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

    addAgentFromData(agentData) {
        const newAgent = {
            id: `agent-${Date.now()}`,
            ...agentData
        };
        this.agents.push(newAgent);
        this._saveAgents();
        renderAgentList();
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
        if (id === DEFAULT_AGENT_ID) {
            console.error("Cannot delete the Default Agent.");
            return;
        }
        this.agents = this.agents.filter(a => a.id !== id);
        this._saveAgents();
        // When an agent is deleted, we must update any chats that were using it.
        appInstance.chats.forEach(chat => {
            if (chat.agent === id) {
                chat.agent = null;
            }
        });
        appInstance.saveChats();
    }

    /**
     * Gets the effective combined configuration for a given agent.
     * It merges model and tool settings, and handles fallbacks to the Default Agent.
     * @param {string|null} [agentId=null] - The ID of the agent. If null, uses the active agent for the current chat.
     * @returns {object} An object containing the effective settings.
     */
    getEffectiveApiConfig(agentId = null) {
        const finalAgentId = agentId || appInstance.getActiveChat()?.agent || DEFAULT_AGENT_ID;
        const agent = this.getAgent(finalAgentId);
        const defaultAgent = this.getAgent(DEFAULT_AGENT_ID);

        if (!defaultAgent) {
            console.error("Default Agent not found!");
            return {};
        }

        // Start with default settings as the base
        let effectiveModelSettings = { ...(defaultAgent.modelSettings || {}) };
        let effectiveToolSettings = { ...(defaultAgent.toolSettings || {}) };
        let effectiveSystemPrompt = defaultAgent.systemPrompt;

        // If we're looking at a specific, non-default agent, layer its settings on top
        if (agent && agent.id !== DEFAULT_AGENT_ID) {
            // The agent's own system prompt always takes precedence if it exists.
            effectiveSystemPrompt = agent.systemPrompt;

            if (agent.useCustomModelSettings) {
                effectiveModelSettings = { ...effectiveModelSettings, ...(agent.modelSettings || {}) };
                if (!agent.modelSettings?.apiUrl) {
                    // If no agent API URL is configured, use both default URL and key ...
                    effectiveModelSettings.apiUrl = defaultAgent.modelSettings.apiUrl;
                    effectiveModelSettings.apiKey = defaultAgent.modelSettings.apiKey;
                } else {
                    // ... otherwise, use both the agents URL and key to prevent sending a key to a wrong server
                    effectiveModelSettings.apiUrl = agent.modelSettings.apiUrl;
                    effectiveModelSettings.apiKey = agent.modelSettings.apiKey;
                }
            }
            if (agent.useCustomToolSettings) {
                effectiveToolSettings = { ...effectiveToolSettings, ...(agent.toolSettings || {}) };
                // Handle MCP Server URL fallback
                if (!effectiveToolSettings.mcpServer) {
                    effectiveToolSettings.mcpServer = defaultAgent.toolSettings?.mcpServer;
                }
            }
        }

        // Return the combined effective settings
        return {
            systemPrompt: effectiveSystemPrompt,
            ...effectiveModelSettings,
            ...effectiveToolSettings
        };
    }
}

export const agentManager = new AgentManager();
/** @type {import('../main.js').App | null} */
let appInstance = null;
/** @type {Map<string, {id: string}[]>} */
const modelCache = new Map();

async function fetchModels(agentId = null, targetSelectElement = null) {
    const effectiveConfig = agentManager.getEffectiveApiConfig(agentId);
    const { apiUrl, apiKey, model: currentModelValue } = effectiveConfig;

    if (!apiUrl) {
        console.warn("Cannot fetch models without an API URL.");
        return;
    }

    const populateSelect = (models) => {
        const modelSelect = targetSelectElement || document.querySelector(`#agent-${agentId}-modelSettings-model`);
        if (!modelSelect) return;

        modelSelect.innerHTML = '';
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.id;
            modelSelect.appendChild(option);
        });

        // Try to re-select the agent's current model
        if (currentModelValue && models.some(m => m.id === currentModelValue)) {
            modelSelect.value = currentModelValue;
        }
    };

    if (modelCache.has(apiUrl)) {
        populateSelect(modelCache.get(apiUrl));
        return;
    }

    try {
        const models = await appInstance.apiService.getModels(apiUrl, apiKey);
        modelCache.set(apiUrl, models);
        populateSelect(models);
    } catch (error) {
        alert(`Failed to fetch models: ${error.message}`);
    }
}

/**
 * Highlights the currently active agent in the list.
 * @private
 */
function updateActiveAgentInList() {
    const agentListEl = document.getElementById('agent-list');
    if (!agentListEl || !appInstance) return;

    const activeAgentId = appInstance.activeView.type === 'agent-editor' ? appInstance.activeView.id : null;

    agentListEl.querySelectorAll('li').forEach(item => {
        item.classList.toggle('active', item.dataset.id === activeAgentId);
    });
}

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
        li.className = 'list-item';
        li.dataset.id = agent.id;
        const deleteButtonHtml = agent.id === DEFAULT_AGENT_ID
            ? ''
            : '<button class="delete-button">X</button>';
        li.innerHTML = `
            <span>${agent.name}</span>
            ${deleteButtonHtml}
        `;
        agentListEl.appendChild(li);
    });
    updateActiveAgentInList();
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
    return `<div id="agent-editor-container" data-agent-id="${agent.id}"></div>`;
}

/**
 * This function is called when the agent editor view is rendered.
 * It builds the settings definition and uses createSettingsUI to render the form.
 * @private
 */
async function initializeAgentEditor() {
    const editorView = document.getElementById('agent-editor-container');
    if (!editorView || !editorView.dataset.agentId) return;

    const agentId = editorView.dataset.agentId;
    const agent = agentManager.getAgent(agentId);
    if (!agent) return;

    const isDefaultAgent = agent.id === DEFAULT_AGENT_ID;
    console.log(`DEBUG: Initializing editor for agentId: ${agentId}, isDefault: ${isDefaultAgent}`);

    // Define the settings structure locally, as global settings are deprecated.
    const modelSettingDefs = [
        { id: 'apiUrl', label: 'API URL', type: 'text', placeholder: 'e.g. https://api.someai.com/' },
        { id: 'apiKey', label: 'API Key', type: 'password' },
        {
            id: 'model', label: 'Model', type: 'select', options: [], actions: [{
                id: 'agent-refresh-models',
                label: 'Refresh',
                onClick: (e, modelInput) => fetchModels(agentId, modelInput)
            }]
        },
        { id: 'temperature', label: 'Temperature', type: 'range', default: 1, min: 0, max: 2, step: 0.1 },
    ];

    const effectiveConfig = agentManager.getEffectiveApiConfig(agent.id);
    const mcpServerUrl = effectiveConfig.mcpServer;
    console.log(`DEBUG: Effective MCP URL for ${agentId}: '${mcpServerUrl}'`);

    const tools = await appInstance?.mcp?.getTools(mcpServerUrl) || [];
    console.log(`DEBUG: Tools found for URL '${mcpServerUrl}':`, tools.length);

    /** @type {Setting[]} */
    let settingsDefinition = [];

    if (!isDefaultAgent) {
        settingsDefinition.push({ id: 'name', label: 'Name', type: 'text', required: true });
    }

    settingsDefinition.push(
        { id: 'systemPrompt', label: 'System Prompt', type: 'textarea', required: true },
        { type: 'divider' }
    );


    // --- Conditional Model Settings ---
    if (!isDefaultAgent) {
        settingsDefinition.push({ id: 'useCustomModelSettings', label: 'Use Custom Model Settings', type: 'checkbox' });
    }
    settingsDefinition.push({
        id: 'modelSettings',
        type: 'fieldset',
        label: 'Model Settings',
        children: modelSettingDefs,
        // Only add dependency if it's not the default agent
        ...(isDefaultAgent ? {} : { dependsOn: 'useCustomModelSettings', dependsOnValue: true })
    });
    settingsDefinition.push({ type: 'divider' });

    // --- Conditional Tool Settings ---
    if (!isDefaultAgent) {
        settingsDefinition.push({ id: 'useCustomToolSettings', label: 'Use Custom Tool Settings', type: 'checkbox' });
    }
    settingsDefinition.push({
        id: 'toolSettings',
        type: 'fieldset',
        label: 'Tool Settings',
        children: [
            { id: 'mcpServer', label: 'MCP Server URL', type: 'text', placeholder: 'e.g. http://localhost:3000/mcp' },
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
        // Only add dependency if it's not the default agent
            ...(isDefaultAgent ? {} : { dependsOn: 'useCustomToolSettings', dependsOnValue: true }),
            actions: [
                {
                    id: 'agent-refresh-tools',
                    label: 'Refresh Tools',
                    onClick: () => {
                        const effectiveConfig = agentManager.getEffectiveApiConfig(agent.id);
                        const mcpServerUrl = effectiveConfig.mcpServer;
                        if (mcpServerUrl) {
                            appInstance.mcp.getTools(mcpServerUrl);
                        } else {
                            alert('Please set an MCP Server URL for this agent or the Default Agent first.');
                        }
                    }
                }
            ]
    });


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

    const toolbar = document.createElement('div');
    toolbar.className = 'agent-toolbar';
    toolbar.innerHTML = `
        <h2 class="editor-title" style="flex-grow: 1;">Edit Agent</h2>
        <div class="title-bar-buttons">
            <button id="import-agents-btn" class="btn-gray">Import Agents</button>
            <button id="export-agents-btn" class="btn-gray">Export Agents</button>
        </div>
    `;
    editorView.innerHTML = '';
    editorView.appendChild(toolbar);
    editorView.appendChild(settingsFragment);

    toolbar.querySelector('#import-agents-btn').addEventListener('click', () => {
        importJson('.agent', (data) => {
            if (Array.isArray(data)) {
                data.forEach(agentData => agentManager.addAgentFromData(agentData));
                alert(`${data.length} agent(s) imported successfully.`);
            } else {
                agentManager.addAgentFromData(data);
                alert(`Agent imported successfully.`);
            }
        });
    });

    toolbar.querySelector('#export-agents-btn').addEventListener('click', () => {
        const agentsToExport = agentManager.agents.filter(a => a.id !== DEFAULT_AGENT_ID);
        if (agentsToExport.length > 0) {
            exportJson(agentsToExport, 'agents_config', 'agent');
        } else {
            alert('No custom agents to export.');
        }
    });

    // Fetch models for the current agent when the editor is opened.
    fetchModels(agentId);
}

export function getAgentSelectorHtml(activeAgentId) {
    const finalActiveAgentId = activeAgentId || DEFAULT_AGENT_ID;
    const optionsHtml = agentManager.agents.map(agent =>
        `<option value="${agent.id}" ${agent.id === finalActiveAgentId ? 'selected' : ''}>${agent.name}</option>`
    ).join('');

    return `
        <div id="agent-selector-container">
            <label for="agent-selector">Active Agent:</label>
            <select id="agent-selector">
                ${optionsHtml}
            </select>
        </div>
    `;
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

        // Pre-fetch models for the default agent on startup
        fetchModels(DEFAULT_AGENT_ID);

        // Add a listener to refresh the editor UI when tools are updated
        document.body.addEventListener('mcp-tools-updated', (e) => {
            if (appInstance.activeView.type === 'agent-editor') {
                const agent = agentManager.getAgent(appInstance.activeView.id);
                // Check if the updated URL matches the current agent's URL
                if (agent && agent.modelSettings.mcpServer === e.detail.url) {
                    console.log('Refreshing agent editor due to tool update...');
                    initializeAgentEditor();
                }
            }
        });
    },

    /**
     * @param {Tab[]} tabs - The array of existing tabs.
     * @returns {Tab[]} The updated array of tabs.
     */
    onTabsRegistered(tabs) {
        tabs.push({
            id: 'agents',
            label: 'Agents',
            viewType: 'agent-editor',
            onActivate: () => {
                const contentEl = document.getElementById('agents-pane');
                contentEl.innerHTML = `
                    <div class="list-pane">
                        <ul id="agent-list" class="item-list"></ul>
                        <button id="add-agent-btn" class="add-new-button">Add New Agent</button>
                    </div>
                `;
                renderAgentList();

                document.getElementById('add-agent-btn').addEventListener('click', () => {
                    const addedAgent = agentManager.addAgent({});
                    renderAgentList();
                    appInstance.setView('agent-editor', addedAgent.id);
                });

                document.getElementById('agent-list').addEventListener('click', (e) => {
                    const agentItem = e.target.closest('.list-item');
                    if (!agentItem) return;
                    const agentId = agentItem.dataset.id;

                    if (e.target.classList.contains('delete-button')) {
                        e.stopPropagation();
                        if (confirm(`Are you sure you want to delete the agent "${agentManager.getAgent(agentId)?.name}"?`)) {
                            agentManager.deleteAgent(agentId);
                            renderAgentList();
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
     * @param {View} view - The rendered view object.
     * @param {Chat} chat
     */
    onViewRendered(view, chat) {
        if (view.type === 'agent-editor') {
            initializeAgentEditor();
        }
        // Update the active state in the list whenever any view is rendered
        updateActiveAgentInList();
    }
};

pluginManager.register(agentsPlugin);
