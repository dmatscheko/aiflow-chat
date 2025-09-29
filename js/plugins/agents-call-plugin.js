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
        if (!effectiveAgentCallSettings) return systemPrompt;

        const agentManager = this.app.agentManager;
        const allAgents = agentManager.agents;
        const callableAgents = effectiveAgentCallSettings.allowAll
            ? allAgents.filter(a => a.id !== agent.id)
            : allAgents.filter(a => effectiveAgentCallSettings.allowed?.includes(a.id));

        if (callableAgents.length === 0) return systemPrompt;

        const agentsSection = callableAgents.map((a, idx) => {
            const desc = a.description || 'No description provided.';
            return `${idx + 1}. **${a.name} (ID: ${a.id})**\n - **Description**: ${desc}\n - **Action** (dma:tool_call name): \`${a.id}\`\n - **Arguments** (parameter name): \n   - \`prompt\`: The user's request to the agent. (type: string)(required)`;
        }).join('\n');

        if (systemPrompt) systemPrompt += '\n\n';
        systemPrompt += agentCallsHeader + agentsSection;
        return systemPrompt;
    }

    /**
     * Informs the central orchestrator if this plugin can execute a given tool.
     * @param {string} toolName - The name of the tool.
     * @returns {Function | null} The executor function if this plugin handles the tool, otherwise null.
     */
    getToolExecutor(toolName) {
        const agentManager = this.app.agentManager;
        const allAgentIds = new Set(agentManager.agents.map(a => a.id));
        if (allAgentIds.has(toolName)) {
            return this._handleAgentCall.bind(this);
        }
        return null;
    }

    /**
     * Handles a single agent-as-tool call by running a self-contained execution loop.
     * @param {ToolCall} call - The tool call to process.
     * @param {Message} message - The original message containing the tool call.
     * @returns {Promise<import('../tool-processor.js').ToolResult>} A promise that resolves to the final tool result.
     * @private
     */
    async _handleAgentCall(call, message) {
        const agentManager = this.app.agentManager;
        const callingAgent = agentManager.getAgent(message.value.agent || 'agent-default');
        const targetAgent = agentManager.getAgent(call.name);

        if (!callingAgent || !targetAgent) {
            return { name: call.name, tool_call_id: call.id, error: 'Invalid agent specified.' };
        }
        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        if (!(callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id))) {
            return { name: call.name, tool_call_id: call.id, error: `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".` };
        }
        const prompt = call.params.prompt;
        if (!prompt) {
            return { name: call.name, tool_call_id: call.id, error: 'The "prompt" parameter is required when calling an agent.' };
        }

        this.app.dom.stopButton.style.display = 'block';
        const abortController = new AbortController();
        this.app.abortController = abortController;

        try {
            const finalResult = await this._runSubAgent(targetAgent, prompt, abortController.signal);
            return { name: call.name, tool_call_id: call.id, content: finalResult };
        } catch (error) {
            if (error.name === 'AbortError') {
                return { name: call.name, tool_call_id: call.id, content: '\n\n[Sub-agent call aborted by user]' };
            }
            console.error(`Error in sub-agent call to "${targetAgent.name}":`, error);
            return { name: call.name, tool_call_id: call.id, error: error.message };
        } finally {
            this.app.abortController = null;
            this.app.dom.stopButton.style.display = 'none';
        }
    }

    /**
     * Executes a sub-agent conversation loop until a final text response is received.
     * @param {Agent} agent - The agent to run.
     * @param {string} prompt - The initial prompt for the agent.
     * @param {AbortSignal} signal - The abort signal for the operation.
     * @returns {Promise<string>} The final text content from the sub-agent.
     * @private
     */
    async _runSubAgent(agent, prompt, signal) {
        const agentConfig = this.app.agentManager.getEffectiveApiConfig(agent.id);
        const subHistory = [
            { role: 'system', content: agentConfig.systemPrompt },
            { role: 'user', content: prompt }
        ];

        for (let i = 0; i < 10; i++) { // Max 10 iterations to prevent infinite loops
            if (signal.aborted) throw new Error('AbortError');

            const assistantResponse = await this._callSubAgentLlm(subHistory, agentConfig, signal);
            subHistory.push({ role: 'assistant', content: assistantResponse, agent: agent.id });

            const { toolCalls } = parseToolCalls(assistantResponse);
            if (toolCalls.length === 0) return assistantResponse;

            const promises = toolCalls.map(call => {
                const executor = this.app.pluginManager.getToolExecutor(call.name);
                if (executor) {
                    // Pass a dummy message with the sub-agent's context
                    const dummyMessage = { value: { agent: agent.id } };
                    return executor(call, dummyMessage);
                }
                return Promise.resolve({ name: call.name, tool_call_id: call.id, error: `Unknown tool: ${call.name}` });
            });

            const results = await Promise.all(promises);
            let toolContents = '';
            results.forEach(tr => {
                const inner = tr.error ? `<error>${tr.error}</error>` : `<content>${tr.content}</content>`;
                toolContents += `<dma:tool_response name="${tr.name}" tool_call_id="${tr.tool_call_id}">${inner}</dma:tool_response>\n`;
            });
            subHistory.push({ role: 'tool', content: toolContents });
        }
        throw new Error(`Sub-agent "${agent.name}" exceeded maximum iteration limit.`);
    }

    /**
     * Calls the LLM for the sub-agent and returns the streamed response as a single string.
     * @param {object[]} messages - The message history for the sub-agent call.
     * @param {object} agentConfig - The effective API config for the agent.
     * @param {AbortSignal} signal - The abort signal.
     * @returns {Promise<string>} The complete assistant message content.
     * @private
     */
    async _callSubAgentLlm(messages, agentConfig, signal) {
        const payload = {
            model: agentConfig.model,
            messages: messages,
            stream: true,
            temperature: agentConfig.temperature,
            top_p: agentConfig.top_p,
        };
        const reader = await this.app.apiService.streamChat(payload, agentConfig.apiUrl, agentConfig.apiKey, signal);
        let content = '';
        const decoder = new TextDecoder();
        while (true) {
            if (signal.aborted) throw new Error('AbortError');
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
            if (deltas.length > 0) content += deltas.join('');
        }
        return content;
    }
}

const agentsCallPluginInstance = new AgentsCallPlugin();

pluginManager.register({
    name: 'Agents Call Plugin',
    onAppInit: (app) => agentsCallPluginInstance.init(app),
    onSystemPromptConstruct: (systemPrompt, allSettings, agent) => agentsCallPluginInstance.onSystemPromptConstruct(systemPrompt, allSettings, agent),
    getToolExecutor: (toolName) => agentsCallPluginInstance.getToolExecutor(toolName),
});
