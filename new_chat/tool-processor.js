/**
 * @fileoverview Reusable tool processing logic.
 */

'use strict';

/**
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./chat-data.js').ChatLog} ChatLog
 */

// --- Tool Call Processing Functions (adapted from mcp-plugin.js) ---

/**
 * Parses tool calls from the assistant's message content.
 * @param {string} content - The message content.
 * @param {Array<object>} [tools=[]] - A list of available tools with their schemas.
 * @returns {{toolCalls: Array<Object>, positions: Array<Object>, isSelfClosings: Array<boolean>}} The parsed tool calls, their positions, and self-closing flags.
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
 * Processes tool calls found in a message, executes them, and continues the conversation.
 * @param {Message} message - The message containing tool calls.
 * @param {ChatLog} chatLog - The chat log to add results to.
 * @param {Array<object>} tools - A list of available tools with their schemas.
 * @param {Function} filterCallback - A function to filter which tool calls to process.
 * @param {Function} executeCallback - An async function to execute a tool call and return the result.
 * @param {Function} continueCallback - A callback to continue the conversation.
 * @param {Function} [saveCallback=null] - An optional callback to save the chat state.
 */
async function processToolCalls(message, chatLog, tools, filterCallback, executeCallback, continueCallback, saveCallback = null) {
    const { toolCalls, positions, isSelfClosings } = parseToolCalls(message.value.content, tools);
    if (toolCalls.length === 0) return;

    const applicableCalls = toolCalls.filter(filterCallback);
    if (applicableCalls.length === 0) return;

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
    chatLog.notify(); // Notify UI to re-render the message

    let toolContents = '';
    results.forEach((tr) => {
        const inner = tr.error
            ? `<error>\n${tr.error}\n</error>`
            : `<content>\n${tr.content}\n</content>`;
        toolContents += `<dma:tool_response name="${tr.name}" tool_call_id="${tr.tool_call_id}">\n${inner}\n</dma:tool_response>\n`;
    });

    if (toolContents) {
        chatLog.addMessage({ role: 'tool', content: toolContents });
        if (saveCallback) {
            saveCallback();
        }
    }

    if (continueCallback) {
        // Trigger a new API call to get the assistant's response.
        continueCallback();
    }
}

export { parseToolCalls, processToolCalls };
