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
import {
    pluginManager
} from './plugin-manager.js';

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
 * all tool calls found within a single message.
 * @typedef {object} ToolCallJob
 * @property {string} id - A unique identifier for the job, starting with 'job_'.
 * @property {ToolCall[]} calls - The array of tool calls to be executed in this job.
 * @property {Message} sourceMessage - The message that initiated these tool calls.
 * @property {Chat} chat - The chat context for this job.
 * @property {Map<string, boolean>} completedCalls - A map to track the completion of calls by their `tool_call_id`.
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

    // Regex to find <dma:tool_call> tags, supporting both container and self-closing forms.
    const functionCallRegex = /<dma:tool_call\s+([^>]+?)\/>|<dma:tool_call\s+([^>]*?)>([\s\S]*?)<\/dma:tool_call\s*>/gi;
    const nameRegex = /name="([^"]*)"/;
    const paramsRegex = /<parameter\s+name="([^"]*)">([\s\S]*?)<\/parameter>/g;

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
                // Basic trim and unescaping for now. Type coercion can be added here if needed.
                params[paramName] = paramValue.trim();
            }
        }

        const call = {
            tool_call_id: `call_${generateUniqueId()}`,
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
 * This class ensures that nested tool calls (e.g., an agent calling a tool)
 * are processed correctly. It orchestrates the entire lifecycle of a tool call,
 * from job creation to completion and response generation.
 * @class
 */
class ToolCallManager {
    /** @type {App} */
    app = null;
    /** @type {ToolCallJob[]} */
    jobStack = [];
    isProcessing = false;

    /**
     * Initializes the manager with the main application instance.
     * @param {App} app - The main application instance.
     */
    init(app) {
        this.app = app;
    }

    /**
     * Creates a new job from a set of parsed tool calls and adds it to the execution stack.
     * It also updates the source message to include the unique `tool_call_id` for each call.
     * @param {ParsedToolCall[]} parsedCalls - The tool calls to be executed.
     * @param {Message} sourceMessage - The message containing the calls.
     * @param {Chat} chat - The active chat instance.
     */
    addJob(parsedCalls, sourceMessage, chat) {
        if (!parsedCalls || parsedCalls.length === 0) {
            return;
        }

        this.updateMessageWithToolCallIDs(sourceMessage, parsedCalls);

        const job = {
            id: `job_${generateUniqueId()}`,
            calls: parsedCalls.map(p => p.call),
            sourceMessage,
            chat,
            completedCalls: new Map(),
        };

        this.jobStack.push(job);
        this.processNextJob();
    }

    /**
     * Injects or overwrites the `tool_call_id` attribute in the raw XML of a message.
     * This ensures that the displayed message content accurately reflects the executed call.
     * @param {Message} message - The message to update.
     * @param {ParsedToolCall[]} parsedCalls - The calls found in the message.
     * @private
     */
    updateMessageWithToolCallIDs(message, parsedCalls) {
        let content = message.value.content;
        // Iterate backwards to avoid messing up indices during replacement.
        for (let i = parsedCalls.length - 1; i >= 0; i--) {
            const pCall = parsedCalls[i];
            const originalTag = content.substring(pCall.start, pCall.end);

            const endOfStartTagMarker = pCall.isSelfClosing ? '/>' : '>';
            const endOfStartTagIndex = originalTag.indexOf(endOfStartTagMarker);
            if (endOfStartTagIndex === -1) continue;

            // Extract the part of the tag to modify, removing any pre-existing tool_call_id.
            let startTagContent = originalTag.substring(0, endOfStartTagIndex);
            startTagContent = startTagContent.replace(/\s+tool_call_id\s*=\s*["'][^"']*["']/g, '');

            // Reconstruct the tag with the new ID.
            const newTag = `${startTagContent} tool_call_id="${pCall.call.tool_call_id}"${originalTag.substring(endOfStartTagIndex)}`;
            content = content.substring(0, pCall.start) + newTag + content.substring(pCall.end);
        }
        message.value.content = content;
        message.cache = null; // Invalidate cache to force re-render.
        this.app.chatManager.getActiveChat()?.log.notify();
    }

    /**
     * Processes the next job on the stack (LIFO).
     * It dispatches all tool calls within the current job to the appropriate plugins for execution.
     */
    async processNextJob() {
        if (this.isProcessing || this.jobStack.length === 0) {
            return;
        }

        this.isProcessing = true;
        const job = this.jobStack[this.jobStack.length - 1]; // Peek at the top job.

        for (const call of job.calls) {
            // Fire-and-forget dispatch. The executing plugin is responsible for reporting completion.
            this.dispatchCall(call, job);
        }
    }

    /**
     * Dispatches a single tool call to the appropriate plugin for execution.
     * The method determines whether a call is for an agent or a standard tool (MCP)
     * and forwards it to the corresponding plugin instance.
     * @param {ToolCall} call - The tool call to dispatch.
     * @param {ToolCallJob} job - The job this call belongs to.
     * @private
     */
    async dispatchCall(call, job) {
        try {
            const agentPlugin = pluginManager.plugins.find(p => p.name === 'Agents Call Plugin')?.instance;
            const mcpPlugin = pluginManager.plugins.find(p => p.name === 'MCP Plugin')?.instance;
            const agentIds = new Set(this.app.agentManager.agents.map(a => a.id));

            if (agentIds.has(call.name) && agentPlugin?.executeCall) {
                await agentPlugin.executeCall(call, job);
            } else if (mcpPlugin?.executeCall) {
                await mcpPlugin.executeCall(call, job);
            } else {
                throw new Error(`No handler found for tool "${call.name}".`);
            }
        } catch (error) {
            console.error(`[ToolCallManager] Error dispatching call ${call.tool_call_id}:`, error);
            const result = {
                name: call.name,
                tool_call_id: call.id,
                content: null,
                error: error.message,
            };
            this.notifyCallComplete(job.id, result);
        }
    }

    /**
     * Callback for plugins to report the completion of a tool call.
     * This method records the result, adds a 'tool' message to the chat, and
     * checks if the entire job is finished.
     * @param {string} jobId - The ID of the job the call belonged to.
     * @param {ToolResult} result - The result of the tool execution.
     */
    notifyCallComplete(jobId, result) {
        const job = this.jobStack.find(j => j.id === jobId);
        if (!job) {
            return;
        }

        job.chat.log.addMessage({
            role: 'tool',
            content: result.error ? `<error>${result.error}</error>` : result.content,
            name: result.name,
            tool_call_id: result.tool_call_id,
        }, job.sourceMessage.id);

        job.completedCalls.set(result.tool_call_id, true);

        if (job.completedCalls.size === job.calls.length) {
            this.finishJob(job);
        }
    }

    /**
     * Finalizes a completed job.
     * This involves removing the job from the stack, queuing the next AI turn
     * if appropriate, and triggering the processing of the next job on the stack.
     * @param {ToolCallJob} job - The job that has just been completed.
     * @private
     */
    finishJob(job) {
        this.jobStack.pop(); // Remove the completed job.

        // If the message that created the tools was from an assistant or another tool,
        // add a new message to allow it to respond to its tool calls.
        const sourceRole = job.sourceMessage.value.role;
        if (sourceRole === 'assistant' || sourceRole === 'tool') {
            const agentId = job.sourceMessage.value.agent || null;
            job.chat.log.addMessage({
                role: 'assistant',
                content: null,
                agent: agentId
            });
            this.app.responseProcessor.scheduleProcessing(this.app);
        }

        this.isProcessing = false;
        this.processNextJob(); // Look for the next job on the stack.
    }
}

export const toolCallManager = new ToolCallManager();