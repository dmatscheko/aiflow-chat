/**
 * @fileoverview A reusable UI component for creating and managing list panes
 * in the sidebar, used for displaying chats, agents, and flows.
 */

'use strict';

/**
 * @typedef {import('../data-manager.js').DataManager} DataManager
 * @typedef {import('../main.js').App} App
 */

/**
 * @typedef {object} ListPaneConfig
 * @property {HTMLElement} container - The DOM element to render the pane into.
 * @property {DataManager} dataManager - The manager for the data being displayed.
 * @property {App} app - The main application instance.
 * @property {string} viewType - The view type to activate when an item is selected (e.g., 'chat').
 * @property {string} addNewButtonLabel - The text for the "Add New" button.
 * @property {function(): object} onAddNew - A callback function that creates a new item and returns it.
 * @property {function(object): string} getItemName - A function to get the display name of an item.
 * @property {function(string, string): boolean} [onDelete] - An optional callback to confirm deletion.
 * @property {Array<object>} [actionButtons] - An optional array of button definitions to add to the bottom of the pane.
 */

/**
 * Creates and manages a list pane UI.
 * @param {ListPaneConfig} config - The configuration for the list pane.
 */
export function createListPane(config) {
    const {
        container,
        dataManager,
        app,
        viewType,
        addNewButtonLabel,
        onAddNew,
        getItemName,
        onDelete,
        actionButtons = [],
    } = config;

    container.innerHTML = `
        <div class="list-pane">
            <button class="add-new-button">${addNewButtonLabel}</button>
            <ul class="item-list"></ul>
            <div class="list-pane-footer">
                <div class="spacer"></div>
                <div class="action-buttons"></div>
            </div>
        </div>
    `;

    const listEl = container.querySelector('.item-list');
    const addButton = container.querySelector('.add-new-button');
    const actionButtonsContainer = container.querySelector('.action-buttons');

    // Render action buttons if provided
    if (actionButtons.length > 0) {
        actionButtons.forEach(buttonInfo => {
            const button = document.createElement('button');
            button.id = buttonInfo.id;
            button.textContent = buttonInfo.label;
            button.className = buttonInfo.className || 'btn-gray';
            button.addEventListener('click', buttonInfo.onClick);
            actionButtonsContainer.appendChild(button);
        });
    }

    const renderList = () => {
        listEl.innerHTML = '';
        const items = dataManager.getAll();
        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'list-item';
            li.dataset.id = item.id;

            const deleteButtonHtml = (onDelete && item.id !== 'agent-default')
                ? '<button class="delete-button">X</button>'
                : '';

            li.innerHTML = `<span>${getItemName(item)}</span>${deleteButtonHtml}`;
            listEl.appendChild(li);
        });
        updateActiveItem();
    };

    const updateActiveItem = () => {
        const activeId = app.activeView.type === viewType ? app.activeView.id : null;
        listEl.querySelectorAll('li').forEach(item => {
            item.classList.toggle('active', item.dataset.id === activeId);
        });
    };

    addButton.addEventListener('click', () => {
        const newItem = onAddNew();
        if (newItem) {
            renderList();
            app.setView(viewType, newItem.id);
        }
    });

    listEl.addEventListener('click', (e) => {
        const itemEl = e.target.closest('.list-item');
        if (!itemEl) return;

        const itemId = itemEl.dataset.id;

        if (e.target.classList.contains('delete-button')) {
            e.stopPropagation();
            const item = dataManager.get(itemId);
            if (item && (!onDelete || onDelete(itemId, getItemName(item)))) {
                dataManager.delete(itemId);
                renderList();
                if (app.activeView.id === itemId) {
                    const firstItem = dataManager.getAll()[0];
                    app.setView(viewType, firstItem ? firstItem.id : null);
                }
            }
        } else {
            app.setView(viewType, itemId);
        }
    });

    // Initial render
    renderList();

    // Return an object with the update function so it can be called externally
    return {
        updateActiveItem,
        renderList,
    };
}