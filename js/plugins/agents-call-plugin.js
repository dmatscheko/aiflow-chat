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
        const { toolCalls, positions, isSelfClosings } = parseToolCalls(message.value.content);

        const agentCallData = toolCalls.map((call, index) => ({
            call,
            position: positions[index],
            isSelfClosing: isSelfClosings[index]
        })).filter(data => allAgentIds.has(data.call.name));


        if (agentCallData.length === 0) {
            return false;
        }

        let content = message.value.content;
        // Process from last to first to avoid messing up indices
        for (let i = agentCallData.length - 1; i >= 0; i--) {
            const { call, position, isSelfClosing } = agentCallData[i];

            const gtIndex = content.indexOf('>', position.start);
            let startTag = content.slice(position.start, gtIndex + 1);

            if (!startTag.includes('tool_call_id')) {
                const insert = ` tool_call_id="${call.id}"`;
                const endSlice = isSelfClosing ? -2 : -1;
                const endTag = isSelfClosing ? '/>' : '>';
                startTag = startTag.slice(0, endSlice) + insert + endTag;
                content = content.slice(0, position.start) + startTag + content.slice(gtIndex + 1);
            }
        }
        message.value.content = content;
        message.cache = null; // Invalidate cache to force re-render
        activeChat.log.notify(); // Notify UI to re-render the message with IDs

        for (const data of agentCallData) {
            await this._handleAgentCall(data.call, message, activeChat);
        }

        this.app.responseProcessor.scheduleProcessing(this.app);
        return true;
    }

    /**
     * Handles a single agent-as-tool call by pushing it onto the agent stack.
     * @param {ToolCall} call - The tool call to process.
     * @param {Message} message - The original message containing the tool call.
     * @param {Chat} activeChat - The active chat instance.
     * @returns {Promise<void>}
     * @private
     */
    async _handleAgentCall(call, message, activeChat) {
        const agentManager = this.app.agentManager;
        const callingAgentId = message.value.agent || 'agent-default';
        const callingAgent = agentManager.getAgent(callingAgentId);
        const targetAgent = agentManager.getAgent(call.name);

        if (!callingAgent || !targetAgent) {
            this._addErrorToolResponse(activeChat, message.id, call, 'Invalid agent specified.');
            return;
        }

        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        const isAllowed = callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id);
        if (!isAllowed) {
            this._addErrorToolResponse(activeChat, message.id, call, `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".`);
            return;
        }

        const prompt = call.params.prompt;
        if (!prompt) {
            this._addErrorToolResponse(activeChat, message.id, call, 'The "prompt" parameter is required when calling an agent.');
            return;
        }

        // --- Start of Stack-based logic ---
        if (!activeChat.agentStack) {
            activeChat.agentStack = [];
        }

        // Push the context of the call onto the stack.
        activeChat.agentStack.push({
            callingAgentId: callingAgentId,
            agentId: targetAgent.id,
            toolCallId: call.id,
        });

        // Create a new "user" message for the sub-agent.
        // This makes it seem like a natural conversation for the sub-agent.
        activeChat.log.addMessage({
            role: 'user',
            content: prompt,
        });

        // Queue a pending message for the sub-agent to respond to.
        activeChat.log.addMessage({
            role: 'assistant',
            content: null,
            agent: targetAgent.id,
        });
        // --- End of Stack-based logic ---
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
