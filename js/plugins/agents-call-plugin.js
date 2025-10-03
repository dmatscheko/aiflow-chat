/**
 * @fileoverview Plugin for allowing agents to call other agents as tools.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../tool-processor.js').ToolCall} ToolCall
 * @typedef {import('../tool-processor.js').ToolExecutionResult} ToolExecutionResult
 * @typedef {import('./agents-plugin.js').Agent} Agent
 */

const agentCallsHeader = `### Callable Agents:

You can call other specialized agents as tools. The format for calling an agent is the same as a regular tool call. The agent's ID is used as the tool name.

Example of calling an agent with the ID 'agent-598356234':
<dma:tool_call name="agent-598356234">
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
     * Contributes the list of callable agents to the system prompt.
     * @param {string} systemPrompt
     * @param {object} allSettings
     * @param {Agent} agent
     * @returns {Promise<string>}
     */
    async onSystemPromptConstruct(systemPrompt, allSettings, agent) {
        const effectiveAgentCallSettings = allSettings.agentCallSettings;

        if (!effectiveAgentCallSettings) {
            return systemPrompt;
        }

        const agentManager = this.app.agentManager;
        const allAgents = agentManager.agents;
        // An agent cannot call itself.
        const callableAgents = (effectiveAgentCallSettings.allowAll
            ? allAgents.filter(a => a.id !== agent.id)
            : allAgents.filter(a => effectiveAgentCallSettings.allowed?.includes(a.id)))
            .filter(a => a.id !== agent.id);


        if (callableAgents.length === 0) {
            return systemPrompt;
        }

        const agentsSection = callableAgents.map((a, idx) => {
            const desc = a.description || 'No description provided.';
            return `${idx + 1}. **${a.name} (ID: ${a.id})**\n - **Description**: ${desc}\n - **Action** (dma:tool_call name): \`${a.id}\`\n - **Arguments** (parameter name): \n   - \`prompt\`: The user's request to the agent. (type: string)(required)`;
        }).join('\n');

        if (systemPrompt) {
            systemPrompt += '\n\n';
        }
        systemPrompt += agentCallsHeader + agentsSection;

        return systemPrompt;
    }

    /**
     * Handles an agent-as-tool call dispatched by the ToolCallManager.
     * @param {ToolCall} call - The tool call to process.
     * @param {Message} message - The original message containing the tool call.
     * @returns {Promise<ToolExecutionResult | null>} A promise that resolves to the result, or null if this plugin doesn't handle the call.
     */
    async onToolCall(call, message) {
        const agentManager = this.app.agentManager;
        const allAgentIds = new Set(agentManager.agents.map(a => a.id));

        // 1. Check if this tool call is meant for an agent.
        if (!allAgentIds.has(call.name)) {
            return null; // Not an agent call, let other plugins handle it.
        }

        // 2. Validate the call and check permissions.
        const callingAgentId = message.value.agent || 'agent-default';
        const callingAgent = agentManager.getAgent(callingAgentId);
        const targetAgent = agentManager.getAgent(call.name);

        if (!callingAgent || !targetAgent) {
            return { error: 'Invalid agent specified in tool call.' };
        }

        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        const isAllowed = callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id);
        if (!isAllowed) {
            return { error: `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".` };
        }

        const prompt = call.params.prompt;
        if (!prompt) {
            return { error: 'The "prompt" parameter is required when calling an agent.' };
        }

        // 3. Execute the call and return a streaming result.
        try {
            const targetAgentConfig = agentManager.getEffectiveApiConfig(targetAgent.id);
            const payload = {
                model: targetAgentConfig.model,
                messages: [
                    { role: 'system', content: targetAgentConfig.systemPrompt },
                    { role: 'user', content: prompt }
                ],
                stream: true,
                temperature: targetAgentConfig.temperature,
                top_p: targetAgentConfig.top_p,
            };

            // Note: The AbortController is now managed by the ResponseProcessor/ToolCallManager
            // for the entire sequence, so we don't create a new one here.
            const reader = await this.app.apiService.streamChat(
                payload, targetAgentConfig.apiUrl, targetAgentConfig.apiKey, this.app.abortController.signal
            );

            return { isStreaming: true, streamReader: reader };

        } catch (error) {
            if (error.name === 'AbortError') {
                return { content: '\n\n[Aborted by user]' };
            }
            console.error(`Error during agent-to-agent call:`, error);
            return { error: `An error occurred while calling the agent: ${error.message}` };
        }
    }
}

const agentsCallPluginInstance = new AgentsCallPlugin();

pluginManager.register({
    name: 'Agents Call Plugin',
    onAppInit: (app) => agentsCallPluginInstance.init(app),
    onSystemPromptConstruct: (systemPrompt, allSettings, agent) => agentsCallPluginInstance.onSystemPromptConstruct(systemPrompt, allSettings, agent),
    onToolCall: (call, message) => agentsCallPluginInstance.onToolCall(call, message),
});