/**
 * @fileoverview Plugin for handling agent-to-agent calls.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { processToolCalls as genericProcessToolCalls } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../main.js').Chat} Chat
 * @typedef {import('../tool-processor.js').ToolSchema} ToolSchema
 * @typedef {import('./agents-plugin.js').Agent} Agent
 */

const agentsHeader = `### Callable Agents:

You can call other agents as tools. Make sure to follow the following XML-inspired format:
<dma:tool_call name="agent-some-agent-id">
<parameter name="prompt">
The prompt for the agent to be called
</parameter>
</dma:tool_call>
Do not escape any of the tool call arguments. The arguments will be parsed as normal text. There is one exception: If you need to write </dma:tool_call> or </parameter> as value inside a <parameter>, write it like <\/dma:tool_call> or <\/parameter>.

You can use multiple tools in one message, but either use tools or write an answer in a message. Use tools only if you need them.

#### Available Agents:\n\n`;

/**
 * Singleton class to manage agent-to-agent calls.
 */
class AgentsCallPlugin {
    /** @type {AgentsCallPlugin | null} */
    static #instance = null;

    /**
     * The application instance.
     * @type {App | null}
     * @private
     */
    #app = null;

    /**
     * Enforces the singleton pattern.
     * @returns {AgentsCallPlugin}
     */
    constructor() {
        if (AgentsCallPlugin.#instance) {
            return AgentsCallPlugin.#instance;
        }
        AgentsCallPlugin.#instance = this;
    }

    /**
     * Initializes the plugin and stores the app instance.
     * @param {App} app - The main application instance.
     */
    init(app) {
        this.#app = app;
    }

    /**
     * Gets the application instance.
     * @returns {App}
     */
    getApp() {
        return this.#app;
    }

    /**
     * Executes a single agent call.
     * @param {import('../tool-processor.js').ToolCall} call
     * @param {Message} message
     * @returns {Promise<import('../tool-processor.js').ToolResult>}
     */
    async executeAgentCall(call, message) {
        const app = this.#app;
        if (!app) return { name: call.name, tool_call_id: call.id, error: 'App not initialized' };

        const callingAgentId = message.agent || 'agent-default';
        const targetAgentId = call.name;

        if (callingAgentId === targetAgentId) {
            return { name: call.name, tool_call_id: call.id, error: 'Agent cannot call itself.' };
        }

        const callingAgent = app.agentManager.getAgent(callingAgentId);
        const defaultAgent = app.agentManager.getAgent('agent-default');

        let effectiveAgentToolSettings;
        if (callingAgent && callingAgent.id !== 'agent-default' && callingAgent.useCustomToolSettings) {
            effectiveAgentToolSettings = callingAgent.agentToolSettings || { allowAll: false, allowed: [] };
        } else {
            effectiveAgentToolSettings = defaultAgent.agentToolSettings || { allowAll: false, allowed: [] };
        }

        const isAllowed = effectiveAgentToolSettings.allowAll || effectiveAgentToolSettings.allowed?.includes(targetAgentId);

        if (!isAllowed) {
            return { name: call.name, tool_call_id: call.id, error: `Agent "${callingAgent.name}" is not allowed to call agent "${targetAgentId}".` };
        }

        const targetAgent = app.agentManager.getAgent(targetAgentId);
        if (!targetAgent) {
            return { name: call.name, tool_call_id: call.id, error: `Could not find agent with id "${targetAgentId}".` };
        }

        const prompt = call.params?.prompt;
        if (typeof prompt !== 'string' || !prompt) {
            return { name: call.name, tool_call_id: call.id, error: 'Missing or invalid "prompt" parameter for agent call.' };
        }

        try {
            const targetAgentConfig = app.agentManager.getEffectiveApiConfig(targetAgentId);

            const payload = {
                messages: [
                    { role: 'system', content: targetAgentConfig.systemPrompt },
                    { role: 'user', content: prompt }
                ],
                model: targetAgentConfig.model,
                temperature: targetAgentConfig.temperature,
                // top_p, etc. could be added here if needed
            };

            const response = await app.apiService.getCompletion(payload, targetAgentConfig);

            // Assuming getCompletion returns a string response. Adjust if it returns an object.
            const content = typeof response === 'string' ? response : response.content;

            return { name: call.name, tool_call_id: call.id, content: content, error: null };

        } catch (err) {
            console.error('Agent call execution error', err);
            return { name: call.name, tool_call_id: call.id, error: err.message || 'Unknown error during agent call' };
        }
    }

    /**
     * Generates the agents Markdown section for the system prompt based on agent settings.
     * @param {Agent | null} agent
     * @param {Agent[]} availableAgents
     * @returns {string}
     */
    generateAgentsSection(agent, availableAgents) {
        const agentManager = this.#app?.agentManager;
        if (!agentManager) return '';

        const defaultAgent = agentManager.getAgent('agent-default');
        let effectiveAgentToolSettings;
        if (agent && agent.id !== 'agent-default' && agent.useCustomToolSettings) {
            effectiveAgentToolSettings = agent.agentToolSettings || { allowAll: false, allowed: [] };
        } else {
            effectiveAgentToolSettings = defaultAgent.agentToolSettings || { allowAll: false, allowed: [] };
        }

        if (!effectiveAgentToolSettings) return '';

        const callableAgents = effectiveAgentToolSettings.allowAll
            ? availableAgents.filter(a => a.id !== agent?.id) // Exclude self
            : availableAgents.filter(a => a.id !== agent?.id && effectiveAgentToolSettings.allowed?.includes(a.id));

        if (!callableAgents || callableAgents.length === 0) {
            return '';
        }

        return callableAgents.map((callableAgent, idx) => {
            const desc = callableAgent.systemPrompt || 'No description provided.';
            const action = callableAgent.id;
            const displayName = callableAgent.name;
            return `${idx + 1}. **${displayName}**\n - **Description**: ${desc}\n - **Action** (dma:tool_call name): \`${action}\``;
        }).join('\n');
    }
}

// --- Singleton Instance ---
const agentsCallPluginSingleton = new AgentsCallPlugin();

// --- Plugin Definition ---

/**
 * Plugin for handling agent-to-agent calls.
 * @type {import('../plugin-manager.js').Plugin}
 */
const agentsCallPluginDefinition = {
    name: 'AgentsCall',

    onAppInit(app) {
        agentsCallPluginSingleton.init(app);
    },

    async beforeApiCall(payload, allSettings, agent) {
        const app = agentsCallPluginSingleton.getApp();
        const allAgents = app.agentManager.agents;
        if (!allAgents || allAgents.length === 0) {
            return payload;
        }

        const dynamicAgentsSection = agentsCallPluginSingleton.generateAgentsSection(agent, allAgents);
        if (dynamicAgentsSection) {
            const systemPrompt = payload.messages.find(m => m.role === 'system');
            if (systemPrompt && !systemPrompt.content.includes(agentsHeader)) {
                systemPrompt.content += '\n\n' + agentsHeader + dynamicAgentsSection;
            }
        }
        return payload;
    },

    async onResponseComplete(message, activeChat) {
        if (!message) {
            return false;
        }

        const app = agentsCallPluginSingleton.getApp();
        const allAgents = app.agentManager.agents;
        if (!allAgents || allAgents.length === 0) return false;

        const agentTools = allAgents.map(agent => ({
            name: agent.id,
            description: agent.systemPrompt,
            inputSchema: {
                type: 'object',
                properties: {
                    prompt: {
                        type: 'string',
                        description: 'The prompt to send to the agent.'
                    }
                },
                required: ['prompt']
            }
        }));

        return await genericProcessToolCalls(
            app,
            activeChat,
            message,
            agentTools,
            (call) => allAgents.some(agent => agent.id === call.name), // filter
            (call, msg) => agentsCallPluginSingleton.executeAgentCall(call, msg) // executor
        );
    },
};

pluginManager.register(agentsCallPluginDefinition);
