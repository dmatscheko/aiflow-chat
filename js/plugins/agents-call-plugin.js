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
<parameter name="full_context">
false
</parameter>
</dma:tool_call>

Parameter Description:
  - \`prompt\`: The user\'s or assistant\'s request to the agent. (type: string)(required)
  - \`full_context\`: Whether to provide the full conversational history to the called agent. If false, only the history up to and including the call is seen by the called agent. (type: boolean)(optional, default: false)

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
            return `${idx + 1}. **${a.name} (ID: ${a.id})**\n - **Description**: ${desc}\n - **Action** (dma:tool_call name): \`${a.id}\`\n - **Arguments** (parameter name): prompt, full_context`;
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

        let nestedCallQueued = false;
        for (const call of agentCalls) {
            // A sub-agent call may itself queue a nested tool call.
            const subAgentHandledNestedCall = await this._handleAgentCall(call, message, activeChat);
            if (subAgentHandledNestedCall) {
                nestedCallQueued = true;
            }
        }

        if (nestedCallQueued) {
            // A nested call was queued, so stop this chain and let the main loop handle the new work.
            return true;
        }

        // After all agent calls are handled, and if no nested calls were queued, queue up the next step for the AI.
        const callingAgentId = message.agent || 'agent-default';
        activeChat.log.addMessage(
            { role: 'assistant', content: null, agent: callingAgentId },
            { depth: message.depth }
        );
        this.app.responseProcessor.scheduleProcessing(this.app);
        return true;
    }

    /**
     * Handles a single agent-as-tool call.
     * @param {ToolCall} call - The tool call to process.
     * @param {Message} message - The original message containing the tool call.
     * @param {Chat} activeChat - The active chat instance.
     * @returns {Promise<boolean>} A promise that resolves to true if a nested call was queued, false otherwise.
     * @private
     */
    async _handleAgentCall(call, message, activeChat) {
        const agentManager = this.app.agentManager;
        const callingAgentId = message.agent || 'agent-default';
        const callingAgent = agentManager.getAgent(callingAgentId);
        const targetAgent = agentManager.getAgent(call.name);

        // 1. Validate the call and check permissions first.
        if (!callingAgent || !targetAgent) {
            this._addErrorToolResponse(activeChat, message, call, 'Invalid agent specified.');
            return false;
        }

        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        const isAllowed = callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id);
        if (!isAllowed) {
            this._addErrorToolResponse(activeChat, message, call, `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".`);
            return false;
        }

        const prompt = call.params.prompt;
        if (!prompt) {
            this._addErrorToolResponse(activeChat, message, call, 'The "prompt" parameter is required when calling an agent.');
            return false;
        }

        const fullContext = call.params.full_context === true;
        const newDepth = fullContext ? message.depth : message.depth + 1;

        // Push the calling agent's context onto the stack.
        this.app.responseProcessor.agentCallStack.push({
            agentId: callingAgentId,
            depth: message.depth,
        });

        const abortController = new AbortController();
        this.app.abortController = abortController;

        // The tool response message will be updated as the agent streams its response.
        const toolResponseMessage = {
            role: 'tool',
            content: '',
            tool_call_id: call.id,
            agent: targetAgent.id,
            model: null,
            is_full_context_call: fullContext,
        };

        // Add the placeholder message with the correct depth.
        const toolResponseAsMessage = activeChat.log.addMessage(toolResponseMessage, { depth: newDepth });

        try {
            this.app.dom.stopButton.style.display = 'block';

            // 2. Now that validation is done, construct the payload and perform the call.
            const targetAgentConfig = agentManager.getEffectiveApiConfig(targetAgent.id);
            toolResponseAsMessage.value.model = targetAgentConfig.model;

            const systemPrompt = await agentManager.constructSystemPrompt(targetAgent.id);

            const history = activeChat.log.getHistoryForAgentCall(message, fullContext);
            const messagesForPayload = [
                ...history,
                { role: 'user', content: prompt }
            ];

            const payload = {
                model: targetAgentConfig.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messagesForPayload
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
                    toolResponseAsMessage.value.content += deltas.join('');
                    activeChat.log.notify();
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                toolResponseAsMessage.value.content += '\n\n[Aborted by user]';
            } else {
                toolResponseAsMessage.value.content = `<error>An error occurred while calling the agent: ${error.message}</error>`;
            }
            activeChat.log.notify();
        } finally {
            this.app.abortController = null;
            this.app.dom.stopButton.style.display = 'none';
        }

        // After the sub-agent has responded, check its response for tool calls.
        const nestedCallHandled = await pluginManager.triggerSequentially('onResponseComplete', toolResponseAsMessage, activeChat);

        // If a nested call was handled, it will queue new messages and return true.
        // We propagate this signal up to the main onResponseComplete loop.
        return nestedCallHandled;
    }

    /**
     * Adds a tool response message with a pre-formatted error.
     * @param {Chat} activeChat
     * @param {Message} originalMessage
     * @param {ToolCall} call
     * @param {string} errorMessage
     * @private
     */
    _addErrorToolResponse(activeChat, originalMessage, call, errorMessage) {
        const toolResponseMessage = {
            role: 'tool',
            content: `<error>${errorMessage}</error>`,
            tool_call_id: call.id,
            name: call.name,
            agent: call.name,
        };
        activeChat.log.addMessage(toolResponseMessage, { depth: originalMessage.depth + 1 });
    }
}

const agentsCallPluginInstance = new AgentsCallPlugin();

pluginManager.register({
    name: 'Agents Call Plugin',
    onAppInit: (app) => agentsCallPluginInstance.init(app),
    onSystemPromptConstruct: (systemPrompt, allSettings, agent) => agentsCallPluginInstance.onSystemPromptConstruct(systemPrompt, allSettings, agent),
    onResponseComplete: (message, activeChat) => agentsCallPluginInstance.onResponseComplete(message, activeChat),
});
