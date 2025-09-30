/**
 * @fileoverview Central processor for managing and executing tool calls.
 * @version 1.0.0
 */

'use strict';

import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./tool-processor.js').ToolCall} ToolCall
 * @typedef {import('./tool-processor.js').ToolResult} ToolResult
 */

/**
 * Represents a batch of tool calls originating from a single source message.
 * @class
 */
class ToolCallBatch {
    /**
     * @param {Message} sourceMessage - The message that contains the tool call requests.
     * @param {ToolCall[]} calls - The array of tool calls to be executed.
     */
    constructor(sourceMessage, calls) {
        /** @type {Message} */
        this.sourceMessage = sourceMessage;
        /** @type {ToolCall[]} */
        this.calls = calls;
        /** @type {number} */
        this.completedCalls = 0;
    }
}

/**
 * Manages the lifecycle of tool calls in a stack-based manner.
 * It ensures that nested tool calls are resolved before their parents.
 * @class
 */
class ToolCallProcessor {
    /**
     * @param {App} app - The main application instance.
     */
    constructor(app) {
        /** @type {App} */
        this.app = app;
        /**
         * An array of tool call batches, treated as a LIFO stack.
         * @type {ToolCallBatch[]}
         */
        this.callStack = [];
        /**
         * Flag to prevent concurrent processing.
         * @type {boolean}
         */
        this.isProcessing = false;
    }

    /**
     * Adds a new batch of tool calls to the processing stack.
     * @param {Message} sourceMessage - The message initiating the calls.
     * @param {ToolCall[]} calls - The tool calls to execute.
     */
    addBatch(sourceMessage, calls) {
        if (calls.length > 0) {
            const batch = new ToolCallBatch(sourceMessage, calls);
            this.callStack.push(batch);
        }
    }

    /**
     * Checks if there are any pending tool calls to be processed.
     * @returns {boolean}
     */
    hasPendingCalls() {
        return this.callStack.length > 0;
    }

    /**
     * Processes the next available tool call from the top-most batch on the stack.
     * This method orchestrates the entire tool call execution flow.
     */
    async processNext() {
        if (this.isProcessing || !this.hasPendingCalls()) {
            return;
        }
        this.isProcessing = true;

        const currentBatch = this.callStack[this.callStack.length - 1];
        const callToExecute = currentBatch.calls.find(c => !c.processed);

        if (!callToExecute) {
            // This should not happen if hasPendingCalls is checked correctly, but as a safeguard.
            console.warn('Processing triggered, but no unprocessed calls found in the current batch.');
            this.isProcessing = false;
            return;
        }

        try {
            // Mark as processed to prevent re-execution
            callToExecute.processed = true;

            // Delegate the actual execution to the appropriate plugin.
            // `triggerUntilHandled` ensures the first plugin to return a non-null result wins.
            /** @type {ToolResult} */
            const result = await pluginManager.triggerUntilHandled('onToolCallExecute', callToExecute, currentBatch.sourceMessage);

            if (!result) {
                throw new Error(`Execution for tool call '${callToExecute.name}' did not return a result.`);
            }

            this._handleCallCompletion(currentBatch, result);

        } catch (error) {
            console.error(`Error executing tool call '${callToExecute.name}':`, error);
            const errorResult = {
                name: callToExecute.name,
                tool_call_id: callToExecute.id,
                error: error.message || 'An unknown error occurred during execution.',
            };
            this._handleCallCompletion(currentBatch, errorResult);
        } finally {
            this.isProcessing = false;
            // Immediately schedule the next processing cycle.
            this.app.responseProcessor.scheduleProcessing();
        }
    }

    /**
     * Handles the completion of a single tool call. It adds the tool response
     * message to the chat and checks if the batch is complete.
     * @param {ToolCallBatch} batch - The batch the call belongs to.
     * @param {ToolResult} result - The result of the tool call execution.
     * @private
     */
    _handleCallCompletion(batch, result) {
        const { name, tool_call_id, content, error } = result;
        const chat = this.app.chatManager.getActiveChat(); // Assuming the active chat is the correct one.

        // Add the tool response message.
        // Note: The parent for this message is the source message of the batch.
        chat.log.addMessage({
            role: 'tool',
            content: error ? `<error>${error}</error>` : content,
            name: name,
            tool_call_id: tool_call_id,
        }, batch.sourceMessage.id);

        batch.completedCalls++;

        // Check if the entire batch is complete.
        if (batch.completedCalls === batch.calls.length) {
            this._finalizeBatch(batch);
        }
    }

    /**
     * Finalizes a completed batch by removing it from the stack and queuing
     * the next turn for the original calling agent or assistant.
     * @param {ToolCallBatch} batch - The batch that has been completed.
     * @private
     */
    _finalizeBatch(batch) {
        // Remove the completed batch from the stack.
        this.callStack.pop();

        const chat = this.app.chatManager.getActiveChat();
        const callingAgentId = batch.sourceMessage.value.agent || null;

        // Add a new pending message for the original agent/assistant to respond.
        chat.log.addMessage({
            role: 'assistant',
            content: null,
            agent: callingAgentId
        });
    }
}

export { ToolCallProcessor };