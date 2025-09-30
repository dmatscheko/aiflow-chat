/**
 * @fileoverview Manages the plugin infrastructure, including hooks and registration.
 * @version 2.0.0
 */

'use strict';

/**
 * @callback ViewRenderer
 * @param {string} [id] - The ID of the item to render in the view.
 * @returns {string} The HTML string for the view.
 */

/**
 * A mapping of hook names to callback functions.
 * @typedef {object} Plugin
 * @property {string} name - The display name of the plugin.
 */

/**
 * Manages the registration and execution of plugins.
 * This class provides different methods for triggering hooks, allowing for
 * flexible plugin interaction patterns such as data modification chains,
 * sequential event handling, and single-handler execution.
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
     */
    register(plugin) {
        for (const hookName in plugin) {
            // The 'name' property is for identification and not a hook.
            if (hookName === 'name') continue;

            if (Object.hasOwnProperty.call(plugin, hookName)) {
                if (!this.hooks[hookName]) {
                    this.hooks[hookName] = [];
                }
                this.hooks[hookName].push(plugin[hookName]);
            }
        }
    }

    /**
     * Triggers a synchronous hook, executing all registered callbacks in sequence.
     * This is intended for data modification chains, where the return value of each callback
     * is passed as the first argument to the next.
     * @param {string} hookName - The name of the hook to trigger.
     * @param {...any} args - Arguments to pass to the hook's callbacks. The first argument is typically the data to be modified.
     * @returns {any} The result from the last callback in the chain, or the original
     * first argument if no callbacks were registered.
     */
    trigger(hookName, ...args) {
        const callbacks = this.hooks[hookName];
        if (!callbacks || callbacks.length === 0) {
            return args[0];
        }

        let result = args[0];
        callbacks.forEach(callback => {
            const callbackResult = callback(result, ...args.slice(1));
            if (callbackResult !== undefined) {
                result = callbackResult;
            }
        });

        return result;
    }

    /**
     * Asynchronously triggers a hook, executing all registered callbacks in sequence.
     * Like `trigger`, this is for data modification chains, but for callbacks that return Promises.
     * @param {string} hookName - The name of the hook to trigger.
     * @param {...any} args - Arguments to pass to the hook's callbacks.
     * @returns {Promise<any>} A promise that resolves to the result from the last callback in the chain.
     */
    async triggerAsync(hookName, ...args) {
        const callbacks = this.hooks[hookName];
        if (!callbacks || callbacks.length === 0) {
            return args[0];
        }

        let result = args[0];
        for (const callback of callbacks) {
            // The 'result' is passed as the first argument to the next callback in the chain.
            const callbackResult = await callback(result, ...args.slice(1));
            if (callbackResult !== undefined) {
                result = callbackResult;
            }
        }

        return result;
    }

    /**
     * Asynchronously triggers a hook and stops when the first handler returns a truthy value.
     * This is for events that can be "handled" by one of many plugins, preventing subsequent plugins from running.
     * @param {string} hookName - The name of the hook to trigger.
     * @param {...any} args - Arguments to pass to the hook's callbacks.
     * @returns {Promise<boolean>} A promise that resolves to `true` if any handler returned `true`, `false` otherwise.
     */
    async triggerSequentially(hookName, ...args) {
        const callbacks = this.hooks[hookName];
        if (!callbacks || callbacks.length === 0) {
            return false;
        }

        for (const callback of callbacks) {
            const wasHandled = await callback(...args);
            if (wasHandled === true) {
                return true;
            }
        }
        return false;
    }

    /**
     * Asynchronously triggers a hook and returns the result from the first plugin that handles it.
     * A plugin "handles" the call by returning a non-null, non-undefined value.
     * This is ideal for execution hooks where one of many plugins might be responsible for a task.
     * @param {string} hookName - The name of the hook to trigger (e.g., 'onToolCallExecute').
     * @param {...any} args - Arguments to pass to each callback.
     * @returns {Promise<any|null>} A promise that resolves with the return value of the first handler, or null if no handler was found.
     */
    async triggerUntilHandled(hookName, ...args) {
        const callbacks = this.hooks[hookName];
        if (!callbacks) return null;

        for (const callback of callbacks) {
            const result = await callback(...args);
            if (result !== null && result !== undefined) {
                return result; // Stop and return the result from the first handler.
            }
        }
        return null; // No handler returned a result.
    }
}

// Export a singleton instance
export const pluginManager = new PluginManager();