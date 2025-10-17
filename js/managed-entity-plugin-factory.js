/**
 * @fileoverview Factory for creating a standard plugin for managing a data entity.
 * This factory abstracts the common logic for creating a sidebar tab, a list pane,
 * and handling basic CRUD operations for a given data entity (e.g., Chats, Agents, Flows).
 * @version 1.0.0
 */

'use strict';

import { createListPane } from './ui/list-pane.js';
import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./data-manager.js').DataManager} DataManager
 */

/**
 * Configuration object for the managed entity plugin factory.
 * @typedef {object} ManagedEntityPluginConfig
 * @property {string} name - The name of the entity (e.g., 'Chat', 'Agent').
 * @property {string} id - The unique ID for the plugin and tab (e.g., 'chats', 'agents').
 * @property {string} viewType - The view type associated with this entity.
 * @property {() => any} onAddNew - Function to call when the 'Add New' button is clicked.
 * @property {(item: any) => string} getItemName - Function to get the display name of an item.
 * @property {(itemId: string, itemName: string) => boolean} onDelete - Function to call when an item is deleted.
 * @property {Array<object>} [actionButtons] - An optional array of button definitions to add to the bottom of the pane.
 * @property {object} [pluginHooks={}] - Additional plugin hooks to merge into the created plugin.
 * @property {boolean} [addAtStart=false] - Whether to add the tab at the beginning of the tab list.
 */

/**
 * Creates and registers a standard plugin for managing a data entity.
 * @param {ManagedEntityPluginConfig} config - The configuration for the entity.
 */
export function createManagedEntityPlugin(config) {
    const plugin = {
        name: config.name,

        onTabsRegistered(tabs) {
            const tabDefinition = {
                id: config.id,
                label: config.name,
                viewType: config.viewType,
                onActivate: () => {
                    const managerName = `${config.id.replace(/s$/, '')}Manager`;
                    const manager = pluginManager.app[managerName];
                    if (!manager) {
                        console.error(`${managerName} not found on app instance.`);
                        return;
                    }

                    manager.listPane = createListPane({
                        container: document.getElementById(`${config.id}-pane`),
                        dataManager: manager.dataManager,
                        app: pluginManager.app,
                        viewType: config.viewType,
                        addNewButtonLabel: `Add New ${config.name}`,
                        onAddNew: config.onAddNew,
                        getItemName: config.getItemName,
                        onDelete: config.onDelete,
                        actionButtons: config.actionButtons || [],
                    });

                    // If a custom onActivate is provided, call it.
                    if (config.onActivate) {
                        config.onActivate(manager);
                    }
                },
            };

            if (config.addAtStart) {
                tabs.unshift(tabDefinition);
            } else {
                tabs.push(tabDefinition);
            }
            return tabs;
        },

        ...config.pluginHooks,
    };

    pluginManager.register(plugin);
}