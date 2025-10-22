/**
 * @fileoverview Manages the top panel of the application, primarily the main title bar.
 * This module is responsible for orchestrating the creation and rendering of the
 * title bar, allowing plugins to register custom controls, buttons, and title content.
 */

'use strict';

import { createTitleBar } from './ui-components.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../plugin-manager.js').PluginManager} PluginManager
 */

/**
 * Manages the top panel of the application.
 * @class
 */
export class TopPanelManager {
    /**
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
     * Renders the main title bar based on the current view.
     * It gathers configuration from plugins via the `onTitleBarRegister` hook
     * and uses the `createTitleBar` component to build the final UI.
     * @param {import('../main.js').View} view - The currently active view.
     * @param {any} [data] - Optional data related to the view (e.g., the active chat object).
     */
    renderTitleBar(view, data) {
        // Remove any existing title bar to prevent duplicates.
        const existingTitleBar = this.dom.mainPanel.querySelector('.main-title-bar');
        if (existingTitleBar) {
            existingTitleBar.remove();
        }

        // The config object is populated by plugins via the hook.
        const config = {
            titleParts: [],
            controls: [],
            buttons: [],
        };

        // The hook allows plugins to populate the config based on the view.
        this.pluginManager.trigger('onTitleBarRegister', config, view, data);

        // Only render if there's something to show.
        if (config.titleParts.length > 0 || config.controls.length > 0 || config.buttons.length > 0) {
            const titleBar = createTitleBar({ ...config, pluginManager: this.pluginManager });
            this.dom.mainPanel.prepend(titleBar);
        }
    }
}
