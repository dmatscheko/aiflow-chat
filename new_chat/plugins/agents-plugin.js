/**
 * @fileoverview Plugin for managing and using Agents with advanced settings.
 * @version 2.0.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce, createSettingsUI } from '../utils.js';

/**
 * @typedef {import('../tool-processor.js').ToolSettings} AgentToolSettings
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
 * @param {string} [agentId] - The ID of the agent to edit. If not provided, renders a creation form.
 * @returns {string} The HTML content for the agent editor.
 * @private
 */
/**
 * Renders the agent editor view.
 * This function is registered as a view renderer with the PluginManager.
 * @param {string} [agentId] - The ID of the agent to edit.
 * @returns {string} The HTML content for the agent editor.
 * @private
 */
function renderAgentEditor(agentId) {
    const agent = agentId ? agentManager.getAgent(agentId) : null;
    if (!agent) {
        return '<h2>Agent not found</h2>';
    }

    const editorContainer = document.createElement('div');
    editorContainer.id = 'agent-editor-view';

    const form = document.createElement('form');
    form.id = 'agent-editor-form';
    form.setAttribute('data-agent-id', agent.id);
    form.noValidate = true;

    const heading = document.createElement('h2');
    heading.textContent = `Edit Agent: ${agent.name || 'New Agent'}`;
    form.appendChild(heading);

    // --- Define Settings Structure with default values from agent ---
    const modelSettingDefs = (appInstance?.settings || [])
        .filter(s => s.id !== 'systemPrompt')
        .map(s => ({
            ...s,
            id: `model.${s.id}`,
            default: agent.modelSettings?.[s.id] ?? s.default
        }));

    const toolDefs = (appInstance?.mcp?.getTools() || []).map(tool => ({
        id: `tool.${tool.name}`,
        label: tool.name,
        type: 'checkbox',
        className: 'tool-checkbox',
        default: agent.toolSettings?.allowed?.includes(tool.name) || false
    }));

    const settingsDefs = [
        { id: 'name', label: 'Name', type: 'text', default: agent.name },
        { id: 'systemPrompt', label: 'System Prompt', type: 'textarea', default: agent.systemPrompt },
        {
            id: 'useCustomModelSettings',
            label: 'Use Custom Model Settings',
            type: 'checkbox',
            default: agent.useCustomModelSettings,
            listeners: {
                change: (e) => {
                    const fieldset = document.getElementById('agent-modelSettings-fieldset');
                    if (fieldset) fieldset.style.display = e.target.checked ? 'block' : 'none';
                }
            }
        },
        { id: 'modelSettings', type: 'fieldset', children: modelSettingDefs },
        {
            id: 'useCustomToolSettings',
            label: 'Use Custom Tool Settings',
            type: 'checkbox',
            default: agent.useCustomToolSettings,
            listeners: {
                change: (e) => {
                    const fieldset = document.getElementById('agent-tool-settings-fieldset');
                    if (fieldset) fieldset.style.display = e.target.checked ? 'block' : 'none';
                }
            }
        },
        {
            id: 'toolSettings',
            type: 'fieldset',
            children: [
                {
                    id: 'toolSettings.allowAll',
                    label: 'Allow all tools',
                    type: 'checkbox',
                    default: agent.toolSettings?.allowAll || false,
                    listeners: {
                        change: (e, el) => {
                            const fieldset = el.closest('fieldset');
                            if (!fieldset) return;
                            fieldset.querySelectorAll('.tool-checkbox input').forEach(cb => {
                                cb.disabled = e.target.checked;
                            });
                        }
                    }
                },
                ...toolDefs
            ]
        }
    ];

    // --- Create and Append UI ---
    // Pass an empty currentValues object; let createSettingsUI use the defaults we just defined.
    const emptyCurrentValues = {};
    settingsDefs.forEach(setting => {
        if (setting.type === 'fieldset') {
            const fieldset = document.createElement('fieldset');
            fieldset.id = `agent-${setting.id}-fieldset`;
            const legend = document.createElement('legend');
            legend.textContent = setting.id === 'modelSettings' ? 'Model Settings' : 'Tool Settings';
            fieldset.appendChild(legend);
            const settingsFragment = createSettingsUI(setting.children, emptyCurrentValues, 'agent-', 'agent_settings');
            fieldset.appendChild(settingsFragment);
            form.appendChild(fieldset);
        } else {
            const settingsFragment = createSettingsUI([setting], emptyCurrentValues, 'agent-', 'agent_settings');
            form.appendChild(settingsFragment);
        }
    });

    // --- Set Initial UI State ---
    const modelFieldset = form.querySelector('#agent-modelSettings-fieldset');
    if (modelFieldset) modelFieldset.style.display = agent.useCustomModelSettings ? 'block' : 'none';

    const toolFieldset = form.querySelector('#agent-toolSettings-fieldset');
    if (toolFieldset) {
        toolFieldset.style.display = agent.useCustomToolSettings ? 'block' : 'none';
        const allowAllCheckbox = toolFieldset.querySelector('#agent-toolSettings\\.allowAll');
        if (allowAllCheckbox?.checked) {
            toolFieldset.querySelectorAll('.tool-checkbox input').forEach(cb => {
                cb.disabled = true;
            });
        }
    }

    editorContainer.appendChild(form);
    return editorContainer.outerHTML;
}


/**
 * Saves all data from the agent editor form.
 * @param {HTMLFormElement} form - The agent editor form element.
 * @private
 */
function saveAgentFromForm(form) {
    const agentId = form.dataset.agentId;
    const agent = agentManager.getAgent(agentId);
    if (!agent) return;

    const newAgentData = {
        id: agent.id,
        name: form.querySelector('#agent-name')?.value || agent.name,
        systemPrompt: form.querySelector('#agent-systemPrompt')?.value || agent.systemPrompt,
        useCustomModelSettings: form.querySelector('#agent-useCustomModelSettings')?.checked || false,
        useCustomToolSettings: form.querySelector('#agent-useCustomToolSettings')?.checked || false,
        modelSettings: {},
        toolSettings: {
            allowAll: form.querySelector('#agent-toolSettings\\.allowAll')?.checked || false,
            allowed: []
        }
    };

    // Gather model settings
    if (newAgentData.useCustomModelSettings) {
        const modelSettingDefs = (appInstance?.settings || []).filter(s => s.id !== 'systemPrompt');
        modelSettingDefs.forEach(setting => {
            const input = form.querySelector(`#agent-model\\.${setting.id}`);
            if (input) {
                let value;
                if (input.type === 'checkbox') value = input.checked;
                else if (input.type === 'range' || input.type === 'number') value = parseFloat(input.value);
                else value = input.value;
                newAgentData.modelSettings[setting.id] = value;
            }
        });
    }

    // Gather tool settings
    if (newAgentData.useCustomToolSettings && !newAgentData.toolSettings.allowAll) {
        const toolDefs = appInstance?.mcp?.getTools() || [];
        toolDefs.forEach(tool => {
            const input = form.querySelector(`#agent-tool\\.${tool.name}`);
            if (input?.checked) {
                newAgentData.toolSettings.allowed.push(tool.name);
            }
        });
    }

    agentManager.updateAgent(newAgentData);

    // Update the name in the agent list
    const agentListItem = document.querySelector(`.agent-list-item[data-id="${agentId}"] span`);
    if (agentListItem && agentListItem.textContent !== newAgentData.name) {
        agentListItem.textContent = newAgentData.name;
    }
}


/**
 * Attaches event listeners to the agent editor form for auto-saving changes.
 * This function is called when the agent editor view is rendered.
 * @private
 */
function attachAgentFormListeners() {
    const form = document.getElementById('agent-editor-form');
    if (!form) return;

    const debouncedSave = debounce(() => saveAgentFromForm(form), 500);
    form.addEventListener('input', debouncedSave);
    form.addEventListener('change', debouncedSave);
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
        if (view.type === 'agent-editor') {
            attachAgentFormListeners();
        }
    }
};

pluginManager.register(agentsPlugin);
