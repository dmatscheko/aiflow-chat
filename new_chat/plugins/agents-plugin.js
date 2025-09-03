/**
 * @fileoverview Plugin for managing and using Agents with advanced settings.
 * @version 2.0.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {object} AgentModelSettings
 * @property {string} [apiKey] - Custom API key for the agent.
 * @property {string} [apiUrl] - Custom API URL for the agent.
 * @property {string} [model] - The specific model to use for the agent.
 * @property {number} [temperature] - The temperature setting for the model.
 * @property {number} [top_p] - The top_p setting for the model.
 */

/**
 * @typedef {object} Agent
 * @property {string} id - The unique identifier for the agent.
 * @property {string} name - The name of the agent.
 * @property {string} systemPrompt - The system prompt for the agent.
 * @property {boolean} useCustomModelSettings - Whether to use custom model settings.
 * @property {AgentModelSettings} modelSettings - The custom model settings.
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
    const settings = agent?.modelSettings || {};

    return `
        <div id="agent-editor-view">
            <h2>${agentId ? 'Edit' : 'Create'} Agent</h2>
            <form id="agent-editor-form">
                <input type="hidden" id="agent-id" value="${agent?.id || ''}">

                <div class="form-group">
                    <label for="agent-name">Name</label>
                    <input type="text" id="agent-name" required value="${agent?.name || ''}">
                </div>

                <div class="form-group">
                    <label for="agent-system-prompt">System Prompt</label>
                    <textarea id="agent-system-prompt" rows="8">${agent?.systemPrompt || ''}</textarea>
                </div>

                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="agent-use-custom-settings" ${agent?.useCustomModelSettings ? 'checked' : ''}>
                        Use Custom Model Settings
                    </label>
                </div>

                <fieldset id="agent-model-settings" ${agent?.useCustomModelSettings ? '' : 'disabled'}>
                    <legend>Model Settings</legend>
                    <div class="form-group">
                        <label for="agent-api-url">API URL</label>
                        <input type="text" id="agent-api-url" placeholder="Default" value="${settings.apiUrl || ''}">
                    </div>
                    <div class="form-group">
                        <label for="agent-model">Model Name</label>
                        <input type="text" id="agent-model" placeholder="Default" value="${settings.model || ''}">
                    </div>
                    <div class="form-group">
                        <label for="agent-temperature">Temperature</label>
                        <input type="number" id="agent-temperature" step="0.1" min="0" max="2" placeholder="Default" value="${settings.temperature || ''}">
                    </div>
                    <div class="form-group">
                        <label for="agent-top-p">Top P</label>
                        <input type="number" id="agent-top-p" step="0.1" min="0" max="1" placeholder="Default" value="${settings.top_p || ''}">
                    </div>
                </fieldset>

            </form>
        </div>
    `;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Attaches event listeners to the agent editor form for auto-saving.
 */
function attachAgentFormListeners() {
    const form = document.getElementById('agent-editor-form');
    if (!form) return;

    const saveAgent = () => {
        const agentId = form.querySelector('#agent-id').value;
        const agentData = {
            id: agentId,
            name: form.querySelector('#agent-name').value,
            systemPrompt: form.querySelector('#agent-system-prompt').value,
            useCustomModelSettings: form.querySelector('#agent-use-custom-settings').checked,
            modelSettings: {
                apiUrl: form.querySelector('#agent-api-url').value || undefined,
                model: form.querySelector('#agent-model').value || undefined,
                temperature: parseFloat(form.querySelector('#agent-temperature').value) || undefined,
                top_p: parseFloat(form.querySelector('#agent-top-p').value) || undefined,
            },
        };

        if (agentId) {
            agentManager.updateAgent(agentData);
            // Also update the name in the list in real-time
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
    form.addEventListener('change', debouncedSave); // For checkboxes

    const customSettingsCheckbox = form.querySelector('#agent-use-custom-settings');
    const modelSettingsFieldset = form.querySelector('#agent-model-settings');
    customSettingsCheckbox.addEventListener('change', () => {
        modelSettingsFieldset.disabled = !customSettingsCheckbox.checked;
        // The main change listener will pick this up and save.
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
        app.setActiveAgent = (agentId) => {
            if (app.activeChatId) {
                agentManager.setActiveAgentForChat(app.activeChatId, agentId || null);
            }
        };
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
    },

    /**
     * Modifies the API call payload based on the active agent.
     * @param {object} payload - The original API call payload.
     * @param {object} settings - The global settings.
     * @returns {object} The modified payload.
     */
    beforeApiCall(payload, settings) {
        if (!appInstance || !appInstance.activeChatId) return payload;

        const activeAgentId = agentManager.getActiveAgentForChat(appInstance.activeChatId);
        if (!activeAgentId) return payload;

        const agent = agentManager.getAgent(activeAgentId);
        if (!agent) return payload;

        // Modify system prompt
        let systemMessage = payload.messages.find(m => m.role === 'system');
        if (systemMessage) {
            systemMessage.content = agent.systemPrompt;
        } else {
            payload.messages.unshift({ role: 'system', content: agent.systemPrompt });
        }

        // Override model settings if custom settings are enabled
        if (agent.useCustomModelSettings) {
            const { apiUrl, model, temperature, top_p } = agent.modelSettings;
            if (apiUrl) settings.apiUrl = apiUrl;
            if (model) payload.model = model;
            if (temperature) payload.temperature = temperature;
            if (top_p) payload.top_p = top_p;
        }

        return payload;
    }
};

pluginManager.register(agentsPlugin);
