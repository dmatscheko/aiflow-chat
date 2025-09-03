/**
 * @fileoverview Plugin for managing agents.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {object} Agent
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} systemPrompt
 * @property {boolean} availableAsTool
 * @property {boolean} useCustomModelSettings
 * @property {object} modelSettings
 */

const agentsPlugin = {
    /** @type {import('../main.js').App} */
    app: null,

    /**
     * Initializes the plugin, storing a reference to the main app instance.
     * @param {import('../main.js').App} app - The main application instance.
     */
    onAppInit(app) {
        this.app = app;
    },

    /**
     * Registers the 'Agents' tab.
     * @param {Array<Object>} tabs - The original tabs array.
     * @returns {Array<Object>} The modified tabs array.
     */
    onTabsRegistered(tabs) {
        tabs.push({
            id: 'agents',
            label: 'Agents',
            onActivate: () => this.renderAgentsTab(),
        });
        return tabs;
    },

    /**
     * Renders the content of the 'Agents' tab.
     */
    renderAgentsTab() {
        const pane = document.getElementById('agents-pane');
        if (!pane) return;

        pane.innerHTML = `
            <div class="agents-toolbar">
                <button id="add-agent-btn">Add Agent</button>
            </div>
            <div id="agent-list"></div>
            <div id="agent-form-container" style="display: none;">
                <form id="agent-form">
                    <input type="hidden" id="agent-id">
                    <label for="agent-name">Name:</label>
                    <input type="text" id="agent-name" required>
                    <label for="agent-description">Description:</label>
                    <textarea id="agent-description" rows="2"></textarea>
                    <label for="agent-system-prompt">System Prompt:</label>
                    <textarea id="agent-system-prompt" rows="5"></textarea>
                    <label>
                        <input type="checkbox" id="agent-available-as-tool">
                        Available as a tool for other agents
                    </label>
                    <label>
                        <input type="checkbox" id="agent-use-custom-settings">
                        Use Custom Model Settings
                    </label>
                    <div id="agent-model-settings" style="display: none;"></div>
                    <div class="agent-form-buttons">
                        <button type="submit">Save Agent</button>
                        <button type="button" id="cancel-agent-form">Cancel</button>
                    </div>
                </form>
            </div>
        `;

        this.renderAgentList();
        this.initEventListeners();
    },

    /**
     * Renders the list of agents for the current chat.
     */
    renderAgentList() {
        const agentListEl = document.getElementById('agent-list');
        if (!agentListEl) return;

        const chat = this.app.getActiveChat();
        if (!chat || !chat.agents || chat.agents.length === 0) {
            agentListEl.innerHTML = '<p>No agents defined for this chat.</p>';
            return;
        }

        agentListEl.innerHTML = chat.agents.map(agent => {
            const isActive = agent.id === chat.activeAgentId;
            return `
                <div class="agent-card ${isActive ? 'active' : ''}" data-id="${agent.id}">
                    <h3>${agent.name}</h3>
                    <p>${agent.description}</p>
                    <div class="agent-card-buttons">
                        <button class="activate-agent-btn" data-id="${agent.id}">${isActive ? 'Deactivate' : 'Activate'}</button>
                        <button class="edit-agent-btn" data-id="${agent.id}">Edit</button>
                        <button class="delete-agent-btn" data-id="${agent.id}">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Sets up event listeners for the 'Agents' tab UI.
     */
    initEventListeners() {
        // Use event delegation on a parent element that is always present
        const pane = document.getElementById('agents-pane');
        if (!pane) return;

        pane.addEventListener('click', (e) => {
            if (e.target.id === 'add-agent-btn') this.showAgentForm();
            if (e.target.id === 'cancel-agent-form') this.hideAgentForm();
            if (e.target.closest('.agent-card-buttons')) this.handleAgentListClick(e);
        });

        pane.addEventListener('submit', (e) => {
            if (e.target.id === 'agent-form') this.handleSaveAgent(e);
        });

        pane.addEventListener('change', (e) => {
            if (e.target.id === 'agent-use-custom-settings') {
                const settingsEl = document.getElementById('agent-model-settings');
                settingsEl.style.display = e.target.checked ? 'block' : 'none';
                if (e.target.checked) {
                    this.renderAgentModelSettings();
                }
            }
        });
    },

    /**
     * Renders the model settings controls within the agent form.
     * @param {object} [settings] - The existing settings to populate the form with.
     */
    renderAgentModelSettings(settings = {}) {
        const container = document.getElementById('agent-model-settings');
        if (!container) return;

        const modelOptions = Array.from(this.app.dom.settings.model.options).map(opt =>
            `<option value="${opt.value}" ${settings.model === opt.value ? 'selected' : ''}>${opt.textContent}</option>`
        ).join('');

        container.innerHTML = `
            <div class="setting">
                <label for="agent-apiUrl">API URL:</label>
                <input type="text" id="agent-apiUrl" value="${settings.apiUrl || ''}">
            </div>
            <div class="setting">
                <label for="agent-model">Model:</label>
                <select id="agent-model">${modelOptions}</select>
            </div>
            <div class="setting">
                <label for="agent-temperature">Temperature:</label>
                <input type="range" id="agent-temperature" min="0" max="2" step="0.1" value="${settings.temperature || '1'}">
                <span>${settings.temperature || '1'}</span>
            </div>
        `;

        // Add event listener for the range slider to update the value display
        const tempSlider = container.querySelector('#agent-temperature');
        tempSlider.addEventListener('input', () => {
            tempSlider.nextElementSibling.textContent = tempSlider.value;
        });
    },

    /**
     * Displays the agent form for adding or editing an agent.
     * @param {Agent} [agent] - The agent to edit. If null, the form is for a new agent.
     */
    showAgentForm(agent = null) {
        const form = document.getElementById('agent-form');
        form.reset();

        const customSettingsCheckbox = document.getElementById('agent-use-custom-settings');
        const settingsContainer = document.getElementById('agent-model-settings');

        if (agent) {
            document.getElementById('agent-id').value = agent.id;
            document.getElementById('agent-name').value = agent.name;
            document.getElementById('agent-description').value = agent.description;
            document.getElementById('agent-system-prompt').value = agent.systemPrompt;
            document.getElementById('agent-available-as-tool').checked = agent.availableAsTool;
            customSettingsCheckbox.checked = agent.useCustomModelSettings;

            if (agent.useCustomModelSettings) {
                settingsContainer.style.display = 'block';
                this.renderAgentModelSettings(agent.modelSettings);
            } else {
                settingsContainer.style.display = 'none';
            }
        } else {
            document.getElementById('agent-id').value = '';
            customSettingsCheckbox.checked = false;
            settingsContainer.style.display = 'none';
        }

        document.getElementById('agent-form-container').style.display = 'block';
    },

    /**
     * Hides the agent form.
     */
    hideAgentForm() {
        document.getElementById('agent-form-container').style.display = 'none';
    },

    /**
     * Handles the click events on the agent list (edit/delete/activate).
     * @param {MouseEvent} e - The click event.
     */
    handleAgentListClick(e) {
        const button = e.target.closest('button');
        if (!button) return;

        const agentId = button.dataset.id;
        if (!agentId) return;

        const chat = this.app.getActiveChat();
        if (!chat) return;

        const agent = chat.agents && chat.agents.find(a => a.id === agentId);

        if (button.classList.contains('edit-agent-btn')) {
            this.showAgentForm(agent);
        } else if (button.classList.contains('delete-agent-btn')) {
            if (confirm(`Are you sure you want to delete the agent "${agent.name}"?`)) {
                chat.agents = chat.agents.filter(a => a.id !== agentId);
                if (chat.activeAgentId === agentId) chat.activeAgentId = null;
                this.app.saveChats();
                this.renderAgentList();
            }
        } else if (button.classList.contains('activate-agent-btn')) {
            chat.activeAgentId = chat.activeAgentId === agentId ? null : agentId;
            this.app.saveChats();
            this.renderAgentList();
        }
    },

    /**
     * Handles the form submission for saving an agent.
     * @param {SubmitEvent} e - The form submission event.
     */
    handleSaveAgent(e) {
        e.preventDefault();
        const id = document.getElementById('agent-id').value;
        const useCustomSettings = document.getElementById('agent-use-custom-settings').checked;

        const agentData = {
            id: id || `agent-${Date.now()}`,
            name: document.getElementById('agent-name').value,
            description: document.getElementById('agent-description').value,
            systemPrompt: document.getElementById('agent-system-prompt').value,
            availableAsTool: document.getElementById('agent-available-as-tool').checked,
            useCustomModelSettings: useCustomSettings,
            modelSettings: {}
        };

        if (useCustomSettings) {
            agentData.modelSettings = {
                apiUrl: document.getElementById('agent-apiUrl').value,
                model: document.getElementById('agent-model').value,
                temperature: document.getElementById('agent-temperature').value,
            };
        }

        const chat = this.app.getActiveChat();
        if (!chat) return;

        if (!chat.agents) chat.agents = [];

        if (id) {
            const index = chat.agents.findIndex(a => a.id === id);
            if (index > -1) chat.agents[index] = agentData;
        } else {
            chat.agents.push(agentData);
        }

        this.app.saveChats();
        this.renderAgentList();
        this.hideAgentForm();
    },

    /**
     * Returns a list of agents that are marked as "available as tool".
     * @returns {Array<Agent>}
     */
    getAgentsAsTools() {
        const chat = this.app.getActiveChat();
        if (!chat || !chat.agents) return [];
        return chat.agents.filter(a => a.availableAsTool);
    },

    /**
     * Modifies the API payload before sending.
     * @param {object} payload - The original API payload.
     * @param {object} settings - The global settings.
     * @returns {object} The modified payload.
     */
    beforeApiCall(payload, settings) {
        const chat = this.app.getActiveChat();
        if (!chat || !chat.activeAgentId) {
            return payload;
        }

        const agent = chat.agents.find(a => a.id === chat.activeAgentId);
        if (!agent) {
            return payload;
        }

        // Override payload with agent's custom settings if they exist
        if (agent.useCustomModelSettings && agent.modelSettings) {
            if (agent.modelSettings.model) payload.model = agent.modelSettings.model;
            if (agent.modelSettings.temperature) payload.temperature = parseFloat(agent.modelSettings.temperature);
            // Note: We don't override the API URL/Key here as that's handled by ApiService
        }

        // Find the system message and append the agent's prompt.
        let systemMessage = payload.messages.find(m => m.role === 'system');
        if (systemMessage) {
            systemMessage.content += `\n\n--- AGENT DEFINITION ---\n${agent.systemPrompt}`;
        } else {
            payload.messages.unshift({ role: 'system', content: settings.systemPrompt + `\n\n--- AGENT DEFINITION ---\n${agent.systemPrompt}` });
        }

        return payload;
    }
};

pluginManager.register(agentsPlugin);
