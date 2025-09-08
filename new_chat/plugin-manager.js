/**
 * @fileoverview Manages the plugin infrastructure, including hooks and registration.
 */

'use strict';

/**
 * @callback ViewRenderer
 * @param {string} [id] - The ID of the item to render in the view.
 * @returns {string} The HTML string for the view.
 */

/**
 * A mapping of hook names to callback functions.
 * @typedef {Object.<string, Function>} Plugin
 */

/**
 * Manages the registration and execution of plugins.
 * Plugins can register callbacks for various hooks, which are triggered at
 * specific points in the application lifecycle. This allows for extending
 * and modifying the application's behavior without changing the core code.
 * It also manages registration of custom "views" for the main panel.
 * @class
 */
class PluginManager {
    constructor() {
        /**
         * A map where keys are hook names and values are arrays of callbacks.
         * @private
         * @type {Object.<string, Function[]>}
         */
        this.hooks = {};
        /**
         * A map where keys are view types and values are renderer functions.
         * @private
         * @type {Object.<string, ViewRenderer>}
         */
        this.viewRenderers = {};
    }

    /**
     * Registers a view renderer for a specific view type.
     * @param {string} viewType - The name of the view type (e.g., 'agent-editor').
     * @param {ViewRenderer} renderer - A function that takes an optional ID and returns an HTML string for the view.
     */
    registerView(viewType, renderer) {
        if (this.viewRenderers[viewType]) {
            console.warn(`PluginManager: A view renderer for "${viewType}" is already registered. It will be overwritten.`);
        }
        this.viewRenderers[viewType] = renderer;
    }

    /**
     * Gets the renderer function for a given view type.
     * @param {string} viewType - The name of the view type.
     * @returns {ViewRenderer|null} The renderer function or null if not found.
     */
    getViewRenderer(viewType) {
        return this.viewRenderers[viewType] || null;
    }

    /**
     * Registers a plugin, allowing it to add callbacks to various hooks.
     * @param {Plugin} plugin - The plugin object. The keys are hook names (e.g., 'onAppInit') and values are the callback functions.
     * @example
     * pluginManager.register({
     *   onAppInit: (app) => console.log('App is initializing!'),
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
     * Triggers a specific hook, executing all registered callbacks in sequence.
     * For hooks that are designed to modify data (e.g., a settings array),
     * the return value of each callback is passed as the first argument to the next.
     * @param {string} hookName - The name of the hook to trigger.
     * @param {...any} args - Arguments to pass to the hook's callbacks.
     * @returns {any} The result from the last callback in the chain, or the original
     * first argument if no callbacks were registered or if they returned undefined.
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

    /**
     * Asynchronously triggers a specific hook, executing all registered callbacks in sequence.
     * This is for hooks that may have asynchronous callbacks (returning Promises).
     * @param {string} hookName - The name of the hook to trigger.
     * @param {...any} args - Arguments to pass to the hook's callbacks.
     * @returns {Promise<any>} The result from the last callback in the chain.
     */
    async triggerAsync(hookName, ...args) {
        const callbacks = this.hooks[hookName];
        if (!callbacks || callbacks.length === 0) {
            return args[0];
        }

        let result = args[0];
        for (const callback of callbacks) {
            const callbackResult = await callback(result, ...args.slice(1));
            if (callbackResult !== undefined) {
                result = callbackResult;
            }
        }

        return result;
    }
}

// Export a singleton instance
export const pluginManager = new PluginManager();
