/**
 * @fileoverview Plugin for managing and using Agents with advanced settings.
 * @version 2.0.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce, createSettingsUI, createToolSettingsUI } from '../utils.js';

/**
 * @typedef {object} AgentModelSettings
 * @property {string} [apiKey] - Custom API key for the agent.
 * @property {string} [apiUrl] - Custom API URL for the agent.
 * @property {string} [model] - The specific model to use for the agent.
 * @property {number} [temperature] - The temperature setting for the model.
 * @property {number} [top_p] - The top_p setting for the model.
 */

/**
 * @typedef {object} AgentToolSettings
 * @property {boolean} allowAll - Whether to allow all tools.
 * @property {string[]} allowed - A list of allowed tool names.
 */

/**
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
 */
class AgentManager {
    constructor() {
        /** @type {Agent[]} */
        this.agents = this._loadAgents();
        /** @type {Object.<string, string>} */
        this.chatAgentMap = this._loadChatAgentMap(); // Maps chatId to agentId
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
     * Adds a new agent.
     * @param {Omit<Agent, 'id'>} agentData - The data for the new agent.
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
let appInstance = null;

/**
 * Renders the list of agents in the "Agents" tab.
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
 * Renders the agent editor view.
 * @param {string} [agentId] - The ID of the agent to edit. If null, creates a new agent.
 * @returns {string} The HTML content for the agent editor.
 */
function renderAgentEditor(agentId) {
    const agent = agentId ? agentManager.getAgent(agentId) : null;
    const modelSettings = agent?.modelSettings || {};
    const toolSettings = agent?.toolSettings || { allowAll: false, allowed: [] };

    const editorContainer = document.createElement('div');
    editorContainer.id = 'agent-editor-view';
    editorContainer.innerHTML = `
        <h2>${agentId ? 'Edit' : 'Create'} Agent</h2>
        <form id="agent-editor-form" novalidate>
            <input type="hidden" id="agent-id" value="${agent?.id || ''}">

            <div class="form-group">
                <label for="agent-name">Name</label>
                <input type="text" id="agent-name" required value="${agent?.name || ''}">
            </div>

            <div class="form-group">
                <label for="agent-system-prompt">System Prompt</label>
                <textarea id="agent-system-prompt" rows="8">${agent?.systemPrompt || ''}</textarea>
            </div>

            <hr>

            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="agent-use-custom-settings" ${agent?.useCustomModelSettings ? 'checked' : ''}>
                    Use Custom Model Settings
                </label>
            </div>

            <fieldset id="agent-model-settings" ${agent?.useCustomModelSettings ? '' : 'disabled'}>
                <legend>Model Settings</legend>
            </fieldset>

            <hr>

            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="agent-use-custom-tool-settings" ${agent?.useCustomToolSettings ? 'checked' : ''}>
                    Use Custom Tool Settings
                </label>
            </div>

            <div id="agent-tool-settings-container" ${agent?.useCustomToolSettings ? '' : 'style="display: none;"'}>
                <!-- Tool settings will be rendered here -->
            </div>
        </form>
    `;

    const form = editorContainer.querySelector('form');

    // Dynamically create model settings UI
    const modelSettingsContainer = editorContainer.querySelector('#agent-model-settings');
    if (appInstance && appInstance.settings) {
        const modelSettingDefs = appInstance.settings.filter(s => s.id !== 'systemPrompt');
        const settingsFragment = createSettingsUI(modelSettingDefs, modelSettings, 'agent-');
        modelSettingsContainer.appendChild(settingsFragment);
    }

    // Dynamically create tool settings UI
    const toolSettingsContainer = editorContainer.querySelector('#agent-tool-settings-container');
    if (appInstance && appInstance.mcp && appInstance.mcp.getTools) {
        const tools = appInstance.mcp.getTools();
        if (tools.length > 0) {
            const toolSettingsUI = createToolSettingsUI(tools, toolSettings, () => { /* no-op, handled by form listener */ });
            toolSettingsUI.id = 'agent-tool-settings';
            toolSettingsContainer.appendChild(toolSettingsUI);
        }
    }

    return editorContainer.outerHTML;
}

/**
 * Attaches event listeners to the agent editor form for auto-saving.
 */
function attachAgentFormListeners() {
    const form = document.getElementById('agent-editor-form');
    if (!form) return;

    const modelSettingDefs = (appInstance && appInstance.settings)
        ? appInstance.settings.filter(s => s.id !== 'systemPrompt')
        : [];

    const saveAgent = () => {
        const agentId = form.querySelector('#agent-id').value;

        const modelSettings = {};
        modelSettingDefs.forEach(setting => {
            const input = form.querySelector(`#agent-${setting.id}`);
            if (input) {
                let value = input.value;
                if (setting.type === 'range' || setting.type === 'number') {
                    value = parseFloat(value);
                }
                if (value !== '' && value !== null && !isNaN(value)) {
                    modelSettings[setting.id] = value;
                }
            }
        });

        const toolSettingsUI = form.querySelector('#agent-tool-settings');
        let toolSettings = { allowAll: false, allowed: [] };
        if (toolSettingsUI) {
            const allowAllCheckbox = toolSettingsUI.querySelector('input[type="checkbox"]');
            const allowedCheckboxes = toolSettingsUI.querySelectorAll('input[type="checkbox"]:not(:first-child)');
            toolSettings = {
                allowAll: allowAllCheckbox.checked,
                allowed: Array.from(allowedCheckboxes).filter(cb => cb.checked).map(cb => cb.value),
            };
        }

        const agentData = {
            id: agentId,
            name: form.querySelector('#agent-name').value,
            systemPrompt: form.querySelector('#agent-system-prompt').value,
            useCustomModelSettings: form.querySelector('#agent-use-custom-settings').checked,
            modelSettings: modelSettings,
            useCustomToolSettings: form.querySelector('#agent-use-custom-tool-settings').checked,
            toolSettings: toolSettings,
        };

        if (agentId) {
            agentManager.updateAgent(agentData);
            const agentListItem = document.querySelector(`.agent-list-item[data-id="${agentId}"] span`);
            if (agentListItem) {
                agentListItem.textContent = agentData.name;
            }
        }
        // Auto-saving doesn't handle creating new agents, only editing existing ones.
        // A new agent is created with default values and then can be edited.
    };

    const debouncedSave = debounce(saveAgent, 500);
    form.addEventListener('input', debouncedSave);
    form.addEventListener('change', debouncedSave);

    const customModelCheckbox = form.querySelector('#agent-use-custom-settings');
    const modelSettingsFieldset = form.querySelector('#agent-model-settings');
    customModelCheckbox.addEventListener('change', () => {
        modelSettingsFieldset.disabled = !customModelCheckbox.checked;
    });

    const customToolCheckbox = form.querySelector('#agent-use-custom-tool-settings');
    const toolSettingsContainer = form.querySelector('#agent-tool-settings-container');
    customToolCheckbox.addEventListener('change', () => {
        toolSettingsContainer.style.display = customToolCheckbox.checked ? 'block' : 'none';
    });
}

/**
 * Populates the agent selector dropdown in the chat area.
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
 * The main plugin object for agents.
 */
const agentsPlugin = {
    name: 'Agents',

    /**
     * Initializes the plugin.
     * @param {object} app - The main application instance.
     */
    onAppInit(app) {
        appInstance = app;
        pluginManager.registerView('agent-editor', renderAgentEditor);
        app.agentManager = agentManager; // Expose agent manager to other plugins
    },

    /**
     * Registers the "Agents" tab.
     * @param {object[]} tabs - The array of existing tabs.
     * @returns {object[]} The updated array of tabs.
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
     * Renders the agent selector in the chat area.
     * @param {string} currentHtml - The current HTML of the chat area.
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
     * Updates the agent selector when the chat is switched.
     * @param {object} chat - The newly active chat object.
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
     * @param {{type: string, id: string}} view - The rendered view object.
     */
    onViewRendered(view) {
        if (view.type === 'agent-editor') {
            attachAgentFormListeners();
        }
    }
};

pluginManager.register(agentsPlugin);
