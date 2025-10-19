/**
 * @fileoverview Manages the entire right-hand panel, including the tab system
 * and the content of each tab pane.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { createButton } from './ui-elements.js';

let appInstance = null;

class RightPanelManager {
    constructor(app) {
        this.app = app;
        this.tabs = [];
        this.tabContainer = document.getElementById('panel-tabs');
        this.paneContainer = document.getElementById('panel-content');
        this.isReady = false;
    }

    registerTab(tabConfig) {
        this.tabs.push(tabConfig);
        // Sort tabs by order property
        this.tabs.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    renderTabs() {
        this.tabContainer.innerHTML = '';
        this.tabs.forEach(tab => {
            const tabButton = createButton({
                id: `${tab.id}-tab`,
                label: tab.label,
                className: 'tab-btn',
                onClick: () => this.app.setView(tab.viewType, this.app.lastActiveIds[tab.viewType] || null)
            });
            this.tabContainer.appendChild(tabButton);

            const pane = document.createElement('div');
            pane.id = `${tab.id}-pane`;
            pane.className = 'tab-pane';
            this.paneContainer.appendChild(pane);
        });
    }

    renderActivePane() {
        this.tabs.forEach(tab => {
            const pane = document.getElementById(`${tab.id}-pane`);
            if (this.app.activeView.type === tab.viewType) {
                this.renderPaneContent(pane, tab);
            }
        });
        this.updateTabStates();
    }

    renderPaneContent(pane, tab) {
        const manager = this.app[tab.manager];
        if (!manager) {
            console.error(`${tab.manager} not found on app instance.`);
            return;
        }

        pane.innerHTML = ''; // Clear previous content

        const listPane = document.createElement('div');
        listPane.className = 'list-pane';
        listPane.style.display = 'flex';
        listPane.style.flexDirection = 'column';
        listPane.style.height = '100%';

        const listEl = document.createElement('ul');
        listEl.className = 'item-list';

        const spacer = document.createElement('div');
        spacer.style.flexGrow = '1';

        const footer = document.createElement('div');
        footer.className = 'list-pane-footer';

        const addButton = createButton({
            label: `Add New ${tab.label}`,
            className: 'add-new-button',
            onClick: () => {
                const newItem = tab.onAddNew();
                if (newItem) {
                    this.app.setView(tab.viewType, newItem.id);
                }
            }
        });

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'list-pane-actions';

        footer.appendChild(addButton);
        footer.appendChild(actionsContainer);

        listPane.appendChild(listEl);
        listPane.appendChild(spacer);
        listPane.appendChild(footer);
        pane.appendChild(listPane);

        // Render list items
        const items = manager.dataManager.getAll();
        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'list-item';
            li.dataset.id = item.id;
            li.innerHTML = `<span>${tab.getItemName(item)}</span>`;
            if (tab.onDelete) {
                const deleteButton = createButton({
                    id: `delete-${item.id}`,
                    label: 'X',
                    className: 'delete-button',
                    onClick: (e) => {
                        e.stopPropagation();
                        if (tab.onDelete(item.id, tab.getItemName(item))) {
                            manager.dataManager.delete(item.id);
                            this.renderActivePane();
                        }
                    }
                });
                li.appendChild(deleteButton);
            }
            li.addEventListener('click', () => this.app.setView(tab.viewType, item.id));
            listEl.appendChild(li);
        });

        // Render actions
        const actions = tab.actions ? tab.actions() : [];
        actions.forEach(action => {
            const button = createButton(action);
            actionsContainer.appendChild(button);
        });

        this.updateActiveListItem(listEl);
    }

    updateActiveListItem(listEl) {
        const activeId = this.app.activeView.id;
        listEl.querySelectorAll('li').forEach(item => {
            item.classList.toggle('active', item.dataset.id === activeId);
        });
    }

    updateTabStates() {
        this.tabs.forEach(tab => {
            const tabButton = document.getElementById(`${tab.id}-tab`);
            const pane = document.getElementById(`${tab.id}-pane`);
            const isActive = this.app.activeView.type === tab.viewType;

            if (tabButton) {
                tabButton.classList.toggle('active', isActive);
            }
            if (pane) {
                pane.classList.toggle('active', isActive);
            }
        });
    }
}

pluginManager.register({
    name: 'RightPanelManagerInitializer',
    onAppInit(app) {
        appInstance = app;
        app.rightPanelManager = new RightPanelManager(app);
    },
    onViewRendered(view) {
        if (appInstance.rightPanelManager) {
            if (!appInstance.rightPanelManager.isReady) {
                appInstance.rightPanelManager.renderTabs();
                appInstance.rightPanelManager.isReady = true;
            }
            appInstance.rightPanelManager.renderActivePane();
        }
    }
});