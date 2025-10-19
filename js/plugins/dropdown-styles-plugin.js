/**
 * @fileoverview Injects the necessary CSS for dropdown buttons into the document.
 * This ensures that the dropdown functionality is self-contained and does not
 * rely on external stylesheets.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

const dropdownCSS = `
    .dropdown-wrapper {
        position: relative;
        display: inline-block;
    }

    .dropdown-menu {
        display: none;
        position: absolute;
        background-color: var(--background-color-secondary);
        min-width: 160px;
        box-shadow: 0px 8px 16px 0px rgba(0,0,0,0.2);
        z-index: 100;
        border-radius: 4px;
        padding: 5px 0;
    }

    .dropdown-menu.show {
        display: block;
    }

    .dropdown-menu a {
        color: var(--text-color);
        padding: 8px 12px;
        text-decoration: none;
        display: block;
        font-size: 0.9rem;
    }

    .dropdown-menu a:hover {
        background-color: var(--background-color-tertiary);
    }
`;

pluginManager.register({
    name: 'DropdownStylesInjector',
    onAppInit() {
        const style = document.createElement('style');
        style.textContent = dropdownCSS;
        document.head.appendChild(style);
    }
});