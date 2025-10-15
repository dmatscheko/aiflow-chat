/**
 * @fileoverview A plugin to automatically resize the message input textarea
 * based on its content.
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
 * Resizes the textarea to fit its content, up to a maximum height.
 * @param {HTMLTextAreaElement} textarea - The textarea element to resize.
 */
function autoResizeTextarea(textarea) {
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';

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
     * Called when a view is rendered. Attaches the resize logic to the chat view's textarea.
     * @param {import('../main.js').View} view - The view being rendered.
     * @param {import('../chat-data.js').ChatLog} entity - The entity associated with the view.
     */
    onViewRendered(view, entity) {
        if (view.type === 'chat') {
            const textarea = appInstance.dom.messageInput;
            if (textarea) {
                // Initial resize
                autoResizeTextarea(textarea);

                // Resize on input
                textarea.addEventListener('input', () => autoResizeTextarea(textarea));
            }
        }
    }
};

pluginManager.register(autoResizeTextareaPlugin);