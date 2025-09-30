/**
 * @fileoverview Plugin for allowing agents to call other agents as tools.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../tool-processor.js').ToolCall} ToolCall
 * @typedef {import('../tool-processor.js').ToolResult} ToolResult
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
        // Register the executor for agent-to-agent calls.
        // All agent IDs start with 'agent-', so we can use a prefix-based executor.
        app.toolExecutionManager.registerExecutor(
            'agent-',
            (call, message) => this._executeAgentCall(call, message)
        );
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
            ? allAgents.filter(a => a.id !== agent?.id)
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
     * Handles a single agent-as-tool call and returns a tool result.
     * @param {ToolCall} call - The tool call to process.
     * @param {Message} message - The original message containing the tool call.
     * @returns {Promise<ToolResult>} A promise that resolves to a tool result object.
     * @private
     */
    async _executeAgentCall(call, message) {
        const agentManager = this.app.agentManager;
        const callingAgentId = message.value.agent || 'agent-default';
        const callingAgent = agentManager.getAgent(callingAgentId);
        const targetAgent = agentManager.getAgent(call.name);

        if (!callingAgent || !targetAgent) {
            return { name: call.name, tool_call_id: call.id, error: 'Invalid agent specified.' };
        }

        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        const isAllowed = callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id);
        if (!isAllowed) {
            return { name: call.name, tool_call_id: call.id, error: `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".` };
        }

        const prompt = call.params.prompt;
        if (!prompt) {
            return { name: call.name, tool_call_id: call.id, error: 'The "prompt" parameter is required when calling an agent.' };
        }

        const abortController = new AbortController();
        this.app.abortController = abortController;

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

            let content = '';
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                const deltas = lines
                    .map(line => line.replace(/^data: /, '').trim())
                    .filter(line => line !== '' && line !== '[DONE]')
                    .map(line => {
                        try {
                            return JSON.parse(line).choices[0].delta.content;
                        } catch {
                            return null;
                        }
                    })
                    .filter(Boolean);

                if (deltas.length > 0) {
                    content += deltas.join('');
                }
            }
            return { name: call.name, tool_call_id: call.id, content: content };

        } catch (error) {
            if (error.name === 'AbortError') {
                return { name: call.name, tool_call_id: call.id, error: 'Aborted by user.' };
            } else {
                return { name: call.name, tool_call_id: call.id, error: `An error occurred while calling the agent: ${error.message}` };
            }
        } finally {
            this.app.abortController = null;
            this.app.dom.stopButton.style.display = 'none';
        }
    }
}

const agentsCallPluginInstance = new AgentsCallPlugin();

pluginManager.register({
    name: 'Agents Call Plugin',
    onAppInit: (app) => agentsCallPluginInstance.init(app),
    onSystemPromptConstruct: (systemPrompt, allSettings, agent) => agentsCallPluginInstance.onSystemPromptConstruct(systemPrompt, allSettings, agent),
});