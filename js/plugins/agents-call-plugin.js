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
     * @param {Agent | null} agent - The agent for which the prompt is being constructed. Can be null.
     * @returns {Promise<string>}
     */
    async onSystemPromptConstruct(systemPrompt, allSettings, agent) {
        const effectiveAgentCallSettings = allSettings.agentCallSettings;

        if (!effectiveAgentCallSettings) {
            return systemPrompt;
        }

        const agentManager = this.app.agentManager;
        const allAgents = agentManager.agents;

        // If an agent is specified, don't include it in its own list of callable agents.
        const currentAgentId = agent ? agent.id : null;

        const callableAgents = effectiveAgentCallSettings.allowAll
            ? allAgents.filter(a => a.id !== currentAgentId)
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
     * Executes an agent-as-a-tool call.
     * @param {ToolCall} call - The tool call to process.
     * @param {Message} message - The original message containing the tool call.
     * @returns {Promise<import('../tool-processor.js').ToolResult|false>} A promise that resolves to a ToolResult or false if this plugin doesn't handle the call.
     */
    async onExecuteToolCall(call, message) {
        const agentManager = this.app.agentManager;
        const allAgentIds = new Set(agentManager.agents.map(a => a.id));

        // This plugin only handles calls where the tool name is a valid agent ID.
        if (!allAgentIds.has(call.name)) {
            return false; // Let other plugins (like mcp-plugin) handle it.
        }

        const callingAgentId = message.value.agent || 'agent-default';
        const callingAgent = agentManager.getAgent(callingAgentId);
        const targetAgent = agentManager.getAgent(call.name);

        // 1. Validate the call and check permissions.
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

        // 2. Prepare and execute the streaming call.
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

        const abortController = new AbortController();
        this.app.abortController = abortController;
        this.app.dom.stopButton.style.display = 'block';

        try {
            const streamReader = await this.app.apiService.streamChat(
                payload, targetAgentConfig.apiUrl, targetAgentConfig.apiKey, abortController.signal
            );

            // 3. Return a ToolResult with an async generator for the stream.
            return {
                name: call.name,
                tool_call_id: call.id,
                isStreaming: true,
                stream: this._streamResponse(streamReader),
            };
        } catch (error) {
            console.error(`Agent call failed for ${call.name}:`, error);
            return { name: call.name, tool_call_id: call.id, error: error.message };
        } finally {
            // The stop button will be hidden by the ToolCallManager's stream consumer.
            // We don't hide it here because the stream is still active.
        }
    }

    /**
     * An async generator that processes the raw stream from the API.
     * @param {ReadableStreamDefaultReader<Uint8Array>} reader - The stream reader.
     * @private
     */
    async* _streamResponse(reader) {
        const decoder = new TextDecoder();
        let aborted = false;
        try {
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
                            return null; // Ignore invalid JSON chunks
                        }
                    })
                    .filter(Boolean);

                if (deltas.length > 0) {
                    yield deltas.join('');
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                aborted = true;
                console.log('Agent call stream aborted by user.');
                yield '\n\n[Aborted by user]';
            } else {
                console.error('Agent call stream error:', error);
                yield `\n\n<error>An error occurred: ${error.message}</error>`;
            }
        } finally {
            if (this.app.abortController && !aborted) {
                this.app.abortController = null;
            }
            this.app.dom.stopButton.style.display = 'none';
        }
    }
}

const agentsCallPluginInstance = new AgentsCallPlugin();

pluginManager.register({
    name: 'Agents Call Plugin',
    onAppInit: (app) => agentsCallPluginInstance.init(app),
    onSystemPromptConstruct: (systemPrompt, allSettings, agent) => agentsCallPluginInstance.onSystemPromptConstruct(systemPrompt, allSettings, agent),
    onExecuteToolCall: (call, message) => agentsCallPluginInstance.onExecuteToolCall(call, message),
});
