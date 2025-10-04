/**
 * @fileoverview Centralized logic for parsing and managing tool calls.
 * This file introduces the ToolCallManager, which orchestrates the entire
 * tool call lifecycle, from parsing to execution and response handling.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./chat-data.js').MessageValue} MessageValue
 */

/**
 * Represents a parsed tool call before system IDs are assigned.
 * @typedef {object} RawToolCall
 * @property {string} name - The name of the tool being called.
 * @property {object} params - The parameters for the tool call.
 */

/**
 * Represents a tool call with a system-assigned unique ID.
 * @typedef {object} ToolCall
 * @property {string} id - A system-generated unique identifier for the tool call.
 * @property {string} name - The name of the tool being called.
 * @property {object} params - The parameters for the tool call.
 */

/**
 * @typedef {object} ToolCallPosition
 * @property {number} start - The starting index of the tool call in the content.
 * @property {number} end - The ending index of the tool call in the content.
 */

/**
 * @typedef {object} ParsedToolCalls
 * @property {RawToolCall[]} toolCalls - The parsed tool calls.
 * @property {ToolCallPosition[]} positions - The positions of the tool calls in the content.
 * @property {boolean[]} isSelfClosings - Flags indicating if a tool call was self-closing.
 */

/**
 * @typedef {object} ToolSchema
 * @property {string} name - The name of the tool.
 * @property {object} [inputSchema] - The JSON schema for the tool's input.
 */

/**
 * @typedef {object} ToolExecutionResult
 * @property {string} [content] - The result of the tool execution.
 * @property {string} [error] - An error message if the execution failed.
 * @property {boolean} [isStreaming] - Whether the result is a stream.
 * @property {ReadableStreamDefaultReader<Uint8Array>} [streamReader] - The reader for the streaming response.
 */


/**
 * Parses tool calls from an assistant's message content.
 * @param {string | null} content - The message content to parse.
 * @param {ToolSchema[]} [tools=[]] - A list of available tools with their schemas, used for type coercion.
 * @returns {ParsedToolCalls} The parsed tool calls, their positions, and self-closing flags.
 */
function parseToolCalls(content, tools = []) {
    const toolCalls = [];
    const positions = [];
    const isSelfClosings = [];
    const functionCallRegex = /<dma:tool_call\s+([^>]+?)\/>|<dma:tool_call\s+([^>]*?)>([\s\S]*?)<\/dma:tool_call\s*>/gi;
    const nameRegex = /name="([^"]*)"/;
    const paramsRegex = /<parameter\s+name="([^"]*)">([\s\S]*?)<\/parameter>/g;

    if (!content) return { toolCalls, positions, isSelfClosings };

    for (const match of content.matchAll(functionCallRegex)) {
        const startIndex = match.index;
        const endIndex = startIndex + match[0].length;

        const [, selfAttrs, openAttrs, innerContent] = match;
        const isSelfClosing = innerContent === undefined;
        const attributes = isSelfClosing ? selfAttrs : openAttrs;
        const contentInner = isSelfClosing ? '' : innerContent;

        const nameMatch = nameRegex.exec(attributes);
        if (!nameMatch) continue;

        const [, name] = nameMatch;
        const params = {};
        const toolDef = tools.find(t => t.name === name);

        if (!isSelfClosing) {
            let paramMatch;
            while ((paramMatch = paramsRegex.exec(contentInner)) !== null) {
                const [, paramName, paramValue] = paramMatch;
                let value = paramValue.trim();
                value = value.replace(/<\\\/dma:tool_call>/g, '</dma:tool_call>').replace(/<\\\/parameter>/g, '</parameter>');

                if (toolDef && toolDef.inputSchema?.properties?.[paramName]) {
                    const prop = toolDef.inputSchema.properties[paramName];
                    if (value === '' && (prop.type === 'integer' || prop.type === 'number')) {
                        value = null;
                    } else if (prop.type === 'integer') {
                        const parsed = parseInt(value, 10);
                        value = isNaN(parsed) ? null : parsed;
                    } else if (prop.type === 'number') {
                        const parsed = parseFloat(value);
                        value = isNaN(parsed) ? null : parsed;
                    } else if (prop.type === 'boolean') {
                        value = value.toLowerCase() === 'true';
                    }
                }
                params[paramName] = value;
            }
        }
        const call = { name, params };
        toolCalls.push(call);
        positions.push({ start: startIndex, end: endIndex });
        isSelfClosings.push(isSelfClosing);
    }

    return { toolCalls, positions, isSelfClosings };
}

/**
 * @typedef {object} ToolCallJob
 * @property {string} id - A unique ID for the job.
 * @property {Message} originalMessage - The assistant message that initiated the tool calls.
 * @property {ToolCall[]} calls - The queue of tool calls to be executed for this job.
 * @property {string} lastMessageId - The ID of the last message created by this job, used for chaining.
 */

/**
 * Orchestrates the processing of tool calls in a stateful, sequential, and nestable manner.
 * @class
 */
class ToolCallManager {
    constructor() {
        /** @type {App | null} */
        this.app = null;
        /** @type {ToolCallJob[]} */
        this.jobStack = [];
        /** @type {boolean} */
        this.isProcessing = false;
    }

    /**
     * @param {App} app The main application instance.
     */
    init(app) {
        this.app = app;
    }

    /**
     * Generates a globally unique ID for a tool call.
     * @returns {string} A unique identifier.
     */
    generateUniqueToolCallId() {
        return `tcid_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Creates a new job from an assistant message containing tool calls.
     * This function parses the calls, assigns unique IDs, updates the original message content,
     * and pushes the new job onto the LIFO stack for processing.
     * @param {Message} assistantMessage The message containing `<dma:tool_call>` tags.
     */
    createJob(assistantMessage) {
        // If this is the first job being pushed, we are starting a new tool call phase.
        // Create the AbortController and show the stop button.
        if (this.jobStack.length === 0) {
            this.app.abortController = new AbortController();
            this.app.dom.stopButton.style.display = 'block';
        }

        const { toolCalls: rawCalls, positions, isSelfClosings } = parseToolCalls(assistantMessage.value.content);

        if (rawCalls.length === 0) return;

        let updatedContent = assistantMessage.value.content;
        const finalToolCalls = [];

        for (let i = rawCalls.length - 1; i >= 0; i--) {
            const rawCall = rawCalls[i];
            const newId = this.generateUniqueToolCallId();
            const callWithId = { ...rawCall, id: newId };
            finalToolCalls.unshift(callWithId);

            const pos = positions[i];
            const gtIndex = updatedContent.indexOf('>', pos.start);
            let startTag = updatedContent.slice(pos.start, gtIndex + 1);

            startTag = startTag.replace(/\s+tool_call_id\s*=\s*["'][^"']*["']/g, '');
            const insert = ` tool_call_id="${newId}"`;
            const endSlice = isSelfClosings[i] ? -2 : -1;
            const endTag = isSelfClosings[i] ? '/>' : '>';
            startTag = startTag.slice(0, endSlice) + insert + endTag;
            updatedContent = updatedContent.slice(0, pos.start) + startTag + updatedContent.slice(gtIndex + 1);
        }

        assistantMessage.value.content = updatedContent;
        if ('cache' in assistantMessage) assistantMessage.cache = null;

        const newJob = {
            id: `job_${Date.now()}`,
            originalMessage: assistantMessage,
            calls: finalToolCalls,
            lastMessageId: assistantMessage.id,
        };

        this.jobStack.push(newJob);
        this.app.chatManager.getActiveChat()?.log.notify();
        this.processNext();
    }

    /**
     * The main processing loop. It processes jobs from the LIFO stack.
     * @private
     */
    async processNext() {
        if (this.isProcessing) return;
        if (this.jobStack.length === 0) {
            // All jobs are done. Clean up the controller and button.
            if (this.app.abortController) {
                this.app.abortController = null;
                this.app.dom.stopButton.style.display = 'none';
            }
            // The last `finishJob` call added a pending message. Now, schedule the AI to process it.
            this.app.responseProcessor.scheduleProcessing(this.app);
            return;
        }

        this.isProcessing = true;
        const currentJob = this.jobStack[this.jobStack.length - 1];
        const callToExecute = currentJob.calls.shift();

        if (callToExecute) {
            await this.executeCall(callToExecute, currentJob);
            this.isProcessing = false;
            this.processNext();
        } else {
            this.finishJob(currentJob);
            this.isProcessing = false;
            this.processNext();
        }
    }

    /**
     * Executes a single tool call by dispatching it to the appropriate plugin.
     * It creates the tool response message and handles both regular and streaming results.
     * @param {ToolCall} call The tool call to execute.
     * @param {ToolCallJob} job The job this call belongs to.
     * @private
     */
    async executeCall(call, job) {
        const activeChat = this.app.chatManager.getActiveChat();
        if (!activeChat) {
            console.error("Cannot execute tool call: No active chat.");
            return;
        }

        const toolResponseValue = {
            role: 'tool',
            name: call.name,
            tool_call_id: call.id,
            content: '',
        };

        const responseMessage = activeChat.log.addMessage(toolResponseValue, job.lastMessageId);
        job.lastMessageId = responseMessage.id;

        try {
            // Pass both the call and the original message to the handler for context.
            const result = await pluginManager.triggerAsync('onToolCall', call, job.originalMessage);

            if (!result) {
                responseMessage.value.content = `<error>No plugin handled the tool call: "${call.name}".</error>`;
            } else if (result.error) {
                responseMessage.value.content = `<error>${result.error}</error>`;
            } else if (result.isStreaming && result.streamReader) {
                const reader = result.streamReader;
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    responseMessage.value.content += decoder.decode(value, { stream: true });
                    activeChat.log.notify();
                }
            } else {
                responseMessage.value.content = result.content;
            }
        } catch (e) {
            console.error(`Error executing tool call ${call.id}:`, e);
            responseMessage.value.content = `<error>${e.message}</error>`;
        } finally {
            activeChat.log.notify();
        }
    }

    /**
     * Finishes a job by removing it from the stack and queueing the next assistant turn.
     * @param {ToolCallJob} job The job to finish.
     * @private
     */
    finishJob(job) {
        this.jobStack.pop();

        const activeChat = this.app.chatManager.getActiveChat();
        const callingAgentId = job.originalMessage.value.agent || 'agent-default';

        // Queue up the next step for the AI, which will be handled when the job stack is empty.
        activeChat.log.addMessage(
            { role: 'assistant', content: null, agent: callingAgentId },
            job.lastMessageId
        );
    }
}

const toolCallManager = new ToolCallManager();

export { parseToolCalls, toolCallManager };