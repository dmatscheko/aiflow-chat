/**
 * @fileoverview Plugin that enables agents to call other agents as if they were tools.
 * This powerful feature allows for creating hierarchical and collaborative agent systems.
 * It hooks into the system prompt to inform agents of available sub-agents and
 * intercepts agent responses to handle the execution of sub-agent calls.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { parseToolCalls } from '../tool-processor.js';
import { DEFAULT_AGENT_ID } from '../constants.js';
import { appendSystemPromptSection } from '../utils.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('./chats-plugin.js').Chat} Chat
 * @typedef {import('../tool-processor.js').ToolCall} ToolCall
 * @typedef {import('./agents-plugin.js').Agent} Agent
 */

/**
 * The introductory text and instructions for using sub-agents, which is injected
 * into an agent's system prompt if it has permission to call other agents.
 * @const {string}
 */
const agentCallsHeader = `### Callable Agents:

You can call other specialized agents as tools. The format for calling an agent is the same as a regular tool call. The agent's ID is used as the tool name. You can call both tools and agents in the same message.

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
  - \`full_context\`: Whether to provide the full conversational history to the called agent. If false, only the call is seen by the called agent. (type: boolean)(optional, default: false)

#### Available Agents:\n\n`;

/**
 * Implements the logic for agents calling other agents.
 * @class
 */
class AgentsCallPlugin {
    /**
     * The main application instance.
     * @type {App | null}
     */
    app = null;

    /**
     * Initializes the plugin and stores a reference to the main app instance.
     * This method is called by the plugin manager during the application's initialization phase.
     * @param {App} app - The main application instance.
     */
    init(app) {
        this.app = app;
    }

    /**
     * Hooks into the system prompt construction process to add information about callable agents.
     * It checks the agent's settings to see which other agents it's allowed to call,
     * then formats this information and appends it to the system prompt.
     * @param {string} systemPrompt - The system prompt constructed so far.
     * @param {object} allSettings - The combined settings object for the agent.
     * @param {Agent} agent - The agent for which the prompt is being constructed.
     * @returns {Promise<string>} The modified system prompt.
     */
    async onSystemPromptConstruct(systemPrompt, allSettings, agent) {
        const effectiveAgentCallSettings = allSettings.agentCallSettings;

        if (!effectiveAgentCallSettings) {
            return systemPrompt;
        }

        const agentManager = this.app.agentManager;
        const allAgents = agentManager.agents;
        const callableAgents = effectiveAgentCallSettings.allowAll
            ? allAgents.filter(a => a.id !== agent.id) // An agent cannot call itself.
            : allAgents.filter(a => a.id !== agent.id && effectiveAgentCallSettings.allowed?.includes(a.id));

        if (callableAgents.length === 0) {
            return systemPrompt;
        }

        const agentsSection = callableAgents.map((a, idx) => {
            const desc = a.description || 'No description provided.';
            return `${idx + 1}. **${a.name} (ID: ${a.id})**\n - **Description**: ${desc}\n - **Action** (dma:tool_call name): \`${a.id}\`\n - **Arguments** (parameter name): prompt, full_context`;
        }).join('\n\n');

        return appendSystemPromptSection(systemPrompt, agentCallsHeader + agentsSection);
    }

    /**
     * Hooks into the response completion event to detect and handle agent-as-tool calls.
     * It parses the message content for tool calls that match the ID of a known agent.
     * For each valid agent call, it invokes `_handleAgentCall` to manage the sub-agent execution.
     *
     * The calling agent is pushed onto the agentCallStack ONCE for all calls in this message.
     * Resumption of the calling agent is handled exclusively by the processLoop's stack pop,
     * which fires only after all sub-agent work (including nested MCP tool usage) is complete.
     * This prevents the double-resumption bug where both an explicit pending message and a
     * stack pop would each create a turn for the calling agent.
     *
     * @param {Message | null} message - The message that has just been completed.
     * @param {Chat} activeChat - The active chat instance.
     * @returns {Promise<boolean>} A promise that resolves to `true` if an agent call was
     * handled (and thus the processing loop should be restarted), otherwise `false`.
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

        // If the message also contains non-agent tool calls (MCP tools), process
        // them first. Since triggerSequentially stops at the first `true` return,
        // the MCP plugin's handler would never run for this message. We handle
        // MCP tool calls here with `createPendingMessage: false` because the
        // agent call stack (below) will manage resuming the calling agent's turn.
        const hasNonAgentCalls = toolCalls.some(call => !allAgentIds.has(call.name));
        if (hasNonAgentCalls) {
            await this._processNonAgentToolCalls(message, activeChat, allAgentIds);
        }

        // Push calling agent onto the stack ONCE for all calls in this message.
        // The processLoop will pop this entry to resume the calling agent after
        // all sub-agent work (including any MCP tool usage by sub-agents) is complete.
        const callingAgentId = message.agent || DEFAULT_AGENT_ID;
        this.app.responseProcessor.agentCallStack.push({
            agentId: callingAgentId,
            depth: message.depth,
            chatId: activeChat.id,
        });

        for (const call of agentCalls) {
            if (this.app.responseProcessor.isStopped) break;
            await this._handleAgentCall(call, message, activeChat);
        }

        // No explicit pending message creation here. The stack pop in the
        // processLoop handles resuming the calling agent once all work is done.
        return true;
    }

    /**
     * Processes non-agent tool calls (e.g., MCP tools) found in a message that also
     * contains agent calls. This is necessary because `triggerSequentially` stops at the
     * first handler that returns `true`, so the MCP plugin's `onResponseComplete` would
     * never run for messages that also contain agent calls.
     *
     * Tool results are added to the chat log, but no pending assistant message is created
     * since the agent call stack handles resuming the calling agent's turn.
     *
     * @param {Message} message - The message containing the mixed tool calls.
     * @param {Chat} activeChat - The active chat instance.
     * @param {Set<string>} allAgentIds - The set of all known agent IDs, used to filter out agent calls.
     * @returns {Promise<void>}
     * @private
     */
    async _processNonAgentToolCalls(message, activeChat, allAgentIds) {
        if (!this.app.mcp) return;

        await this.app.mcp.processMessageToolCalls(message, activeChat, {
            filter: (call) => !allAgentIds.has(call.name),
            createPendingMessage: false,
        });
    }

    /**
     * Handles the execution of a single agent-as-tool call.
     * This method validates permissions, constructs the API payload for the target agent,
     * initiates the streaming call, and updates the chat log with the response.
     * Crucially, it recursively triggers `onResponseComplete` on the sub-agent's response
     * to allow for deeply nested tool calls and MCP tool usage by sub-agents.
     *
     * Stack management is handled by `onResponseComplete` (one push per message),
     * not here. This prevents duplicate stack entries when a single message contains
     * multiple agent calls.
     *
     * @param {ToolCall} call - The agent tool call to process.
     * @param {Message} message - The original message containing the tool call.
     * @param {Chat} activeChat - The active chat instance.
     * @private
     */
    async _handleAgentCall(call, message, activeChat) {
        const app = this.app;
        const agentManager = app.agentManager;
        const callingAgentId = message.agent || DEFAULT_AGENT_ID;
        const callingAgent = agentManager.getAgent(callingAgentId);
        const targetAgent = agentManager.getAgent(call.name);

        if (!callingAgent || !targetAgent) {
            this._addErrorToolResponse(activeChat, message, call, 'Invalid agent specified.');
            return;
        }

        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        const isAllowed = callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id);
        if (!isAllowed) {
            this._addErrorToolResponse(activeChat, message, call, `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".`);
            return;
        }

        const prompt = call.params.prompt;
        if (!prompt) {
            this._addErrorToolResponse(activeChat, message, call, 'The "prompt" parameter is required when calling an agent.');
            return;
        }

        const fullContext = call.params.full_context === true || call.params.full_context === 'true';
        const newDepth = fullContext ? message.depth : message.depth + 1;

        const toolResponseAsMessage = activeChat.log.addMessage({
            role: 'tool',
            content: '',
            tool_call_id: call.id,
            agent: targetAgent.id,
            model: null,
            is_full_context_call: fullContext,
        }, { depth: newDepth });

        const messages = activeChat.log.getHistoryForAgentCall(message, fullContext);
        if (!messages) {
            toolResponseAsMessage.value.content = '<error>Could not reconstruct message history for agent call.</error>';
            activeChat.log.notify();
            return;
        }
        messages.push({ role: 'user', content: prompt });

        await app.apiService.executeStreamingAgentCall(
            app,
            activeChat,
            toolResponseAsMessage,
            messages,
            targetAgent.id
        );

        // If the user stopped while the sub-agent was streaming, skip any
        // further recursive processing to avoid resuming parent agents.
        if (app.responseProcessor.isStopped) return;

        // Recursively check if the sub-agent's response triggers further work
        // (nested agent calls, MCP tool usage, etc.). Any such work is resolved
        // inline before this method returns, ensuring the calling agent only
        // resumes (via stack pop) after all descendant work is complete.
        await pluginManager.triggerSequentially('onResponseComplete', toolResponseAsMessage, activeChat);
    }

    /**
     * A private helper method to add a tool response message containing a pre-formatted error.
     * This is used to provide feedback to the parent agent when a sub-agent call fails validation.
     * @param {Chat} activeChat - The active chat instance.
     * @param {Message} originalMessage - The message that contained the invalid tool call.
     * @param {ToolCall} call - The specific tool call that failed.
     * @param {string} errorMessage - The error message to be included in the tool response.
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

/**
 * The singleton instance of the AgentsCallPlugin.
 * @type {AgentsCallPlugin}
 */
const agentsCallPluginInstance = new AgentsCallPlugin();

/**
 * Registers the Agents Call Plugin with the application's plugin manager.
 * This connects the plugin's methods to the corresponding application hooks.
 */
pluginManager.register({
    name: 'Agents Call Plugin',
    onAppInit: (app) => agentsCallPluginInstance.init(app),
    onSystemPromptConstruct: (systemPrompt, allSettings, agent) => agentsCallPluginInstance.onSystemPromptConstruct(systemPrompt, allSettings, agent),
    onResponseComplete: (message, activeChat) => agentsCallPluginInstance.onResponseComplete(message, activeChat),
});
