/**
 * @fileoverview Reusable tool processing logic, including parsing and type definitions.
 * @version 2.0.0
 */

'use strict';

/**
 * @typedef {import('./chat-data.js').Message} Message
 */

/**
 * Represents a parsed tool call request from a message.
 * @typedef {object} ToolCall
 * @property {string} id - A unique identifier for the tool call, generated during parsing.
 * @property {string} name - The name of the tool being called.
 * @property {object} params - The parameters for the tool call.
 * @property {boolean} [processed] - A flag used by the processor to track execution state.
 */

/**
 * Represents the result of a tool call execution.
 * @typedef {object} ToolResult
 * @property {string} name - The name of the tool that was called.
 * @property {string} tool_call_id - The ID of the tool call this is a result for.
 * @property {string | null} [content] - The stringified result of the tool execution.
 * @property {string | null} [error] - A string describing an error, if one occurred.
 */

/**
 * Represents the position of a tool call within the original string.
 * @typedef {object} ToolCallPosition
 * @property {number} start - The starting index of the tool call in the content.
 * @property {number} end - The ending index of the tool call in the content.
 */

/**
 * Represents the complete result of parsing a message for tool calls.
 * @typedef {object} ParsedToolCalls
 * @property {ToolCall[]} toolCalls - The parsed tool calls.
 * @property {string} modifiedContent - The original content with unique `tool_call_id` attributes injected.
 */

/**
 * Represents the schema for a single tool, used for validation and parsing.
 * @typedef {object} ToolSchema
 * @property {string} name - The name of the tool.
 * @property {object} [inputSchema] - The JSON schema for the tool's input.
 */


/**
 * Parses tool calls from an assistant's message content, injects unique IDs,
 * and handles various XML formats including self-closing tags.
 * @param {string | null} content - The message content to parse.
 * @param {ToolSchema[]} [tools=[]] - A list of available tools with their schemas, used for type coercion.
 * @returns {ParsedToolCalls | null} The parsed tool calls and modified content, or null if no calls are found.
 */
export function parseToolCalls(content, tools = []) {
    if (!content || !content.includes('<dma:tool_call')) {
        return null;
    }

    const toolCalls = [];
    const positions = [];
    const isSelfClosingFlags = [];

    // This regex handles two formats:
    // 1. Self-closing tags: <dma:tool_call ... />
    // 2. Tags with content: <dma:tool_call ...>...</dma:tool_call>
    const functionCallRegex = /<dma:tool_call\s+([^>]+?)\/>|<dma:tool_call\s+([^>]*?)>([\s\S]*?)<\/dma:tool_call\s*>/gi;
    const nameRegex = /name="([^"]*)"/;
    const paramsRegex = /<parameter\s+name="([^"]*)">([\s\S]*?)<\/parameter>/g;

    // First pass: Parse all tool calls and their positions.
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
            for (const paramMatch of contentInner.matchAll(paramsRegex)) {
                const [, paramName, paramValue] = paramMatch;
                let value = paramValue.trim();
                // Un-escape special closing tags that might be inside the parameter value.
                value = value.replace(/<\\\/dma:tool_call>/g, '</dma:tool_call>').replace(/<\\\/parameter>/g, '</parameter>');

                // Optional: Coerce types based on schema
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

        // Generate a unique ID for every tool call, which will override any existing one.
        const call = {
            id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name,
            params
        };

        toolCalls.push(call);
        positions.push({ start: startIndex, end: endIndex });
        isSelfClosingFlags.push(isSelfClosing);
    }

    if (toolCalls.length === 0) {
        return null;
    }

    // Second pass (in reverse): Inject the unique IDs back into the content string.
    // We go in reverse to avoid messing up the start/end indices of subsequent matches.
    let modifiedContent = content;
    for (let i = positions.length - 1; i >= 0; i--) {
        const call = toolCalls[i];
        const pos = positions[i];
        const isSelfClosing = isSelfClosingFlags[i];

        // Find the end of the opening tag (the first '>')
        const gtIndex = modifiedContent.indexOf('>', pos.start);
        if (gtIndex === -1 || gtIndex > pos.end) continue;

        // Extract the start tag (e.g., <dma:tool_call name="foo" ... > or />)
        let startTag = modifiedContent.substring(pos.start, gtIndex + 1);

        // Remove any pre-existing tool_call_id attribute to ensure ours is the only one.
        startTag = startTag.replace(/\s+tool_call_id\s*=\s*["'][^"']*["']/g, '');

        const idToInsert = ` tool_call_id="${call.id}"`;

        // Find the correct insertion point: just before the closing `>` or `/>`.
        const insertionPoint = isSelfClosing ? startTag.length - 2 : startTag.length - 1;
        const newStartTag = startTag.slice(0, insertionPoint) + idToInsert + startTag.slice(insertionPoint);

        // Reconstruct the full content string with the modified start tag.
        modifiedContent = modifiedContent.slice(0, pos.start) + newStartTag + modifiedContent.slice(gtIndex + 1);
    }

    return { toolCalls, modifiedContent };
}