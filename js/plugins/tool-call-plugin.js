/**
 * @fileoverview Plugin that serves as the central entry point for tool call processing.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { toolCallManager } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../plugins/chats-plugin.js').Chat} Chat
 */

class ToolCallPlugin {
    /** @type {App} */
    app = null;

    /** @param {App} app */
    init(app) {
        this.app = app;
        // The toolCallManager is a singleton, but it needs access to the app instance
        // for things like triggering the response processor.
        toolCallManager.init(app);
    }

    /**
     * This hook is the primary entry point for initiating the tool call workflow.
     * It checks outgoing assistant messages for tool calls and hands them off
     * to the ToolCallManager if any are found.
     *
     * @param {Message} message - The message being processed.
     * @param {Chat} activeChat - The active chat instance.
     * @returns {Promise<boolean>} - True if tool calls were found and a job was started,
     *                              which halts further processing by other plugins. False otherwise.
     */
    async onResponseComplete(message, activeChat) {
        // If there's no message content, there's nothing to do.
        if (!message || !message.value.content) {
            return false;
        }

        // Delegate the entire job creation and management process to the ToolCallManager.
        // The addJob method will parse the content, create a job if necessary,
        // and return true if it did so. This boolean return value is exactly
        // what the onResponseComplete hook chain expects.
        return toolCallManager.addJob(message, activeChat);
    }
}

const toolCallPluginInstance = new ToolCallPlugin();

pluginManager.register({
    name: 'Tool Call Orchestrator',
    onAppInit: (app) => toolCallPluginInstance.init(app),
    onResponseComplete: (message, activeChat) => toolCallPluginInstance.onResponseComplete(message, activeChat),
});