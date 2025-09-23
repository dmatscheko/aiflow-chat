/**
 * @fileoverview Plugin for allowing agents to call other agents as tools.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { processToolCalls } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../main.js').Chat} Chat
 * @typedef {import('../tool-processor.js').ToolCall} ToolCall
 * @typedef {import('./agents-plugin.js').Agent} Agent
 */

const agentCallsHeader = `### Callable Agents:

You can call other specialized agents as tools. The format for calling an agent is the same as a regular tool call. The agent's ID is used as the tool name.

Example of calling an agent with the ID 'math-expert':
<dma:tool_call name="math-expert">
<parameter name="prompt">
What is the square root of 144?
</parameter>
</dma:tool_call>

#### Available Agents:\n\n`;


class AgentsCallPlugin {
    /** @type {App} */
    app = null;

    /** @param {App} app */
    init(app) {
        this.app = app;
    }

    /**
     * @param {object} payload
     * @param {object} allSettings
     * @param {Agent} agent
     */
    async beforeApiCall(payload, allSettings, agent) {
        if (!agent) {
            return payload;
        }

        const agentManager = this.app.agentManager;
        const defaultAgent = agentManager.getAgent('agent-default');
        let effectiveAgentCallSettings = defaultAgent.agentCallSettings;

        if (agent.useCustomAgentCallSettings) {
            effectiveAgentCallSettings = agent.agentCallSettings;
        }

        if (!effectiveAgentCallSettings) {
            return payload;
        }

        const allAgents = agentManager.agents;
        const callableAgents = effectiveAgentCallSettings.allowAll
            ? allAgents.filter(a => a.id !== agent.id)
            : allAgents.filter(a => effectiveAgentCallSettings.allowed?.includes(a.id));

        if (callableAgents.length === 0) {
            return payload;
        }

        const agentsSection = callableAgents.map((a, idx) => {
            const desc = a.description || 'No description provided.';
            return `${idx + 1}. **${a.name} (ID: ${a.id})**\n - **Description**: ${desc}\n - **Action** (dma:tool_call name): \`${a.id}\`\n - **Arguments** (parameter name): \n   - \`prompt\`: The user's request to the agent. (type: string)(required)`;
        }).join('\n');

        const systemPrompt = payload.messages.find(m => m.role === 'system');
        if (systemPrompt) {
            systemPrompt.content += '\n\n' + agentCallsHeader + agentsSection;
        }

        return payload;
    }

    /**
     * @param {Message} message
     * @param {Chat} activeChat
     * @returns {Promise<boolean>}
     */
    async onResponseComplete(message, activeChat) {
        if (!message || !message.value.content) {
            return false;
        }

        const agentManager = this.app.agentManager;
        const allAgentIds = new Set(agentManager.agents.map(a => a.id));

        const filterCallback = (call) => allAgentIds.has(call.name);

        const executeCallback = async (call) => {
            const callingAgentId = message.agent;
            const callingAgent = agentManager.getAgent(callingAgentId);
            const targetAgent = agentManager.getAgent(call.name);

            if (!callingAgent || !targetAgent) {
                return { name: call.name, tool_call_id: call.id, error: 'Invalid agent specified.' };
            }

            // Check permissions
            const defaultAgent = agentManager.getAgent('agent-default');
            let effectiveAgentCallSettings = defaultAgent.agentCallSettings;
            if (callingAgent.useCustomAgentCallSettings) {
                effectiveAgentCallSettings = callingAgent.agentCallSettings;
            }
            const isAllowed = effectiveAgentCallSettings.allowAll || effectiveAgentCallSettings.allowed?.includes(targetAgent.id);

            if (!isAllowed) {
                return { name: call.name, tool_call_id: call.id, error: `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".` };
            }

            const prompt = call.params.prompt;
            if (!prompt) {
                return { name: call.name, tool_call_id: call.id, error: 'The "prompt" parameter is required when calling an agent.' };
            }

            try {
                const targetAgentConfig = agentManager.getEffectiveApiConfig(targetAgent.id);
                const messages = [
                    { role: 'system', content: targetAgentConfig.systemPrompt },
                    { role: 'user', content: prompt }
                ];

                const payload = {
                    ...targetAgentConfig,
                    messages,
                    stream: false
                };

                const response = await this.app.apiService.getCompletion(payload);
                const content = response.choices[0]?.message?.content;

                return { name: call.name, tool_call_id: call.id, content: content || '' };

            } catch (error) {
                console.error(`Error calling agent ${targetAgent.name}:`, error);
                return { name: call.name, tool_call_id: call.id, error: `An error occurred while calling the agent: ${error.message}` };
            }
        };

        return processToolCalls(
            this.app,
            activeChat,
            message,
            [], // No specific tool schemas needed here, as we are not doing type coercion.
            filterCallback,
            executeCallback
        );
    }
}

const agentsCallPluginInstance = new AgentsCallPlugin();

pluginManager.register({
    name: 'Agents Call Plugin',
    onAppInit: (app) => agentsCallPluginInstance.init(app),
    beforeApiCall: (payload, allSettings, agent) => agentsCallPluginInstance.beforeApiCall(payload, allSettings, agent),
    onResponseComplete: (message, activeChat) => agentsCallPluginInstance.onResponseComplete(message, activeChat),
});
