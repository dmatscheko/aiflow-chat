/**
 * @fileoverview Central orchestrator for processing tool and agent calls.
 * This module is responsible for parsing tool calls from a message,
 * coordinating their execution, and managing the overall flow, including
 * handling nested agent calls.
 */

'use strict';

import { parseToolCalls } from './tool-processor.js';
import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./chat-data.js').MessageValue} MessageValue
 * @typedef {import('./main.js').Chat} Chat
 * @typedef {import('./tool-processor.js').ToolCall} ToolCall
 * @typedef {import('./tool-processor.js').ToolResult} ToolResult
 */

class ToolOrchestrator {
    /** @type {App | null} */
    app = null;

    /**
     * @param {App} app
     */
    init(app) {
        this.app = app;
    }

    /**
     * The main entry point for processing a message that might contain tool calls.
     * It parses the message, identifies all tool and agent calls, executes them,
     * and then queues the next assistant turn.
     * @param {Message} message The message to process.
     * @param {Chat} chat The active chat.
     * @returns {Promise<boolean>} True if any action was taken, false otherwise.
     */
    async process(message, chat) {
        const { toolCalls, positions, isSelfClosings } = parseToolCalls(message.value.content);

        if (toolCalls.length === 0) {
            return false;
        }

        this.injectToolCallIds(message, chat, toolCalls, positions, isSelfClosings);

        const results = await this.executeAllToolCalls(toolCalls, message, chat);

        // Filter out any null results that may have occurred from aborted calls
        const validResults = results.filter(r => r);

        if (validResults.length === 0) {
            // All tool calls were aborted or failed in a way that produced no result.
            // Don't proceed to the next turn.
            return true;
        }

        let toolContents = '';
        validResults.forEach((tr) => {
            const inner = tr.error
                ? `<error>\n${tr.error}\n</error>`
                : `<content>\n${tr.content}\n</content>`;
            toolContents += `<dma:tool_response name="${tr.name}" tool_call_id="${tr.tool_call_id}">\n${inner}\n</dma:tool_response>\n`;
        });

        if (toolContents) {
            chat.log.addMessage({ role: 'tool', content: toolContents });
            const callingAgentId = message.value.agent || 'agent-default';
            chat.log.addMessage({ role: 'assistant', content: null, agent: callingAgentId });
            this.app.responseProcessor.scheduleProcessing(this.app);
            return true;
        }

        return false;
    }

    /**
     * Executes all tool calls in parallel.
     * @param {ToolCall[]} toolCalls
     * @param {Message} message
     * @param {Chat} chat
     * @returns {Promise<ToolResult[]>}
     */
    async executeAllToolCalls(toolCalls, message, chat) {
        const promises = toolCalls.map(call => this.executeSingleCall(call, message, chat));
        return Promise.all(promises);
    }

    /**
     * Executes a single tool call, delegating to the correct plugin or handling stacked agent calls.
     * @param {ToolCall} call
     * @param {Message} message
     * @param {Chat} chat
     * @returns {Promise<ToolResult>}
     */
    async executeSingleCall(call, message, chat) {
        const agentManager = this.app.agentManager;
        const isAgentCall = agentManager.agents.some(a => a.id === call.name);

        if (isAgentCall) {
            return this.handleStackedAgentCall(call, message, chat);
        } else {
            const effectiveConfig = agentManager.getEffectiveApiConfig(message.value.agent);
            const mcpUrl = effectiveConfig.toolSettings.mcpServer;
            if (!mcpUrl) {
                return { name: call.name, tool_call_id: call.id, error: 'MCP server not configured for this agent.' };
            }
            return this.app.mcp.executeMcpCall(call, message, mcpUrl);
        }
    }

    /**
     * Manages a stateful, conversational loop for a sub-agent call.
     * @param {ToolCall} initialCall - The initial tool call that triggered the agent.
     * @param {Message} originalMessage - The message from the calling agent.
     * @param {Chat} chat - The current chat context.
     * @returns {Promise<ToolResult>} The final result from the sub-agent.
     */
    async handleStackedAgentCall(initialCall, originalMessage, chat) {
        const agentManager = this.app.agentManager;
        const callingAgentId = originalMessage.value.agent || 'agent-default';
        const callingAgent = agentManager.getAgent(callingAgentId);
        const targetAgent = agentManager.getAgent(initialCall.name);

        // 1. Permission checks
        if (!callingAgent || !targetAgent) {
            return { name: initialCall.name, tool_call_id: initialCall.id, error: 'Invalid agent specified.' };
        }
        const callingAgentConfig = agentManager.getEffectiveApiConfig(callingAgent.id);
        const isAllowed = callingAgentConfig.agentCallSettings.allowAll || callingAgentConfig.agentCallSettings.allowed?.includes(targetAgent.id);
        if (!isAllowed) {
            const error = `Agent "${callingAgent.name}" is not permitted to call agent "${targetAgent.name}".`;
            return { name: initialCall.name, tool_call_id: initialCall.id, error };
        }
        const prompt = initialCall.params.prompt;
        if (!prompt) {
            return { name: initialCall.name, tool_call_id: initialCall.id, error: 'The "prompt" parameter is required when calling an agent.' };
        }

        // 2. Initialize the sub-conversation
        const subAgentHistory = [{ role: 'user', content: prompt }];
        let finalContent = null;
        const MAX_LOOPS = 10;

        for (let i = 0; i < MAX_LOOPS; i++) {
            // 3. Call the sub-agent with its current history
            const subAgentResponseContent = await this.invokeSubAgent(targetAgent.id, subAgentHistory);
            if (subAgentResponseContent === null) {
                return { name: initialCall.name, tool_call_id: initialCall.id, error: 'Sub-agent failed to produce a response.' };
            }

            subAgentHistory.push({ role: 'assistant', content: subAgentResponseContent });

            // 4. Parse the response for more tool calls
            const { toolCalls } = parseToolCalls(subAgentResponseContent);
            if (toolCalls.length === 0) {
                finalContent = subAgentResponseContent;
                break; // Exit loop, we have the final answer
            }

            // 5. Execute the sub-agent's tool calls
            const subAgentMessage = { value: { role: 'assistant', content: subAgentResponseContent, agent: targetAgent.id } };
            const toolResults = await this.executeAllToolCalls(toolCalls, subAgentMessage, chat);

            const validResults = toolResults.filter(r => r);
            if (validResults.length === 0) {
                return { name: initialCall.name, tool_call_id: initialCall.id, error: 'Sub-agent tool calls were aborted or failed.' };
            }

            let toolResponseMessageContent = '';
            validResults.forEach((tr) => {
                const inner = tr.error ? `<error>\n${tr.error}\n</error>` : `<content>\n${tr.content}\n</content>`;
                toolResponseMessageContent += `<dma:tool_response name="${tr.name}" tool_call_id="${tr.tool_call_id}">\n${inner}\n</dma:tool_response>\n`;
            });

            subAgentHistory.push({ role: 'tool', content: toolResponseMessageContent });
        }

        if (!finalContent) {
            return { name: initialCall.name, tool_call_id: initialCall.id, error: `Agent call exceeded maximum loop count of ${MAX_LOOPS}.` };
        }

        return { name: initialCall.name, tool_call_id: initialCall.id, content: finalContent };
    }

    /**
     * Invokes a sub-agent with a given message history and returns the streamed response content.
     * @param {string} agentId - The ID of the agent to invoke.
     * @param {MessageValue[]} messages - The history to provide to the agent.
     * @returns {Promise<string|null>} The complete response content, or null on failure.
     */
    async invokeSubAgent(agentId, messages) {
        const agentManager = this.app.agentManager;
        const targetAgent = agentManager.getAgent(agentId);
        const targetAgentConfig = agentManager.getEffectiveApiConfig(targetAgent.id);

        const finalSystemPrompt = await pluginManager.triggerAsync('onSystemPromptConstruct', targetAgentConfig.systemPrompt, targetAgentConfig, targetAgent);

        const historyWithSystem = [...messages];
        if (finalSystemPrompt) {
            historyWithSystem.unshift({ role: 'system', content: finalSystemPrompt });
        }

        const payload = {
            model: targetAgentConfig.model,
            messages: historyWithSystem,
            stream: true,
            temperature: targetAgentConfig.temperature,
            top_p: targetAgentConfig.top_p,
        };

        try {
            const reader = await this.app.apiService.streamChat(
                payload, targetAgentConfig.apiUrl, targetAgentConfig.apiKey, null
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
                        try {
                            const parsed = JSON.parse(line);
                            return parsed.choices[0].delta.content;
                        } catch { return null; }
                    })
                    .filter(Boolean);

                content += deltas.join('');
            }
            return content;
        } catch (error) {
            console.error(`Error invoking sub-agent ${agentId}:`, error);
            return `<error>Sub-agent invocation failed: ${error.message}</error>`;
        }
    }

    /**
     * Injects the generated `tool_call_id` into the original message content.
     * @param {Message} message
     * @param {Chat} chat
     * @param {ToolCall[]} toolCalls
     * @param {import('./tool-processor.js').ToolCallPosition[]} positions
     * @param {boolean[]} isSelfClosings
     */
    injectToolCallIds(message, chat, toolCalls, positions, isSelfClosings) {
        let content = message.value.content;
        for (let i = positions.length - 1; i >= 0; i--) {
            const call = toolCalls[i];
            const pos = positions[i];
            const gtIndex = content.indexOf('>', pos.start);
            let startTag = content.slice(pos.start, gtIndex + 1);

            if (startTag.includes('tool_call_id=')) continue;

            const insert = ` tool_call_id="${call.id}"`;
            const endSlice = isSelfClosings[i] ? -2 : -1;
            const endTag = isSelfClosings[i] ? '/>' : '>';
            startTag = startTag.slice(0, endSlice) + insert + endTag;
            content = content.slice(0, pos.start) + startTag + content.slice(gtIndex + 1);
        }
        message.value.content = content;
        message.cache = null;
        chat.log.notify();
    }
}

export const toolOrchestrator = new ToolOrchestrator();