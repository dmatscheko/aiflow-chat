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

class App {
    constructor() {
        this.apiService = new ApiService();
        this.chats = [];
        this.activeChatId = null;
        this.abortController = null;

        // Allow plugins to register themselves
        pluginManager.trigger('onAppInit', this);

        this.defineSettings();
        this.initDOM();
        this.renderSettings();

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

    initDOM() {
        this.dom = {
            settingsContainer: document.getElementById('settings-container'),
            // Chat
            chatContainer: document.getElementById('chat-container'),
            messageForm: document.getElementById('message-form'),
            messageInput: document.getElementById('message-input'),
            stopButton: document.getElementById('stop-button'),
            // Chat List
            chatList: document.getElementById('chat-list'),
            newChatButton: document.getElementById('new-chat-button'),
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
                // Options will be populated later
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
                input.type = setting.type;
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

        // Store dynamic element references
        this.dom.settings = {};
        this.settings.forEach(s => {
            this.dom.settings[s.id] = document.getElementById(`setting-${s.id}`);
        });
    }

    initEventListeners() {
        // Settings
        this.settings.forEach(setting => {
            const inputEl = this.dom.settings[setting.id];
            inputEl.addEventListener('change', () => this.saveSettings());
            if (setting.type === 'range') {
                const valueSpan = document.getElementById(`setting-${setting.id}-value`);
                inputEl.addEventListener('input', () => {
                    valueSpan.textContent = inputEl.value;
                });
            }
        });
        document.getElementById('refresh-models').addEventListener('click', () => this.fetchModels());


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
            if (target.dataset.id) {
                this.switchChat(target.dataset.id);
            }
            if (target.classList.contains('delete-chat-button')) {
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
        this.dom.chatList.innerHTML = '';
        this.chats.forEach(chat => {
            const li = document.createElement('li');
            li.dataset.id = chat.id;
            li.textContent = chat.title;

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'X';
            deleteBtn.classList.add('delete-chat-button');
            li.appendChild(deleteBtn);

            this.dom.chatList.appendChild(li);
        });
        this.updateActiveChatInList();
    }

    updateActiveChatInList() {
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

        // Add a placeholder for the assistant's response
        const assistantMsg = activeChat.log.addMessage({ role: 'assistant', content: '...' });

        this.dom.stopButton.style.display = 'block';
        this.abortController = new AbortController();

        try {
            const settings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};
            const messages = activeChat.log.getActiveMessageValues();

            // Add system prompt if it exists
            if (settings.systemPrompt) {
                messages.unshift({ role: 'system', content: settings.systemPrompt });
            }

            let payload = {
                model: settings.model,
                messages: messages.slice(0, -1), // Exclude the placeholder
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

            assistantMsg.value.content = ''; // Clear placeholder
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
                    activeChat.log.notify(); // Update UI with new content
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
            // Update chat title
            if(activeChat.title === 'New Chat') {
                const firstUserMessage = activeChat.log.getActiveMessageValues().find(m => m.role === 'user');
                if(firstUserMessage) {
                    activeChat.title = firstUserMessage.content.substring(0, 20) + '...';
                }
            }
            this.saveChats();
            this.renderChatList();
        }
    }
}

// Initialize the application once the DOM is fully loaded.
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
