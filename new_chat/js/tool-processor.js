/**
 * @fileoverview Reusable tool processing logic.
 */

'use strict';

/**
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./main.js').App} App
 * @typedef {import('./main.js').Chat} Chat
 */

/**
 * @typedef {object} ToolCall
 * @property {string} id - A unique identifier for the tool call.
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
 * @property {ToolCall[]} toolCalls - The parsed tool calls.
 * @property {ToolCallPosition[]} positions - The positions of the tool calls in the content.
 * @property {boolean[]} isSelfClosings - Flags indicating if a tool call was self-closing.
 */

/**
 * @typedef {object} ToolSchema
 * @property {string} name - The name of the tool.
 * @property {object} [inputSchema] - The JSON schema for the tool's input.
 */

// --- Tool Call Processing Functions (adapted from mcp-plugin.js) ---

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
    // This regex handles both self-closing tags and tags with content.
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
        const call = { id: `call_${Date.now()}_${toolCalls.length}`, name, params };
        toolCalls.push(call);
        positions.push({ start: startIndex, end: endIndex });
        isSelfClosings.push(isSelfClosing);
    }

    return { toolCalls, positions, isSelfClosings };
}


/**
 * @callback ToolFilterCallback
 * @param {ToolCall} call - The tool call to check.
 * @returns {boolean} Whether the tool call should be processed.
 */

/**
 * @typedef {object} ToolResult
 * @property {string} name - The name of the tool that was called.
 * @property {string} tool_call_id - The ID of the tool call this is a result for.
 * @property {string | null} content - The stringified result of the tool execution.
 * @property {string | null} error - A string describing an error, if one occurred.
 */

/**
 * @callback ToolExecuteCallback
 * @param {ToolCall} call - The tool call to execute.
 * @param {Message} message - The message containing the tool call.
 * @returns {Promise<ToolResult>} A promise that resolves to the result of the tool execution.
 */

/**
 * A generic function to process tool calls found in a message.
 * It parses, filters, executes, and then formats the results into a new
 * 'tool' role message. If tool calls were processed, it queues up the next
 * assistant turn by creating a new pending message.
 * @param {App} app - The main application instance.
 * @param {Chat} chat - The chat object this message belongs to.
 * @param {Message} message - The message containing tool calls.
 * @param {ToolSchema[]} tools - A list of available tools with their schemas.
 * @param {ToolFilterCallback} filterCallback - A function to filter which tool calls to process.
 * @param {ToolExecuteCallback} executeCallback - An async function to execute a tool call and return the result.
 * @returns {Promise<boolean>} A promise that resolves to `true` if tool calls were processed and a new turn was queued, `false` otherwise.
 */
async function processToolCalls(app, chat, message, tools, filterCallback, executeCallback) {
    const { toolCalls, positions, isSelfClosings } = parseToolCalls(message.value.content, tools);
    if (toolCalls.length === 0) return false;

    const applicableCalls = toolCalls.filter(filterCallback);
    if (applicableCalls.length === 0) return false;

    const promises = applicableCalls.map(call => executeCallback(call, message));
    const results = await Promise.all(promises);

    // Inject tool_call_id into the original message content
    let content = message.value.content;
    for (let i = positions.length - 1; i >= 0; i--) {
        const call = toolCalls[i];
        if (!applicableCalls.find(ac => ac.id === call.id)) continue;

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
    message.cache = null; // Invalidate cache to force re-render
    chat.log.notify(); // Notify UI to re-render the message

    let toolContents = '';
    results.forEach((tr) => {
        const inner = tr.error
            ? `<error>\n${tr.error}\n</error>`
            : `<content>\n${tr.content}\n</content>`;
        toolContents += `<dma:tool_response name="${tr.name}" tool_call_id="${tr.tool_call_id}">\n${inner}\n</dma:tool_response>\n`;
    });

    if (toolContents) {
        chat.log.addMessage({ role: 'tool', content: toolContents });
        // After adding tool results, queue up the next step for the AI.
        chat.log.addMessage({ role: 'assistant', content: null });
        return true;
    }
    return false;
}

export { parseToolCalls, processToolCalls };
