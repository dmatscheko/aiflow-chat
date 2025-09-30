/**
 * @fileoverview Plugin for allowing agents to call other agents as tools.
 * Integrates with the ToolCallManager to act as an executor for agent-to-agent calls.
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
    /** @type {Set<string>} */
    allAgentIds = new Set();

    /** @param {App} app */
    init(app) {
        this.app = app;
        // The agent list might not be available right away, so we'll populate the set later.
        // For now, register the executor with the ToolCallManager.
        toolCallManager.registerExecutor('agent-caller', {
            canExecute: (call) => this.canExecute(call),
            execute: (call, job) => this.execute(call, job),
        });
    }

    /**
     * Re-populates the set of known agent IDs. Called when agents are updated.
     * @private
     */
    _updateAgentIds() {
        if (!this.app.agentManager) return;
        this.allAgentIds = new Set(this.app.agentManager.agents.map(a => a.id));
    }

    /**
     * Checks if this executor can handle the given tool call.
     * @param {ToolCall} call - The tool call to check.
     * @returns {boolean} - True if the call name is a known agent ID.
     */
    canExecute(call) {
        this._updateAgentIds(); // Ensure the list is fresh
        return this.allAgentIds.has(call.name);
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
     * Executes a single agent-as-tool call.
     * This method is called by the ToolCallManager.
     * @param {ToolCall} call - The tool call to process.
     * @param {ToolCallJob} job - The job this call belongs to.
     * @returns {Promise<void>}
     */
    async execute(call, job) {
        const agentManager = this.app.agentManager;
        const callingAgent = agentManager.getAgent(job.callingAgentId);
        const targetAgent = agentManager.getAgent(call.name);
        const activeChat = this.app.chatManager.getActiveChat();

        // 1. Validate the call and check permissions first.
        if (!callingAgent || !targetAgent) {
            return toolCallManager.notifyCallComplete(job.id, {
                tool_call_id: call.tool_call_id, name: call.name, error: 'Invalid agent specified.', content: null
            });
        }

        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        const isAllowed = callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id);
        if (!isAllowed) {
            return toolCallManager.notifyCallComplete(job.id, {
                tool_call_id: call.tool_call_id, name: call.name, error: `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".`, content: null
            });
        }

        const prompt = call.params.prompt;
        if (!prompt) {
            return toolCallManager.notifyCallComplete(job.id, {
                tool_call_id: call.tool_call_id, name: call.name, error: 'The "prompt" parameter is required when calling an agent.', content: null
            });
        }

        const abortController = new AbortController();
        this.app.abortController = abortController;

        let finalContent = '';
        let finalError = null;

        try {
            this.app.dom.stopButton.style.display = 'block';

            const targetAgentConfig = agentManager.getEffectiveApiConfig(targetAgent.id);

            // Construct the full, dynamic system prompt for the target agent, allowing it to use its own tools.
            const finalSystemPrompt = await pluginManager.triggerAsync(
                'onSystemPromptConstruct',
                targetAgentConfig.systemPrompt,
                targetAgentConfig,
                targetAgent
            );

            const payload = {
                model: targetAgentConfig.model,
                messages: [
                    { role: 'system', content: finalSystemPrompt },
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
                    .map(line => JSON.parse(line).choices[0].delta.content)
                    .filter(Boolean);

                if (deltas.length > 0) {
                    finalContent += deltas.join('');
                    // Note: We don't update the message here directly anymore.
                    // The final result is passed back to the manager.
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                finalContent += '\n\n[Aborted by user]';
                // Aborting stops the whole flow. We don't proceed.
                this.app.chatManager.stopChatFlow();
                return; // Don't notify completion, as the flow is stopped.
            } else {
                finalError = `An error occurred while calling the agent: ${error.message}`;
            }
        } finally {
            this.app.abortController = null;
            this.app.dom.stopButton.style.display = 'none';
        }

        // 2. Notify the manager that this call is complete.
        toolCallManager.notifyCallComplete(job.id, {
            tool_call_id: call.tool_call_id,
            name: call.name,
            content: finalContent,
            error: finalError,
        });

        // 3. Check for nested tool calls in the response.
        // We need to find the message we just added to parse it.
        // This is a bit tricky, but it should be the last message in the log.
        const lastMessage = job.chatLog.getLastMessage();
        if (lastMessage && lastMessage.value.role === 'tool' && !finalError) {
             const nestedCalls = parseToolCalls(finalContent);
             if (nestedCalls.length > 0) {
                // We need to create a fake "assistant" message to host these calls.
                // This message won't be rendered but is needed for the job structure.
                const nestedAssistantMessage = {
                    id: `nested_msg_${Date.now()}`,
                    value: {
                        role: 'assistant',
                        content: finalContent,
                        agent: targetAgent.id, // The agent that just responded is the caller
                    },
                    // This is a simplified message object for the purpose of creating a job.
                    // It doesn't need to be a full `Message` class instance.
                    cache: null,
                };

                // Add the nested job. The ToolCallManager's LIFO stack will handle pausing the parent job.
                toolCallManager.addJob(nestedAssistantMessage, activeChat);
             }
        }
    }
}

const agentsCallPluginInstance = new AgentsCallPlugin();

pluginManager.register({
    name: 'Agents Call Plugin',
    onAppInit: (app) => agentsCallPluginInstance.init(app),
    onSystemPromptConstruct: (systemPrompt, allSettings, agent) => agentsCallPluginInstance.onSystemPromptConstruct(systemPrompt, allSettings, agent),
    // onResponseComplete is now removed
});