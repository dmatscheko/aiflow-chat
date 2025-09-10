/**
 * @fileoverview Main application logic for the Core Chat.
 * This script ties together the data, API, and UI components.
 */

'use strict';

import { ApiService } from './api-service.js';
import { pluginManager } from './plugin-manager.js';
import { SettingsManager } from './settings-manager.js';

// Load plugins
import './plugins/chats-plugin.js';
import './plugins/example-plugin.js';
import './plugins/agents-plugin.js';
import './plugins/flows-plugin.js';
import './plugins/mcp-plugin.js';
import './plugins/formatting-plugin.js';
import './plugins/title-bar-plugin.js';
import './plugins/mobile-style-plugin.js';

/**
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./plugins/chats-plugin.js').Chat} Chat
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
        /** @type {View} */
        this.activeView = { type: 'chat', id: null };
        /** @type {AbortController | null} */
        this.abortController = null;
        /** @type {Object.<string, string>} */
        this.lastActiveIds = {};
        /** @type {Object.<string, HTMLElement>} */
        this.dom = {};
        /** @type {Tab[]} */
        this.tabs = [];
        /** @type {SettingsManager} */
        this.settingsManager = null;

        this.initDOM();

        // --- Managers will be attached by plugins ---
        /** @type {import('./plugins/chats-plugin.js').ChatManager | null} */
        this.chatManager = null;
        /** @type {import('./plugins/agents-plugin.js').AgentManager | null} */
        this.agentManager = null;
        // --- End of Managers ---


        // --- Settings Management ---
        this.settingsManager = new SettingsManager(this);
        // --- End Settings Management ---

        // Initial async setup
        (async () => {
            await pluginManager.triggerAsync('onAppInit', this);
            this.defineTabs();
            this.renderTabs();
            this._loadLastActiveIds();
            if (this.chatManager) {
                this.chatManager.init();
            }
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
        if (this.tabs.length > 0) {
            this.dom.panelTabs.querySelector('.tab-btn').classList.add('active');
            this.dom.panelContent.querySelector('.tab-pane').classList.add('active');
            this.tabs[0].onActivate();
        }
    }

    async setView(type, id) {
        this.activeView = { type, id };
        this.lastActiveIds[type] = id;
        this._saveLastActiveIds();

        if (type === 'chat' && this.chatManager) {
            this.chatManager.activeChatId = id;
            localStorage.setItem('core_active_chat_id', this.chatManager.activeChatId);
            this.chatManager.updateActiveChatInList();
        }
        await this.renderMainView();
    }

    async renderMainView() {
        const { type, id } = this.activeView;
        const renderer = pluginManager.getViewRenderer(type);
        if (renderer) {
            this.dom.mainPanel.innerHTML = renderer(id);
            const activeChat = this.chatManager ? this.chatManager.getActiveChat() : null;
            await pluginManager.triggerAsync('onViewRendered', this.activeView, activeChat);
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

        this.dom.panelTabs.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        this.dom.panelContent.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        const tabBtn = document.getElementById(`tab-btn-${tabId}`);
        const tabPane = document.getElementById(`${tabId}-pane`);
        if (tabBtn) tabBtn.classList.add('active');
        if (tabPane) tabPane.classList.add('active');

        if (tab.onActivate) {
            tab.onActivate();
        }

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
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
