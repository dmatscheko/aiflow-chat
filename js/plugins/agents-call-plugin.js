/**
 * @fileoverview Plugin for allowing agents to call other agents as tools.
 * @version 2.0.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { parseToolCalls } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../main.js').Chat} Chat
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
        // Exclude the current agent from the callable list.
        // If agent is null, it means the Default Agent is running.
        const currentAgentId = agent ? agent.id : 'agent-default';
        const callableAgents = effectiveAgentCallSettings.allowAll
            ? allAgents.filter(a => a.id !== currentAgentId)
            : allAgents.filter(a => effectiveAgentCallSettings.allowed?.includes(a.id) && a.id !== currentAgentId);

        if (callableAgents.length === 0) {
            return systemPrompt;
        }

        const agentsSection = callableAgents.map((a, idx) => {
            const desc = a.description || 'No description provided.';
            return `${idx + 1}. **${a.name} (ID: ${a.id})**\n - **Description**: ${desc}\n - **Action** (dma:tool_call name): \`${a.id}\`\n - **Arguments** (parameter name): \n   - \`prompt\`: The user's request to the agent. (type: string)(required)`;
        }).join('\n');

        return `${systemPrompt}\n\n${agentCallsHeader}${agentsSection}`;
    }

    /**
     * Executes a single agent-as-tool call.
     * This is invoked by the central ToolCallProcessor.
     * @param {ToolCall} call - The tool call to process.
     * @param {Message} message - The original message containing the tool call.
     * @returns {Promise<ToolResult>} A promise that resolves to a tool result object.
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
            return { name: call.name, tool_call_id: call.id, error: `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".` };
        }

        const prompt = call.params.prompt;
        if (!prompt) {
            return { name: call.name, tool_call_id: call.id, error: 'The "prompt" parameter is required when calling an agent.' };
        }

        const abortController = new AbortController();
        this.app.abortController = abortController;

        let responseContent = '';
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
                    .map(line => {
                        try {
                            return JSON.parse(line).choices[0].delta.content;
                        } catch {
                            return null;
                        }
                    })
                    .filter(Boolean);

                if (deltas.length > 0) {
                    responseContent += deltas.join('');
                    // We don't notify the UI here; the result is returned to the processor.
                }
            }
            return { name: call.name, tool_call_id: call.id, content: responseContent };
        } catch (error) {
            if (error.name === 'AbortError') {
                responseContent += '\n\n[Aborted by user]';
                return { name: call.name, tool_call_id: call.id, content: responseContent };
            } else {
                return { name: call.name, tool_call_id: call.id, error: `An error occurred while calling agent '${targetAgent.name}': ${error.message}` };
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

    /**
     * This hook is called by the ResponseProcessor to parse for agent calls in a message.
     * @param {ToolCall[]} toolCalls - The array of tool calls collected so far.
     * @param {Message} message - The message being parsed.
     * @param {Chat} activeChat - The active chat instance.
     * @returns {ToolCall[]} The updated array of tool calls.
     */
    onToolCallParse(toolCalls, message, activeChat) {
        if (!message?.value.content) {
            return toolCalls;
        }
        const app = agentsCallPluginInstance.app;
        const agentManager = app.agentManager;
        const allAgentIds = new Set(agentManager.agents.map(a => a.id));

        // We re-parse the content here. This is acceptable because parseToolCalls is efficient
        // and it ensures that each plugin is responsible for identifying its own calls.
        const parsedResult = parseToolCalls(message.value.content);
        if (!parsedResult) {
            return toolCalls;
        }

        const agentCalls = parsedResult.toolCalls.filter(call => allAgentIds.has(call.name));

        if (agentCalls.length > 0) {
            // Add the identified agent calls to the main list.
            toolCalls.push(...agentCalls);
            // Update the message content with the injected tool_call_ids.
            message.value.content = parsedResult.modifiedContent;
            message.cache = null; // Invalidate cache to force re-render with new IDs
            activeChat.log.notify();
        }

        return toolCalls;
    },

    /**
     * This hook is called by the ToolCallProcessor to execute a specific agent call.
     * @param {ToolCall} call - The tool call to execute.
     * @param {Message} message - The source message of the call.
     * @returns {Promise<ToolResult|null>} A tool result, or null if this plugin doesn't handle this call.
     */
    async onToolCallExecute(call, message) {
        const agentManager = agentsCallPluginInstance.app.agentManager;
        const allAgentIds = new Set(agentManager.agents.map(a => a.id));

        // Check if the call's name corresponds to a known agent ID.
        if (allAgentIds.has(call.name)) {
            return await agentsCallPluginInstance.executeAgentCall(call, message);
        }
        // If it's not an agent call, return null to let other plugins handle it.
        return null;
    },
});