/**
 * @fileoverview Reusable tool processing logic.
 * This file provides a set of generic functions for parsing and processing
 * tool calls embedded in assistant messages. It defines a custom XML-like
 * syntax for representing tool calls and their results, and offers a
 * high-level function (`processToolCalls`) to orchestrate the entire
 * parse-filter-execute-respond cycle. This makes the tool-handling logic
 * reusable across different plugins.
 */

'use strict';

/**
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./main.js').App} App
 * @typedef {import('./plugins/chats-plugin.js').Chat} Chat
 */

/**
 * Represents a single, parsed tool call extracted from a message.
 * @typedef {object} ToolCall
 * @property {string} id - A unique identifier for the tool call, generated during parsing.
 * @property {string} name - The name of the tool to be executed.
 * @property {object} params - A key-value map of parameters for the tool call.
 */

/**
 * Stores the start and end character indices of a matched tool call within a string.
 * @typedef {object} ToolCallPosition
 * @property {number} start - The starting index of the tool call substring.
 * @property {number} end - The ending index of the tool call substring.
 */

/**
 * The result of parsing tool calls from a string.
 * @typedef {object} ParsedToolCalls
 * @property {ToolCall[]} toolCalls - An array of the parsed tool call objects.
 * @property {ToolCallPosition[]} positions - An array of the positions corresponding to each parsed tool call.
 * @property {boolean[]} isSelfClosings - An array of flags indicating if a tool call was self-closing (`<.../>`).
 */

/**
 * Defines the schema for a tool, including its name and input parameters.
 * @typedef {object} ToolSchema
 * @property {string} name - The name of the tool.
 * @property {object} [inputSchema] - The JSON schema definition for the tool's input parameters.
 */

/**
 * Parses tool calls from an assistant's message content using a regex-based approach.
 * It looks for `<dma:tool_call>` tags, extracts the tool name and parameters,
 * and performs type coercion on parameters if a `ToolSchema` is provided.
 * @param {string | null} content - The message content to parse for tool calls.
 * @param {ToolSchema[]} [tools=[]] - A list of available tools with their schemas, used for type coercion of parameters.
 * @returns {ParsedToolCalls} An object containing the parsed tool calls, their positions, and self-closing flags.
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
 * A callback function used to determine if a specific tool call should be processed.
 * @callback ToolFilterCallback
 * @param {ToolCall} call - The tool call to inspect.
 * @returns {boolean} `true` if the tool call should be processed, otherwise `false`.
 */

/**
 * Represents the result of a single tool execution.
 * @typedef {object} ToolResult
 * @property {string} name - The name of the tool that was executed.
 * @property {string} tool_call_id - The unique ID of the tool call this result corresponds to.
 * @property {string | null} content - The stringified successful result of the tool execution. `null` if an error occurred.
 * @property {string | null} error - A string describing an error, if one occurred during execution. `null` if the execution was successful.
 */

/**
 * An asynchronous callback function responsible for executing a single tool call.
 * @callback ToolExecuteCallback
 * @param {ToolCall} call - The tool call to execute.
 * @param {Message} message - The message that contained the tool call.
 * @returns {Promise<ToolResult>} A promise that resolves to the result of the tool execution.
 */

/**
 * A generic, high-level function to process tool calls found in a message.
 * It orchestrates the entire cycle:
 * 1. Parses tool calls from the message content.
 * 2. Filters them using a provided callback to see which ones are applicable.
 * 3. Executes the applicable calls in parallel using another callback.
 * 4. Injects the `tool_call_id` back into the original assistant message for traceability.
 * 5. Creates a new 'tool' role message containing the results of all executions.
 * 6. Queues up the next assistant turn by creating a new pending message.
 *
 * @param {App} app - The main application instance.
 * @param {Chat} chat - The chat object where the message resides.
 * @param {Message} message - The assistant message containing the tool calls to process.
 * @param {ToolSchema[]} tools - A list of available tools and their schemas, passed to the parser.
 * @param {ToolFilterCallback} filterCallback - A function to select which of the parsed tool calls should be executed.
 * @param {ToolExecuteCallback} executeCallback - An async function that executes a single tool call and returns its result.
 * @returns {Promise<boolean>} A promise that resolves to `true` if any tool calls were processed and a new assistant turn was queued, otherwise `false`.
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
        chat.log.addMessage(
            { role: 'tool', content: toolContents, agent: message.agent },
            { depth: message.depth }
        );
        // After adding tool results, queue up the next step for the AI.
        const callingAgentId = message.agent;
        // The role of the next turn should be the same as the role that made the tool call.
        const nextTurnRole = message.value.role === 'tool' ? 'tool' : 'assistant';
        chat.log.addMessage(
            { role: nextTurnRole, content: null, agent: callingAgentId },
            { depth: message.depth }
        );
        return true;
    }
    return false;
}

export { parseToolCalls, processToolCalls };
