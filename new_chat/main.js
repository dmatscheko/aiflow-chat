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

// Load plugins
import './plugins/example-plugin.js';
import './plugins/agents-plugin.js';
import './plugins/flows-plugin.js';
import './plugins/mcp-plugin.js';
import './plugins/formatting-plugin.js';

class App {
    constructor() {
        this.apiService = new ApiService();
        this.chats = [];
        this.activeView = { type: 'chat', id: null }; // Default view
        this.abortController = null;

        this.registerCoreViews();
        pluginManager.trigger('onAppInit', this);

        this.defineSettings();
        this.defineTabs();
        this.initDOM();

        this.renderSettings();
        this.renderTabs();

        this.loadSettings();
        this.debouncedSave = debounce(() => this.saveChats(), 500);
        this.loadChats(); // This will set the initial active chat id

        // Set initial view
        this.activeView.id = this.activeChatId;
        this.renderMainView();

        this.initEventListeners();
        this.fetchModels();
    }

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

    initDOM() {
        this.dom = {
            settingsContainer: document.getElementById('settings-container'),
            mainPanel: document.getElementById('main-panel'),
            panelTabs: document.getElementById('panel-tabs'),
            panelContent: document.getElementById('panel-content'),
        };
    }

    renderSettings() {
        this.dom.settingsContainer.innerHTML = '';
        this.settings.forEach(setting => {
            const el = document.createElement('div');
            el.classList.add('setting');
            const label = document.createElement('label');
            label.setAttribute('for', `setting-${setting.id}`);
            label.textContent = setting.label;
            el.appendChild(label);

            let input;
            if (setting.type === 'textarea') {
                input = document.createElement('textarea');
                input.rows = 4;
            } else if (setting.type === 'select') {
                input = document.createElement('select');
            } else if (setting.type === 'range') {
                input = document.createElement('input');
                input.type = 'range';
                input.min = setting.min;
                input.max = setting.max;
                input.step = setting.step;
                const valueSpan = document.createElement('span');
                valueSpan.id = `setting-${setting.id}-value`;
                valueSpan.textContent = setting.default;
                el.appendChild(valueSpan);
            }
            else {
                input = document.createElement('input');
                input.type = setting.type || 'text';
                if(setting.placeholder) input.placeholder = setting.placeholder;
            }

            input.id = `setting-${setting.id}`;
            input.value = setting.default;
            el.appendChild(input);

            if (setting.id === 'model') {
                const refreshBtn = document.createElement('button');
                refreshBtn.id = 'refresh-models';
                refreshBtn.textContent = 'Refresh';
                el.appendChild(refreshBtn);
            }
            this.dom.settingsContainer.appendChild(el);
        });

        this.dom.settings = {};
        this.settings.forEach(s => {
            this.dom.settings[s.id] = document.getElementById(`setting-${s.id}`);
        });
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
        console.log('Setting view to', this.activeView);
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

    initEventListeners() {
        this.settings.forEach(setting => {
            const inputEl = this.dom.settings[setting.id];
            if(inputEl) {
                inputEl.addEventListener('change', () => this.saveSettings());
                if (setting.type === 'range') {
                    const valueSpan = document.getElementById(`setting-${setting.id}-value`);
                    inputEl.addEventListener('input', () => {
                        if(valueSpan) valueSpan.textContent = inputEl.value;
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
        this.saveChats(); // Save immediately to create the entry
    }

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

    updateActiveChatInList() {
        const chatListEl = document.getElementById('chat-list');
        if (!chatListEl) return;
        const chatItems = chatListEl.querySelectorAll('li');
        chatItems.forEach(item => {
            item.classList.toggle('active', item.dataset.id === this.activeChatId);
        });
    }

    getActiveChat() {
        return this.chats.find(c => c.id === this.activeChatId);
    }

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

    async handleFormSubmit(options = {}) {
        const { isContinuation = false, agentId = null } = options;
        const activeChat = this.getActiveChat();
        if (!activeChat) return;

        // Determine the agent to use: the override, the chat's active agent, or null.
        const finalAgentId = agentId || this.agentManager.getActiveAgentForChat(activeChat.id);

        if (!isContinuation) {
            const userInput = this.dom.messageInput.value.trim();
            if (!userInput) return;
            activeChat.log.addMessage({ role: 'user', content: userInput, agent: finalAgentId });
            this.dom.messageInput.value = '';
        }

        // Add a placeholder message with the same agent context.
        const assistantMsg = activeChat.log.addMessage({ role: 'assistant', content: null, agent: finalAgentId });

        // Schedule the response processor to find and process the new placeholder.
        responseProcessor.scheduleProcessing(this);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
