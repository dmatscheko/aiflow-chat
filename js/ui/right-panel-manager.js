/**
 * @fileoverview Manages the right-hand panel, including its tab system and pane content.
 * This module is responsible for registering, rendering, and handling the interactions
 * of the various tabs (like Chats, Agents, Flows) that plugins provide.
 */

'use strict';

import { createElement, createButton } from './ui-elements.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../plugin-manager.js').PluginManager} PluginManager
 * @typedef {import('../data-manager.js').DataManager} DataManager
 */

/**
 * Defines the configuration for a tab to be registered with the RightPanelManager.
 * @typedef {object} TabConfig
 * @property {string} id - The unique identifier for the tab (e.g., 'chats', 'agents').
 * @property {string} label - The display label for the tab button.
 * @property {string} viewType - The view type associated with this tab, for restoring the last active view.
 * @property {boolean} [addAtStart=false] - If true, the tab will be added to the beginning of the list.
 * @property {(pane: HTMLElement) => void} onActivate - A function to call when the tab is activated.
 *        It receives the tab's content pane element as an argument, which it is responsible for populating.
 */

/**
 * Represents a List Pane instance, which is a common UI pattern for the sidebar tabs.
 * @typedef {object} ListPane
 * @property {HTMLElement} element - The root HTML element of the list pane component.
 * @property {() => void} updateActiveItem - Function to visually update the active item in the list.
 * @property {() => void} renderList - Function to re-render the list of items.
 * @property {() => void} renderActions - Function to re-render the action buttons in the footer.
 */

/**
 * Manages the right-hand panel of the application.
 * @class
 */
export class RightPanelManager {
    /**
     * @param {App} app - The main application instance.
     * @param {PluginManager} pluginManager - The application's plugin manager.
     */
    constructor(app, pluginManager) {
        this.app = app;
        this.pluginManager = pluginManager;
        this.tabs = [];
        this.dom = {
            panelTabs: document.getElementById('panel-tabs'),
            panelContent: document.getElementById('panel-content'),
        };
        this.isReady = false; // Flag to prevent multiple renders
    }

    /**
     * Registers a new tab to be displayed in the right panel.
     * This method is typically called by plugins.
     * @param {TabConfig} config - The configuration for the tab.
     */
    registerTab(config) {
        if (config.addAtStart) {
            this.tabs.unshift(config);
        } else {
            this.tabs.push(config);
        }
    }

    /**
     * Renders the tabs and their corresponding panes. This should only be called once
     * the DOM is ready, typically from an `onViewRendered` or `onAppInit` hook.
     */
    render() {
        if (this.isReady || !this.dom.panelTabs || !this.dom.panelContent) return;

        this.pluginManager.trigger('onRegisterRightPanelTabs', this);

        this.tabs.forEach(tab => {
            const tabBtn = createButton(tab.label, {
                id: `tab-btn-${tab.id}`,
                className: 'tab-btn',
                attributes: { 'data-tab-id': tab.id },
                events: {
                    click: () => this.showTab(tab.id),
                },
            });
            this.dom.panelTabs.appendChild(tabBtn);

            const tabPane = createElement('div', {
                id: `${tab.id}-pane`,
                className: 'tab-pane',
            });
            this.dom.panelContent.appendChild(tabPane);
        });

        // Activate the first tab by default
        if (this.tabs.length > 0) {
            this.showTab(this.tabs[0].id);
        }

        this.isReady = true;
    }

    /**
     * Shows a specific tab, making it active and hiding the others.
     * It calls the `onActivate` callback for the tab.
     * @param {string} tabId - The ID of the tab to show.
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

        // The onActivate callback is responsible for rendering the content of the pane.
        if (tab.onActivate) {
            tab.onActivate(tabPane);
        }

        // Switch the main view if the tab is associated with a specific view type.
        const lastActiveId = this.app.lastActiveIds[tab.viewType];
        if (lastActiveId) {
            await this.app.setView(tab.viewType, lastActiveId);
        } else if (tab.viewType) {
            // If there's no last active ID, let the plugin's onActivate handle the default view.
            // This is often handled inside the onActivate logic (e.g., showing the default agent).
        }
    }
}
