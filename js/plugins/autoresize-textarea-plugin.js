/**
 * @fileoverview A plugin to automatically resize the message input textarea
 * based on its content, ensuring it starts at a minimal single-line height.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {import('../main.js').App} App
 */

/**
 * The singleton instance of the main App class.
 * @type {App | null}
 */
let appInstance = null;

/**
 * Resets the textarea height to a minimal value, then resizes it to fit its
 * content, up to a maximum height. This ensures the initial height is as
 * small as possible.
 * @param {HTMLTextAreaElement} textarea - The textarea element to resize.
 */
function autoResizeTextarea(textarea) {
    if (!textarea) return;

    // Set height to 0 to force the browser to calculate the minimum required
    // scrollHeight, which includes padding and line-height. This is the key
    // to getting a correct initial one-line height.
    textarea.style.height = '0';

    const maxHeight = window.innerHeight / 3;
    const scrollHeight = textarea.scrollHeight;

    if (scrollHeight > maxHeight) {
        textarea.style.height = `${maxHeight}px`;
        textarea.style.overflowY = 'auto';
    } else {
        textarea.style.height = `${scrollHeight}px`;
        textarea.style.overflowY = 'hidden';
    }
}

/**
 * The plugin object for autoresizing the textarea.
 * @type {import('../plugin-manager.js').Plugin}
 */
const autoResizeTextareaPlugin = {
    name: 'auto-resize-textarea',

    /**
     * Stores a reference to the main app instance.
     * @param {App} app - The main application instance.
     */
    onAppInit(app) {
        appInstance = app;
    },

    /**
     * Called when a view is rendered. Attaches the resize logic to the chat
     * view's textarea. This is done only once per textarea element to ensure
     * the plugin is self-contained and efficient.
     * @param {import('../main.js').View} view - The view being rendered.
     */
    onViewRendered(view) {
        if (view.type === 'chat') {
            const textarea = appInstance.dom.messageInput;

            // Only initialize once per element to avoid duplicate listeners.
            if (textarea && !textarea.dataset.autoresizeInitialized) {
                // Apply styles directly via JS to make the plugin self-contained.
                // This overrides the default CSS to ensure a correct initial height.
                textarea.style.paddingTop = '0.35rem';
                textarea.style.paddingBottom = '0.45rem';
                textarea.style.boxSizing = 'border-box';

                // Attach the event listener for user input.
                textarea.addEventListener('input', () => autoResizeTextarea(textarea));

                // Perform the initial resize for draft messages or initial load.
                autoResizeTextarea(textarea);

                // Set a flag to prevent re-initialization.
                textarea.dataset.autoresizeInitialized = 'true';
            }
        }
    }
};

pluginManager.register(autoResizeTextareaPlugin);