/**
 * @fileoverview Reusable tool processing logic.
 */

'use strict';

/**
 * @typedef {import('./chat-data.js').Message} Message
 */

/**
 * @typedef {object} ToolCall
 * @property {string} id - A unique identifier for the tool call.
 * @property {string} name - The name of the tool being called.
 * @property {object} params - The parameters for the tool call.
 */

/**
 * @typedef {object} ToolResult
 * @property {string} name - The name of the tool that was called.
 * @property {string} tool_call_id - The ID of the tool call this is a result for.
 * @property {string | null} content - The stringified result of the tool execution.
 * @property {string | null} error - A string describing an error, if one occurred.
 */

/**
 * @typedef {object} ToolCallPosition
 * @property {number} start - The starting index of the tool call in the content.
 * @property {number} end - The ending index of the tool call in the content.
 */

/**
 * @typedef {object} ParsedToolCalls
 * @property {ToolCall[]} toolCalls - The parsed tool calls.
 * @property {ToolCallPosition[]} positions - The positions of the tool calls in the content.
 * @property {boolean[]} isSelfClosings - Flags indicating if a tool call was self-closing.
 */

/**
 * @typedef {object} ToolSchema
 * @property {string} name - The name of the tool.
 * @property {object} [inputSchema] - The JSON schema for the tool's input.
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
    // This regex handles both self-closing tags (e.g., <.../>) and tags with content.
    const functionCallRegex = /<dma:tool_call\s+(.*?)\s*\/>|<dma:tool_call\s+([^>]*?)>([\s\S]*?)<\/dma:tool_call\s*>/gi;
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
        const call = { id: `call_${Date.now()}_${toolCalls.length}`, name, params };
        toolCalls.push(call);
        positions.push({ start: startIndex, end: endIndex });
        isSelfClosings.push(isSelfClosing);
    }

    return { toolCalls, positions, isSelfClosings };
}

export { parseToolCalls };