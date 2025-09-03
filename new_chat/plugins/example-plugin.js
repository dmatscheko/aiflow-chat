/**
 * @fileoverview An example plugin that adds a 'Max Tokens' setting.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

const examplePlugin = {
    /**
     * Modifies the settings definition to add a new setting.
     * @param {Array<Object>} settings - The original settings array.
     * @returns {Array<Object>} The modified settings array.
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
     * Modifies the API payload to include the max_tokens parameter.
     * @param {Object} payload - The original API payload.
     * @param {Object} allSettings - All current settings from local storage.
     * @returns {Object} The modified payload.
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
