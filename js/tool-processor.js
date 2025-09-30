/**
 * @fileoverview Provides a centralized, stack-based system for processing tool calls.
 * This file defines the ToolCallManager, which orchestrates the execution of
 * tool calls (including nested calls from agents) in a last-in, first-out (LIFO) manner.
 * It also provides the parsing logic to extract tool calls from message content.
 */

'use strict';

import {
    generateUniqueId
} from './utils.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./main.js').Chat} Chat
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./plugins/mcp-plugin.js').ToolResult} ToolResult
 */

/**
 * Represents a single tool call parsed from a message.
 * @typedef {object} ToolCall
 * @property {string} tool_call_id - A unique identifier for the tool call, starting with 'call_'.
 * @property {string} name - The name of the tool being called.
 * @property {object<string, any>} params - The parameters for the tool call.
 */

/**
 * An object that contains a parsed tool call and its position in the source string.
 * @typedef {object} ParsedToolCall
 * @property {ToolCall} call - The parsed tool call data.
 * @property {number} start - The starting index of the tool call tag in the content.
 * @property {number} end - The ending index of the tool call tag in the content.
 * @property {boolean} isSelfClosing - A flag indicating if the tag was self-closing.
 */

/**
 * Represents a job to be executed by the ToolCallManager. A job consists of
 * all tool calls found within a single message, which are executed sequentially.
 * @typedef {object} ToolCallJob
 * @property {string} id - A unique identifier for the job.
 * @property {ToolCall[]} calls - The array of tool calls to be executed in this job.
 * @property {Message} sourceMessage - The message that initiated these tool calls.
 * @property {Chat} chat - The chat context for this job.
 * @property {number} nextCallIndex - The index of the next tool call in the `calls` array to be executed.
 * @property {string} lastMessageId - The ID of the last message created in the execution chain for this job.
 */


/**
 * Parses tool calls from an assistant's message content.
 * This function identifies tool call XML tags, extracts their name and parameters,
 * and assigns a unique ID to each call. It correctly handles both standard and
 * self-closing tag formats.
 *
 * @param {string | null} content - The message content to parse.
 * @returns {ParsedToolCall[]} An array of parsed tool call objects, each including
 *   the call data and its position in the original string.
 */
export function parseToolCalls(content) {
    /** @type {ParsedToolCall[]} */
    const parsedCalls = [];
    if (!content) {
        return parsedCalls;
    }

    const functionCallRegex = /<dma:tool_call\s+([^>]+?)\/>|<dma:tool_call\s+([^>]*?)>([\s\S]*?)<\/dma:tool_call\s*>/gi;
    const nameRegex = /name="([^"]*)"/;
    const paramsRegex = /<parameter\s+name="([^"]*)">([\s\S]*?)<\/parameter>/g;

    const generatedIds = new Set();
    for (const match of content.matchAll(functionCallRegex)) {
        const [fullMatch, selfClosingAttrs, openTagAttrs, innerContent] = match;
        const isSelfClosing = innerContent === undefined;
        const attributes = selfClosingAttrs || openTagAttrs;

        const nameMatch = nameRegex.exec(attributes);
        if (!nameMatch) continue;

        const name = nameMatch[1];
        const params = {};

        if (!isSelfClosing) {
            let paramMatch;
            while ((paramMatch = paramsRegex.exec(innerContent)) !== null) {
                const [, paramName, paramValue] = paramMatch;
                params[paramName] = paramValue.trim();
            }
        }

        const newId = generateUniqueId('call', generatedIds);
        generatedIds.add(newId);

        const call = {
            tool_call_id: newId,
            name,
            params,
        };

        parsedCalls.push({
            call,
            start: match.index,
            end: match.index + fullMatch.length,
            isSelfClosing,
        });
    }

    return parsedCalls;
}


/**
 * Manages the execution of tool calls in a stack-based (LIFO) manner.
 * @class
 */
class ToolCallManager {
    /** @type {App} */
    app = null;
    /** @type {ToolCallJob[]} */
    jobStack = [];
    isProcessing = false;
    /** @type {Map<string, object>} */
    executors = new Map();

    /**
     * @param {App} app
     */
    init(app) {
        this.app = app;
    }

    /**
     * @param {string} type
     * @param {object} executor
     */
    registerExecutor(type, executor) {
        if (typeof executor.executeCall !== 'function') {
            throw new Error(`Executor for type "${type}" must have an executeCall method.`);
        }
        this.executors.set(type, executor);
    }

    /**
     * @param {ParsedToolCall[]} parsedCalls
     * @param {Message} sourceMessage
     * @param {Chat} chat
     */
    addJob(parsedCalls, sourceMessage, chat) {
        if (!parsedCalls || parsedCalls.length === 0) {
            return;
        }

        this.updateMessageWithToolCallIDs(sourceMessage, parsedCalls);

        const job = {
            id: generateUniqueId('job'),
            calls: parsedCalls.map(p => p.call),
            sourceMessage,
            chat,
            nextCallIndex: 0,
            lastMessageId: sourceMessage.id, // Start the chain from the source message
        };

        this.jobStack.push(job);
        this.processLoop();
    }

    /**
     * @param {Message} message
     * @param {ParsedToolCall[]} parsedCalls
     * @private
     */
    updateMessageWithToolCallIDs(message, parsedCalls) {
        let content = message.value.content;
        for (let i = parsedCalls.length - 1; i >= 0; i--) {
            const pCall = parsedCalls[i];
            const originalTag = content.substring(pCall.start, pCall.end);
            const endOfStartTagMarker = pCall.isSelfClosing ? '/>' : '>';
            const endOfStartTagIndex = originalTag.indexOf(endOfStartTagMarker);
            if (endOfStartTagIndex === -1) continue;

            let startTagContent = originalTag.substring(0, endOfStartTagIndex);
            startTagContent = startTagContent.replace(/\s+tool_call_id\s*=\s*["'][^"']*["']/g, '');

            const newTag = `${startTagContent} tool_call_id="${pCall.call.tool_call_id}"${originalTag.substring(endOfStartTagIndex)}`;
            content = content.substring(0, pCall.start) + newTag + content.substring(pCall.end);
        }
        message.value.content = content;
        message.cache = null;
        this.app.chatManager.getActiveChat()?.log.notify();
    }

    async processLoop() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.jobStack.length > 0) {
            const job = this.jobStack[this.jobStack.length - 1];

            if (job.nextCallIndex >= job.calls.length) {
                this.finishJob(job);
                continue; // Continue the loop to process the next job on the stack
            }

            const call = job.calls[job.nextCallIndex];
            // Await the dispatch and notification, ensuring sequential execution
            await this.dispatchCall(call, job);
        }

        this.isProcessing = false;
    }

    /**
     * @param {ToolCall} call
     * @param {ToolCallJob} job
     * @private
     */
    async dispatchCall(call, job) {
        try {
            const agentIds = new Set(this.app.agentManager.agents.map(a => a.id));
            const executor = agentIds.has(call.name)
                ? this.executors.get('agent')
                : this.executors.get('mcp');

            if (executor) {
                await executor.executeCall(call, job, this.app);
            } else {
                throw new Error(`No handler registered for tool "${call.name}".`);
            }
        } catch (error) {
            console.error(`[ToolCallManager] Error dispatching call ${call.tool_call_id}:`, error);
            this.notifyCallComplete(job.id, {
                name: call.name,
                tool_call_id: call.tool_call_id,
                content: null,
                error: error.message,
            });
        }
    }

    /**
     * @param {string} jobId
     * @param {ToolResult} result
     * @returns {Message | null}
     */
    notifyCallComplete(jobId, result) {
        const job = this.jobStack.find(j => j.id === jobId);
        if (!job) return null;

        const parentId = job.lastMessageId;
        const toolResponseMessage = job.chat.log.addMessage({
            role: 'tool',
            content: result.error ? `<error>${result.error}</error>` : `<dma:tool_response name="${result.name}" tool_call_id="${result.tool_call_id}"><content>${result.content}</content></dma:tool_response>`,
            name: result.name,
            tool_call_id: result.tool_call_id,
        }, parentId);

        job.lastMessageId = toolResponseMessage.id;
        job.nextCallIndex++;

        return toolResponseMessage;
    }

    /**
     * @param {ToolCallJob} job
     * @private
     */
    finishJob(job) {
        this.jobStack.pop();

        const sourceRole = job.sourceMessage.value.role;
        if (sourceRole === 'assistant' || sourceRole === 'tool') {
            const agentId = job.sourceMessage.value.agent || null;
            job.chat.log.addMessage({
                role: 'assistant',
                content: null,
                agent: agentId
            }, job.lastMessageId);
            this.app.responseProcessor.scheduleProcessing(this.app);
        }
    }
}

export const toolCallManager = new ToolCallManager();