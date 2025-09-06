/**
 * @fileoverview Main application logic for the Core Chat.
 * This script ties together the data, API, and UI components.
 */

'use strict';

import { ChatLog } from './chat-data.js';
import { ApiService } from './api-service.js';
import { ChatUI } from './chat-ui.js';
import { pluginManager } from './plugin-manager.js';
import { debounce, createSettingsUI, createToolSettingsUI } from './utils.js';
import { responseProcessor } from './response-processor.js';

// Load plugins
import './plugins/example-plugin.js';
import './plugins/agents-plugin.js';
import './plugins/flows-plugin.js';
import './plugins/mcp-plugin.js';
import './plugins/formatting-plugin.js';

/**
 * @typedef {object} Chat
 * @property {string} id - The unique identifier for the chat.
 * @property {string} title - The title of the chat.
 * @property {ChatLog} log - The ChatLog instance for the chat.
 */

/**
 * @typedef {object} Setting
 * @property {string} id - The unique identifier for the setting.
 * @property {string} label - The display label for the setting.
 * @property {string} type - The input type (e.g., 'text', 'select').
 * @property {any} default - The default value for the setting.
 * @property {any[]} [options] - Options for 'select' type settings.
 */

/**
 * @typedef {object} Tab
 * @property {string} id - The unique identifier for the tab.
 * @property {string} label - The display label for the tab.
 * @property {() => void} onActivate - A function to call when the tab is activated.
 */

/**
 * @typedef {object} View
 * @property {string} type - The type of the view (e.g., 'chat', 'editor').
 * @property {string | null} id - The unique identifier for the content of the view (e.g., a chat ID).
 */

/**
 * The main application class.
 * Orchestrates all components of the chat application.
 * @class
 */
class App {
    constructor() {
        /** @type {ApiService} */
        this.apiService = new ApiService();
        /** @type {Chat[]} */
        this.chats = [];
        /** @type {View} */
        this.activeView = { type: 'chat', id: null }; // Default view
        /** @type {AbortController | null} */
        this.abortController = null;
        /** @type {string | null} */
        this.activeChatId = null;
        /** @type {ChatUI | null} */
        this.chatUI = null;
        /**
         * A debounced version of the saveChats method.
         * @type {() => void}
         */
        this.debouncedSave = debounce(() => this.saveChats(), 500);

        /**
         * A map of cached DOM elements.
         * @type {Object.<string, HTMLElement>}
         */
        this.dom = {};

        /**
         * The application settings definition.
         * @type {Setting[]}
         */
        this.settings = [];

        /**
         * The application tabs definition.
         * @type {Tab[]}
         */
        this.tabs = [];


        this.registerCoreViews();
        pluginManager.trigger('onAppInit', this);

        this.defineSettings();
        this.defineTabs();
        this.initDOM();

        this.renderSettings();
        this.renderTabs();

        this.loadSettings();
        this.loadChats(); // This will set the initial active chat id

        // Set initial view
        this.activeView.id = this.activeChatId;
        this.renderMainView();

        this.initEventListeners();
        this.fetchModels();
    }

    /**
     * Registers the core views provided by the application.
     * Plugins can register additional views.
     * @private
     */
    registerCoreViews() {
        pluginManager.registerView('chat', (chatId) => {
            return `
                <div id="chat-container"></div>
                <div id="chat-area-controls"></div>
                <form id="message-form">
                    <textarea id="message-input" placeholder="Type your message..." rows="3"></textarea>
                    <button type="submit">Send</button>
                    <button type="button" id="stop-button" style="display: none;">Stop</button>
                </form>
            `;
        });
    }

    /**
     * Defines the core application settings.
     * Plugins can modify this list via the 'onSettingsRegistered' hook.
     * @private
     */
    defineSettings() {
        const coreSettings = [
            { id: 'apiUrl', label: 'API URL', type: 'text', default: 'https://api.openai.com/' },
            { id: 'apiKey', label: 'API Key', type: 'password', default: '' },
            { id: 'model', label: 'Model', type: 'select', options: [] },
            { id: 'systemPrompt', label: 'System Prompt', type: 'textarea', default: 'You are a helpful assistant.' },
            { id: 'temperature', label: 'Temperature', type: 'range', default: '1', min: 0, max: 2, step: 0.1 },
        ];
        this.settings = pluginManager.trigger('onSettingsRegistered', coreSettings);
    }

    /**
     * Defines the core application tabs for the right-hand panel.
     * Plugins can modify this list via the 'onTabsRegistered' hook.
     * @private
     */
    defineTabs() {
        const coreTabs = [
            {
                id: 'chats',
                label: 'Chats',
                onActivate: () => {
                    const contentEl = document.getElementById('chats-pane');
                    contentEl.innerHTML = `
                        <ul id="chat-list"></ul>
                        <button id="new-chat-button">New Chat</button>
                    `;
                    this.renderChatList();

                    document.getElementById('new-chat-button').addEventListener('click', () => this.createNewChat());
                    document.getElementById('chat-list').addEventListener('click', (e) => {
                        const target = e.target;
                        if (target.closest('li')) {
                            this.setView('chat', target.closest('li').dataset.id);
                        }
                        if (target.classList.contains('delete-chat-button')) {
                            e.stopPropagation();
                            this.deleteChat(target.parentElement.dataset.id);
                        }
                    });
                }
            }
        ];
        this.tabs = pluginManager.trigger('onTabsRegistered', coreTabs);
    }

    /**
     * Caches references to key DOM elements.
     * @private
     */
    initDOM() {
        this.dom = {
            settingsContainer: document.getElementById('settings-container'),
            mainPanel: document.getElementById('main-panel'),
            panelTabs: document.getElementById('panel-tabs'),
            panelContent: document.getElementById('panel-content'),
        };
    }

    /**
     * Renders the settings UI in the left panel based on the `this.settings` definition.
     * @private
     */
    renderSettings() {
        this.dom.settingsContainer.innerHTML = '';

        // --- Render standard model and plugin settings ---
        const currentSettings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};
        const settingsFragment = createSettingsUI(this.settings, currentSettings, 'setting-');
        this.dom.settingsContainer.appendChild(settingsFragment);

        // Add the refresh models button manually as it's a special case
        const modelSettingEl = this.dom.settingsContainer.querySelector('#setting-model').parentElement;
        if (modelSettingEl) {
            const refreshBtn = document.createElement('button');
            refreshBtn.id = 'refresh-models';
            refreshBtn.textContent = 'Refresh';
            modelSettingEl.appendChild(refreshBtn);
        }

        // --- Render Tool Settings ---
        if (this.mcp && this.mcp.getTools) {
            const tools = this.mcp.getTools();
            if (tools.length > 0) {
                const currentToolSettings = JSON.parse(localStorage.getItem('core_tool_settings')) || { allowAll: false, allowed: [] };
                const toolSettingsUI = createToolSettingsUI(tools, currentToolSettings, (newSettings) => {
                    localStorage.setItem('core_tool_settings', JSON.stringify(newSettings));
                });
                this.dom.settingsContainer.appendChild(toolSettingsUI);
            }
        }

        // Cache the DOM elements for settings
        this.dom.settings = {};
        this.settings.forEach(s => {
            this.dom.settings[s.id] = document.getElementById(`setting-${s.id}`);
        });
    }

    /**
     * Renders the tab buttons and panes in the right panel.
     * @private
     */
    renderTabs() {
        this.dom.panelTabs.innerHTML = '';
        this.dom.panelContent.innerHTML = '';

        this.tabs.forEach(tab => {
            const tabBtn = document.createElement('button');
            tabBtn.id = `tab-btn-${tab.id}`;
            tabBtn.classList.add('tab-btn');
            tabBtn.dataset.tabId = tab.id;
            tabBtn.textContent = tab.label;
            this.dom.panelTabs.appendChild(tabBtn);

            const tabPane = document.createElement('div');
            tabPane.id = `${tab.id}-pane`;
            tabPane.classList.add('tab-pane');
            this.dom.panelContent.appendChild(tabPane);
        });

        this.dom.panelTabs.querySelector('.tab-btn').classList.add('active');
        this.dom.panelContent.querySelector('.tab-pane').classList.add('active');
        this.tabs[0].onActivate();
    }

    /**
     * Sets the active view for the main panel.
     * @param {string} type - The type of view to display.
     * @param {string} id - The ID of the content for the view (e.g., chat ID).
     */
    setView(type, id) {
        this.activeView = { type, id };
        console.log('Setting view to', this.activeView);
        if (type === 'chat') {
            this.activeChatId = id;
            localStorage.setItem('core_active_chat_id', this.activeChatId);
            this.updateActiveChatInList();
        }
        this.renderMainView();
    }

    /**
     * Renders the content of the main panel based on the current `activeView`.
     * @private
     */
    renderMainView() {
        const { type, id } = this.activeView;
        const renderer = pluginManager.getViewRenderer(type);

        if (renderer) {
            this.dom.mainPanel.innerHTML = renderer(id);
            if (type === 'chat') {
                this.initChatView(id);
            }
            pluginManager.trigger('onViewRendered', this.activeView);
        } else {
            this.dom.mainPanel.innerHTML = `<h2>Error: View type "${type}" not found.</h2>`;
        }
    }

    /**
     * Activates a specific tab in the right-hand panel.
     * @param {string} tabId - The ID of the tab to show.
     * @private
     */
    showTab(tabId) {
        if (!tabId) return;

        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        this.dom.panelTabs.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        this.dom.panelContent.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

        const tabBtn = document.getElementById(`tab-btn-${tabId}`);
        const tabPane = document.getElementById(`${tabId}-pane`);

        if (tabBtn) tabBtn.classList.add('active');
        if (tabPane) tabPane.classList.add('active');

        if (tab.onActivate) {
            tab.onActivate();
        }
    }

    /**
     * Initializes the chat view components and event listeners for a given chat.
     * @param {string} chatId - The ID of the chat to initialize the view for.
     * @private
     */
    initChatView(chatId) {
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) return;

        this.chatUI = new ChatUI(document.getElementById('chat-container'), this.agentManager);
        this.chatUI.setChatLog(chat.log);

        this.dom.messageForm = document.getElementById('message-form');
        this.dom.messageInput = document.getElementById('message-input');
        this.dom.stopButton = document.getElementById('stop-button');

        this.dom.messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFormSubmit();
        });
        this.dom.stopButton.addEventListener('click', () => {
            if (this.abortController) this.abortController.abort();
        });

        // Let plugins render chat area controls
        const chatAreaControls = document.getElementById('chat-area-controls');
        if(chatAreaControls) {
            chatAreaControls.innerHTML = pluginManager.trigger('onChatAreaRender', '');
            pluginManager.trigger('onChatSwitched', chat); // Notify plugins that the chat view is ready
        }
    }

    /**
     * Initializes global event listeners for settings and panel tabs.
     * @private
     */
    initEventListeners() {
        this.settings.forEach(setting => {
            const inputEl = this.dom.settings[setting.id];
            if (inputEl) {
                inputEl.addEventListener('change', () => {
                    this.saveSettings();
                    // If the API URL or key changes, we should refetch models.
                    if (setting.id === 'apiUrl' || setting.id === 'apiKey') {
                        this.fetchModels();
                    }
                });
                if (setting.type === 'range') {
                    const valueSpan = document.getElementById(`setting-${setting.id}-value`);
                    inputEl.addEventListener('input', () => {
                        if (valueSpan) valueSpan.textContent = inputEl.value;
                    });
                }
            }
        });
        document.getElementById('refresh-models').addEventListener('click', () => this.fetchModels());

        this.dom.panelTabs.addEventListener('click', (e) => {
            const tabId = e.target.dataset.tabId;
            if (tabId) {
                this.showTab(tabId);
            }
        });
    }

    /**
     * Loads settings from localStorage and applies them to the UI.
     * @private
     */
    loadSettings() {
        const savedSettings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};
        this.settings.forEach(setting => {
            const inputEl = this.dom.settings[setting.id];
            if(inputEl) {
                inputEl.value = savedSettings[setting.id] || setting.default;
                if (setting.type === 'range') {
                    const valueSpan = document.getElementById(`setting-${setting.id}-value`);
                    if(valueSpan) valueSpan.textContent = inputEl.value;
                }
            }
        });
    }

    /**
     * Saves the current settings from the UI to localStorage.
     * @private
     */
    saveSettings() {
        const settingsToSave = {};
        this.settings.forEach(setting => {
            const inputEl = this.dom.settings[setting.id];
            if(inputEl) {
                settingsToSave[setting.id] = inputEl.value;
            }
        });
        localStorage.setItem('core_chat_settings', JSON.stringify(settingsToSave));
    }

    /**
     * Loads chat history from localStorage.
     * If no chats are found, creates a new one.
     * @private
     */
    loadChats() {
        const savedChats = JSON.parse(localStorage.getItem('core_chat_logs'));
        if (savedChats && savedChats.length > 0) {
            this.chats = savedChats.map(chatData => {
                const chat = {
                    id: chatData.id,
                    title: chatData.title,
                    log: ChatLog.fromJSON(chatData.log),
                };
                chat.log.subscribe(this.debouncedSave);
                return chat;
            });
            this.activeChatId = localStorage.getItem('core_active_chat_id') || this.chats[0].id;
        } else {
            // createNewChat is called in saveChats if chats is empty
        }
        if (this.chats.length === 0) {
             this.createNewChat();
        }
    }

    /**
     * Saves all chats and the active chat ID to localStorage.
     * @private
     */
    saveChats() {
        const chatsToSave = this.chats.map(chat => ({
            id: chat.id,
            title: chat.title,
            log: chat.log.toJSON(),
        }));
        localStorage.setItem('core_chat_logs', JSON.stringify(chatsToSave));
        localStorage.setItem('core_active_chat_id', this.activeChatId);
    }

    /**
     * Creates a new, empty chat, adds it to the list, and makes it active.
     * @private
     */
    createNewChat() {
        const newChat = {
            id: `chat-${Date.now()}`,
            title: 'New Chat',
            log: new ChatLog(),
        };
        newChat.log.subscribe(this.debouncedSave);
        this.chats.unshift(newChat);
        this.renderChatList();
        this.setView('chat', newChat.id);
        this.saveChats(); // Save immediately to create the entry
    }

    /**
     * Deletes a chat and updates the view to a different chat.
     * @param {string} chatId - The ID of the chat to delete.
     * @private
     */
    deleteChat(chatId) {
        this.chats = this.chats.filter(c => c.id !== chatId);
        if (this.activeChatId === chatId) {
            const newActiveChat = this.chats.length > 0 ? this.chats[0] : null;
            if (newActiveChat) {
                this.setView('chat', newActiveChat.id);
            } else {
                this.createNewChat();
                return; // createNewChat calls setView
            }
        }
        this.renderChatList();
        this.saveChats();
    }

    /**
     * Renders the list of chats in the 'Chats' tab.
     * @private
     */
    renderChatList() {
        const chatListEl = document.getElementById('chat-list');
        if (!chatListEl) return;
        chatListEl.innerHTML = '';
        this.chats.forEach(chat => {
            const li = document.createElement('li');
            li.dataset.id = chat.id;

            const span = document.createElement('span');
            span.textContent = chat.title;
            li.appendChild(span);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'X';
            deleteBtn.classList.add('delete-chat-button');
            li.appendChild(deleteBtn);

            chatListEl.appendChild(li);
        });
        this.updateActiveChatInList();
    }

    /**
     * Toggles the 'active' class on the current chat in the list.
     * @private
     */
    updateActiveChatInList() {
        const chatListEl = document.getElementById('chat-list');
        if (!chatListEl) return;
        const chatItems = chatListEl.querySelectorAll('li');
        chatItems.forEach(item => {
            item.classList.toggle('active', item.dataset.id === this.activeChatId);
        });
    }

    /**
     * Gets the full chat object for the currently active chat.
     * @returns {Chat | undefined} The active chat object.
     */
    getActiveChat() {
        return this.chats.find(c => c.id === this.activeChatId);
    }

    /**
     * Fetches the list of available models from the API and populates the model dropdown.
     * @private
     */
    async fetchModels() {
        const apiUrl = this.dom.settings.apiUrl.value;
        const apiKey = this.dom.settings.apiKey.value;
        if (!apiUrl) return;
        try {
            const models = await this.apiService.getModels(apiUrl, apiKey);
            const modelSelect = this.dom.settings.model;
            modelSelect.innerHTML = '';
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.id;
                modelSelect.appendChild(option);
            });
            const savedSettings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};
            if (savedSettings.model) {
                modelSelect.value = savedSettings.model;
            }
            this.saveSettings();
        } catch (error) {
            alert(`Failed to fetch models: ${error.message}`);
        }
    }

    /**
     * Handles the submission of the message form.
     * Adds the user message to the log and schedules the response processor.
     * @param {object} [options={}] - Options for the submission.
     * @param {boolean} [options.isContinuation=false] - Whether this is a continuation of a previous turn.
     * @param {string|null} [options.agentId=null] - The ID of an agent to force for this turn.
     * @private
     */
    async handleFormSubmit(options = {}) {
        const { isContinuation = false, agentId = null } = options;
        const activeChat = this.getActiveChat();
        if (!activeChat) return;

        if (!isContinuation) {
            const userInput = this.dom.messageInput.value.trim();
            if (!userInput) return;
            activeChat.log.addMessage({ role: 'user', content: userInput });
            this.dom.messageInput.value = '';
        }

        // Determine the agent to use: the override, the chat's active agent, or null.
        const finalAgentId = agentId || this.agentManager.getActiveAgentForChat(activeChat.id);

        // Add a placeholder message with the same agent context.
        const assistantMsg = activeChat.log.addMessage({ role: 'assistant', content: null, agent: finalAgentId });

        // Schedule the response processor to find and process the new placeholder.
        responseProcessor.scheduleProcessing(this);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
