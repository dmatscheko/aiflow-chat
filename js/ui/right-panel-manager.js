/**
 * @fileoverview Manages the right-hand panel of the application, including its
 * tab system and the content panes associated with each tab. Plugins use this
 * manager to register their presence in the UI.
 */

'use strict';

import { createButton } from './ui-elements.js';
import { DataManager } from '../data-manager.js';
import { DEFAULT_AGENT_ID } from '../constants.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../plugin-manager.js').PluginManager} PluginManager
 */

/**
 * Defines the configuration for a list pane to be displayed in a tab.
 * @typedef {object} ListPaneConfig
 * @property {object} [manager] - The owning manager instance; receives a `listPane` property for API access.
 * @property {DataManager} dataManager - The manager for the data being displayed.
 * @property {string} viewType - The view type to activate when an item is selected.
 * @property {string} addNewButtonLabel - The text for the "Add New" button.
 * @property {() => object} onAddNew - Callback that creates a new item and returns it.
 * @property {(item: any) => string} getItemName - Function to get the display name of an item.
 * @property {(itemId: string, itemName: string) => boolean} [onDelete] - Optional callback to confirm deletion.
 * @property {Array<object> | () => Array<object>} [actions] - Optional actions for the pane footer.
 */

/**
 * Defines the configuration for a tab to be added to the right panel.
 * @typedef {object} TabConfig
 * @property {string} id - The unique identifier for the tab (e.g., 'chats', 'agents').
 * @property {string} label - The display label for the tab button.
 * @property {string} [viewType] - The view type associated with this tab, used for restoring state.
 * @property {boolean} [addAtStart=false] - Whether to add the tab at the beginning.
 * @property {ListPaneConfig} [listPane] - Configuration for a standard list pane in this tab.
 * @property {(pane: HTMLElement) => void} [onActivate] - A callback to run when the tab is activated, allowing for custom content rendering.
 */

/**
 * Manages the right-hand panel of the application, including its
 * tab system and the content panes associated with each tab.
 * @class
 */
export class RightPanelManager {
    /**
     * Creates an instance of RightPanelManager.
     * @constructor
     * @param {App} app - The main application instance.
     * @param {PluginManager} pluginManager - The application's plugin manager.
     */
    constructor(app, pluginManager) {
        this.app = app;
        this.pluginManager = pluginManager;
        this.tabs = [];
        this.listPanes = {}; // Cache for list pane instances
        this.isReady = false; // Flag to ensure onReady runs only once
        this.dom = {
            panelTabs: document.getElementById('panel-tabs'),
            panelContent: document.getElementById('panel-content'),
        };
    }

    /**
     * Registers a new tab in the right panel. Called by plugins.
     * @param {TabConfig} config - The configuration object for the tab.
     */
    registerTab(config) {
        if (config.addAtStart) {
            this.tabs.unshift(config);
        } else {
            this.tabs.push(config);
        }
    }

    /**
     * Renders the tabs and panes. This should be called after all plugins have registered.
     */
    render() {
        this.dom.panelTabs.innerHTML = '';
        this.dom.panelContent.innerHTML = '';

        this.tabs.forEach(tab => {
            const tabBtn = createButton(tab.label, {
                id: `tab-btn-${tab.id}`,
                className: 'tab-btn',
                dataset: { tabId: tab.id },
                onClick: () => this.app.showTab(tab.id),
            });
            this.dom.panelTabs.appendChild(tabBtn);

            const tabPane = document.createElement('div');
            tabPane.id = `${tab.id}-pane`;
            tabPane.className = 'tab-pane';
            this.dom.panelContent.appendChild(tabPane);
        });

        // Activate the first tab by default
        if (this.tabs.length > 0) {
            this.app.showTab(this.tabs[0].id);
        }
    }

    /**
     * Activates a specific tab, rendering its content.
     * @param {string} tabId - The ID of the tab to activate.
     */
    activateTab(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        const pane = document.getElementById(`${tab.id}-pane`);
        if (!pane) return;

        // Render content only if it hasn't been rendered yet
        if (!pane.innerHTML.trim()) {
            if (tab.listPane) {
                this.listPanes[tab.id] = this._createListPane(pane, tab.listPane);
            }
            if (tab.onActivate) {
                tab.onActivate(pane);
            }
        }

        // Trigger a hook for plugins to react to tab activation
        this.pluginManager.trigger('onTabActivated', tabId, this.listPanes[tab.id]);
    }

    /**
     * Creates a standardized list pane within a given container.
     * @param {HTMLElement} container - The parent element for the list pane.
     * @param {ListPaneConfig} config - The configuration for the list pane.
     * @returns {object} The API for the created list pane (e.g., to refresh it).
     * @private
     */
    _createListPane(container, config) {
        container.innerHTML = `
            <div class="list-pane">
                <ul class="item-list"></ul>
                <div class="list-pane-spacer"></div>
                <div class="list-pane-footer"></div>
            </div>`;

        const listEl = container.querySelector('.item-list');
        const footerEl = container.querySelector('.list-pane-footer');

        const trashSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"></path></svg>';
        const checkSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

        /** Cancels any open inline delete confirmation in this list. */
        const cancelConfirming = () => {
            listEl.querySelectorAll('.delete-actions.confirming').forEach(el => el.classList.remove('confirming'));
        };

        const renderList = () => {
            listEl.innerHTML = '';
            config.dataManager.getAll().forEach(item => {
                const li = document.createElement('li');
                li.className = 'list-item';
                li.dataset.id = item.id;

                const deleteHtml = (config.onDelete && item.id !== DEFAULT_AGENT_ID)
                    ? `<span class="delete-actions">` +
                      `<button class="delete-btn delete-trash" title="Delete">${trashSvg}</button>` +
                      `<button class="delete-btn delete-cancel" title="Cancel">&times;</button>` +
                      `<button class="delete-btn delete-confirm" title="Confirm delete">${checkSvg}</button>` +
                      `</span>`
                    : '';

                li.innerHTML = `<span class="list-item-label">${config.getItemName(item)}</span>${deleteHtml}`;
                listEl.appendChild(li);
            });
            updateActiveItem();
        };

        const renderActions = () => {
            footerEl.innerHTML = ''; // Clear previous actions
            if (config.addNewButtonLabel && config.onAddNew) {
                const addButton = createButton(config.addNewButtonLabel, {
                    className: 'add-new-button',
                    onClick: () => {
                        const newItem = config.onAddNew();
                        if (newItem) {
                            renderList();
                            this.app.setView(config.viewType, newItem.id);
                        }
                    },
                });
                footerEl.appendChild(addButton);
            }

            const currentActions = typeof config.actions === 'function' ? config.actions() : config.actions || [];
            if (currentActions.length > 0) {
                const actionsContainer = document.createElement('div');
                actionsContainer.className = 'list-pane-actions';
                currentActions.forEach(action => {
                    actionsContainer.appendChild(createButton(action.label, action));
                });
                footerEl.appendChild(actionsContainer);
            }
        };

        const updateActiveItem = () => {
            const activeId = this.app.activeView.type === config.viewType ? this.app.activeView.id : null;
            listEl.querySelectorAll('li').forEach(item => {
                item.classList.toggle('active', item.dataset.id === activeId);
            });
        };

        // Close any open delete confirmation when clicking anywhere outside.
        document.addEventListener('click', () => cancelConfirming());

        listEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.delete-btn');
            if (btn) {
                e.stopPropagation(); // Prevent item selection for all delete-related clicks.

                const actionsEl = btn.closest('.delete-actions');
                const itemEl = btn.closest('.list-item');
                if (!actionsEl || !itemEl) return;

                if (btn.classList.contains('delete-trash')) {
                    // Step 1: Show confirm / cancel buttons.
                    cancelConfirming(); // Close any other open confirmation first.
                    actionsEl.classList.add('confirming');
                    e.stopImmediatePropagation(); // Stop the document listener from immediately cancelling.
                } else if (btn.classList.contains('delete-cancel')) {
                    actionsEl.classList.remove('confirming');
                } else if (btn.classList.contains('delete-confirm')) {
                    // Step 2: Perform the actual deletion.
                    const itemId = itemEl.dataset.id;
                    const item = config.dataManager.get(itemId);
                    if (item && (!config.onDelete || config.onDelete(itemId, config.getItemName(item)))) {
                        config.dataManager.delete(itemId);
                        renderList();
                        if (this.app.activeView.id === itemId) {
                            const firstItem = config.dataManager.getAll()[0];
                            if (firstItem) {
                                this.app.setView(config.viewType, firstItem.id);
                            } else if (config.onAddNew) {
                                const newItem = config.onAddNew();
                                renderList();
                                this.app.setView(config.viewType, newItem.id);
                            }
                        }
                    }
                }
                return;
            }

            // Regular item click — select the item.
            const itemEl = e.target.closest('.list-item');
            if (!itemEl) return;
            cancelConfirming();
            this.app.setView(config.viewType, itemEl.dataset.id);
        });

        renderList();
        renderActions();

        const listPaneAPI = { renderList, renderActions, updateActiveItem };

        // Make the API accessible on the owning manager if one was provided.
        if (config.manager) {
            config.manager.listPane = listPaneAPI;
        }

        return listPaneAPI;
    }
}
