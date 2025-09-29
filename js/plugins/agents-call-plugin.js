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

        // If another process has already started a tool call turn, wait.
        if (this.app.toolCallManager.callStack.length > 0) {
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
        this.app.toolCallManager.startTurn(callingAgentId, agentCalls.length);

        for (const call of agentCalls) {
            this.app.toolCallManager.addCall({
                call,
                message,
                chat: activeChat,
                executor: (c, m, chat) => this._executeAgentCall(c, m, chat),
            });
        }

        return true;
    }

    /**
     * Executes a single agent-as-tool call.
     * This is called by the ToolCallManager.
     * @param {ToolCall} call - The tool call to process.
     * @param {Message} message - The original message containing the tool call.
     * @param {Chat} activeChat - The active chat instance.
     * @returns {Promise<void>}
     * @private
     */
    async _executeAgentCall(call, message, activeChat) {
        const agentManager = this.app.agentManager;
        const callingAgentId = message.value.agent || 'agent-default';
        const callingAgent = agentManager.getAgent(callingAgentId);
        const targetAgent = agentManager.getAgent(call.name);

        const addError = (errorMessage) => {
            activeChat.log.addMessage({
                role: 'tool',
                content: `<error>${errorMessage}</error>`,
                tool_call_id: call.id,
                name: call.name,
            }, message.id);
        };

        // 1. Validate the call and check permissions first.
        if (!callingAgent || !targetAgent) {
            return addError('Invalid agent specified.');
        }

        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        const isAllowed = callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id);
        if (!isAllowed) {
            return addError(`Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".`);
        }

        const prompt = call.params.prompt;
        if (!prompt) {
            return addError('The "prompt" parameter is required when calling an agent.');
        }

        const abortController = new AbortController();
        this.app.abortController = abortController;

        // 2. Create the message and perform the call.
        const targetAgentConfig = agentManager.getEffectiveApiConfig(targetAgent.id);
        const toolResponseMessage = {
            role: 'tool',
            content: '',
            tool_call_id: call.id,
            name: call.name,
            agent: targetAgent.id,
            model: targetAgentConfig.model,
        };
        activeChat.log.addMessage(toolResponseMessage, message.id);

        try {
            this.app.dom.stopButton.style.display = 'block';

            const systemPrompt = await pluginManager.triggerAsync('onSystemPromptConstruct', targetAgentConfig.systemPrompt, targetAgentConfig, targetAgent);

            const payload = {
                model: targetAgentConfig.model,
                messages: [
                    { role: 'system', content: systemPrompt },
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
                        } catch (e) {
                            console.error("Error parsing streaming delta:", line, e);
                            return null;
                        }
                    })
                    .filter(Boolean);

                if (deltas.length > 0) {
                    toolResponseMessage.content += deltas.join('');
                    activeChat.log.notify();
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                toolResponseMessage.content += '\n\n[Aborted by user]';
            } else {
                toolResponseMessage.content = `<error>An error occurred while calling the agent: ${error.message}</error>`;
            }
            activeChat.log.notify();
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
    onResponseComplete: (message, activeChat) => agentsCallPluginInstance.onResponseComplete(message, activeChat),
});
