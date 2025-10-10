/**
 * @fileoverview Manages the application's plugin infrastructure, including
 * the registration of hooks, views, and the triggering of events. This module
 * provides a singleton `pluginManager` which is the central hub for all
 * plugin-based extensibility.
 */

'use strict';

/**
 * A callback function responsible for rendering the HTML content of a view.
 * @callback ViewRenderer
 * @param {string} [id] - The optional ID of the specific item to render in the view (e.g., a chat ID).
 * @returns {string} The HTML string representing the view's content.
 */

/**
 * Represents a plugin, which is an object where keys are hook names and values
 * are the corresponding callback functions to be executed when that hook is triggered.
 * @typedef {Object.<string, Function>} Plugin
 * @example
 * const myPlugin = {
 *   onAppInit: (app) => { console.log('App is initializing!'); },
 *   onMessageRender: (message) => { /.../ }
 * };
 */

/**
 * Manages the registration and execution of plugins and their hooks.
 * This class implements a hook-based system that allows for extending and
 * modifying the application's behavior without changing core code. It supports
 * different types of hook triggers for various use cases (data transformation,
 * sequential actions, etc.). It also manages the registration of custom "views"
 * for the main application panel.
 * @class
 */
class PluginManager {
    /**
     * Creates an instance of the PluginManager.
     */
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
     * Registers a view renderer for a specific view type. This allows plugins
     * to define custom views for the main application panel.
     * @param {string} viewType - The name of the view type (e.g., 'chat', 'agent-editor').
     * @param {ViewRenderer} renderer - A function that takes an optional ID and returns an HTML string for the view.
     */
    registerView(viewType, renderer) {
        if (this.viewRenderers[viewType]) {
            console.warn(`PluginManager: A view renderer for "${viewType}" is already registered. It will be overwritten.`);
        }
        this.viewRenderers[viewType] = renderer;
    }

    /**
     * Retrieves the renderer function for a given view type.
     * @param {string} viewType - The name of the view type.
     * @returns {ViewRenderer|null} The registered renderer function, or `null` if not found.
     */
    getViewRenderer(viewType) {
        return this.viewRenderers[viewType] || null;
    }

    /**
     * Registers a plugin by iterating over its properties and adding each
     * function to the corresponding hook's list of callbacks.
     * @param {Plugin} plugin - The plugin object, where keys are hook names
     * (e.g., 'onAppInit') and values are the callback functions.
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
     * Triggers a synchronous hook, executing all registered callbacks in sequence.
     * This method is designed for hooks that transform data, where the return value
     * of each callback is passed as the first argument to the next callback in the chain.
     * @param {string} hookName - The name of the hook to trigger.
     * @param {...any} args - Arguments to pass to the hook's callbacks. The first argument is typically the data to be transformed.
     * @returns {any} The result from the final callback in the chain, or the original
     * first argument if no callbacks were registered or if they returned `undefined`.
     */
    trigger(hookName, ...args) {
        const callbacks = this.hooks[hookName];
        if (!callbacks || callbacks.length === 0) {
            // If it's a data modification hook, return the first argument (the data).
            return args[0];
        }

        let result = args[0];
        callbacks.forEach(callback => {
            // For data transformation hooks, the callback should return the modified data.
            // This modified data is then passed as the first argument to the next callback.
            const callbackResult = callback(result, ...args.slice(1));
            if (callbackResult !== undefined) {
                result = callbackResult;
            }
        });

        return result;
    }

    /**
     * Asynchronously triggers a hook, executing all registered callbacks in sequence.
     * This is the asynchronous version of `trigger`, suitable for hooks with async
     * callbacks that transform data. It awaits each callback before proceeding to the next.
     * @param {string} hookName - The name of the hook to trigger.
     * @param {...any} args - Arguments to pass to the hook's callbacks.
     * @returns {Promise<any>} A promise that resolves to the result from the final callback in the chain.
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

    /**
     * Asynchronously triggers a hook, executing callbacks sequentially until one
     * of them returns `true`. This method is designed for action-handling hooks
     * where the first plugin to handle an event can prevent subsequent plugins
     * from processing it.
     * @param {string} hookName - The name of the hook to trigger.
     * @param {...any} args - Arguments to pass to the hook's callbacks.
     * @returns {Promise<boolean>} A promise that resolves to `true` if any handler
     * returned `true` (indicating the event was handled), and `false` otherwise.
     */
    async triggerSequentially(hookName, ...args) {
        const callbacks = this.hooks[hookName];
        if (!callbacks || callbacks.length === 0) {
            return false;
        }

        for (const callback of callbacks) {
            const wasHandled = await callback(...args);
            if (wasHandled === true) {
                // If a handler returns true, it signifies it has handled the event,
                // so we stop processing and return true immediately.
                return true;
            }
        }

        // If no handler returned true, it means the event was not handled by any plugin.
        return false;
    }
}

/**
 * The singleton instance of the PluginManager, used throughout the application.
 * @type {PluginManager}
 */
export const pluginManager = new PluginManager();
