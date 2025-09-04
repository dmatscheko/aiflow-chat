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
 * @returns {Array<Object>} The parsed tool calls.
 */
function parseToolCalls(content, tools = []) {
    const toolCalls = [];
    // This regex handles both self-closing tags and tags with content.
    const functionCallRegex = /<dma:tool_call\s+([^>]+?)\/>|<dma:tool_call\s+([^>]*?)>([\s\S]*?)<\/dma:tool_call\s*>/gi;
    const nameRegex = /name="([^"]*)"/;
    const paramsRegex = /<parameter\s+name="([^"]*)">([\s\S]*?)<\/parameter>/g;

    if (!content) return [];

    for (const match of content.matchAll(functionCallRegex)) {
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

        toolCalls.push({ id: `call_${Date.now()}_${toolCalls.length}`, name, params });
    }

    return toolCalls;
}


/**
 * Processes tool calls found in a message, executes them, and continues the conversation.
 * @param {Message} message - The message containing tool calls.
 * @param {ChatLog} chatLog - The chat log to add results to.
 * @param {Array<object>} tools - A list of available tools with their schemas.
 * @param {Function} filterCallback - A function to filter which tool calls to process.
 * @param {Function} executeCallback - An async function to execute a tool call and return the result.
 * @param {Function} continueCallback - A callback to continue the conversation.
 */
async function processToolCalls(message, chatLog, tools, filterCallback, executeCallback, continueCallback) {
    const content = message.value.content;
    const allCalls = parseToolCalls(content, tools);
    if (allCalls.length === 0) return;

    const applicableCalls = allCalls.filter(filterCallback);
    if (applicableCalls.length === 0) return;

    // Visually disable the original message content that contains tool calls.
    message.value.content = `Using tools: ${applicableCalls.map(c => c.name).join(', ')}...`;
    chatLog.notify();

    const promises = applicableCalls.map(call => executeCallback(call, message));
    const results = await Promise.all(promises);

    let toolContents = '';
    results.forEach((tr) => {
        const inner = tr.error
            ? `<error>\n${tr.error}\n</error>`
            : `<content>\n${tr.content}\n</content>`;
        toolContents += `<dma:tool_response name="${tr.name}" tool_call_id="${tr.tool_call_id}">\n${inner}\n</dma:tool_response>\n`;
    });

    if (toolContents) {
        chatLog.addMessage({ role: 'tool', content: toolContents });
    }

    // If there were successful tool calls, trigger a new API call to get the assistant's response.
    if (results.some(r => !r.error)) {
        console.log("Tool processor: Tool calls executed, continuing conversation.");
        if (continueCallback) {
            continueCallback();
        }
    }
}

export { parseToolCalls, processToolCalls };
