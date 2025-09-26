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
        const { toolCalls } = parseToolCalls(message.value.content);
        const agentCalls = toolCalls.filter(call => allAgentIds.has(call.name));

        if (agentCalls.length === 0) {
            return false;
        }

        let wasAborted = false;
        for (const call of agentCalls) {
            const wasCallAborted = await this._handleAgentCall(call, message, activeChat);
            if (wasCallAborted) {
                wasAborted = true;
            }
        }

        if (wasAborted) {
            return true; // Stop processing, don't queue the next turn.
        }

        // After all agent calls are handled, queue up the next step for the AI.
        const callingAgentId = message.value.agent || 'agent-default';
        activeChat.log.addMessage({ role: 'assistant', content: null, agent: callingAgentId });
        this.app.responseProcessor.scheduleProcessing(this.app);
        return true;
    }

    /**
     * Handles a single agent-as-tool call, including nested tool calls from the sub-agent.
     * @param {ToolCall} call - The tool call to process.
     * @param {Message} message - The original message containing the tool call.
     * @param {Chat} activeChat - The active chat instance.
     * @returns {Promise<boolean>} A promise that resolves to true if the call was aborted, false otherwise.
     * @private
     */
    async _handleAgentCall(call, message, activeChat) {
        const agentManager = this.app.agentManager;
        const callingAgentId = message.value.agent || 'agent-default';
        const callingAgent = agentManager.getAgent(callingAgentId);
        const targetAgent = agentManager.getAgent(call.name);

        if (!callingAgent || !targetAgent) {
            this._addErrorToolResponse(activeChat, message.id, call, 'Invalid agent specified.');
            return false;
        }

        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        if (!(callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id))) {
            this._addErrorToolResponse(activeChat, message.id, call, `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".`);
            return false;
        }

        const prompt = call.params.prompt;
        if (!prompt) {
            this._addErrorToolResponse(activeChat, message.id, call, 'The "prompt" parameter is required when calling an agent.');
            return false;
        }

        const abortController = new AbortController();
        this.app.abortController = abortController;

        const toolResponseMessage = {
            role: 'tool',
            content: '',
            tool_call_id: call.id,
            name: call.name,
            agent: targetAgent.id,
        };
        activeChat.log.addMessage(toolResponseMessage, message.id);

        try {
            this.app.dom.stopButton.style.display = 'block';
            let currentMessages = [{ role: 'user', content: prompt }];
            let finalResponse = null;

            // Loop to handle potential nested tool calls from the sub-agent
            for (let i = 0; i < 5; i++) { // Limit to 5 iterations to prevent infinite loops
                const subAgentResponse = await this._getAgentResponse(targetAgent, currentMessages, abortController.signal);
                if (subAgentResponse.aborted) return true; // Propagate abort signal

                const { toolCalls } = parseToolCalls(subAgentResponse.content);

                if (toolCalls.length === 0) {
                    finalResponse = subAgentResponse.content;
                    break; // No more tools to call, exit loop
                }

                // Sub-agent wants to use tools. Execute them.
                const mcpUrl = agentManager.getEffectiveApiConfig(targetAgent.id).toolSettings.mcpServer;
                const toolPromises = toolCalls.map(tc => this.app.mcp.executeMcpCall(tc, { value: { agent: targetAgent.id } }, mcpUrl));
                const toolResults = await Promise.all(toolPromises);

                let toolContents = '';
                toolResults.forEach(tr => {
                    const inner = tr.error ? `<error>${tr.error}</error>` : `<content>${tr.content}</content>`;
                    toolContents += `<dma:tool_response name="${tr.name}" tool_call_id="${tr.tool_call_id}">${inner}</dma:tool_response>\n`;
                });

                // Add the sub-agent's turn and the tool results to its message history for the next call
                currentMessages.push({ role: 'assistant', content: subAgentResponse.content });
                currentMessages.push({ role: 'tool', content: toolContents });
            }

            if (finalResponse) {
                toolResponseMessage.content = finalResponse;
            } else {
                toolResponseMessage.content = '<error>Agent exceeded maximum tool call iterations.</error>';
            }
            activeChat.log.notify();

        } catch (error) {
            if (error.name === 'AbortError') {
                toolResponseMessage.content += '\n\n[Aborted by user]';
                return true;
            }
            toolResponseMessage.content = `<error>An error occurred while calling the agent: ${error.message}</error>`;
        } finally {
            this.app.abortController = null;
            this.app.dom.stopButton.style.display = 'none';
            activeChat.log.notify();
        }
        return false;
    }

    /**
     * Gets a single, complete response from an agent, handling the streaming API call.
     * @param {Agent} agent - The agent to get a response from.
     * @param {object[]} messages - The message history to send to the agent.
     * @param {AbortSignal} signal - The abort signal for the API call.
     * @returns {Promise<{content: string, aborted: boolean}>} The agent's full response.
     * @private
     */
    async _getAgentResponse(agent, messages, signal) {
        const agentConfig = this.app.agentManager.getEffectiveApiConfig(agent.id);
        const payload = {
            model: agentConfig.model,
            messages: [{ role: 'system', content: agentConfig.systemPrompt }, ...messages],
            stream: true,
            temperature: agentConfig.temperature,
            top_p: agentConfig.top_p,
        };

        const reader = await this.app.apiService.streamChat(
            payload, agentConfig.apiUrl, agentConfig.apiKey, signal
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
                    try { return JSON.parse(line).choices[0].delta.content; } catch { return null; }
                })
                .filter(Boolean);
            content += deltas.join('');
        }
        return { content, aborted: signal.aborted };
    }

    /**
     * Adds a tool response message with a pre-formatted error.
     * @param {Chat} activeChat
     * @param {string} originalMessageId
     * @param {ToolCall} call
     * @param {string} errorMessage
     * @private
     */
    _addErrorToolResponse(activeChat, originalMessageId, call, errorMessage) {
        const toolResponseMessage = {
            role: 'tool',
            content: `<error>${errorMessage}</error>`,
            tool_call_id: call.id,
            name: call.name,
        };
        activeChat.log.addMessage(toolResponseMessage, originalMessageId);
    }
}

const agentsCallPluginInstance = new AgentsCallPlugin();

pluginManager.register({
    name: 'Agents Call Plugin',
    onAppInit: (app) => agentsCallPluginInstance.init(app),
    onSystemPromptConstruct: (systemPrompt, allSettings, agent) => agentsCallPluginInstance.onSystemPromptConstruct(systemPrompt, allSettings, agent),
    onResponseComplete: (message, activeChat) => agentsCallPluginInstance.onResponseComplete(message, activeChat),
});
