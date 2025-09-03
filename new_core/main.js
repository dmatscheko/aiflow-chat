/**
 * @fileoverview Main application logic for the Core Chat.
 * This script ties together the data, API, and UI components.
 */

'use strict';

import { ChatLog } from './chat-data.js';
import { ApiService } from './api-service.js';
import { ChatUI } from './chat-ui.js';

class App {
    constructor() {
        this.apiService = new ApiService();
        this.chats = [];
        this.activeChatId = null;
        this.abortController = null;

        this.initDOM();
        this.chatUI = new ChatUI(this.dom.chatContainer);

        this.loadSettings();
        this.loadChats();

        this.initEventListeners();

        this.renderChatList();
        this.switchChat(this.activeChatId);
        this.fetchModels();
    }

    initDOM() {
        this.dom = {
            // Settings
            apiUrlInput: document.getElementById('api-url'),
            apiKeyInput: document.getElementById('api-key'),
            modelSelect: document.getElementById('model-select'),
            refreshModelsBtn: document.getElementById('refresh-models'),
            systemPromptInput: document.getElementById('system-prompt'),
            temperatureInput: document.getElementById('temperature'),
            temperatureValue: document.getElementById('temperature-value'),
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

    initEventListeners() {
        // Settings
        this.dom.apiUrlInput.addEventListener('change', () => this.saveSettings());
        this.dom.apiKeyInput.addEventListener('change', () => this.saveSettings());
        this.dom.modelSelect.addEventListener('change', () => this.saveSettings());
        this.dom.systemPromptInput.addEventListener('change', () => this.saveSettings());
        this.dom.temperatureInput.addEventListener('input', () => {
            this.dom.temperatureValue.textContent = this.dom.temperatureInput.value;
        });
        this.dom.temperatureInput.addEventListener('change', () => this.saveSettings());
        this.dom.refreshModelsBtn.addEventListener('click', () => this.fetchModels());

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
        const settings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};
        this.dom.apiUrlInput.value = settings.apiUrl || 'https://api.openai.com/';
        this.dom.apiKeyInput.value = settings.apiKey || '';
        this.dom.systemPromptInput.value = settings.systemPrompt || 'You are a helpful assistant.';
        this.dom.temperatureInput.value = settings.temperature || '1';
        this.dom.temperatureValue.textContent = settings.temperature || '1';
        // Note: Model is loaded after fetching
    }

    saveSettings() {
        const settings = {
            apiUrl: this.dom.apiUrlInput.value,
            apiKey: this.dom.apiKeyInput.value,
            model: this.dom.modelSelect.value,
            systemPrompt: this.dom.systemPromptInput.value,
            temperature: this.dom.temperatureInput.value,
        };
        localStorage.setItem('core_chat_settings', JSON.stringify(settings));
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
        const apiUrl = this.dom.apiUrlInput.value;
        const apiKey = this.dom.apiKeyInput.value;
        if (!apiUrl) {
            alert('Please enter an API URL.');
            return;
        }
        try {
            const models = await this.apiService.getModels(apiUrl, apiKey);
            this.dom.modelSelect.innerHTML = '';
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.id;
                this.dom.modelSelect.appendChild(option);
            });
            const savedSettings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};
            if (savedSettings.model) {
                this.dom.modelSelect.value = savedSettings.model;
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

            const payload = {
                model: settings.model,
                messages: messages.slice(0, -1), // Exclude the placeholder
                stream: true,
                temperature: parseFloat(settings.temperature)
            };

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
