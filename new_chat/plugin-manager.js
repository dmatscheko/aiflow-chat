/**
 * @fileoverview Manages the plugin infrastructure, including hooks and registration.
 */

'use strict';

class PluginManager {
    constructor() {
        this.hooks = {};
        this.viewRenderers = {};
    }

    /**
     * Registers a view renderer for a specific view type.
     * @param {string} viewType - The name of the view type (e.g., 'agent-editor').
     * @param {Function} renderer - A function that takes an ID and returns an HTML string for the view.
     */
    registerView(viewType, renderer) {
        this.viewRenderers[viewType] = renderer;
    }

    /**
     * Gets the renderer function for a given view type.
     * @param {string} viewType - The name of the view type.
     * @returns {Function|null} The renderer function or null if not found.
     */
    getViewRenderer(viewType) {
        return this.viewRenderers[viewType] || null;
    }

    /**
     * Registers a plugin, allowing it to add callbacks to various hooks.
     * @param {Object} plugin - The plugin object. The keys are hook names and values are the callback functions.
     * @example
     * pluginManager.register({
     *   onAppInit: () => console.log('App is initializing!'),
     *   onSettingsRegistered: (settings) => {
     *     settings.push({ id: 'my-plugin-setting', ... });
     *     return settings;
     *   }
     * });
     */
    register(plugin) {
        for (const hookName in plugin) {
            if (Object.hasOwnProperty.call(plugin, hookName)) {
                if (!this.hooks[hookName]) {
                    this.hooks[hookName] = [];
                }
                this.hooks[hookName].push(plugin[hookName]);
            }
        }
    }

    /**
     * Triggers a specific hook, executing all registered callbacks.
     * @param {string} hookName - The name of the hook to trigger.
     * @param {...*} args - Arguments to pass to the hook's callbacks.
     * @returns {*} The result of the hook. For hooks that modify data, this will be the modified data.
     */
    trigger(hookName, ...args) {
        const callbacks = this.hooks[hookName];
        if (!callbacks || callbacks.length === 0) {
            // If it's a data modification hook, return the first argument (the data)
            return args[0];
        }

        let result = args[0];
        callbacks.forEach(callback => {
            // For hooks that are meant to modify data, the callback should return the modified data.
            // The modified data is then passed to the next callback.
            const callbackResult = callback(result, ...args.slice(1));
            if (callbackResult !== undefined) {
                result = callbackResult;
            }
        });

        return result;
    }
}

// Export a singleton instance
export const pluginManager = new PluginManager();
