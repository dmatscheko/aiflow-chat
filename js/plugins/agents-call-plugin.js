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
        const effectiveAgentCallSettings = allSettings.agentCallSettings;

        if (!effectiveAgentCallSettings) {
            return payload;
        }

        const agentManager = this.app.agentManager;
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

        const { toolCalls } = parseToolCalls(message.value.content);
        const agentCalls = toolCalls.filter(call => allAgentIds.has(call.name));

        if (agentCalls.length === 0) {
            return false;
        }

        const callingAgentId = message.value.agent || 'agent-default';
        const callingAgent = agentManager.getAgent(callingAgentId);
        let wasAborted = false;

        for (const call of agentCalls) {
            const targetAgent = agentManager.getAgent(call.name);

            let toolContent = '';
            let toolError = null;

            if (!callingAgent || !targetAgent) {
                toolError = 'Invalid agent specified.';
            } else {
                const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
                const effectiveAgentCallSettings = callingAgentConfig.agentCallSettings;
                const isAllowed = effectiveAgentCallSettings.allowAll || effectiveAgentCallSettings.allowed?.includes(targetAgent.id);

                if (!isAllowed) {
                    toolError = `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".`;
                }
            }

            const prompt = call.params.prompt;
            if (!prompt) {
                toolError = 'The "prompt" parameter is required when calling an agent.';
            }

            const toolResponseMessage = {
                role: 'tool',
                content: '',
                tool_call_id: call.id,
                name: call.name,
                agent: targetAgent.id,
                model: null, // Will be populated after config is fetched
            };

            activeChat.log.addMessage(toolResponseMessage, message.id);

            if (toolError) {
                toolResponseMessage.content = `<error>${toolError}</error>`;
                activeChat.log.notify();
                continue;
            }

            try {
                this.app.abortController = new AbortController();
                this.app.dom.stopButton.style.display = 'block';

                const targetAgentConfig = agentManager.getEffectiveApiConfig(targetAgent.id);
                toolResponseMessage.model = targetAgentConfig.model; // Populate model name
                const messages = [
                    { role: 'system', content: targetAgentConfig.systemPrompt },
                    { role: 'user', content: prompt }
                ];

                const payload = {
                    model: targetAgentConfig.model,
                    messages,
                    stream: true,
                    temperature: targetAgentConfig.temperature,
                    top_p: targetAgentConfig.top_p,
                };

                const reader = await this.app.apiService.streamChat(
                    payload,
                    targetAgentConfig.apiUrl,
                    targetAgentConfig.apiKey,
                    this.app.abortController.signal
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
                        toolContent += deltas.join('');
                        toolResponseMessage.content = toolContent;
                        activeChat.log.notify();
                    }
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    toolResponseMessage.content = `<error>An error occurred while calling the agent: ${error.message}</error>`;
                } else {
                    wasAborted = true;
                    toolResponseMessage.content += '\n\n[Aborted by user]';
                }
                activeChat.log.notify();
            } finally {
                this.app.abortController = null;
                this.app.dom.stopButton.style.display = 'none';
            }
        }

        if (wasAborted) {
            return true; // Stop processing, don't queue next turn
        }

        activeChat.log.addMessage({ role: 'assistant', content: null, agent: callingAgentId });
        this.app.responseProcessor.scheduleProcessing(this.app);
        return true;
    }
}

const agentsCallPluginInstance = new AgentsCallPlugin();

pluginManager.register({
    name: 'Agents Call Plugin',
    onAppInit: (app) => agentsCallPluginInstance.init(app),
    beforeApiCall: (payload, allSettings, agent) => agentsCallPluginInstance.beforeApiCall(payload, allSettings, agent),
    onResponseComplete: (message, activeChat) => agentsCallPluginInstance.onResponseComplete(message, activeChat),
});
