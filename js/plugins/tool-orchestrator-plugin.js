/**
 * @fileoverview Plugin that integrates the ToolOrchestrator into the app's lifecycle.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { toolOrchestrator } from '../tool-orchestrator.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../main.js').Chat} Chat
 */

class ToolOrchestratorPlugin {
    /**
     * @param {App} app
     */
    init(app) {
        toolOrchestrator.init(app);
    }

    /**
     * This will be the single entry point for processing tool and agent calls
     * from an assistant's response.
     * @param {Message} message The message to process.
     * @param {Chat} chat The active chat.
     * @returns {Promise<boolean>} True if any action was taken, false otherwise.
     */
    async onResponseComplete(message, chat) {
        // If the message is null (idle check) or has no content, do nothing.
        if (!message || !message.value.content) {
            return false;
        }
        return await toolOrchestrator.process(message, chat);
    }
}

const toolOrchestratorPluginInstance = new ToolOrchestratorPlugin();

pluginManager.register({
    name: 'Tool Orchestrator Plugin',
    // Register with a high priority to ensure it runs before other plugins
    // that might also listen to onResponseComplete.
    priority: 100,
    onAppInit: (app) => toolOrchestratorPluginInstance.init(app),
    onResponseComplete: (message, chat) => toolOrchestratorPluginInstance.onResponseComplete(message, chat),
});