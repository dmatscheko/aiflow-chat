/**
 * @fileoverview High-level UI component creation functions.
 * This module provides functions for building complex, reusable UI components
 * like title bars and list panes by composing low-level elements.
 */

'use strict';

import { createElement, createButton } from './ui-elements.js';
import { makeSingleLineEditable } from '../utils.js';

/**
 * @typedef {import('./right-panel-manager.js').ListPane} ListPane
 * @typedef {import('../plugin-manager.js').PluginManager} PluginManager
 */

/**
 * Creates a standardized title bar element for a main panel view.
 *
 * @param {object} config - The configuration for the title bar.
 * @param {Array<string|{text: string, onSave: (newText: string) => void}>} config.titleParts - Segments for the title. Objects create editable segments.
 * @param {Array<object>} [config.controls=[]] - Custom controls for the center area.
 * @param {Array<object>} [config.buttons=[]] - Buttons for the right-side area.
 * @param {PluginManager} [config.pluginManager] - The plugin manager instance to trigger hooks.
 * @returns {HTMLElement} The constructed title bar element.
 */
export function createTitleBar(config) {
    const { titleParts, controls = [], buttons = [], pluginManager } = config;

    const titleEl = createElement('h2', { className: 'title' });
    titleParts.forEach(part => {
        if (typeof part === 'string') {
            titleEl.appendChild(document.createTextNode(part));
        } else {
            const span = createElement('span', {
                className: 'editable-title-part',
                textContent: part.text,
                attributes: { 'data-original-text': part.text },
                events: {
                    click: () => makeSingleLineEditable(span, part.text, part.onSave),
                },
            });

            const editBtn = createButton('', {
                className: 'inline-edit-btn',
                children: [
                    createElement('svg', {
                        attributes: { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg" },
                        children: [createElement('path', { attributes: { d: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z", fill: "currentColor" } })],
                    }),
                ],
                events: {
                    click: () => makeSingleLineEditable(span, part.text, part.onSave),
                },
            });

            titleEl.appendChild(span);
            titleEl.appendChild(editBtn);
        }
    });

    const controlsContainer = createElement('div', { id: 'title-bar-controls' });
    let finalControls = controls;
    if (pluginManager) {
        finalControls = pluginManager.trigger('onTitleBarControlsRegistered', controls);
    }
    finalControls.forEach(control => {
        const controlWrapper = createElement('div', { id: control.id });
        controlWrapper.innerHTML = control.html;
        controlsContainer.appendChild(controlWrapper);
        if (control.onMount) {
            setTimeout(() => control.onMount(controlWrapper), 0);
        }
    });

    const buttonsContainer = createElement('div', { className: 'title-bar-buttons' });
    buttons.forEach(buttonInfo => {
        const button = createButton(buttonInfo.label, {
            id: buttonInfo.id,
            className: buttonInfo.className,
            events: { click: buttonInfo.onClick },
        });

        if (buttonInfo.dropdownContent) {
            const dropdownContainer = createElement('div', { className: 'dropdown', children: [button] });
            const dropdownContent = createElement('div', { className: 'dropdown-content' });
            dropdownContent.innerHTML = buttonInfo.dropdownContent;
            dropdownContainer.appendChild(dropdownContent);

            button.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.dropdown-content.show').forEach(d => {
                    if (d !== dropdownContent) d.classList.remove('show');
                });
                dropdownContent.classList.toggle('show');
            });
            buttonsContainer.appendChild(dropdownContainer);
        } else {
            buttonsContainer.appendChild(button);
        }
    });

    return createElement('div', {
        className: 'main-title-bar',
        children: [titleEl, controlsContainer, buttonsContainer],
    });
}

/**
 * Creates and manages a list pane UI component for the sidebar.
 *
 * @param {object} config - The configuration for the list pane.
 * @param {import('../data-manager.js').DataManager} config.dataManager - The manager for the data being displayed.
 * @param {import('../main.js').App} config.app - The main application instance.
 * @param {string} config.viewType - The view type to activate when an item is selected.
 * @param {string} config.addNewButtonLabel - The text for the "Add New" button.
 * @param {() => any} config.onAddNew - Callback to create a new item.
 * @param {(item: any) => string} config.getItemName - Function to get the display name of an item.
 * @param {(itemId: string, itemName: string) => boolean} [config.onDelete] - Optional callback to confirm deletion.
 * @param {Array|() => Array} [config.actions] - Actions for the footer.
 * @returns {ListPane} An object representing the created list pane.
 */
export function createListPane(config) {
    const { dataManager, app, viewType, addNewButtonLabel, onAddNew, getItemName, onDelete, actions } = config;

    let listPaneInstance; // To hold the instance methods

    const listEl = createElement('ul', { className: 'item-list' });
    const actionsContainer = createElement('div', { className: 'list-pane-actions' });
    const addButton = createButton(addNewButtonLabel, {
        className: 'add-new-button',
        events: {
            click: () => {
                const newItem = onAddNew();
                if (newItem && newItem.id) {
                    listPaneInstance.renderList();
                    app.setView(viewType, newItem.id);
                }
            },
        },
    });

    const footer = createElement('div', {
        className: 'list-pane-footer',
        children: [addButton, actionsContainer],
    });

    const container = createElement('div', {
        className: 'list-pane',
        children: [listEl, createElement('div', { className: 'list-pane-spacer' }), footer],
    });

    const renderActions = () => {
        actionsContainer.innerHTML = '';
        const currentActions = typeof actions === 'function' ? actions() : actions || [];
        currentActions.forEach(action => {
            actionsContainer.appendChild(
                createButton(action.label, {
                    id: action.id,
                    className: action.className,
                    events: { click: action.onClick },
                })
            );
        });
    };

    const renderList = () => {
        listEl.innerHTML = '';
        const items = dataManager.getAll();
        items.forEach(item => {
            const deleteButton =
                onDelete && item.id !== 'agent-default'
                    ? createButton('X', { className: 'delete-button' })
                    : null;

            const listItem = createElement('li', {
                className: 'list-item',
                attributes: { 'data-id': item.id },
                children: [createElement('span', { textContent: getItemName(item) }), ...(deleteButton ? [deleteButton] : [])],
            });

            if (deleteButton) {
                deleteButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const itemName = getItemName(item);
                    if (onDelete(item.id, itemName)) {
                        dataManager.delete(item.id);
                        renderList(); // Re-render the list
                        // If the deleted item was active, switch view
                        if (app.activeView.id === item.id) {
                            const firstItem = dataManager.getAll()[0];
                            if (firstItem) {
                                app.setView(viewType, firstItem.id);
                            } else {
                                onAddNew(); // Create a new one if none are left
                            }
                        }
                    }
                });
            }

            listItem.addEventListener('click', () => app.setView(viewType, item.id));
            listEl.appendChild(listItem);
        });
        updateActiveItem();
    };

    const updateActiveItem = () => {
        const activeId = app.activeView.type === viewType ? app.activeView.id : null;
        listEl.querySelectorAll('li').forEach(item => {
            item.classList.toggle('active', item.dataset.id === activeId);
        });
    };

    // Initial render
    renderList();
    renderActions();

    listPaneInstance = {
        element: container,
        updateActiveItem,
        renderList,
        renderActions,
    };

    return listPaneInstance;
}
