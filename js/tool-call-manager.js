/**
 * @fileoverview Manages the queue and execution of tool and agent calls.
 * This class ensures that tool calls are processed sequentially,
 * handles nested agent calls with a stack, and orchestrates the
 * overall flow of tool-using conversations.
 */

'use strict';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./main.js').Chat} Chat
 * @typedef {import('./tool-processor.js').ToolCall} ToolCall
 * @typedef {import('./plugins/agents-plugin.js').Agent} Agent
 */

/**
 * @typedef {object} QueuedCall
 * @property {ToolCall} call - The tool call to be executed.
 * @property {Message} message - The message that triggered the tool call.
 * @property {Chat} chat - The active chat instance.
 * @property {(call: ToolCall, message: Message, chat: Chat) => Promise<any>} executor - The function that will execute the call.
 */

/**
 * @typedef {object} CallStackFrame
 * @property {string} agentId - The ID of the agent that made the calls.
 * @property {number} expectedCalls - The number of tool/agent calls made in this frame.
 * @property {number} completedCalls - The number of calls that have completed.
 */

class ToolCallManager {
    /** @param {App} app */
    constructor(app) {
        /** @type {App} */
        this.app = app;
        /** @type {QueuedCall[]} */
        this.callQueue = [];
        /** @type {CallStackFrame[]} */
        this.callStack = [];
        /** @type {boolean} */
        this.isProcessing = false;
    }

    /**
     * Adds a tool call to the processing queue.
     * @param {QueuedCall} queuedCall
     */
    addCall(queuedCall) {
        this.callQueue.push(queuedCall);
    }

    /**
     * Starts processing the tool call queue if not already running.
     */
    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.callQueue.length > 0) {
            const { call, message, chat, executor } = this.callQueue.shift();
            await executor(call, message, chat);
            this.callStack[this.callStack.length - 1].completedCalls++;
            await this.checkStackCompletion(chat);
        }

        this.isProcessing = false;
    }

    /**
     * Pushes a new frame onto the call stack. This is done when an assistant
     * message contains one or more tool calls.
     * @param {string} agentId - The ID of the agent making the calls.
     * @param {number} callCount - The number of calls made by the agent.
     */
    startTurn(agentId, callCount) {
        this.callStack.push({
            agentId: agentId,
            expectedCalls: callCount,
            completedCalls: 0,
        });
    }

    /**
     * Checks if the current frame on the call stack is complete. If so,
     * it pops the frame and either queues the next assistant turn or
     * continues processing the parent frame.
     * @param {Chat} chat
     */
    async checkStackCompletion(chat) {
        if (this.callStack.length === 0) return;

        const currentFrame = this.callStack[this.callStack.length - 1];
        if (currentFrame.completedCalls < currentFrame.expectedCalls) {
            return; // Still more calls to complete in this frame
        }

        // If we reach here, the current frame is complete.
        this.callStack.pop();

        if (this.callStack.length > 0) {
            // This was a nested agent call. The result is now in a 'tool' message.
            // We need to signal the parent agent's turn to continue.
            const parentFrame = this.callStack[this.callStack.length - 1];
            parentFrame.completedCalls++;
            await this.checkStackCompletion(chat);
        } else {
            // This was the top-level turn. All tool calls are done.
            // Queue the final assistant response.
            chat.log.addMessage({ role: 'assistant', content: null, agent: currentFrame.agentId });
            this.app.responseProcessor.scheduleProcessing(this.app);
        }
    }

    /**
     * Resets the state of the manager.
     */
    reset() {
        this.callQueue = [];
        this.callStack = [];
        this.isProcessing = false;
    }
}

export { ToolCallManager };