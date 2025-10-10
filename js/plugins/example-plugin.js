/**
 * @fileoverview An example plugin that demonstrates basic plugin functionality,
 * such as adding a custom setting and modifying the API payload. This serves as
 * a template for creating new plugins.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {import('../main.js').Setting} Setting
 */

/**
 * An example plugin object that demonstrates how to:
 * 1. Hook into `onSettingsRegistered` to add a new 'Max Tokens' setting to the UI.
 * 2. Hook into `beforeApiCall` to modify the API payload based on the new setting.
 * @type {import('../plugin-manager.js').Plugin}
 */
const examplePlugin = {
    /**
     * The `onSettingsRegistered` hook is a "transform" hook. It receives the current
     * array of settings definitions and must return a modified array.
     * @param {Setting[]} settings - The original array of setting definitions.
     * @returns {Setting[]} The modified array including the new 'Max Tokens' setting.
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
     * The `beforeApiCall` hook is also a "transform" hook. It receives the API payload
     * and the current settings, allowing for modification of the payload before it's sent.
     * @param {object} payload - The original API payload.
     * @param {object} allSettings - A key-value object of all current application settings.
     * @returns {object} The potentially modified payload.
     */
    beforeApiCall(payload, allSettings) {
        if (allSettings.maxTokens && parseInt(allSettings.maxTokens, 10) > 0) {
            payload.max_tokens = parseInt(allSettings.maxTokens, 10);
        }
        return payload;
    }
};

// Register the plugin with the central plugin manager to activate its hooks.
pluginManager.register(examplePlugin);
