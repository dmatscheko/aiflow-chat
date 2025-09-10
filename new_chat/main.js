/**
 * @fileoverview Main application logic for the Core Chat.
 * This script ties together the data, API, and UI components.
 */

'use strict';

import { ChatLog } from './chat-data.js';
import { ApiService } from './api-service.js';
import { pluginManager } from './plugin-manager.js';
import { debounce } from './utils.js';
import { SettingsManager } from './settings-manager.js';

// Load plugins
import './plugins/chat-plugin.js';
import './plugins/example-plugin.js';
import './plugins/agents-plugin.js';
import './plugins/flows-plugin.js';
import './plugins/mcp-plugin.js';
import './plugins/formatting-plugin.js';
import './plugins/title-bar-plugin.js';

/**
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {object} Chat
 * @property {string} id - The unique identifier for the chat.
 * @property {string} title - The title of the chat.
 * @property {ChatLog} log - The ChatLog instance for the chat.
 * @property {string} draftMessage - The current draft message.
 * @property {string | null} agent - The ID of the active agent.
 * @property {string | null} flow - The ID of the active flow.
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
 * @property {string} [viewType] - The associated view type to restore.
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
        /** @type {Object.<string, string>} */
        this.lastActiveIds = {};
        /** @type {() => void} */
        this.debouncedSave = debounce(() => this.saveChats(), 500);
        /** @type {Object.<string, HTMLElement>} */
        this.dom = {};
        /** @type {Tab[]} */
        this.tabs = [];
        /** @type {Object.<string, any>} */
        /** @type {SettingsManager} */
        this.settingsManager = null;

        this.initDOM();

        // --- Settings Management ---
        this.settingsManager = new SettingsManager(this);
        // --- End Settings Management ---

        // Initial async setup
        (async () => {
            await pluginManager.triggerAsync('onAppInit', this);
            this.defineTabs();
            this.renderTabs();
            this._loadLastActiveIds();
            this.loadChats();
            this.activeView.id = this.activeChatId;
            await this.renderMainView();
            this.initEventListeners();
        })();
    }

    defineTabs() {
        const coreTabs = [];
        this.tabs = pluginManager.trigger('onTabsRegistered', coreTabs);
    }

    initDOM() {
        this.dom = {
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

    async setView(type, id) {
        this.activeView = { type, id };
        this.lastActiveIds[type] = id;
        this._saveLastActiveIds();

        if (type === 'chat') {
            this.activeChatId = id;
            // The active chat ID is also saved in saveChats, but we save here
            // to ensure it's updated immediately on view change.
            localStorage.setItem('core_active_chat_id', this.activeChatId);
            this.updateActiveChatInList();
        }
        await this.renderMainView();
    }

    async renderMainView() {
        const { type, id } = this.activeView;
        const renderer = pluginManager.getViewRenderer(type);
        if (renderer) {
            this.dom.mainPanel.innerHTML = renderer(id);
            await pluginManager.triggerAsync('onViewRendered', this.activeView, this.getActiveChat());
        } else {
            this.dom.mainPanel.innerHTML = `<h2>Error: View type "${type}" not found.</h2>`;
        }
    }

    /**
     * @param {string} tabId
     * @private
     */
    async showTab(tabId) {
        if (!tabId) return;
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        // Update button and pane visibility first
        this.dom.panelTabs.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        this.dom.panelContent.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        const tabBtn = document.getElementById(`tab-btn-${tabId}`);
        const tabPane = document.getElementById(`${tabId}-pane`);
        if (tabBtn) tabBtn.classList.add('active');
        if (tabPane) tabPane.classList.add('active');

        // Always call onActivate to ensure the pane's HTML is created.
        if (tab.onActivate) {
            tab.onActivate();
        }

        // Then, if a last active view exists for this tab's type, restore it.
        const lastActiveId = tab.viewType ? this.lastActiveIds[tab.viewType] : null;
        if (lastActiveId) {
            await this.setView(tab.viewType, lastActiveId);
        }
    }

    initEventListeners() {
        this.dom.panelTabs.addEventListener('click', async (e) => {
            const tabId = e.target.dataset.tabId;
            if (tabId) {
                await this.showTab(tabId);
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
                    draftMessage: chatData.draftMessage || '',
                    agent: chatData.agent || null,
                    flow: chatData.flow || null,
                };
                chat.log.subscribe(this.debouncedSave);
                return chat;
            });
            this.activeChatId = localStorage.getItem('core_active_chat_id') || this.chats[0].id;
            this.renderChatList();
        } else {
            this.createNewChat();
        }
    }

    saveChats() {
        const chatsToSave = this.chats.map(chat => ({
            id: chat.id,
            title: chat.title,
            log: chat.log.toJSON(),
            draftMessage: chat.draftMessage,
            agent: chat.agent,
            flow: chat.flow,
        }));
        localStorage.setItem('core_chat_logs', JSON.stringify(chatsToSave));
        localStorage.setItem('core_active_chat_id', this.activeChatId);
    }

    /** @private */
    _loadLastActiveIds() {
        try {
            const ids = localStorage.getItem('core_last_active_ids');
            this.lastActiveIds = ids ? JSON.parse(ids) : {};
        } catch (e) {
            console.error('Failed to load last active IDs:', e);
            this.lastActiveIds = {};
        }
    }

    /** @private */
    _saveLastActiveIds() {
        localStorage.setItem('core_last_active_ids', JSON.stringify(this.lastActiveIds));
    }

    createNewChat() {
        const newChat = {
            id: `chat-${Date.now()}`,
            title: 'New Chat',
            log: new ChatLog(),
            draftMessage: '',
            agent: null,
            flow: null,
        };
        newChat.log.subscribe(this.debouncedSave);
        this.chats.push(newChat);
        this.renderChatList();
        this.setView('chat', newChat.id);
        this.saveChats();
    }

    createChatFromData(chatData) {
        const newChat = {
            id: `chat-${Date.now()}`,
            title: chatData.title || 'Imported Chat',
            log: ChatLog.fromJSON(chatData.log),
            draftMessage: chatData.draftMessage || '',
            agent: chatData.agent || null,
            flow: chatData.flow || null,
        };
        newChat.log.subscribe(this.debouncedSave);
        this.chats.push(newChat);
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
            li.className = 'list-item';
            li.dataset.id = chat.id;
            li.innerHTML = `<span>${chat.title}</span><button class="delete-button">X</button>`;
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
     * Handles the submission of the message form.
     * This now delegates the call to the chat plugin.
     * @param {object} [options={}] - Options for the submission.
     * @private
     */
    handleFormSubmit(options = {}) {
        const chatPlugin = pluginManager.getPlugin('Chat');
        if (chatPlugin && chatPlugin.handleFormSubmit) {
            chatPlugin.handleFormSubmit(options);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
