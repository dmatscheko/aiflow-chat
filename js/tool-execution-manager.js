/**
 * @fileoverview Manages the execution of tool calls in a structured, stack-based manner.
 */

'use strict';

import { parseToolCalls } from './tool-processor.js';
import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./tool-processor.js').ToolCall} ToolCall
 * @typedef {import('./tool-processor.js').ToolResult} ToolResult
 */

/**
 * Represents a collection of tool calls from a single message that need to be processed.
 * @typedef {object} ToolCallArray
 * @property {ToolCall[]} calls - The tool calls to be executed.
 * @property {Message} message - The message that initiated these tool calls.
 * @property {number} completedCalls - The number of calls in this array that have been completed.
 */

/**
 * A function that executes a tool call and returns its result.
 * @callback ToolExecutor
 * @param {ToolCall} call - The tool call to execute.
 * @param {Message} message - The message that initiated the call.
 * @returns {Promise<ToolResult>} A promise that resolves to the result of the tool execution.
 */

/**
 * Manages the entire lifecycle of tool execution. It uses a stack-based approach
 * to handle nested tool calls, ensuring that calls are processed in a LIFO
 * (Last-In, First-Out) order. This allows for complex scenarios where a tool's
 * response may itself contain further tool calls.
 * @class
 */
class ToolExecutionManager {
    /** @type {App|null} */
    app = null;

    /**
     * The stack of tool call arrays. Processed in LIFO order.
     * @type {ToolCallArray[]}
     */
    toolCallStack = [];

    /**
     * A map of tool name prefixes or exact names to their executor functions.
     * @type {Map<string, ToolExecutor>}
     */
    executors = new Map();

    /** @type {ToolExecutor | null} */
    defaultExecutor = null;

    /** @type {boolean} */
    isProcessing = false;

    /** @param {App} app */
    init(app) {
        this.app = app;
    }

    /**
     * Registers an executor for a specific tool or a group of tools.
     * @param {string} toolName - The exact name or a prefix for the tool(s).
     * @param {ToolExecutor} executor - The function to execute the tool call.
     */
    registerExecutor(toolName, executor) {
        if (this.executors.has(toolName)) {
            console.warn(`An executor for "${toolName}" is already registered. It will be overwritten.`);
        }
        this.executors.set(toolName, executor);
    }

    /**
     * Registers a default executor that runs for any tool call not handled by a specific executor.
     * @param {ToolExecutor} executor - The function to execute the tool call.
     */
    registerDefaultExecutor(executor) {
        if (this.defaultExecutor) {
            console.warn('A default tool executor is already registered. It will be overwritten.');
        }
        this.defaultExecutor = executor;
    }

    /**
     * Kicks off the processing of the tool call stack.
     */
    processToolCalls() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        (async () => {
            while (this.toolCallStack.length > 0) {
                const currentArray = this.toolCallStack[this.toolCallStack.length - 1];
                await this._processToolCallArray(currentArray);

                // After processing, check if the array is complete.
                if (currentArray.completedCalls === currentArray.calls.length) {
                    this.toolCallStack.pop(); // Remove the completed array from the stack.
                    const { message } = currentArray;

                    // If the message that triggered the tools was from an assistant or an agent,
                    // add that same agent back to the chat to allow it to respond to the tool results.
                    const agentId = message.value.agent || null;
                    if (message.value.role === 'assistant') {
                        this.app.chatManager.getActiveChat().log.addMessage({
                            role: 'assistant',
                            content: null,
                            agent: agentId
                        });
                        // The main response processor loop will pick this up.
                        this.app.responseProcessor.scheduleProcessing(this.app);
                    }
                }
            }
            this.isProcessing = false;
        })();
    }

    /**
     * Processes a single array of tool calls.
     * @param {ToolCallArray} toolCallArray
     * @private
     */
    async _processToolCallArray(toolCallArray) {
        const { calls, message } = toolCallArray;
        const chat = this.app.chatManager.getActiveChat();
        const results = [];

        for (const call of calls) {
            const executor = this._findExecutor(call.name);
            if (executor) {
                const result = await executor(call, message);
                results.push(result);
                // After getting a result, check its content for new tool calls
                const newToolCalls = parseToolCalls(result.content).toolCalls;
                if (newToolCalls.length > 0) {
                    // This is a nested call. Create a new message for the tool's response
                    // and push a new tool call array onto the stack.
                    const toolResponseMessage = chat.log.addMessage({
                        role: 'tool',
                        name: result.name,
                        tool_call_id: result.tool_call_id,
                        content: result.content
                    });

                    this.toolCallStack.push({
                        calls: newToolCalls,
                        message: toolResponseMessage,
                        completedCalls: 0,
                    });
                    // Immediately start processing the new top of the stack.
                    return;
                }
            } else {
                results.push({
                    name: call.name,
                    tool_call_id: call.id,
                    error: `No executor found for tool "${call.name}".`
                });
            }
        }

        // If we reach here, all calls in the current array are processed without creating nested calls.
        this._formatAndAddToolResults(results, message);
        toolCallArray.completedCalls = calls.length;
    }

    /**
     * Finds the best-matching executor for a given tool name.
     * @param {string} toolName
     * @returns {ToolExecutor | null}
     * @private
     */
    _findExecutor(toolName) {
        // Exact match has the highest priority.
        if (this.executors.has(toolName)) {
            return this.executors.get(toolName);
        }

        // Prefix-based match has second priority.
        for (const [prefix, executor] of this.executors.entries()) {
            if (toolName.startsWith(prefix)) {
                return executor;
            }
        }

        // Fallback to the default executor if no specific one is found.
        return this.defaultExecutor;
    }

    /**
     * Formats the tool results and adds them to the chat.
     * @param {ToolResult[]} results
     * @param {Message} originalMessage
     * @private
     */
    _formatAndAddToolResults(results, originalMessage) {
        const chat = this.app.chatManager.getActiveChat();
        let toolResponseContent = '';
        results.forEach(res => {
            const innerContent = res.error
                ? `<error>${res.error}</error>`
                : `<content>${res.content || ''}</content>`;
            toolResponseContent += `<dma:tool_response name="${res.name}" tool_call_id="${res.tool_call_id}">\n${innerContent}\n</dma:tool_response>\n`;
        });

        chat.log.addMessage({
            role: 'tool',
            content: toolResponseContent,
        });
    }

    /**
     * The main entry point called by the response processor. It parses a message
     * for tool calls, injects unique IDs, and kicks off the execution process.
     * @param {Message} message - The message from the assistant that may contain tool calls.
     * @returns {boolean} - True if tool calls were found and are being processed.
     */
    handleAssistantResponse(message) {
        const { toolCalls } = parseToolCalls(message.value.content);

        if (toolCalls.length === 0) {
            return false;
        }

        // Modify the original message to include the unique IDs
        let content = message.value.content;
        const positions = parseToolCalls(content).positions;
        const isSelfClosings = parseToolCalls(content).isSelfClosings;

        for (let i = positions.length - 1; i >= 0; i--) {
            const call = toolCalls[i];
            const pos = positions[i];
            const gtIndex = content.indexOf('>', pos.start);
            let startTag = content.slice(pos.start, gtIndex + 1);

            startTag = startTag.replace(/\s+tool_call_id\s*=\s*["'][^"']*["']/g, '');
            const insert = ` tool_call_id="${call.id}"`;
            const endSlice = isSelfClosings[i] ? -2 : -1;
            const endTag = isSelfClosings[i] ? '/>' : '>';
            startTag = startTag.slice(0, endSlice) + insert + endTag;
            content = content.slice(0, pos.start) + startTag + content.slice(gtIndex + 1);
        }
        message.value.content = content;
        // Invalidate cache to force re-render
        if (message.cache) {
            message.cache = null;
        }
        this.app.chatManager.getActiveChat().log.notify();

        this.toolCallStack.push({
            calls: toolCalls,
            message: message,
            completedCalls: 0,
        });

        this.processToolCalls();
        return true;
    }
}

export const toolExecutionManager = new ToolExecutionManager();