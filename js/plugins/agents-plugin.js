/**
 * @fileoverview Plugin for creating, managing, and using "Agents".
 * Agents are configurable entities that encapsulate a system prompt, model settings,
 * tool access, and other behaviors, allowing users to switch between different
 * AI personalities or configurations for their chats.
 * @version 2.4.2
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce, importJson, exportJson } from '../utils.js';
import { createSettingsUI, setPropertyByPath } from '../settings-manager.js';
import { createTitleBar } from './title-bar-plugin.js';
import { DataManager } from '../data-manager.js';
import { createListPane } from '../ui/list-pane.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').Setting} Setting
 * @typedef {import('../main.js').View} View
 * @typedef {import('./chats-plugin.js').Chat} Chat
 * @typedef {import('../main.js').Tab} Tab
 */

/**
 * Defines the structure for an agent's custom model settings.
 * @typedef {object} AgentModelSettings
 * @property {string} [apiKey] - The API key for the model.
 * @property {string} [apiUrl] - The base URL for the API.
 * @property {string} [model] - The specific model identifier.
 * @property {number} [temperature] - The sampling temperature.
 * @property {number} [top_p] - The top-p value for nucleus sampling.
 */

/**
 * Defines the structure for an Agent object.
 * @typedef {object} Agent
 * @property {string} id - The unique identifier for the agent.
 * @property {string} name - The display name of the agent.
 * @property {string} description - A brief description of the agent's purpose.
 * @property {string} systemPrompt - The system prompt that defines the agent's behavior.
 * @property {boolean} useCustomModelSettings - Whether to override the default model settings.
 * @property {AgentModelSettings} modelSettings - The agent's custom model settings.
 * @property {boolean} useCustomToolSettings - Whether to override the default tool settings.
 * @property {object} toolSettings - The agent's custom tool settings.
 * @property {boolean} useCustomAgentCallSettings - Whether to override the default agent call settings.
 * @property {object} agentCallSettings - The agent's custom settings for calling other agents.
 */

/**
 * The unique identifier for the mandatory Default Agent.
 * @const {string}
 */
const DEFAULT_AGENT_ID = 'agent-default';

/**
 * The singleton instance of the AgentManager, initialized by the plugin.
 * @type {AgentManager | null}
 */
let agentManager = null;

/**
 * Manages the lifecycle, storage, UI, and configuration of all agents in the application.
 * @class
 */
class AgentManager {
    constructor(app) {
        this.app = app;
        this.dataManager = new DataManager('core_agents_v2', 'agent');
        this.agents = this.dataManager.getAll();
        this.modelCache = new Map();
        this.debouncedSave = debounce(() => this.dataManager.save(), 500);
        this._ensureDefaultAgent();
    }

    _ensureDefaultAgent() {
        let defaultAgent = this.dataManager.get(DEFAULT_AGENT_ID);

        if (!defaultAgent) {
            const newDefaultAgent = {
                id: DEFAULT_AGENT_ID,
                name: 'Default Agent',
                description: 'The default agent for general tasks. It is used when no specific agent is selected for a chat.',
                systemPrompt: 'You are a helpful assistant.',
                useCustomModelSettings: true,
                modelSettings: {
                    apiUrl: 'http://127.0.0.1:1234',
                    apiKey: 'none',
                    model: '',
                    temperature: 1,
                },
                useCustomToolSettings: true,
                toolSettings: { allowAll: true, allowed: [] },
                useCustomAgentCallSettings: false,
                agentCallSettings: { allowAll: true, allowed: [] }
            };
            // Add the default agent at the beginning of the list.
            this.agents.unshift(newDefaultAgent);
            this.dataManager.save();
        } else {
            // Ensure the default agent is always first.
            const defaultIdx = this.agents.findIndex(a => a.id === DEFAULT_AGENT_ID);
            if (defaultIdx > 0) {
                this.agents.unshift(this.agents.splice(defaultIdx, 1)[0]);
                this.dataManager.save();
            }
        }
    }

    getAgent(id) {
        return this.dataManager.get(id);
    }

    addAgent(agentData) {
        const newAgentDefaults = {
            name: 'New Agent',
            description: 'A new, unconfigured agent.',
            systemPrompt: 'You are a helpful assistant.',
            useCustomModelSettings: false,
            modelSettings: {},
            useCustomToolSettings: false,
            toolSettings: { allowAll: true, allowed: [] },
            useCustomAgentCallSettings: false,
            agentCallSettings: { allowAll: true, allowed: [] },
        };
        return this.dataManager.add({ ...newAgentDefaults, ...agentData });
    }

    addAgentFromData(agentData) {
        return this.dataManager.addFromData(agentData);
    }

    updateAgent(agentData) {
        this.dataManager.update(agentData);
    }

    updateAgentProperty(agentId, path, value) {
        const agent = this.getAgent(agentId);
        if (agent) {
            setPropertyByPath(agent, path, value);
            this.debouncedSave();
            if (path === 'name') {
                // The list pane will re-render on its own if needed,
                // but for instant feedback, we can update the DOM directly.
                const agentListItem = document.querySelector(`.list-item[data-id="${agentId}"] span`);
                if (agentListItem) agentListItem.textContent = value;
            }
        }
    }

    deleteAgent(id) {
        if (id === DEFAULT_AGENT_ID) {
            console.error("Cannot delete the Default Agent.");
            return;
        }
        this.dataManager.delete(id);
        if (this.app.chatManager) {
            this.app.chatManager.chats.forEach(chat => {
                if (chat.agent === id) {
                    chat.agent = null; // Reverts to default
                }
            });
            this.app.chatManager.dataManager.save();
        }
    }

    /**
     * Calculates the effective API configuration for a given agent by layering its
     * custom settings over the Default Agent's settings.
     * @param {string|null} [agentId=null] - The ID of the agent. If null, it uses the active chat's agent.
     * @returns {object} The final, combined configuration object to be used for an API call.
     */
    getEffectiveApiConfig(agentId = null) {
        const activeChat = this.app.chatManager ? this.app.chatManager.getActiveChat() : null;
        const finalAgentId = agentId || activeChat?.agent || DEFAULT_AGENT_ID;
        const agent = this.getAgent(finalAgentId);
        const defaultAgent = this.getAgent(DEFAULT_AGENT_ID);

        if (!defaultAgent) {
            console.error("Default Agent not found!");
            return {};
        }

        // Start with a deep copy of the complete default agent configuration.
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

    /**
     * Constructs the full system prompt for a given agent by starting with its base
     * prompt and then allowing other plugins (like tools and agent-calling plugins)
     * to append their own instructional text via the `onSystemPromptConstruct` hook.
     * @param {string | null} [agentId=null] - The ID of the agent. If null, uses the active chat's agent.
     * @returns {Promise<string>} A promise that resolves to the fully constructed system prompt.
     */
    async constructSystemPrompt(agentId = null) {
        const activeChat = this.app.chatManager ? this.app.chatManager.getActiveChat() : null;
        const finalAgentId = agentId || activeChat?.agent || DEFAULT_AGENT_ID;

        const agent = this.getAgent(finalAgentId);
        const effectiveConfig = this.getEffectiveApiConfig(finalAgentId);

        // Trigger the hook to allow plugins to contribute to the system prompt.
        const finalSystemPrompt = await pluginManager.triggerAsync(
            'onSystemPromptConstruct',
            effectiveConfig.systemPrompt, // Initial value
            effectiveConfig,              // All settings for context
            agent                         // The specific agent instance
        );

        return finalSystemPrompt;
    }

    /**
     * Fetches the list of available models for a given agent's API configuration.
     * It uses a cache to avoid re-fetching for the same API URL.
     * @param {string|null} [agentId=null] - The agent whose API config should be used.
     * @param {HTMLSelectElement|null} [targetSelectElement=null] - The dropdown element to populate with the models.
     * @async
     */
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


    /**
     * Renders the placeholder container for the agent editor view.
     * The actual form content is rendered by `initializeAgentEditor`.
     * @param {string} [agentId] - The ID of the agent to render the editor for.
     * @returns {string} The HTML string for the editor's container.
     */
    renderAgentEditor(agentId) {
        const agent = agentId ? this.getAgent(agentId) : null;
        if (!agent) {
             // This case is now handled by the onActivate hook, which should set the view to the default agent.
             // But as a fallback, we can show a message.
            return '<h2>Agent not found</h2><p>Select an agent from the list.</p>';
        }
        return `<div id="agent-editor-container" data-agent-id="${agent.id}"></div>`;
    }

    /**
     * Initializes the agent editor UI within its container.
     * This method dynamically builds the entire settings form for the specified agent
     * using `createSettingsUI`, and fetches any necessary data like available models.
     * @async
     */
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
                        const agents = Array.isArray(data) ? data : [data];
                        agents.forEach(agentData => this.addAgentFromData(agentData));
                        this.listPane.renderList();
                        alert(`${agents.length} agent(s) imported successfully.`);
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

    /**
     * Generates the HTML for the agent selector dropdown.
     * @param {string | null} activeAgentId - The ID of the agent to be pre-selected.
     * @returns {string} The HTML string for the agent selector component.
     */
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

/**
 * The plugin object that encapsulates all hooks and metadata for the Agents plugin.
 * @type {object}
 */
const agentsPlugin = {
    name: 'Agents',

    /**
     * The `onAppInit` hook, called when the application starts.
     * It initializes the `AgentManager` and registers the agent editor view.
     * @param {App} app - The main application instance.
     */
    onAppInit(app) {
        agentManager = new AgentManager(app);
        app.agentManager = agentManager;

        pluginManager.registerView('agent-editor', (id) => agentManager.renderAgentEditor(id));
        agentManager.fetchModels(DEFAULT_AGENT_ID);

        // Listen for an event that indicates tools have been updated (e.g., from an MCP server).
        document.body.addEventListener('mcp-tools-updated', (e) => {
            // Check if the currently active view is an agent editor.
            if (app.activeView.type === 'agent-editor' && app.activeView.id) {
                const agent = agentManager.getAgent(app.activeView.id);
                if (agent) {
                    // Get the effective config for the agent being edited.
                    const effectiveConfig = agentManager.getEffectiveApiConfig(agent.id);
                    // If the updated tools belong to the agent we are viewing, refresh the editor.
                    if (effectiveConfig.toolSettings.mcpServer === e.detail.url) {
                        agentManager.initializeAgentEditor();
                    }
                }
            }
        });
    },

    onTabsRegistered(tabs) {
        tabs.push({
            id: 'agents',
            label: 'Agents',
            viewType: 'agent-editor',
            onActivate: () => {
                const pane = createListPane({
                    container: document.getElementById('agents-pane'),
                    dataManager: agentManager.dataManager,
                    app: agentManager.app,
                    viewType: 'agent-editor',
                    addNewButtonLabel: 'Add New Agent',
                    onAddNew: () => agentManager.addAgent({}),
                    getItemName: (item) => item.name,
                    onDelete: (itemId, itemName) => {
                        if (itemId === DEFAULT_AGENT_ID) return false;
                        return confirm(`Are you sure you want to delete agent "${itemName}"?`);
                    }
                });
                agentManager.listPane = pane;

                const lastActiveId = agentManager.app.lastActiveIds['agent-editor'];
                const lastAgent = agentManager.getAgent(lastActiveId);
                if (!lastAgent) {
                    agentManager.app.setView('agent-editor', DEFAULT_AGENT_ID);
                }
            }
        });
        return tabs;
    },

    onViewRendered(view, chat) {
        if (view.type === 'agent-editor') {
            const existingTitleBar = document.querySelector('#main-panel .main-title-bar');
            if (existingTitleBar) {
                existingTitleBar.remove();
            }
            agentManager.initializeAgentEditor();
            if (agentManager.listPane) {
                agentManager.listPane.updateActiveItem();
            }
        }
    },

    /**
     * The `onChatSwitched` hook, which synchronizes the agent selector dropdown with the active chat's agent.
     * @param {Chat} chat - The chat that was just switched to.
     */
    onChatSwitched(chat) {
        const agentSelector = document.getElementById('agent-selector');
        if (agentSelector) {
            agentSelector.addEventListener('change', (e) => {
                // When the agent selection changes, update the active chat's agent property.
                const activeChat = agentManager.app.chatManager.getActiveChat();
                if (activeChat) {
                    activeChat.agent = e.target.value;
                    agentManager.app.chatManager.saveChats(); // Persist the change immediately.
                }
            });

            // If a new chat is created, it won't have an agent assigned.
            // Assign it the one currently selected in the UI.
            if (!chat.agent) {
                chat.agent = agentSelector.value;
                agentManager.app.chatManager.saveChats();
            }
        }
    }
};

/**
 * Registers the Agents Plugin with the application's plugin manager.
 */
pluginManager.register(agentsPlugin);
