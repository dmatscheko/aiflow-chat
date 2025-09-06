/**
 * @fileoverview Plugin for managing and using Agents with advanced settings.
 * @version 2.0.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce, createSettingsUI } from '../utils.js';

/**
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
 * Manages the lifecycle and storage of agents, including their persistence
 * in localStorage and their association with specific chats.
 * @class
 */
class AgentManager {
    constructor() {
        /**
         * The list of all available agents.
         * @type {Agent[]}
         */
        this.agents = this._loadAgents();
        /**
         * A map where keys are chat IDs and values are the ID of the active agent for that chat.
         * @type {Object.<string, string>}
         */
        this.chatAgentMap = this._loadChatAgentMap();
    }

    /**
     * Loads agents from localStorage.
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
     * Saves agents to localStorage.
     * @private
     */
    _saveAgents() {
        localStorage.setItem('core_agents_v2', JSON.stringify(this.agents));
    }

    /**
     * Loads the chat-to-agent mapping from localStorage.
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
     * Saves the chat-to-agent mapping to localStorage.
     * @private
     */
    _saveChatAgentMap() {
        localStorage.setItem('core_chat_agent_map_v2', JSON.stringify(this.chatAgentMap));
    }

    /**
     * Gets an agent by its ID.
     * @param {string} id - The ID of the agent.
     * @returns {Agent|undefined} The agent object or undefined if not found.
     */
    getAgent(id) {
        return this.agents.find(a => a.id === id);
    }

    /**
     * Adds a new agent to the list and saves it.
     * @param {Omit<Agent, 'id'>} agentData - The data for the new agent, without the 'id' property.
     * @returns {Agent} The newly created agent, including its generated ID.
     */
    addAgent(agentData) {
        const newAgent = { ...agentData, id: `agent-${Date.now()}` };
        this.agents.push(newAgent);
        this._saveAgents();
        return newAgent;
    }

    /**
     * Updates an existing agent.
     * @param {Agent} agentData - The updated agent data.
     */
    updateAgent(agentData) {
        const index = this.agents.findIndex(a => a.id === agentData.id);
        if (index !== -1) {
            this.agents[index] = agentData;
            this._saveAgents();
        }
    }

    /**
     * Deletes an agent by its ID.
     * @param {string} id - The ID of the agent to delete.
     */
    deleteAgent(id) {
        this.agents = this.agents.filter(a => a.id !== id);
        this._saveAgents();

        // Clean up chat-agent map
        for (const chatId in this.chatAgentMap) {
            if (this.chatAgentMap[chatId] === id) {
                delete this.chatAgentMap[chatId];
            }
        }
        this._saveChatAgentMap();
    }

    /**
     * Gets the active agent ID for a given chat.
     * @param {string} chatId - The ID of the chat.
     * @returns {string|null} The active agent ID or null.
     */
    getActiveAgentForChat(chatId) {
        return this.chatAgentMap[chatId] || null;
    }

    /**
     * Sets the active agent for a given chat.
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
/**
 * A reference to the main App instance.
 * @type {import('../main.js').App | null}
 */
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
 * This function is registered as a view renderer with the PluginManager.
 * @param {string} [agentId] - The ID of the agent to edit.
 * @returns {string} The HTML content for the agent editor.
 * @private
 */
function renderAgentEditor(agentId) {
    const agent = agentId ? agentManager.getAgent(agentId) : null;
    if (!agent) return `<h2>Agent not found</h2>`;

    // Ensure nested settings objects exist
    if (!agent.modelSettings) agent.modelSettings = {};
    if (!agent.toolSettings) agent.toolSettings = { allowAll: true, allowed: [] };

    const debouncedSave = debounce(() => {
        agentManager.updateAgent(agent);
        const agentListItem = document.querySelector(`.agent-list-item[data-id="${agent.id}"] span`);
        if (agentListItem) agentListItem.textContent = agent.name;
    }, 500);

    const createValueChangeHandler = (targetObj, key, isCheckbox = false) => (e) => {
        targetObj[key] = isCheckbox ? e.target.checked : e.target.value;
        debouncedSave();
    };

    const createModelValueChangeHandler = (key, isNumeric = false) => (e) => {
        agent.modelSettings[key] = isNumeric ? parseFloat(e.target.value) : e.target.value;
        debouncedSave();
    };

    const createToolValueChangeHandler = (toolName) => (e) => {
        const allowedSet = new Set(agent.toolSettings.allowed);
        if (e.target.checked) {
            allowedSet.add(toolName);
        } else {
            allowedSet.delete(toolName);
        }
        agent.toolSettings.allowed = Array.from(allowedSet);
        debouncedSave();
    };

    const editorContainer = document.createElement('div');
    editorContainer.id = 'agent-editor-view';
    editorContainer.innerHTML = `<h2>Edit Agent</h2>`;

    const form = document.createElement('form');
    form.id = 'agent-editor-form';
    form.addEventListener('submit', e => e.preventDefault());

    // --- Main Agent Settings ---
    const mainSettings = [
        { id: 'name', label: 'Name', type: 'text', default: agent.name, listener: { input: createValueChangeHandler(agent, 'name') } },
        { id: 'systemPrompt', label: 'System Prompt', type: 'textarea', rows: 8, default: agent.systemPrompt, listener: { input: createValueChangeHandler(agent, 'systemPrompt') } }
    ];

    // --- Model Override Settings ---
    const modelSettingDefs = (appInstance?.settings || [])
        .filter(s => ['apiUrl', 'apiKey', 'model', 'temperature'].includes(s.id))
        .map(s => ({
            ...s,
            id: s.id,
            default: agent.modelSettings[s.id] ?? s.default, // Use agent's value or the core default
            listener: { change: createModelValueChangeHandler(s.id, s.type === 'range') }
        }));

    const modelSettingsGroup = {
        id: 'modelSettings', type: 'group', label: 'Model Settings',
        children: [
            ...modelSettingDefs,
            {
                id: 'refresh-models', type: 'button', label: 'Refresh',
                listener: {
                    click: () => {
                        if (!appInstance?.fetchModels) return;
                        const modelInput = document.getElementById('agent-model');
                        appInstance.fetchModels(modelInput, {
                            apiUrl: agent.modelSettings.apiUrl,
                            apiKey: agent.modelSettings.apiKey
                        });
                    }
                }
            }
        ]
    };

    const useCustomModelSettings = {
        id: 'useCustomModelSettings', label: 'Use Custom Model Settings', type: 'checkbox', default: agent.useCustomModelSettings,
        listener: {
            change: (e) => {
                createValueChangeHandler(agent, 'useCustomModelSettings', true)(e);
                const fieldset = document.getElementById('agent-modelSettings');
                if (fieldset) fieldset.disabled = !e.target.checked;
            }
        }
    };

    // --- Tool Override Settings ---
    let toolSettingsGroup;
    if (appInstance?.mcp?.generateToolSettings) {
        toolSettingsGroup = appInstance.mcp.generateToolSettings(appInstance.mcp.getTools(), 'agent');

        const allowAllCheckbox = toolSettingsGroup.children.find(c => c.id === 'agent-allowAllTools');
        if (allowAllCheckbox) {
            allowAllCheckbox.default = agent.toolSettings.allowAll;
            const originalListener = allowAllCheckbox.listener.change;
            allowAllCheckbox.listener.change = (e, el) => {
                originalListener(e, el); // Keep show/hide logic
                agent.toolSettings.allowAll = e.target.checked;
                debouncedSave();
            };
        }

        const toolListGroup = toolSettingsGroup.children.find(c => c.id === 'agent-toolList');
        if (toolListGroup) {
            toolListGroup.children.forEach(toolCheckbox => {
                const toolName = toolCheckbox.id.replace('tool-', '');
                toolCheckbox.default = agent.toolSettings.allowed.includes(toolName);
                toolCheckbox.listener = { change: createToolValueChangeHandler(toolName) };
            });
        }
    } else {
         toolSettingsGroup = { id: 'tools-unavailable', type: 'group', label: 'Tool Settings', children: [{ type: 'static', label: 'MCP plugin not available or no tools found.'}]};
    }

    const useCustomToolSettings = {
        id: 'useCustomToolSettings', label: 'Use Custom Tool Settings', type: 'checkbox', default: agent.useCustomToolSettings,
        listener: {
            change: (e) => {
                createValueChangeHandler(agent, 'useCustomToolSettings', true)(e);
                const fieldset = document.getElementById('agent-toolSettings');
                if (fieldset) fieldset.style.display = e.target.checked ? 'block' : 'none';
            }
        }
    };

    // --- Assemble final settings object ---
    const allSettings = [
        ...mainSettings,
        useCustomModelSettings,
        modelSettingsGroup,
        useCustomToolSettings,
        toolSettingsGroup,
    ];

    const settingsFragment = createSettingsUI(allSettings, {}, 'agent-');
    form.appendChild(settingsFragment);
    editorContainer.appendChild(form);

    // Set initial states after render, since they depend on the DOM being built
    setTimeout(() => {
        const modelFieldset = document.getElementById('agent-modelSettings');
        if (modelFieldset) modelFieldset.disabled = !agent.useCustomModelSettings;

        const toolFieldset = document.getElementById('agent-toolSettings');
        if (toolFieldset) toolFieldset.style.display = agent.useCustomToolSettings ? 'block' : 'none';

        const allowAllCheckbox = document.getElementById('agent-agent-allowAllTools');
        if (allowAllCheckbox && allowAllCheckbox.checked) {
            const toolListEl = document.getElementById('agent-agent-toolList');
            if (toolListEl) toolListEl.style.display = 'none';
        }
    }, 0);

    return editorContainer.outerHTML;
}


/**
 * Populates the agent selector dropdown in the chat area with the available agents
 * and selects the one currently active for the chat.
 * @private
 */
function populateAgentSelector() {
    const selector = document.getElementById('agent-selector');
    if (!selector) return;

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
 * @type {import('../plugin-manager.js').Plugin}
 */
const agentsPlugin = {
    name: 'Agents',

    /**
     * Initializes the plugin, registers views, and exposes the agent manager.
     * @param {App} app - The main application instance.
     */
    onAppInit(app) {
        appInstance = app;
        pluginManager.registerView('agent-editor', renderAgentEditor);
        app.agentManager = agentManager; // Expose agent manager to other plugins
    },

    /**
     * Registers the "Agents" tab in the right-hand panel.
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
                    const newAgent = {
                        name: 'New Agent',
                        systemPrompt: 'You are a helpful assistant.',
                        useCustomModelSettings: false,
                        modelSettings: {},
                        useCustomToolSettings: false,
                        toolSettings: { allowAll: true, allowed: [] }
                    };
                    const addedAgent = agentManager.addAgent(newAgent);
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

    /**
     * Renders the agent selector dropdown in the chat area controls.
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
     * Updates the agent selector when the active chat is switched.
     * @param {Chat} chat - The newly active chat object.
     */
    onChatSwitched(chat) {
        populateAgentSelector();
        const agentSelector = /** @type {HTMLSelectElement} */ (document.getElementById('agent-selector'));
        if (agentSelector) {
            // Use a fresh listener to avoid duplicates
            const newSelector = agentSelector.cloneNode(true);
            agentSelector.parentNode.replaceChild(newSelector, agentSelector);
            newSelector.addEventListener('change', (e) => {
                const selectedAgentId = /** @type {HTMLSelectElement} */ (e.target).value;
                if (appInstance.activeChatId) {
                    agentManager.setActiveAgentForChat(appInstance.activeChatId, selectedAgentId || null);
                }
            });
        }
    },

    /**
     * Attaches listeners when the agent editor view is rendered.
     * @param {View} view - The rendered view object.
     */
    onViewRendered(view) {
        // No longer needed, all listeners are attached in createSettingsUI
    }
};

pluginManager.register(agentsPlugin);
