/**
 * @fileoverview Centralized logic for parsing and processing tool calls.
 * This file defines the ToolCallManager, which orchestrates the sequential
 * and nested execution of tool calls from assistant messages.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./chat-data.js').ChatLog} ChatLog
 * @typedef {import('./chat-data.js').MessageValue} MessageValue
 */

/**
 * Represents a single tool call parsed from a message.
 * @typedef {object} ToolCall
 * @property {string} id - A unique identifier for the tool call.
 * @property {string} name - The name of the tool being called.
 * @property {object} params - The parameters for the tool call.
 */

/**
 * The result of a single tool execution.
 * @typedef {object} ToolResult
 * @property {string} name - The name of the tool that was called.
 * @property {string} tool_call_id - The ID of the tool call this is a result for.
 * @property {string | null} content - The stringified result of the tool execution.
 * @property {string | null} error - A string describing an error, if one occurred.
 * @property {boolean} [isStreaming=false] - Indicates if the content is a stream.
 * @property {AsyncGenerator<string>} [stream] - The async generator for streaming content.
 */

/**
 * Represents a job to be processed by the ToolCallManager. A job consists of
 * one or more tool calls from a single assistant message that must be
 * executed sequentially.
 * @class
 */
class ToolCallJob {
    /**
     * @param {ToolCall[]} calls - The list of tool calls to execute.
     * @param {Message} originalMessage - The assistant message that contained the calls.
     * @param {string} parentMessageId - The ID of the message to which the first tool response should be a child.
     */
    constructor(calls, originalMessage, parentMessageId) {
        /** @type {ToolCall[]} */
        this.calls = calls;
        /** @type {Message} */
        this.originalMessage = originalMessage;
        /**
         * The ID of the last message in the chain (assistant message, then tool responses).
         * This is updated after each call to ensure responses are chained correctly.
         * @type {string}
         */
        this.lastMessageId = parentMessageId;
        /**
         * The index of the next tool call in the `calls` array to be executed.
         * @type {number}
         */
        this.nextCallIndex = 0;
    }
}

/**
 * Orchestrates the execution of tool calls. It manages a stack of jobs to handle
 * sequential and nested tool calls in a Last-In, First-Out (LIFO) manner.
 * @class
 */
class ToolCallManager {
    /**
     * @param {App} app - The main application instance.
     */
    constructor(app) {
        /** @type {App} */
        this.app = app;
        /**
         * The stack of jobs to be processed. The manager always works on the job at the top of the stack.
         * @type {ToolCallJob[]}
         */
        this.jobStack = [];
        /**
         * A flag to prevent multiple processing loops from running concurrently.
         * @type {boolean}
         */
        this.isProcessing = false;
    }

    /**
     * Creates a new job from a set of tool calls and adds it to the job stack.
     * It also updates the original assistant message with the system-generated tool call IDs.
     * @param {ToolCall[]} calls - The tool calls to execute.
     * @param {Message} originalMessage - The message containing the calls.
     * @param {ChatLog} chatLog - The chat log instance for the current chat.
     */
    addJob(calls, originalMessage, chatLog) {
        // Update the original message content with the correct, unique tool_call_ids
        this.updateMessageWithToolIds(originalMessage, calls, chatLog);

        const job = new ToolCallJob(calls, originalMessage, originalMessage.id);
        this.jobStack.push(job);
        console.log(`ToolCallManager: Added new job with ${calls.length} call(s). Stack size: ${this.jobStack.length}`);

        if (!this.isProcessing) {
            this.processLoop();
        }
    }

    /**
     * The main processing loop. It processes jobs from the stack until the stack is empty.
     * It always executes the next call of the job at the top of the stack (LIFO).
     * @private
     */
    async processLoop() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        console.log('ToolCallManager: Starting processing loop.');

        try {
            while (this.jobStack.length > 0) {
                const currentJob = this.jobStack[this.jobStack.length - 1];
                const chat = this.app.chatManager.getActiveChat();
                if (!chat) {
                    console.error("ToolCallManager: No active chat found. Aborting.");
                    this.jobStack = []; // Clear stack to stop loop
                    break;
                }

                if (currentJob.nextCallIndex >= currentJob.calls.length) {
                    // This job is finished, so pop it and queue the final assistant response.
                    this.finishJob(currentJob, chat);
                    continue; // Loop to process the next job on the stack or exit.
                }

                const callToExecute = currentJob.calls[currentJob.nextCallIndex];
                console.log(`ToolCallManager: Executing call ${currentJob.nextCallIndex + 1}/${currentJob.calls.length}: ${callToExecute.name} (${callToExecute.id})`);

                // Find the plugin that can handle this tool call.
                const result = await pluginManager.triggerSequentially('onExecuteToolCall', callToExecute, currentJob.originalMessage);

                if (result === false || typeof result !== 'object') {
                    // No plugin handled the call, or an error occurred.
                    const errorResult = {
                        name: callToExecute.name,
                        tool_call_id: callToExecute.id,
                        error: `No plugin was available to handle the tool call "${callToExecute.name}".`,
                    };
                    await this.addToolResponseMessage(errorResult, currentJob, chat.log);
                } else {
                    // A plugin handled the call. Add the response message.
                    await this.addToolResponseMessage(result, currentJob, chat.log);
                }

                // The call is complete, move to the next one in the job.
                currentJob.nextCallIndex++;
            }
        } catch (error) {
            console.error('ToolCallManager: An unexpected error occurred in the processing loop.', error);
            // Consider how to handle chat state in case of a critical failure.
            // For now, we clear the stack to prevent an infinite loop.
            this.jobStack = [];
        } finally {
            this.isProcessing = false;
            console.log('ToolCallManager: Processing loop finished.');
        }
    }

    /**
     * Adds a tool response message to the chat log and updates the job state.
     * Handles both regular and streaming content.
     * @param {ToolResult} result - The result from the tool execution.
     * @param {ToolCallJob} job - The current job being processed.
     * @param {ChatLog} chatLog - The chat log to add the message to.
     * @private
     */
    async addToolResponseMessage(result, job, chatLog) {
        // For streaming results, create a message shell and update it as chunks arrive.
        if (result.isStreaming && result.stream) {
            const messageValue = {
                role: 'tool',
                content: '', // Start with empty content
                name: result.name,
                tool_call_id: result.tool_call_id,
            };
            const message = chatLog.addMessage(messageValue, job.lastMessageId);
            job.lastMessageId = message.id;
            console.log(`ToolCallManager: Added STREAMING tool response shell for ${result.name}.`);

            let finalContent = '';
            try {
                for await (const chunk of result.stream) {
                    finalContent += chunk;
                    message.value.content = finalContent;
                    chatLog.notify(); // Re-render UI with new chunk
                }
                // After the stream finishes, parse the final content for nested calls.
                const nestedCalls = parseToolCalls(finalContent);
                if (nestedCalls.length > 0) {
                    console.log(`ToolCallManager: Found ${nestedCalls.length} nested tool call(s) in the response from ${result.name}.`);
                    this.app.toolCallManager.addJob(nestedCalls, message, chatLog);
                }
            } catch (error) {
                console.error(`ToolCallManager: Error processing stream for ${result.name}:`, error);
                message.value.content += `\n<error>Stream processing failed: ${error.message}</error>`;
                chatLog.notify();
            }
            console.log(`ToolCallManager: Streaming finished for ${result.name}.`);
        } else {
            // For non-streaming results, add the message in one go.
            const content = result.error ? `<error>${result.error}</error>` : result.content;
            const messageValue = {
                role: 'tool',
                content,
                name: result.name,
                tool_call_id: result.tool_call_id,
            };
            const message = chatLog.addMessage(messageValue, job.lastMessageId);
            job.lastMessageId = message.id;
            console.log(`ToolCallManager: Added tool response for ${result.name}.`);
        }
    }

    /**
     * Finalizes a job by adding a pending assistant message and popping the job from the stack.
     * @param {ToolCallJob} job - The job to finish.
     * @param {import('./main.js').Chat} chat - The active chat.
     * @private
     */
    finishJob(job, chat) {
        console.log(`ToolCallManager: Finishing job. Popping from stack. Stack size will be ${this.jobStack.length - 1}.`);
        // The agent that made the original call gets to respond.
        const originalAgentId = job.originalMessage.value.agent;
        chat.log.addMessage({ role: 'assistant', content: null, agent: originalAgentId }, job.lastMessageId);
        this.jobStack.pop();

        // Schedule the main response processor to handle the new pending assistant message.
        this.app.responseProcessor.scheduleProcessing(this.app);
    }

    /**
     * Injects the unique, system-generated tool_call_ids back into the assistant message content.
     * This ensures the user sees the correct IDs in the UI.
     * @param {Message} message - The message to update.
     * @param {ToolCall[]} calls - The array of tool calls with their generated IDs.
     * @param {ChatLog} chatLog - The chat log to notify of the change.
     * @private
     */
    updateMessageWithToolIds(message, calls, chatLog) {
        let content = message.value.content;
        const callTagRegex = /<dma:tool_call\s+name="([^"]+)"[^>]*>/g;
        let match;
        let callIndex = 0;

        const updatedContent = content.replace(callTagRegex, (matchStr) => {
            if (callIndex < calls.length) {
                const call = calls[callIndex];
                callIndex++;
                // Check if the original tag already has a tool_call_id and remove it
                let newTag = matchStr.replace(/\s+tool_call_id="[^"]*"/, '');
                // Insert the new id
                const insertPos = newTag.endsWith('/>') ? -2 : -1;
                newTag = newTag.slice(0, insertPos) + ` tool_call_id="${call.id}"` + newTag.slice(insertPos);
                return newTag;
            }
            return matchStr; // Should not happen if parsing is correct
        });

        message.value.content = updatedContent;
        chatLog.notify(); // Notify UI to re-render the message with the new IDs
    }
}


// --- Utility Functions ---

/**
 * Parses tool calls from an assistant's message content.
 * This is a revised parser that correctly handles self-closing tags and generates unique IDs.
 * @param {string | null} content - The message content to parse.
 * @returns {ToolCall[]} The parsed tool calls with unique IDs.
 */
export function parseToolCalls(content) {
    const toolCalls = [];
    if (!content) return toolCalls;

    const toolCallRegex = /<dma:tool_call\s+([^>]+?)\/?>/g;
    const nameRegex = /name="([^"]*)"/;

    // Find all opening tags first to parse names and generate IDs
    for (const match of content.matchAll(toolCallRegex)) {
        const attributes = match[1];
        const nameMatch = nameRegex.exec(attributes);
        if (nameMatch) {
            const name = nameMatch[1];
            toolCalls.push({
                id: generateUniqueToolCallId(name),
                name,
                params: {} // Params will be populated next
            });
        }
    }

    // Now parse the full structure to get params
    const fullBlockRegex = /<dma:tool_call\s+name="[^"]+"[^>]*>([\s\S]*?)<\/dma:tool_call>/g;
    const paramRegex = /<parameter\s+name="([^"]*)">([\s\S]*?)<\/parameter>/g;
    let blockMatch;
    let callIndex = 0;
    while ((blockMatch = fullBlockRegex.exec(content)) !== null) {
        if (callIndex < toolCalls.length) {
            const call = toolCalls[callIndex];
            const innerContent = blockMatch[1];
            let paramMatch;
            while ((paramMatch = paramRegex.exec(innerContent)) !== null) {
                const [, paramName, paramValue] = paramMatch;
                // Basic unescaping for values, as per the spec
                const value = paramValue.trim().replace(/<\\\/dma:tool_call>/g, '</dma:tool_call>').replace(/<\\\/parameter>/g, '</parameter>');
                call.params[paramName] = value;
            }
            callIndex++;
        }
    }
    return toolCalls;
}

/**
 * Generates a truly unique ID for a tool call to prevent collisions.
 * @param {string} toolName - The name of the tool, used as a prefix.
 * @returns {string} A unique identifier.
 */
function generateUniqueToolCallId(toolName) {
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 9);
    return `tool_call_${toolName}_${timestamp}_${randomPart}`;
}

export { ToolCallManager, ToolCallJob };