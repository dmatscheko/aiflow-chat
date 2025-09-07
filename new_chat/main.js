/**
 * @fileoverview Main application logic for the Core Chat.
 * This script ties together the data, API, and UI components.
 */

'use strict';

import { ChatLog } from './chat-data.js';
import { ApiService } from './api-service.js';
import { ChatUI } from './chat-ui.js';
import { pluginManager } from './plugin-manager.js';
import { debounce } from './utils.js';
import { responseProcessor } from './response-processor.js';
import { SettingsManager } from './settings-manager.js';

// Load plugins
import './plugins/example-plugin.js';
import './plugins/agents-plugin.js';
import './plugins/flows-plugin.js';
import './plugins/mcp-plugin.js';
import './plugins/formatting-plugin.js';

/**
 * @typedef {import('./chat-data.js').Message} Message
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
 * @property {any} [default] - The default value for the setting.
 * @property {any[]} [options] - Options for 'select' type settings.
 * @property {string} [dependsOn]
 * @property {any} [dependsOnValue]
 * @property {Setting[]} [children]
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
        this.activeView = { type: 'chat', id: null };
        /** @type {AbortController | null} */
        this.abortController = null;
        /** @type {string | null} */
        this.activeChatId = null;
        /** @type {ChatUI | null} */
        this.chatUI = null;
        /** @type {() => void} */
        this.debouncedSave = debounce(() => this.saveChats(), 500);
        /** @type {Object.<string, HTMLElement>} */
        this.dom = {};
        /** @type {Tab[]} */
        this.tabs = [];
        /** @type {Object.<string, any>} */
        this.currentSettings = {}; // Managed by SettingsManager, but app needs a reference
        /** @type {Setting[]} */
        this.settings = []; // Definitions managed by SettingsManager
        /** @type {SettingsManager} */
        this.settingsManager = null;

        this.registerCoreViews();
        this.defineTabs();
        this.initDOM();

        // --- Settings Management ---
        this.settingsManager = new SettingsManager(this);
        this.settingsManager.load();
        const coreSettings = [
            { id: 'apiUrl', label: 'API URL', type: 'text', default: '', placeholder: 'e.g. https://api.someai.com/', required: true },
            { id: 'apiKey', label: 'API Key', type: 'password', default: '' },
            { id: 'model', label: 'Model', type: 'select', options: [], required: true },
            { id: 'systemPrompt', label: 'System Prompt', type: 'textarea', default: 'You are a helpful assistant.', required: true },
            { id: 'temperature', label: 'Temperature', type: 'range', default: 1, min: 0, max: 2, step: 0.1 },
        ];
        this.settingsManager.define(coreSettings);
        // --- End Settings Management ---

        pluginManager.trigger('onAppInit', this);

        this.settingsManager.render();
        this.renderTabs();

        this.loadChats();

        this.activeView.id = this.activeChatId;
        this.renderMainView();

        this.initEventListeners();
        this.fetchModels();
    }

    registerCoreViews() {
        pluginManager.registerView('chat', (chatId) => `
            <div id="chat-container"></div>
            <div id="chat-area-controls"></div>
            <form id="message-form">
                <textarea id="message-input" placeholder="Type your message..." rows="3"></textarea>
                <button type="submit">Send</button>
                <button type="button" id="stop-button" style="display: none;">Stop</button>
            </form>
        `);
    }

    defineTabs() {
        const coreTabs = [{
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
        }];
        this.tabs = pluginManager.trigger('onTabsRegistered', coreTabs);
    }

    initDOM() {
        this.dom = {
            settingsContainer: document.getElementById('settings-container'),
            mainPanel: document.getElementById('main-panel'),
            panelTabs: document.getElementById('panel-tabs'),
            panelContent: document.getElementById('panel-content'),
        };
    }

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

    setView(type, id) {
        this.activeView = { type, id };
        if (type === 'chat') {
            this.activeChatId = id;
            localStorage.setItem('core_active_chat_id', this.activeChatId);
            this.updateActiveChatInList();
        }
        this.renderMainView();
    }

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
     * @param {string} tabId
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
     * @param {string} chatId
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
        const chatAreaControls = document.getElementById('chat-area-controls');
        if (chatAreaControls) {
            chatAreaControls.innerHTML = pluginManager.trigger('onChatAreaRender', '');
            pluginManager.trigger('onChatSwitched', chat);
        }
    }

    initEventListeners() {
        this.dom.panelTabs.addEventListener('click', (e) => {
            const tabId = e.target.dataset.tabId;
            if (tabId) {
                this.showTab(tabId);
            }
        });
    }

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
            this.createNewChat();
        }
    }

    saveChats() {
        const chatsToSave = this.chats.map(chat => ({
            id: chat.id,
            title: chat.title,
            log: chat.log.toJSON(),
        }));
        localStorage.setItem('core_chat_logs', JSON.stringify(chatsToSave));
        localStorage.setItem('core_active_chat_id', this.activeChatId);
    }

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
        this.saveChats();
    }

    deleteChat(chatId) {
        this.chats = this.chats.filter(c => c.id !== chatId);
        if (this.activeChatId === chatId) {
            const newActiveChat = this.chats.length > 0 ? this.chats[0] : null;
            if (newActiveChat) {
                this.setView('chat', newActiveChat.id);
            } else {
                this.createNewChat();
                return;
            }
        }
        this.renderChatList();
        this.saveChats();
    }

    renderChatList() {
        const chatListEl = document.getElementById('chat-list');
        if (!chatListEl) return;
        chatListEl.innerHTML = '';
        this.chats.forEach(chat => {
            const li = document.createElement('li');
            li.dataset.id = chat.id;
            li.innerHTML = `<span>${chat.title}</span><button class="delete-chat-button">X</button>`;
            chatListEl.appendChild(li);
        });
        this.updateActiveChatInList();
    }

    updateActiveChatInList() {
        const chatListEl = document.getElementById('chat-list');
        if (!chatListEl) return;
        chatListEl.querySelectorAll('li').forEach(item => {
            item.classList.toggle('active', item.dataset.id === this.activeChatId);
        });
    }

    getActiveChat() {
        return this.chats.find(c => c.id === this.activeChatId);
    }

    /**
     * Gets the effective API and model configuration based on the active agent.
     * If an agent is active and has custom model settings, they override the global settings.
     * The API URL and key are handled specially: if the agent defines a custom API URL,
     * only the agent's API key is used, even if it's empty.
     * @param {string|null} [agentId=null] - The ID of a specific agent to check. If null, checks the active agent for the current chat.
     * @returns {object} An object containing the effective settings (apiUrl, apiKey, model, temperature, etc.).
     */
    getEffectiveApiConfig(agentId = null) {
        const baseConfig = { ...this.currentSettings };
        const finalAgentId = agentId || this.agentManager?.getActiveAgentForChat(this.activeChatId);

        if (!finalAgentId || !this.agentManager) {
            return baseConfig;
        }

        const agent = this.agentManager.getAgent(finalAgentId);

        if (agent && agent.useCustomModelSettings) {
            const mergedConfig = { ...baseConfig, ...agent.modelSettings };

            // If the agent does NOT have a custom URL, we must revert to the base URL and key.
            // This prevents using the agent's key with the global URL.
            if (!agent.modelSettings.apiUrl) {
                mergedConfig.apiUrl = baseConfig.apiUrl;
                mergedConfig.apiKey = baseConfig.apiKey;
            }
            // If the agent DOES have a custom URL, the merged config is already correct,
            // as it will have the agent's apiUrl and apiKey (which could be undefined).

            return mergedConfig;
        }

        return baseConfig;
    }

    async fetchModels(targetSelectElement = null, agentId = null) {
        const effectiveConfig = this.getEffectiveApiConfig(agentId);
        const { apiUrl, apiKey } = effectiveConfig;

        if (!apiUrl) return;
        try {
            const models = await this.apiService.getModels(apiUrl, apiKey);
            const modelSelect = targetSelectElement || document.getElementById('setting-model');
            if (!modelSelect) return;

            const currentModelValue = modelSelect.value;
            modelSelect.innerHTML = '';
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.id;
                modelSelect.appendChild(option);
            });

            let optionToSelect = Array.from(modelSelect.options).find(opt => opt.value === currentModelValue);
            if (!optionToSelect && currentModelValue) {
                const newOption = document.createElement('option');
                newOption.value = currentModelValue;
                newOption.textContent = `${currentModelValue} (saved)`;
                modelSelect.appendChild(newOption);
                optionToSelect = newOption;
            }

            // After repopulating, try to set the correct value
            if (optionToSelect) {
                optionToSelect.selected = true;
            } else if (effectiveConfig.model && Array.from(modelSelect.options).some(opt => opt.value === effectiveConfig.model)) {
                // If the config's model exists in the new list, select it
                modelSelect.value = effectiveConfig.model;
            }

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
        const finalAgentId = agentId || this.agentManager.getActiveAgentForChat(activeChat.id);
        activeChat.log.addMessage({ role: 'assistant', content: null, agent: finalAgentId });
        responseProcessor.scheduleProcessing(this);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
