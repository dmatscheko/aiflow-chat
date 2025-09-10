/**
 * @fileoverview Plugin for managing and using Agents with advanced settings.
 * @version 2.3.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce, importJson, exportJson } from '../utils.js';
import { createSettingsUI, setPropertyByPath } from '../settings-manager.js';

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
 * @property {string} systemPrompt
 * @property {boolean} useCustomModelSettings
 * @property {AgentModelSettings} modelSettings
 * @property {boolean} useCustomToolSettings
 * @property {object} toolSettings
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
                systemPrompt: oldGlobalSettings.systemPrompt || 'You are a helpful assistant.',
                useCustomModelSettings: true,
                modelSettings: {
                    apiUrl: oldGlobalSettings.apiUrl || '',
                    apiKey: oldGlobalSettings.apiKey || '',
                    model: oldGlobalSettings.model || '',
                    temperature: oldGlobalSettings.temperature ?? 1,
                },
                useCustomToolSettings: true,
                toolSettings: { allowAll: true, allowed: [] }
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

    /** @param {Agent} agentData */
    addAgentFromData(agentData) {
        const newAgent = { id: `agent-${Date.now()}`, ...agentData };
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

        let effectiveModelSettings = { ...(defaultAgent.modelSettings || {}) };
        let effectiveToolSettings = { ...(defaultAgent.toolSettings || {}) };
        let effectiveSystemPrompt = defaultAgent.systemPrompt;

        if (agent && agent.id !== DEFAULT_AGENT_ID) {
            effectiveSystemPrompt = agent.systemPrompt;
            if (agent.useCustomModelSettings) {
                effectiveModelSettings = { ...effectiveModelSettings, ...(agent.modelSettings || {}) };
                if (!agent.modelSettings?.apiUrl) {
                    effectiveModelSettings.apiUrl = defaultAgent.modelSettings.apiUrl;
                    effectiveModelSettings.apiKey = defaultAgent.modelSettings.apiKey;
                } else {
                    effectiveModelSettings.apiUrl = agent.modelSettings.apiUrl;
                    effectiveModelSettings.apiKey = agent.modelSettings.apiKey;
                }
            }
            if (agent.useCustomToolSettings) {
                effectiveToolSettings = { ...effectiveToolSettings, ...(agent.toolSettings || {}) };
                if (!effectiveToolSettings.mcpServer) {
                    effectiveToolSettings.mcpServer = defaultAgent.toolSettings?.mcpServer;
                }
            }
        }

        return { systemPrompt: effectiveSystemPrompt, ...effectiveModelSettings, ...effectiveToolSettings };
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
        if (!agent) return '<h2>Agent not found.</h2>';
        return `<div id="agent-editor-container" data-agent-id="${agent.id}"></div>`;
    }

    async initializeAgentEditor() {
        const editorView = document.getElementById('agent-editor-container');
        if (!editorView || !editorView.dataset.agentId) return;

        const agentId = editorView.dataset.agentId;
        const agent = this.getAgent(agentId);
        if (!agent) return;

        const isDefaultAgent = agent.id === DEFAULT_AGENT_ID;

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
        const mcpServerUrl = effectiveConfig.mcpServer;
        const tools = await this.app.mcp?.getTools(mcpServerUrl) || [];

        let settingsDefinition = [];
        if (!isDefaultAgent) settingsDefinition.push({ id: 'name', label: 'Name', type: 'text', required: true });

        settingsDefinition.push(
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
                { id: 'mcpServer', label: 'MCP Server URL', type: 'text', placeholder: 'e.g. http://localhost:3000/mcp' },
                { id: 'allowAll', label: 'Allow all available tools', type: 'checkbox' },
                {
                    id: 'allowed', type: 'checkbox-list', label: '',
                    options: tools.map(t => ({ value: t.name, label: t.name })),
                    dependsOn: 'allowAll', dependsOnValue: false
                }
            ],
            ...(isDefaultAgent ? {} : { dependsOn: 'useCustomToolSettings', dependsOnValue: true }),
            actions: [{
                id: 'agent-refresh-tools', label: 'Refresh Tools',
                onClick: () => {
                    const effectiveConfig = this.getEffectiveApiConfig(agent.id);
                    if (effectiveConfig.mcpServer) this.app.mcp.getTools(effectiveConfig.mcpServer);
                    else alert('Please set an MCP Server URL for this agent or the Default Agent first.');
                }
            }]
        });

        const onSettingChanged = (path, value) => this.updateAgentProperty(agentId, path, value);
        const settingsFragment = createSettingsUI(settingsDefinition, agent, onSettingChanged, `agent-${agent.id}-`, 'agent-editor');

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
                    data.forEach(agentData => this.addAgentFromData(agentData));
                    alert(`${data.length} agent(s) imported successfully.`);
                } else {
                    this.addAgentFromData(data);
                    alert(`Agent imported successfully.`);
                }
            });
        });

        toolbar.querySelector('#export-agents-btn').addEventListener('click', () => {
            const agentsToExport = this.agents.filter(a => a.id !== DEFAULT_AGENT_ID);
            if (agentsToExport.length > 0) exportJson(agentsToExport, 'agents_config', 'agent');
            else alert('No custom agents to export.');
        });

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
            if (app.activeView.type === 'agent-editor') {
                const agent = agentManager.getAgent(app.activeView.id);
                if (agent && agent.modelSettings.mcpServer === e.detail.url) {
                    agentManager.initializeAgentEditor();
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
                                agentManager.app.showTab('agents');
                            }
                        }
                    } else {
                        agentManager.app.setView('agent-editor', agentId);
                    }
                });
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
            agentManager.initializeAgentEditor();
        }
        agentManager.updateActiveAgentInList();
    }
};

pluginManager.register(agentsPlugin);
