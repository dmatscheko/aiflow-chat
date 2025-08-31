/**
 * @fileoverview Service for processing tool calls from AI responses.
 */

'use strict';

import { parseFunctionCalls } from '../utils/parsers.js';
import { hooks } from '../hooks.js';

class ToolCallService {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    /**
     * Processes tool calls found in a message, filters them, executes them,
     * and adds the results back to the chat.
     *
     * @param {import('../components/chatlog.js').Message} message - The message containing the tool calls.
     * @param {import('../components/chatlog.js').Chatlog} chatlog - The chatlog instance.
     * @param {function(object): boolean} filterCallback - A function to filter which tool calls to process.
     * @param {function(object): Promise<object>} executeCallback - An async function to execute a tool call and return the result.
     * @param {object} context - Additional context to pass to the callbacks.
     * @param {Array<object>} [tools=[]] - A list of available tools with their schemas.
     */
    async process(message, chatlog, filterCallback, executeCallback, context, tools = []) {
        if (message.value.role !== 'assistant') return;

        const { toolCalls, positions, isSelfClosings } = parseFunctionCalls(message.value.content, tools);
        if (toolCalls.length === 0) return;

        const applicableCalls = toolCalls.filter(filterCallback);
        if (applicableCalls.length === 0) return;

        // Assign unique IDs to each applicable call for tracking.
        applicableCalls.forEach(call => {
            call.id = `tool_call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        });

        const toolResults = await Promise.all(
            applicableCalls.map(call => executeCallback(call, context))
        );

        // Add/override tool_call_id attributes (in reverse to avoid index shifts).
        let content = message.value.content;
        for (let i = positions.length - 1; i >= 0; i--) {
            const pos = positions[i];
            const gtIndex = content.indexOf('>', pos.start);
            let startTag = content.slice(pos.start, gtIndex + 1);
            // Remove existing tool_call_id attributes
            startTag = startTag.replace(/\s+tool_call_id\s*=\s*["'][^"']*["']/g, '');
            // Insert new tool_call_id
            const insert = ` tool_call_id="${toolCalls[i].id}"`;
            const endSlice = isSelfClosings[i] ? -2 : -1;
            const endTag = isSelfClosings[i] ? '/>' : '>';
            startTag = startTag.slice(0, endSlice) + insert + endTag;
            content = content.slice(0, pos.start) + startTag + content.slice(gtIndex + 1);
        }
        this.uiManager.updateMessageContent(message, content);

        let toolContents = '';
        toolResults.forEach((tr, i) => {
            const inner = tr.error
                ? `<error>\n${tr.error}\n</error>`
                : `<content>\n${tr.content}\n</content>`;
            toolContents += `<dma:tool_response name="${applicableCalls[i].name}" tool_call_id="${tr.id}">\n${inner}\n</dma:tool_response>\n`;
        });

        if (toolContents) {
            this.uiManager.addMessage({ role: 'tool', content: toolContents });
            this.uiManager.addStreamingMessage('assistant');
            hooks.onGenerateAIResponse.forEach(fn => fn({}, chatlog));
        }
    }
}

export { ToolCallService };
