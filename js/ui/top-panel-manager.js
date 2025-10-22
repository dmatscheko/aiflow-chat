/**
 * @fileoverview Manages the main title bar at the top of the application.
 * Plugins use this manager to register custom controls, buttons, and an editable
 * title for the main view.
 */

'use strict';

import { makeSingleLineEditable } from '../utils.js';
import { createButton } from './ui-elements.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../plugin-manager.js').PluginManager} PluginManager
 */

/**
 * Configuration for a part of the title, which can be static text or editable.
 * @typedef {string | {text: string, onSave: (newText: string) => void}} TitlePart
 */

/**
 * Configuration for a custom control in the title bar.
 * @typedef {object} TitleBarControl
 * @property {string} id - A unique ID for the control's container.
 * @property {string} html - The raw HTML for the control.
 * @property {(container: HTMLElement) => void} [onMount] - A callback to run after the control is added to the DOM.
 */

/**
 * Configuration for a button in the title bar.
 * @typedef {object} TitleBarButton
 * @property {string} id - A unique ID for the button.
 * @property {string} label - The text label for the button.
 * @property {string} [className] - Optional CSS classes.
 * @property {() => void} onClick - The click handler.
 * @property {string} [dropdownContent] - If provided, creates a dropdown menu.
 */

/**
 * The complete configuration object for the title bar, assembled by a plugin hook.
 * @typedef {object} TitleBarConfig
 * @property {TitlePart[]} titleParts - The parts that make up the main title.
 * @property {TitleBarControl[]} controls - Custom controls to display.
 * @property {TitleBarButton[]} buttons - Action buttons to display.
 */


export class TopPanelManager {
    /**
     * Creates an instance of TopPanelManager.
     * @param {App} app - The main application instance.
     * @param {PluginManager} pluginManager - The application's plugin manager.
     */
    constructor(app, pluginManager) {
        this.app = app;
        this.pluginManager = pluginManager;
        this.dom = {
            mainPanel: document.getElementById('main-panel'),
        };
    }

    /**
     * Renders the title bar based on the current view. It triggers a plugin hook
     * to gather the configuration for the title bar and then builds the UI.
     */
    render() {
        // 1. Define a default or empty configuration
        /** @type {TitleBarConfig} */
        let config = {
            titleParts: [{ text: 'AIFlow', onSave: null }],
            controls: [],
            buttons: [],
        };

        // 2. Trigger a hook to allow plugins to modify the configuration
        config = this.pluginManager.trigger('onTitleBarRegister', config, this.app.activeView, this.app);

        // 3. Render the title bar using the final configuration
        this._renderTitleBar(config);
    }


    /**
     * Constructs and injects the title bar element into the DOM.
     * @param {TitleBarConfig} config - The final configuration for the title bar.
     * @private
     */
    _renderTitleBar(config) {
        // Remove any existing title bar to prevent duplicates
        const existingTitleBar = this.dom.mainPanel.querySelector('.main-title-bar');
        if (existingTitleBar) {
            existingTitleBar.remove();
        }

        const titleBar = document.createElement('div');
        titleBar.className = 'main-title-bar';

        // --- Title ---
        const titleEl = document.createElement('h2');
        titleEl.className = 'title';
        config.titleParts.forEach(part => {
            if (typeof part === 'string') {
                titleEl.appendChild(document.createTextNode(part));
            } else if (part.onSave) {
                // Editable part
                const span = document.createElement('span');
                span.className = 'editable-title-part';
                span.textContent = part.text;
                const triggerEdit = () => makeSingleLineEditable(span, part.text, part.onSave);
                span.addEventListener('click', triggerEdit);

                const editBtn = createButton('', {
                    className: 'inline-edit-btn',
                    innerHTML: '<svg width="14" height="14" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>',
                    onClick: triggerEdit,
                });

                titleEl.appendChild(span);
                titleEl.appendChild(editBtn);
            } else {
                 // Non-editable object part
                const span = document.createElement('span');
                span.textContent = part.text;
                titleEl.appendChild(span);
            }
        });

        // --- Controls ---
        const controlsContainer = document.createElement('div');
        controlsContainer.id = 'title-bar-controls';
        config.controls.forEach(control => {
            const wrapper = document.createElement('div');
            wrapper.id = control.id;
            wrapper.innerHTML = control.html;
            controlsContainer.appendChild(wrapper);
            if (control.onMount) {
                setTimeout(() => control.onMount(wrapper), 0);
            }
        });

        // --- Buttons ---
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'title-bar-buttons';
        config.buttons.forEach(btnInfo => {
            if (btnInfo.dropdownContent) {
                buttonsContainer.appendChild(this._createDropdownButton(btnInfo));
            } else {
                buttonsContainer.appendChild(createButton(btnInfo.label, btnInfo));
            }
        });


        titleBar.appendChild(titleEl);
        titleBar.appendChild(controlsContainer);
        titleBar.appendChild(buttonsContainer);

        this.dom.mainPanel.prepend(titleBar);
    }

    /**
     * Creates a button that reveals a dropdown menu on click.
     * @param {TitleBarButton} btnInfo - The configuration for the button.
     * @returns {HTMLDivElement} The container for the dropdown button.
     * @private
     */
    _createDropdownButton(btnInfo) {
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'dropdown';

        const button = createButton(btnInfo.label, {
            ...btnInfo,
            onClick: (e) => {
                e.stopPropagation();
                const content = dropdownContainer.querySelector('.dropdown-content');
                // Close other dropdowns
                document.querySelectorAll('.dropdown-content.show').forEach(d => {
                    if (d !== content) d.classList.remove('show');
                });
                content.classList.toggle('show');
            },
        });

        const dropdownContent = document.createElement('div');
        dropdownContent.className = 'dropdown-content';
        dropdownContent.innerHTML = btnInfo.dropdownContent;

        // If a general onClick is provided for the dropdown, attach it to the content
        if (btnInfo.onClick) {
            dropdownContent.addEventListener('click', (e) => {
                btnInfo.onClick(e);
                dropdownContent.classList.remove('show');
            });
        }

        dropdownContainer.appendChild(button);
        dropdownContainer.appendChild(dropdownContent);

        // Global listener to close dropdown when clicking away
        // Use a static flag to ensure it's only added once
        if (!TopPanelManager._globalClickListenerAdded) {
            window.addEventListener('click', () => {
                document.querySelectorAll('.dropdown-content.show').forEach(d => d.classList.remove('show'));
            });
            TopPanelManager._globalClickListenerAdded = true;
        }

        return dropdownContainer;
    }
}
