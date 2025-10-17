/**
 * @fileoverview Manages the entire right-hand panel, including the tab system
 * and the content of each tab pane.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { createButton } from './ui-elements.js';

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
                onClick: () => this.app.setView(tab.id, this.app.lastActiveIds[tab.id] || null)
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
            if (this.app.activeView.type === tab.id) {
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

        pane.innerHTML = `
            <div class="list-pane">
                <ul class="item-list"></ul>
                <div class="list-pane-spacer"></div>
                <div class="list-pane-footer">
                    <button class="add-new-button">Add New ${tab.label}</button>
                    <div class="list-pane-actions"></div>
                </div>
            </div>
        `;

        const listEl = pane.querySelector('.item-list');
        const addButton = pane.querySelector('.add-new-button');
        const actionsContainer = pane.querySelector('.list-pane-actions');

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
            li.addEventListener('click', () => this.app.setView(tab.id, item.id));
            listEl.appendChild(li);
        });

        // Render actions
        const actions = tab.actions ? tab.actions() : [];
        actions.forEach(action => {
            const button = createButton(action);
            actionsContainer.appendChild(button);
        });

        addButton.addEventListener('click', () => {
            const newItem = tab.onAddNew();
            if (newItem) {
                this.app.setView(tab.id, newItem.id);
            }
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
            const isActive = this.app.activeView.type === tab.id;

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
        app.rightPanelManager = new RightPanelManager(app);
    },
    onViewRendered(view) {
        if (app.rightPanelManager) {
            app.rightPanelManager.renderActivePane();
        }
    },
    onAppReady(app) {
        if (app.rightPanelManager && !app.rightPanelManager.isReady) {
            app.rightPanelManager.renderTabs();
            app.rightPanelManager.isReady = true;
        }
    }
});