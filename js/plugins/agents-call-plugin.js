/**
 * @fileoverview Plugin for allowing agents to call other agents as tools.
 * This plugin constructs the agent part of the system prompt and executes
 * agent-as-tool calls when requested by the ToolCallManager. It supports
 * nested calls by creating new jobs for tool calls found in an agent's response.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { toolCallManager, parseToolCalls } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../tool-processor.js').ToolCall} ToolCall
 * @typedef {import('../tool-processor.js').ToolCallJob} ToolCallJob
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

    /**
     * Initializes the plugin with the main application instance.
     * @param {App} app
     */
    init(app) {
        this.app = app;
    }

    /**
     * Executes a single agent-as-tool call.
     * This method is invoked by the ToolCallManager. It streams the response from
     * the target agent. If the response contains further tool calls, it adds them
     * as a new job to the ToolCallManager stack. Finally, it reports the
     * completion of the initial agent call.
     * @param {ToolCall} call - The agent tool call to execute.
     * @param {ToolCallJob} job - The job this call belongs to.
     * @param {App} app - The main application instance.
     */
    async executeCall(call, job, app) {
        const { sourceMessage, chat } = job;
        const agentManager = app.agentManager;
        const callingAgentId = sourceMessage.value.agent || 'agent-default';
        const targetAgent = agentManager.getAgent(call.name);

        const validationError = this._validateAgentCall(callingAgentId, targetAgent, call, app);
        if (validationError) {
            toolCallManager.notifyCallComplete(job.id, {
                name: call.name,
                tool_call_id: call.tool_call_id,
                content: null,
                error: validationError,
            });
            return;
        }

        const { finalContent, error } = await this._streamAgentResponse(call, targetAgent, chat, app);

        // Notify the manager that this call is complete and get the new tool message.
        const toolResponseMessage = toolCallManager.notifyCallComplete(job.id, {
            name: call.name,
            tool_call_id: call.tool_call_id,
            content: finalContent,
            error: error,
        });

        // Check for nested calls in the agent's response and create a new job if needed.
        const nestedParsedCalls = parseToolCalls(finalContent);
        if (nestedParsedCalls.length > 0) {
            if (toolResponseMessage) {
                // The new tool message becomes the source for any nested calls.
                toolCallManager.addJob(nestedParsedCalls, toolResponseMessage, chat);
            } else {
                console.error(`[AgentsCallPlugin] Could not find the tool response message for ${call.tool_call_id} to attach nested calls, because notifyCallComplete returned null.`);
            }
        }
    }

    /**
     * Validates an agent call, checking permissions and parameters.
     * @param {string} callingAgentId - The ID of the agent making the call.
     * @param {Agent} targetAgent - The agent being called.
     * @param {ToolCall} call - The tool call object.
     * @param {App} app - The main application instance.
     * @returns {string|null} An error message if validation fails, otherwise null.
     * @private
     */
    _validateAgentCall(callingAgentId, targetAgent, call, app) {
        const agentManager = app.agentManager;
        const callingAgent = agentManager.getAgent(callingAgentId);

        if (!callingAgent || !targetAgent) {
            return 'Invalid agent specified in the call.';
        }

        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        const isAllowed = callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id);
        if (!isAllowed) {
            return `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".`;
        }

        if (!call.params.prompt) {
            return 'The "prompt" parameter is required when calling an agent.';
        }

        return null;
    }

    /**
     * Streams the response from the target agent.
     * @param {ToolCall} call - The tool call to execute.
     * @param {Agent} targetAgent - The agent to call.
     * @param {import('../main.js').Chat} chat - The active chat.
     * @param {App} app - The main application instance.
     * @returns {Promise<{finalContent: string, error: string|null}>} The streamed content and any error.
     * @private
     */
    async _streamAgentResponse(call, targetAgent, chat, app) {
        const agentManager = app.agentManager;
        const abortController = new AbortController();
        app.abortController = abortController;
        app.dom.stopButton.style.display = 'block';

        let finalContent = '';
        let error = null;

        try {
            const targetAgentConfig = agentManager.getEffectiveApiConfig(targetAgent.id);
            const payload = {
                model: targetAgentConfig.model,
                messages: [
                    { role: 'system', content: targetAgentConfig.systemPrompt },
                    { role: 'user', content: call.params.prompt }
                ],
                stream: true,
                temperature: targetAgentConfig.temperature,
                top_p: targetAgentConfig.top_p,
            };

            const reader = await app.apiService.streamChat(
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
                            console.error('Error parsing stream chunk:', line, e);
                            return null;
                        }
                    })
                    .filter(Boolean);

                if (deltas.length > 0) {
                    finalContent += deltas.join('');
                    // We don't update the UI here directly anymore.
                    // The ToolCallManager will create the message, and ChatUI will render it.
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                finalContent += '\n\n[Aborted by user]';
                error = 'Aborted by user';
            } else {
                finalContent = `<error>An error occurred while calling the agent: ${err.message}</error>`;
                error = err.message;
            }
        } finally {
            app.abortController = null;
            app.dom.stopButton.style.display = 'none';
        }

        return { finalContent, error };
    }

    /**
     * Constructs the "Callable Agents" section for the system prompt.
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
            ? allAgents
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
}

const agentsCallPluginInstance = new AgentsCallPlugin();

pluginManager.register({
    name: 'Agents Call Plugin',
    instance: agentsCallPluginInstance, // Expose instance for the ToolCallManager
    onAppInit: (app) => {
        agentsCallPluginInstance.init(app);
        toolCallManager.registerExecutor('agent', agentsCallPluginInstance);
    },
    onSystemPromptConstruct: (systemPrompt, allSettings, agent) => agentsCallPluginInstance.onSystemPromptConstruct(systemPrompt, allSettings, agent),
});