/**
 * @fileoverview Main application logic for AIFlow Chat.
 * This script serves as the central entry point for the application. It initializes all
 * core components, loads plugins, and orchestrates the overall application lifecycle,
 * including UI rendering, event handling, and state management.
 */

'use strict';

import { ApiService } from './api-service.js';
import { pluginManager } from './plugin-manager.js';
import { SettingsManager } from './settings-manager.js';
import { responseProcessor } from './response-processor.js';
import { RightPanelManager } from './ui/right-panel-manager.js';
import { TopPanelManager } from './ui/top-panel-manager.js';

// --- Plugin Loading ---
import './plugins/chats-plugin.js';
import './plugins/agents-plugin.js';
import './plugins/agents-call-plugin.js';
import './plugins/flows-plugin.js';
import './plugins/mcp-plugin.js';
import './plugins/formatting-plugin.js';
import './plugins/mobile-style-plugin.js';
import './plugins/custom-dropdown-plugin.js';
import './plugins/ui-controls-plugin.js';
import './plugins/autoresize-textarea-plugin.js';
import './plugins/token-counter-plugin.js';
// --- End Plugin Loading ---

/**
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./plugins/chats-plugin.js').Chat} Chat
 */

/**
 * Defines the structure for a declarative setting used by `createSettingsUI`.
 * @typedef {object} Setting
 * @property {string} id - The unique identifier for the setting (used as a key in the values object).
 * @property {string} label - The display label for the setting's input field.
 * @property {string} type - The input type (e.g., 'text', 'select', 'checkbox', 'fieldset').
 * @property {any} [default] - The default value for the setting.
 * @property {Array<{label: string, value: any}>|string[]} [options] - Options for 'select', 'radio-list', or 'checkbox-list' types.
 * @property {string} [dependsOn] - The ID of another setting that this setting's visibility depends on.
 * @property {any} [dependsOnValue] - The value the `dependsOn` setting must have for this setting to be visible.
 * @property {Setting[]} [children] - For 'fieldset' types, an array of nested setting definitions.
 */

/**
 * Defines the structure for a tab in the sidebar panel.
 * @typedef {object} Tab
 * @property {string} id - The unique identifier for the tab (e.g., 'chats', 'agents').
 * @property {string} label - The display label for the tab button.
 * @property {string} [viewType] - The view type associated with this tab, used for restoring the last active view.
 * @property {() => void} onActivate - A function to call when the tab is clicked and becomes active.
 */

/**
 * Represents the currently active view in the main application panel.
 * @typedef {object} View
 * @property {string} type - The type of the view (e.g., 'chat', 'agent-editor'). This corresponds to a registered view renderer.
 * @property {string | null} id - The unique identifier for the specific content being displayed (e.g., a chat ID or agent ID).
 */

/**
 * The main application class.
 * This class orchestrates all components of the chat application, including
 * services, managers, and UI elements. It follows a plugin-based architecture
 * where core functionality is extended by various plugins.
 * @class
 */
class App {
    /**
     * Initializes the application, sets up core services, and kicks off the
     * asynchronous initialization process.
     */
    constructor() {
        this.apiService = new ApiService();
        this.activeView = { type: 'chat', id: null };
        this.abortController = null;
        this.lastActiveIds = {};
        this.dom = {};
        this.settingsManager = new SettingsManager(this);
        this.responseProcessor = responseProcessor;

        pluginManager.app = this;

        // Initialize UI Managers
        this.rightPanelManager = new RightPanelManager(pluginManager);
        this.topPanelManager = new TopPanelManager(pluginManager);

        this.initDOM();

        // --- Managers will be attached by plugins ---
        this.chatManager = null;
        this.agentManager = null;
        this.flowManager = null;
        // --- End of Managers ---

        (async () => {
            await pluginManager.triggerAsync('onAppInit', this);
            pluginManager.trigger('onStart', this); // New hook for post-init setup

            this._loadLastActiveIds();

            const chats = this.chatManager.dataManager.getAll();
            const chatIds = Object.keys(chats);
            if (chatIds.length > 0) {
                this.setView('chat', chatIds[0]);
            } else {
                const newChat = this.chatManager.createNewChat();
                this.setView('chat', newChat.id);
            }

            await this.renderMainView();
            pluginManager.trigger('onViewRendered');
            this.initEventListeners();
        })();
    }

    /**
     * Caches references to key DOM elements.
     * @private
     */
    initDOM() {
        this.dom = {
            mainPanel: document.getElementById('main-panel'),
            rightPanel: document.getElementById('right-panel'),
            topPanel: document.getElementById('top-panel'),
            // Add other commonly accessed elements as needed
        };
    }

    /**
     * Sets the active view for the main panel, saves the state, and triggers a re-render.
     * @param {string} type - The type of view to set (e.g., 'chat').
     * @param {string} id - The ID of the content for the view (e.g., a chat ID).
     * @async
     */
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

    /**
     * Renders the main content panel using the renderer function registered for the active view type.
     * It then triggers the `onViewRendered` hook to allow plugins to modify the rendered view.
     * @async
     */
    async renderMainView() {
        const { type, id } = this.activeView;
        const renderer = pluginManager.getViewRenderer(type);
        if (renderer) {
            const content = renderer(id);
            this.dom.mainPanel.innerHTML = ''; // Clear previous content
            if (typeof content === 'string') {
                this.dom.mainPanel.innerHTML = content;
            } else if (content instanceof HTMLElement) {
                this.dom.mainPanel.appendChild(content);
            }
            const activeChat = this.chatManager ? this.chatManager.getActiveChat() : null;
            await pluginManager.triggerAsync('onViewRendered', this.activeView, activeChat);
        } else {
            this.dom.mainPanel.innerHTML = `<h2>Error: View type "${type}" not found.</h2>`;
        }
    }

    /**
     * Handles the logic for switching between sidebar tabs, activating the correct
     * tab and pane, and calling the tab's `onActivate` function.
     * @param {string} tabId - The ID of the tab to show.
     * @private
     * @async
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

    /**
     * Initializes global event listeners for the application.
     * @private
     */
    initEventListeners() {
        // Listener for sidebar tab clicks.
        this.dom.panelTabs.addEventListener('click', async (e) => {
            const tabId = e.target.dataset.tabId;
            if (tabId) {
                await this.showTab(tabId);
            }
        });

        // Global keydown listener for the Escape key to abort chat generation.
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Only act if a chat is the active view.
                if (this.activeView.type !== 'chat' || !this.activeView.id) {
                    return;
                }

                // If an in-place editor is active, let its local handler manage the Escape key.
                if (document.querySelector('.edit-in-place, .edit-in-place-input')) {
                    return;
                }

                // Otherwise, stop any active chat flow.
                if (this.chatManager) {
                    this.chatManager.stopChatFlow();
                }
            }
        });
    }

    /**
     * Loads the last active ID for each view type from local storage.
     * @private
     */
    _loadLastActiveIds() {
        try {
            const ids = localStorage.getItem('core_last_active_ids');
            this.lastActiveIds = ids ? JSON.parse(ids) : {};
        } catch (e) {
            console.error('Failed to load last active IDs:', e);
            this.lastActiveIds = {};
        }
    }

    /**
     * Saves the map of last active IDs to local storage.
     * @private
     */
    _saveLastActiveIds() {
        localStorage.setItem('core_last_active_ids', JSON.stringify(this.lastActiveIds));
    }
}

// Instantiate the App class once the DOM is fully loaded.
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
