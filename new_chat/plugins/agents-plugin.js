/**
 * @fileoverview Plugin for managing and using Agents with advanced settings.
 * @version 2.0.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce } from '../utils.js';
import { createModelSettings, createMcpSettings, createSettingElement } from '../settings-ui.js';

/**
 * @typedef {object} AgentModelSettings
 * @property {string} [apiKey] - Custom API key for the agent.
 * @property {string} [apiUrl] - Custom API URL for the agent.
 * @property {string} [model] - The specific model to use for the agent.
 * @property {number} [temperature] - The temperature setting for the model.
 * @property {number} [top_p] - The top_p setting for the model.
 */

/**
 * @typedef {object} AgentMcpSettings
 * @property {boolean} allTools - Whether to enable all tools.
 * @property {Object.<string, boolean>} enabledTools - A map of tool names to their enabled state.
 */

/**
 * @typedef {object} Agent
 * @property {string} id - The unique identifier for the agent.
 * @property {string} name - The name of the agent.
 * @property {string} systemPrompt - The system prompt for the agent.
 * @property {boolean} useCustomModelSettings - Whether to use custom model settings.
 * @property {AgentModelSettings} modelSettings - The custom model settings.
 * @property {boolean} useCustomMcpSettings - Whether to use custom MCP settings.
 * @property {AgentMcpSettings} mcpSettings - The custom MCP settings.
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
    const view = document.createElement('div');
    view.id = 'agent-editor-view';

    view.innerHTML = `
        <h2>${agentId ? 'Edit' : 'Create'} Agent</h2>
        <form id="agent-editor-form">
            <input type="hidden" id="agent-id" value="${agent?.id || ''}">
            <div class="form-group">
                <label for="agent-name">Name</label>
                <input type="text" id="agent-name" required value="${agent?.name || ''}">
            </div>
        </form>
    `;

    const form = view.querySelector('#agent-editor-form');

    // --- System Prompt ---
    const systemPromptContainer = document.createElement('div');
    systemPromptContainer.className = 'form-group';
    const systemPrompt = createSettingElement({
        id: 'systemPrompt',
        label: 'System Prompt',
        type: 'textarea',
        rows: 8,
        default: agent?.systemPrompt || ''
    }, 'agent-');
    systemPromptContainer.appendChild(systemPrompt);
    form.appendChild(systemPromptContainer);


    // --- Custom Model Settings ---
    const useCustomModelSettings = createSettingElement({
        id: 'use-custom-settings',
        label: 'Use Custom Model Settings',
        type: 'checkbox',
        default: agent?.useCustomModelSettings || false
    }, 'agent-');
    form.appendChild(useCustomModelSettings);

    const modelSettingsFieldset = document.createElement('fieldset');
    modelSettingsFieldset.id = 'agent-model-settings';
    modelSettingsFieldset.disabled = !agent?.useCustomModelSettings;
    const modelLegend = document.createElement('legend');
    modelLegend.textContent = 'Model Settings';
    modelSettingsFieldset.appendChild(modelLegend);

    const modelSettingsContent = createModelSettings(appInstance.modelSettings, 'agent-');
    modelSettingsFieldset.appendChild(modelSettingsContent);
    form.appendChild(modelSettingsFieldset);


    // --- Custom MCP Settings ---
    const useCustomMcpSettings = createSettingElement({
        id: 'use-custom-mcp-settings',
        label: 'Use Custom MCP Settings',
        type: 'checkbox',
        default: agent?.useCustomMcpSettings || false
    }, 'agent-');
    form.appendChild(useCustomMcpSettings);

    const mcpSettingsFieldset = document.createElement('fieldset');
    mcpSettingsFieldset.id = 'agent-mcp-settings';
    mcpSettingsFieldset.disabled = !agent?.useCustomMcpSettings;

    // The createMcpSettings function returns a fragment with a fieldset,
    // so we get the content and append it here.
    const mcpTools = pluginManager.getHelper('mcp', 'getTools')?.() || [];
    if (mcpTools.length > 0) {
        const mcpSettingsContent = createMcpSettings(mcpTools, 'agent-');
        mcpSettingsFieldset.appendChild(mcpSettingsContent);
        form.appendChild(mcpSettingsFieldset);
    }

    return view.outerHTML;
}

/**
 * Attaches event listeners to the agent editor form for auto-saving.
 */
function attachAgentFormListeners() {
    const form = document.getElementById('agent-editor-form');
    if (!form) return;

    const getSettingValue = (id, type) => {
        const el = form.querySelector(`#setting-agent-${id}`);
        if (!el) return undefined;
        switch (type) {
            case 'checkbox': return el.checked;
            case 'number': return parseFloat(el.value) || undefined;
            case 'range': return parseFloat(el.value) || undefined;
            default: return el.value || undefined;
        }
    };

    const saveAgent = () => {
        const agentId = form.querySelector('#agent-id').value;
        if (!agentId) return; // Don't auto-save for new, unsaved agents

        const modelSettings = {};
        appInstance.modelSettings.forEach(s => {
            modelSettings[s.id] = getSettingValue(s.id, s.type);
        });

        const mcpSettings = {
            allTools: getSettingValue('mcp-all-tools', 'checkbox'),
            enabledTools: {}
        };
        form.querySelectorAll('.mcp-tool-list input[type="checkbox"]').forEach(cb => {
            mcpSettings.enabledTools[cb.dataset.toolName] = cb.checked;
        });

        const agentData = {
            id: agentId,
            name: form.querySelector('#agent-name').value,
            systemPrompt: getSettingValue('systemPrompt', 'textarea'),
            useCustomModelSettings: getSettingValue('use-custom-settings', 'checkbox'),
            modelSettings: modelSettings,
            useCustomMcpSettings: getSettingValue('use-custom-mcp-settings', 'checkbox'),
            mcpSettings: mcpSettings,
        };

        agentManager.updateAgent(agentData);
        const agentListItem = document.querySelector(`.agent-list-item[data-id="${agentId}"] span`);
        if (agentListItem) {
            agentListItem.textContent = agentData.name;
        }
    };

    const debouncedSave = debounce(saveAgent, 500);
    form.addEventListener('input', debouncedSave);
    form.addEventListener('change', debouncedSave);

    // Toggle fieldsets
    const customModelCheckbox = form.querySelector('#setting-agent-use-custom-settings');
    const modelSettingsFieldset = form.querySelector('#agent-model-settings');
    if (customModelCheckbox && modelSettingsFieldset) {
        customModelCheckbox.addEventListener('change', () => {
            modelSettingsFieldset.disabled = !customModelCheckbox.checked;
        });
    }

    const customMcpCheckbox = form.querySelector('#setting-agent-use-custom-mcp-settings');
    const mcpSettingsFieldset = form.querySelector('#agent-mcp-settings');
    if (customMcpCheckbox && mcpSettingsFieldset) {
        customMcpCheckbox.addEventListener('change', () => {
            mcpSettingsFieldset.disabled = !customMcpCheckbox.checked;
        });
    }
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
                        useCustomMcpSettings: false,
                        mcpSettings: { allTools: true, enabledTools: {} }
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
