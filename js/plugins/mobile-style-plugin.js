/**
 * @fileoverview A simple plugin to handle mobile-specific layout adjustments.
 * It primarily adds a toggle button to show/hide the right-hand sidebar
 * on smaller screens where it is hidden by default via CSS.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * The plugin object for mobile-specific style and layout handling.
 * @type {import('../plugin-manager.js').Plugin}
 */
const mobileStylePlugin = {
    name: 'MobileStyle',

    /**
     * The `onAppInit` hook, called when the application starts.
     * It creates and injects a toggle button into the DOM. This button's click
     * event toggles the 'right-panel-visible' class on the main app container,
     * which is used by CSS to control the visibility of the sidebar on mobile.
     * @param {import('../main.js').App} app - The main application instance.
     */
    onAppInit(app) {
        const appContainer = document.getElementById('app-container');
        if (!appContainer) return;

        const settingsButton = document.createElement('button');
        settingsButton.id = 'mobile-settings-toggle';
        settingsButton.className = 'mobile-settings-button';
        settingsButton.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 4a1 1 0 0 0-1 1c0 1.692-2.046 2.54-3.243 1.343a1 1 0 1 0-1.414 1.414C7.54 8.954 6.693 11 5 11a1 1 0 1 0 0 2c1.692 0 2.54 2.046 1.343 3.243a1 1 0 0 0 1.414 1.414C8.954 16.46 11 17.307 11 19a1 1 0 1 0 2 0c0-1.692 2.046-2.54 3.243-1.343a1 1 0 0 0 1.414-1.414C16.46 15.046 17.307 13 19 13a1 1 0 1 0 0-2c-1.692 0-2.54-2.046-1.343-3.243a1 1 0 0 0-1.414-1.414C15.046 7.54 13 6.693 13 5a1 1 0 0 0-1-1zm-2.992.777a3 3 0 0 1 5.984 0 3 3 0 0 1 4.23 4.231 3 3 0 0 1 .001 5.984 3 3 0 0 1-4.231 4.23 3 3 0 0 1-5.984 0 3 3 0 0 1-4.231-4.23 3 3 0 0 1 0-5.984 3 3 0 0 1 4.231-4.231z" fill="currentColor" />
                <path d="M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-2.828-.828a4 4 0 1 1 5.656 5.656 4 4 0 0 1-5.656-5.656z" fill="currentColor" />
            </svg>
        `;

        settingsButton.addEventListener('click', () => {
            appContainer.classList.toggle('right-panel-visible');
        });

        document.body.appendChild(settingsButton);
    }
};

/**
 * Registers the Mobile Style Plugin with the application's plugin manager.
 */
pluginManager.register(mobileStylePlugin);
