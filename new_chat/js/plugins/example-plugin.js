/**
 * @fileoverview An example plugin that adds a 'Max Tokens' setting.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {import('../main.js').Setting} Setting
 */

/**
 * An example plugin that demonstrates how to add a custom setting and
 * modify the API call payload.
 * @type {import('../plugin-manager.js').Plugin}
 */
const examplePlugin = {
    /**
     * Modifies the settings definition to add a new 'Max Tokens' setting.
     * @param {Setting[]} settings - The original settings array.
     * @returns {Setting[]} The modified settings array.
     */
    onSettingsRegistered(settings) {
        settings.push({
            id: 'maxTokens',
            label: 'Max Tokens',
            type: 'number',
            default: '',
            placeholder: 'e.g., 2048'
        });
        return settings;
    },

    /**
     * Modifies the API payload to include the 'max_tokens' parameter if it's set.
     * @param {object} payload - The original API payload.
     * @param {object} allSettings - A key-value object of all current settings.
     * @returns {object} The modified payload.
     */
    beforeApiCall(payload, allSettings) {
        if (allSettings.maxTokens && parseInt(allSettings.maxTokens, 10) > 0) {
            payload.max_tokens = parseInt(allSettings.maxTokens, 10);
        }
        return payload;
    }
};

// Register the plugin with the plugin manager
pluginManager.register(examplePlugin);
