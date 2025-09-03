/**
 * @fileoverview Main application logic for the Core Chat.
 * This script ties together the data, API, and UI components.
 */

'use strict';

import { ChatLog } from './chat-data.js';
import { ApiService } from './api-service.js';
import { ChatUI } from './chat-ui.js';
import { pluginManager } from './plugin-manager.js';

// Load plugins
import './plugins/example-plugin.js';
import './plugins/agents-plugin.js';
import './plugins/flow-plugin.js';

class App {
    constructor() {
        this.apiService = new ApiService();
        this.chats = [];
        this.activeChatId = null;
        this.abortController = null;

        pluginManager.trigger('onAppInit', this);

        this.defineSettings();
        this.defineTabs();
        this.initDOM();

        this.renderSettings();
        this.renderTabs();

        // Let plugins render chat area controls
        this.dom.chatAreaControls.innerHTML = pluginManager.trigger('onChatAreaRender', '');


        this.chatUI = new ChatUI(this.dom.chatContainer);

        this.loadSettings();
        this.loadChats();

        this.initEventListeners();

        this.renderChatList();
        this.switchChat(this.activeChatId);
        this.fetchModels();
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
                render: () => `
                    <div id="chat-list-pane" class="tab-pane">
                        <ul id="chat-list"></ul>
                        <button id="new-chat-button">New Chat</button>
                    </div>
                `
            }
        ];
        this.tabs = pluginManager.trigger('onTabsRegistered', coreTabs);
    }

    initDOM() {
        this.dom = {
            settingsContainer: document.getElementById('settings-container'),
            // Chat
            chatContainer: document.getElementById('chat-container'),
            chatAreaControls: document.getElementById('chat-area-controls'),
            messageForm: document.getElementById('message-form'),
            messageInput: document.getElementById('message-input'),
            stopButton: document.getElementById('stop-button'),
            // Right Panel
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
            tabPane.innerHTML = tab.render();
            this.dom.panelContent.appendChild(tabPane);
        });

        // Store dynamic DOM references for chat list
        this.dom.chatList = document.getElementById('chat-list');
        this.dom.newChatButton = document.getElementById('new-chat-button');

        // Activate the first tab by default
        this.dom.panelTabs.querySelector('.tab-btn').classList.add('active');
        this.dom.panelContent.querySelector('.tab-pane').classList.add('active');
    }

    initEventListeners() {
        // Settings
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

        // Tabs
        this.dom.panelTabs.addEventListener('click', (e) => {
            const tabId = e.target.dataset.tabId;
            if (tabId) {
                this.dom.panelTabs.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                this.dom.panelContent.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

                e.target.classList.add('active');
                document.getElementById(`${tabId}-pane`).classList.add('active');
            }
        });

        // Chat
        this.dom.messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFormSubmit();
        });
        this.dom.stopButton.addEventListener('click', () => {
            if (this.abortController) {
                this.abortController.abort();
            }
        });

        // Chat List
        this.dom.newChatButton.addEventListener('click', () => this.createNewChat());
        this.dom.chatList.addEventListener('click', (e) => {
            const target = e.target;
            if (target.closest('li')) {
                this.switchChat(target.closest('li').dataset.id);
            }
            if (target.classList.contains('delete-chat-button')) {
                e.stopPropagation();
                this.deleteChat(target.parentElement.dataset.id);
            }
        });
    }

    // --- Settings Management ---
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

    // --- Chat Management ---
    loadChats() {
        const savedChats = JSON.parse(localStorage.getItem('core_chat_logs'));
        if (savedChats && savedChats.length > 0) {
            this.chats = savedChats.map(chatData => ({
                id: chatData.id,
                title: chatData.title,
                log: ChatLog.fromJSON(chatData.log),
            }));
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
        this.chats.unshift(newChat);
        this.activeChatId = newChat.id;
        this.renderChatList();
        this.switchChat(newChat.id);
        this.saveChats();
    }

    switchChat(chatId) {
        const chat = this.chats.find(c => c.id === chatId);
        if (chat) {
            this.activeChatId = chatId;
            this.chatUI.setChatLog(chat.log);
            this.updateActiveChatInList();
            localStorage.setItem('core_active_chat_id', this.activeChatId);
            pluginManager.trigger('onChatSwitched', chat);
        }
    }

    deleteChat(chatId) {
        this.chats = this.chats.filter(c => c.id !== chatId);
        if (this.activeChatId === chatId) {
            this.activeChatId = this.chats.length > 0 ? this.chats[0].id : null;
            if (this.activeChatId) {
                this.switchChat(this.activeChatId);
            } else {
                this.createNewChat();
            }
        }
        this.renderChatList();
        this.saveChats();
    }

    renderChatList() {
        if (!this.dom.chatList) return;
        this.dom.chatList.innerHTML = '';
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

            this.dom.chatList.appendChild(li);
        });
        this.updateActiveChatInList();
    }

    updateActiveChatInList() {
        if (!this.dom.chatList) return;
        const chatItems = this.dom.chatList.querySelectorAll('li');
        chatItems.forEach(item => {
            item.classList.toggle('active', item.dataset.id === this.activeChatId);
        });
    }

    getActiveChat() {
        return this.chats.find(c => c.id === this.activeChatId);
    }

    // --- Core Logic ---
    async fetchModels() {
        const apiUrl = this.dom.settings.apiUrl.value;
        const apiKey = this.dom.settings.apiKey.value;
        if (!apiUrl) {
            alert('Please enter an API URL.');
            return;
        }
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

    async handleFormSubmit() {
        const userInput = this.dom.messageInput.value.trim();
        if (!userInput) return;

        const activeChat = this.getActiveChat();
        if (!activeChat) return;

        activeChat.log.addMessage({ role: 'user', content: userInput });
        this.dom.messageInput.value = '';

        const assistantMsg = activeChat.log.addMessage({ role: 'assistant', content: '...' });

        this.dom.stopButton.style.display = 'block';
        this.abortController = new AbortController();

        try {
            const settings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};
            const messages = activeChat.log.getActiveMessageValues();

            if (settings.systemPrompt) {
                messages.unshift({ role: 'system', content: settings.systemPrompt });
            }

            let payload = {
                model: settings.model,
                messages: messages.slice(0, -1),
                stream: true,
                temperature: parseFloat(settings.temperature)
            };

            payload = pluginManager.trigger('beforeApiCall', payload, settings);

            const reader = await this.apiService.streamChat(
                payload,
                settings.apiUrl,
                settings.apiKey,
                this.abortController.signal
            );

            assistantMsg.value.content = '';
            activeChat.log.notify();

            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                const deltas = lines
                    .map(line => line.replace(/^data: /, '').trim())
                    .filter(line => line !== '' && line !== '[DONE]')
                    .map(line => JSON.parse(line))
                    .map(json => json.choices[0].delta.content)
                    .filter(content => content);

                if (deltas.length > 0) {
                    assistantMsg.value.content += deltas.join('');
                    activeChat.log.notify();
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                assistantMsg.value.content = `Error: ${error.message}`;
            } else {
                 assistantMsg.value.content += '\n\n[Aborted by user]';
            }
            activeChat.log.notify();
        } finally {
            this.abortController = null;
            this.dom.stopButton.style.display = 'none';
            if(activeChat.title === 'New Chat') {
                const firstUserMessage = activeChat.log.getActiveMessageValues().find(m => m.role === 'user');
                if(firstUserMessage) {
                    activeChat.title = firstUserMessage.content.substring(0, 20) + '...';
                }
            }
            this.saveChats();
            this.renderChatList();
            pluginManager.trigger('onResponseComplete', assistantMsg, activeChat);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
