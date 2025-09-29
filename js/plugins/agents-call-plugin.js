/**
 * @fileoverview Plugin for allowing agents to call other agents as tools.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { parseToolCalls } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../main.js').Chat} Chat
 * @typedef {import('../tool-processor.js').ToolCall} ToolCall
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
        const callableAgents = effectiveAgentCallSettings.allowAll
            ? allAgents.filter(a => a.id !== agent.id)
            : allAgents.filter(a => effectiveAgentCallSettings.allowed?.includes(a.id));

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
     * Handles a single agent-as-tool call. This method will be called by the central tool orchestrator.
     * It performs the call, streams the response, and returns the final result.
     * @param {ToolCall} call - The tool call to process.
     * @param {Message} message - The original message containing the tool call.
     * @returns {Promise<import('../tool-processor.js').ToolResult>} A promise that resolves to the result of the tool execution.
     */
    async executeAgentCall(call, message) {
        const agentManager = this.app.agentManager;
        const callingAgentId = message.value.agent || 'agent-default';
        const callingAgent = agentManager.getAgent(callingAgentId);
        const targetAgent = agentManager.getAgent(call.name);

        // 1. Validate the call and check permissions first.
        if (!callingAgent || !targetAgent) {
            return { name: call.name, tool_call_id: call.id, error: 'Invalid agent specified.' };
        }

        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        const isAllowed = callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id);
        if (!isAllowed) {
            const error = `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".`;
            return { name: call.name, tool_call_id: call.id, error };
        }

        const prompt = call.params.prompt;
        if (!prompt) {
            return { name: call.name, tool_call_id: call.id, error: 'The "prompt" parameter is required when calling an agent.' };
        }

        const abortController = new AbortController();
        this.app.abortController = abortController; // Make it accessible to the stop button

        let content = '';

        try {
            this.app.dom.stopButton.style.display = 'block';

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

            const reader = await this.app.apiService.streamChat(
                payload, targetAgentConfig.apiUrl, targetAgentConfig.apiKey, abortController.signal
            );

            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                const deltas = lines
                    .map(line => line.replace(/^data: /, '').trim())
                    .filter(line => line !== '' && line !== '[DONE]')
                    .map(line => JSON.parse(line).choices[0].delta.content)
                    .filter(Boolean);

                if (deltas.length > 0) {
                    content += deltas.join('');
                    // We don't notify the chat log here anymore.
                    // The orchestrator will do that once all results are in.
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                content += '\n\n[Aborted by user]';
                // The orchestrator will decide how to handle this.
                // For now, we return the partial content with the abort message.
                return { name: call.name, tool_call_id: call.id, content: content, error: 'Aborted by user.' };
            } else {
                const errorMsg = `An error occurred while calling the agent: ${error.message}`;
                return { name: call.name, tool_call_id: call.id, error: errorMsg };
            }
        } finally {
            this.app.abortController = null;
            this.app.dom.stopButton.style.display = 'none';
        }

        return { name: call.name, tool_call_id: call.id, content: content };
    }
}

const agentsCallPluginInstance = new AgentsCallPlugin();

pluginManager.register({
    name: 'Agents Call Plugin',
    onAppInit: (app) => {
        agentsCallPluginInstance.init(app);
        app.agentsCall = agentsCallPluginInstance;
    },
    onSystemPromptConstruct: (systemPrompt, allSettings, agent) => agentsCallPluginInstance.onSystemPromptConstruct(systemPrompt, allSettings, agent),
});
