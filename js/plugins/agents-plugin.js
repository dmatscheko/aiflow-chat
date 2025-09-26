/**
 * @fileoverview Plugin for managing and using Agents with advanced settings.
 * @version 2.4.2
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce, importJson, exportJson, generateUniqueId, ensureUniqueId } from '../utils.js';
import { createSettingsUI, setPropertyByPath } from '../settings-manager.js';
import { createTitleBar } from './title-bar-plugin.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').Setting} Setting
 * @typedef {import('../main.js').View} View
 * @typedef {import('../main.js').Chat} Chat
 * @typedef {import('../main.js').Tab} Tab
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
 * @property {string} description
 * @property {string} systemPrompt
 * @property {boolean} useCustomModelSettings
 * @property {AgentModelSettings} modelSettings
 * @property {boolean} useCustomToolSettings
 * @property {object} toolSettings
 * @property {boolean} useCustomAgentCallSettings
 * @property {object} agentCallSettings
 */

const DEFAULT_AGENT_ID = 'agent-default';

let agentManager = null;

/**
 * Manages the lifecycle, storage, and UI of agents.
 * @class
 */
class AgentManager {
    /**
     * @param {App} app
     */
    constructor(app) {
        /** @type {App} */
        this.app = app;
        /** @type {Agent[]} */
        this.agents = [];
        /** @type {Map<string, {id: string}[]>} */
        this.modelCache = new Map();

        this.debouncedSave = debounce(() => this._saveAgents(), 500);
        this._loadAgents();
    }

    _loadAgents() {
        let userAgents = [];
        try {
            const agentsJson = localStorage.getItem('core_agents_v2');
            if (agentsJson) userAgents = JSON.parse(agentsJson);
        } catch (e) {
            console.error('Failed to load user agents:', e);
        }

        let defaultAgent = userAgents.find(a => a.id === DEFAULT_AGENT_ID);

        if (!defaultAgent) {
            const oldGlobalSettings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};
            const newDefaultAgent = {
                id: DEFAULT_AGENT_ID,
                name: 'Default Agent',
                description: 'The default agent for general tasks. It is used when no specific agent is selected for a chat.',
                systemPrompt: oldGlobalSettings.systemPrompt || 'You are a helpful assistant.',
                useCustomModelSettings: true,
                modelSettings: {
                    apiUrl: oldGlobalSettings.apiUrl || '',
                    apiKey: oldGlobalSettings.apiKey || '',
                    model: oldGlobalSettings.model || '',
                    temperature: oldGlobalSettings.temperature ?? 1,
                },
                useCustomToolSettings: true,
                toolSettings: { allowAll: true, allowed: [] },
                useCustomAgentCallSettings: false,
                agentCallSettings: { allowAll: true, allowed: [] }
            };
            if (Object.keys(oldGlobalSettings).length > 0) localStorage.removeItem('core_chat_settings');
            userAgents.unshift(newDefaultAgent);
            this._saveAgents(userAgents);
            defaultAgent = newDefaultAgent;
        }

        const finalAgents = [...userAgents];
        const defaultIdx = finalAgents.findIndex(a => a.id === DEFAULT_AGENT_ID);
        if (defaultIdx > 0) {
            finalAgents.unshift(finalAgents.splice(defaultIdx, 1)[0]);
        }
        this.agents = finalAgents;
    }

    /** @param {Agent[]} [agents=this.agents] */
    _saveAgents(agents = this.agents) {
        localStorage.setItem('core_agents_v2', JSON.stringify(agents));
    }

    /** @param {string} id */
    getAgent(id) {
        return this.agents.find(a => a.id === id);
    }

    /** @param {Omit<Agent, 'id'>} agentData */
    addAgent(agentData) {
        const existingIds = new Set(this.agents.map(a => a.id));
        const newAgent = {
            id: generateUniqueId('agent', existingIds),
            name: 'New Agent',
            description: 'A new, unconfigured agent.',
            systemPrompt: 'You are a helpful assistant.',
            useCustomModelSettings: false,
            modelSettings: {},
            useCustomToolSettings: false,
            toolSettings: { allowAll: true, allowed: [] },
            useCustomAgentCallSettings: false,
            agentCallSettings: { allowAll: true, allowed: [] },
            ...agentData
        };
        this.agents.push(newAgent);
        this._saveAgents();
        return newAgent;
    }

    /**
     * Adds an agent from imported data.
     * If the agent's ID conflicts with an existing ID, or if the ID is missing,
     * a new unique ID will be generated. Otherwise, the original ID is preserved.
     * @param {Agent} agentData The agent data to import.
     */
    addAgentFromData(agentData) {
        if (!agentData || typeof agentData !== 'object') {
            console.warn('Skipping invalid agent data during import:', agentData);
            return;
        }

        const existingIds = new Set(this.agents.map(a => a.id));
        const finalId = ensureUniqueId(agentData.id, 'agent', existingIds);

        const newAgent = { ...agentData, id: finalId };

        this.agents.push(newAgent);
        this._saveAgents();
        this.renderAgentList();
        return newAgent;
    }

    /** @param {Agent} agentData */
    updateAgent(agentData) {
        const index = this.agents.findIndex(a => a.id === agentData.id);
        if (index !== -1) {
            this.agents[index] = { ...this.agents[index], ...agentData };
            this.debouncedSave();
        }
    }

    /**
     * @param {string} agentId
     * @param {string} path
     * @param {any} value
     */
    updateAgentProperty(agentId, path, value) {
        const agent = this.getAgent(agentId);
        if (agent) {
            setPropertyByPath(agent, path, value);
            this.debouncedSave();
            if (path === 'name') {
                const agentListItem = document.querySelector(`.list-item[data-id="${agentId}"] span`);
                if (agentListItem) agentListItem.textContent = value;
            }
        }
    }

    /** @param {string} id */
    deleteAgent(id) {
        if (id === DEFAULT_AGENT_ID) return console.error("Cannot delete the Default Agent.");
        this.agents = this.agents.filter(a => a.id !== id);
        this._saveAgents();
        if (this.app.chatManager) {
            this.app.chatManager.chats.forEach(chat => {
                if (chat.agent === id) chat.agent = null;
            });
            this.app.chatManager.saveChats();
        }
    }

    /** @param {string|null} [agentId=null] */
    getEffectiveApiConfig(agentId = null) {
        const activeChat = this.app.chatManager ? this.app.chatManager.getActiveChat() : null;
        const finalAgentId = agentId || activeChat?.agent || DEFAULT_AGENT_ID;
        const agent = this.getAgent(finalAgentId);
        const defaultAgent = this.getAgent(DEFAULT_AGENT_ID);

        if (!defaultAgent) {
            console.error("Default Agent not found!");
            return {};
        }

        // Start with the complete default agent configuration.
        const effectiveConfig = {
            systemPrompt: defaultAgent.systemPrompt,
            ...(defaultAgent.modelSettings || {}),
            toolSettings: { ...(defaultAgent.toolSettings || {}) },
            agentCallSettings: { ...(defaultAgent.agentCallSettings || {}) },
        };

        // If a specific agent is active (and it's not the default), layer its settings on top.
        if (agent && agent.id !== DEFAULT_AGENT_ID) {
            effectiveConfig.systemPrompt = agent.systemPrompt;

            if (agent.useCustomModelSettings) {
                Object.assign(effectiveConfig, agent.modelSettings);
                // If the custom agent doesn't specify a URL, it inherits the default's URL and key.
                if (!agent.modelSettings?.apiUrl) {
                    effectiveConfig.apiUrl = defaultAgent.modelSettings.apiUrl;
                    effectiveConfig.apiKey = defaultAgent.modelSettings.apiKey;
                }
            }

            if (agent.useCustomToolSettings) {
                Object.assign(effectiveConfig.toolSettings, agent.toolSettings);
                 // If the custom agent doesn't specify an MCP server, it inherits the default's.
                if (!agent.toolSettings?.mcpServer) {
                    effectiveConfig.toolSettings.mcpServer = defaultAgent.toolSettings?.mcpServer;
                }
            }

            if (agent.useCustomAgentCallSettings) {
                Object.assign(effectiveConfig.agentCallSettings, agent.agentCallSettings);
            }
        }

        return effectiveConfig;
    }

    async fetchModels(agentId = null, targetSelectElement = null) {
        const effectiveConfig = this.getEffectiveApiConfig(agentId);
        const { apiUrl, apiKey, model: currentModelValue } = effectiveConfig;
        if (!apiUrl) return console.warn("Cannot fetch models without an API URL.");

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
            if (currentModelValue && models.some(m => m.id === currentModelValue)) {
                modelSelect.value = currentModelValue;
            }
        };

        if (this.modelCache.has(apiUrl)) return populateSelect(this.modelCache.get(apiUrl));

        try {
            const models = await this.app.apiService.getModels(apiUrl, apiKey);
            this.modelCache.set(apiUrl, models);
            populateSelect(models);
        } catch (error) {
            alert(`Failed to fetch models: ${error.message}`);
        }
    }

    updateActiveAgentInList() {
        const agentListEl = document.getElementById('agent-list');
        if (!agentListEl || !this.app) return;
        const activeAgentId = this.app.activeView.type === 'agent-editor' ? this.app.activeView.id : null;
        agentListEl.querySelectorAll('li').forEach(item => {
            item.classList.toggle('active', item.dataset.id === activeAgentId);
        });
    }

    renderAgentList() {
        const agentListEl = document.getElementById('agent-list');
        if (!agentListEl) return;
        agentListEl.innerHTML = '';
        this.agents.forEach(agent => {
            const li = document.createElement('li');
            li.className = 'list-item';
            li.dataset.id = agent.id;
            const deleteButtonHtml = agent.id === DEFAULT_AGENT_ID ? '' : '<button class="delete-button">X</button>';
            li.innerHTML = `<span>${agent.name}</span>${deleteButtonHtml}`;
            agentListEl.appendChild(li);
        });
        this.updateActiveAgentInList();
    }

    /** @param {string} [agentId] */
    renderAgentEditor(agentId) {
        const agent = agentId ? this.getAgent(agentId) : null;
        if (!agent) {
             // This case is now handled by onActivate, which should set view to default.
             // But as a fallback, we can show a message.
            return '<h2>Agent not found</h2><p>Select an agent from the list.</p>';
        }
        return `<div id="agent-editor-container" data-agent-id="${agent.id}"></div>`;
    }

    async initializeAgentEditor() {
        const mainPanel = document.getElementById('main-panel');
        const editorView = document.getElementById('agent-editor-container');
        if (!mainPanel || !editorView || !editorView.dataset.agentId) return;

        const agentId = editorView.dataset.agentId;
        const agent = this.getAgent(agentId);
        if (!agent) return;

        // Remove existing title bar before adding a new one to prevent duplication
        const existingTitleBar = document.querySelector('#main-panel .main-title-bar');
        if (existingTitleBar) {
            existingTitleBar.remove();
        }

        // --- Title Bar ---
        const buttons = [
            {
                id: 'import-agents-btn',
                label: 'Import Agents',
                className: 'btn-gray',
                onClick: () => {
                    importJson('.agents', (data) => {
                        if (Array.isArray(data)) {
                            data.forEach(agentData => this.addAgentFromData(agentData));
                            alert(`${data.length} agent(s) imported successfully.`);
                        } else {
                            this.addAgentFromData(data);
                            alert(`Agent imported successfully.`);
                        }
                    });
                }
            },
            {
                id: 'export-agents-btn',
                label: 'Export Agents',
                className: 'btn-gray',
                onClick: () => {
                    const agentsToExport = this.agents.filter(a => a.id !== DEFAULT_AGENT_ID);
                    if (agentsToExport.length > 0) exportJson(agentsToExport, 'agents_config', 'agents');
                    else alert('No custom agents to export.');
                }
            }
        ];
        const isDefaultAgent = agent.id === DEFAULT_AGENT_ID;
        const titleParts = [];
        if (isDefaultAgent) {
            titleParts.push(agent.name);
        } else {
            titleParts.push({
                text: agent.name,
                onSave: (newName) => {
                    this.updateAgentProperty(agent.id, 'name', newName);
                    this.app.setView('agent-editor', agent.id);
                }
            });
        }
        const titleBar = createTitleBar(titleParts, [], buttons);
        mainPanel.prepend(titleBar);
        // --- End Title Bar ---

        const modelSettingDefs = [
            { id: 'apiUrl', label: 'API URL', type: 'text', placeholder: 'e.g. https://api.someai.com/' },
            { id: 'apiKey', label: 'API Key', type: 'password' },
            {
                id: 'model', label: 'Model', type: 'select', options: [], actions: [{
                    id: 'agent-refresh-models', label: 'Refresh',
                    onClick: (e, modelInput) => this.fetchModels(agentId, modelInput)
                }]
            },
            { id: 'temperature', label: 'Temperature', type: 'range', default: 1, min: 0, max: 2, step: 0.1 },
        ];

        const effectiveConfig = this.getEffectiveApiConfig(agent.id);
        const mcpServerUrl = effectiveConfig.toolSettings.mcpServer;
        const tools = await this.app.mcp?.getTools(mcpServerUrl) || [];

        let settingsDefinition = [];

        settingsDefinition.push(
            { id: 'description', label: 'Description', type: 'textarea', rows: 2, placeholder: 'A brief description of the agent\'s purpose and capabilities.' },
            { id: 'systemPrompt', label: 'System Prompt', type: 'textarea', required: true },
            { type: 'divider' }
        );

        if (!isDefaultAgent) settingsDefinition.push({ id: 'useCustomModelSettings', label: 'Use Custom Model Settings', type: 'checkbox' });
        settingsDefinition.push({
            id: 'modelSettings', type: 'fieldset', label: 'Model Settings', children: modelSettingDefs,
            ...(isDefaultAgent ? {} : { dependsOn: 'useCustomModelSettings', dependsOnValue: true })
        });
        settingsDefinition.push({ type: 'divider' });

        if (!isDefaultAgent) settingsDefinition.push({ id: 'useCustomToolSettings', label: 'Use Custom Tool Settings', type: 'checkbox' });
        settingsDefinition.push({
            id: 'toolSettings', type: 'fieldset', label: 'Tool Settings',
            children: [
                {
                    id: 'mcpServer', label: 'MCP Server URL', type: 'text', placeholder: 'e.g. http://localhost:3000/mcp',
                    actions: [{
                        id: 'agent-refresh-tools', label: 'Refresh',
                        onClick: () => {
                            const effectiveConfig = this.getEffectiveApiConfig(agent.id);
                            if (effectiveConfig.toolSettings.mcpServer) {
                                this.app.mcp.getTools(effectiveConfig.toolSettings.mcpServer, true); // force=true
                            } else {
                                alert('Please set an MCP Server URL for this agent or the Default Agent first.');
                            }
                        }
                    }]
                },
                { id: 'allowAll', label: 'Allow all available tools', type: 'checkbox' },
                {
                    id: 'allowed', type: 'checkbox-list', label: '',
                    options: tools.map(t => ({ value: t.name, label: t.name })),
                    dependsOn: 'allowAll', dependsOnValue: false
                }
            ],
            ...(isDefaultAgent ? {} : { dependsOn: 'useCustomToolSettings', dependsOnValue: true })
        });

        settingsDefinition.push({ type: 'divider' });

        const agentCallSettingsChildren = [
            { id: 'allowAll', label: 'Allow all available agents', type: 'checkbox' },
            {
                id: 'allowed', type: 'checkbox-list', label: '',
                options: this.agents.filter(a => a.id !== agentId).map(a => ({ value: a.id, label: a.name })),
                dependsOn: 'allowAll', dependsOnValue: false
            }
        ];

        if (isDefaultAgent) {
            settingsDefinition.push({
                id: 'agentCallSettings', type: 'fieldset', label: 'Agent Call Settings',
                children: agentCallSettingsChildren
            });
        } else {
            settingsDefinition.push({ id: 'useCustomAgentCallSettings', label: 'Use Custom Agent Call Settings', type: 'checkbox' });
            settingsDefinition.push({
                id: 'agentCallSettings', type: 'fieldset', label: 'Agent Call Settings',
                children: agentCallSettingsChildren,
                dependsOn: 'useCustomAgentCallSettings', dependsOnValue: true
            });
        }

        const onSettingChanged = (path, value) => this.updateAgentProperty(agentId, path, value);
        const settingsFragment = createSettingsUI(settingsDefinition, agent, onSettingChanged, `agent-${agent.id}-`, 'agent-editor');

        editorView.innerHTML = ''; // Clear potential old content
        editorView.appendChild(settingsFragment);

        this.fetchModels(agentId);
    }

    /** @param {string | null} activeAgentId */
    getAgentSelectorHtml(activeAgentId) {
        const finalActiveAgentId = activeAgentId || DEFAULT_AGENT_ID;
        const optionsHtml = this.agents.map(agent =>
            `<option value="${agent.id}" ${agent.id === finalActiveAgentId ? 'selected' : ''}>${agent.name}</option>`
        ).join('');

        return `
            <div id="agent-selector-container">
                <label for="agent-selector">Active Agent:</label>
                <select id="agent-selector">${optionsHtml}</select>
            </div>
        `;
    }
}

const agentsPlugin = {
    name: 'Agents',

    /** @param {App} app */
    onAppInit(app) {
        agentManager = new AgentManager(app);
        app.agentManager = agentManager;

        pluginManager.registerView('agent-editor', (id) => agentManager.renderAgentEditor(id));
        agentManager.fetchModels(DEFAULT_AGENT_ID);

        document.body.addEventListener('mcp-tools-updated', (e) => {
            // Check if the currently active view is an agent editor
            if (app.activeView.type === 'agent-editor' && app.activeView.id) {
                const agent = agentManager.getAgent(app.activeView.id);
                if (agent) {
                    // Get the effective config for the agent being edited
                    const effectiveConfig = agentManager.getEffectiveApiConfig(agent.id);
                    // If the updated tools belong to the agent we are viewing, refresh the editor
                    if (effectiveConfig.toolSettings.mcpServer === e.detail.url) {
                        agentManager.initializeAgentEditor();
                    }
                }
            }
        });
    },

    /** @param {Tab[]} tabs */
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
                agentManager.renderAgentList();

                document.getElementById('add-agent-btn').addEventListener('click', () => {
                    const newAgent = agentManager.addAgent({});
                    agentManager.renderAgentList();
                    agentManager.app.setView('agent-editor', newAgent.id);
                });

                document.getElementById('agent-list').addEventListener('click', (e) => {
                    const agentItem = e.target.closest('.list-item');
                    if (!agentItem) return;
                    const agentId = agentItem.dataset.id;

                    if (e.target.classList.contains('delete-button')) {
                        e.stopPropagation();
                        if (confirm(`Are you sure you want to delete agent "${agentManager.getAgent(agentId)?.name}"?`)) {
                            agentManager.deleteAgent(agentId);
                            agentManager.renderAgentList();
                            if (agentManager.app.activeView.id === agentId) {
                                // If the deleted agent was active, show the default agent view
                                agentManager.app.setView('agent-editor', DEFAULT_AGENT_ID);
                            }
                        }
                    } else {
                        agentManager.app.setView('agent-editor', agentId);
                    }
                });

                // If no agent is active or the active one is invalid, show the default agent.
                const lastActiveId = agentManager.app.lastActiveIds['agent-editor'];
                const lastAgent = agentManager.getAgent(lastActiveId);
                if (!lastAgent) {
                    agentManager.app.setView('agent-editor', DEFAULT_AGENT_ID);
                }
            }
        });
        return tabs;
    },

    /**
     * @param {View} view
     * @param {Chat} chat
     */
    onViewRendered(view, chat) {
        if (view.type === 'agent-editor') {
            const existingTitleBar = document.querySelector('#main-panel .main-title-bar');
            if (existingTitleBar) {
                existingTitleBar.remove();
            }
            agentManager.initializeAgentEditor();
        }
        agentManager.updateActiveAgentInList();
    }
};

pluginManager.register(agentsPlugin);
