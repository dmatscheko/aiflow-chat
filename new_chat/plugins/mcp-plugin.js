/**
 * @fileoverview Plugin for MCP (Model Context Protocol) integration.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { processToolCalls as genericProcessToolCalls } from '../tool-processor.js';
import { ChatLog } from '../chat-data.js';

// --- State Variables ---
let mcpUrl = null;
let mcpSessionId = null;
let tools = [];
let cachedToolsSection = '';
let isInitialized = false;
let initPromise = null;
let appInstance = null;


const mcpPlugin = {
    name: 'MCP',

    /**
     * Get the list of available tools.
     * @returns {object[]} The list of tools.
     */
    getTools: () => tools,

    /**
     * Hook to register settings.
     * @param {Array<Object>} settings - The original settings array.
     * @returns {Array<Object>} The modified settings array.
     */
    onSettingsRegistered(settings) {
        settings.push({
            id: 'mcpServer',
            label: 'MCP Server URL',
            type: 'text',
            placeholder: 'e.g., http://localhost:3000/mcp',
            default: ''
        });
        return settings;
    },

    /**
     * Hook called when the application initializes.
     * @param {App} app - The main application instance.
     */
    onAppInit(app) {
        appInstance = app;
        // Expose the plugin's API to the app instance
        app.mcp = {
            getTools: this.getTools
        };

        const savedSettings = JSON.parse(localStorage.getItem('core_chat_settings')) || {};
        mcpUrl = savedSettings.mcpServer || '';
        if (mcpUrl) {
            console.log('MCP: URL found, initializing...', mcpUrl);
            initializeMcp();
        } else {
            console.log('MCP: No URL, skipping initialization.');
        }

        // Re-initialize if the setting changes
        document.addEventListener('change', (e) => {
            if (e.target.id === 'setting-mcpServer') {
                mcpUrl = e.target.value;
                if (mcpUrl) {
                    console.log('MCP: URL changed, re-initializing...', mcpUrl);
                    isInitialized = false; // Reset initialization state
                    initializeMcp();
                }
            }
        });
    },

    /**
     * Hook to modify the API payload before sending.
     * @param {Object} payload - The original API payload.
     * @param {Object} allSettings - All current settings from local storage.
     * @returns {Object} The modified payload.
     */
    beforeApiCall(payload, allSettings) {
        if (!mcpUrl || !cachedToolsSection) {
            return payload;
        }

        const systemPrompt = payload.messages.find(m => m.role === 'system');
        if (systemPrompt) {
            console.log('MCP: Adding tools section to system prompt.');
            // Avoid duplicating the section if it's already there
            if (!systemPrompt.content.includes(toolsHeader)) {
                 systemPrompt.content += '\n\n' + toolsHeader + cachedToolsSection;
            }
        }
        return payload;
    },

    /**
     * Hook called after an API response is complete.
     * @param {Message} message - The completed assistant message.
     * @param {Object} activeChat - The active chat instance.
     */
    async onResponseComplete(message, activeChat) {
        if (!mcpUrl) return;
        console.log("MCP: Checking for tool calls in message...", message.value.content);
        await genericProcessToolCalls(
            appInstance,
            activeChat,
            message,
            tools,
            filterMcpCalls,
            executeMcpCall
        );
    },

    /**
     * Hook to format message content, specifically for citations.
     * @param {HTMLElement} contentEl - The content element.
     * @param {Message} message - The message object.
     */
    onFormatMessageContent(contentEl, message) {
        if (!contentEl.innerHTML.includes('&lt;dma:render')) return;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentEl.innerHTML;

        tempDiv.querySelectorAll('dma\\:render[type="render_inline_citation"]').forEach(node => {
            const argNode = node.querySelector('argument[name="citation_id"]');
            const id = argNode ? parseInt(argNode.textContent.trim()) : null;
            if (!id) {
                console.warn('MCP: Invalid citation_id, removing node');
                node.parentNode.removeChild(node);
                return;
            }
            const source = message.metadata?.sources?.[id - 1];
            const sup = document.createElement('sup');
            const a = document.createElement('a');
            if (source) {
                a.href = source.url;
                a.title = source.title || 'Source';
            } else {
                console.warn('MCP: Citation not found for id', id);
                a.title = 'Citation not found';
                a.style.color = 'red';
            }
            a.textContent = `[${id}]`;
            a.target = '_blank'; // Open in new tab
            sup.appendChild(a);
            node.parentNode.replaceChild(sup, node);
        });
        contentEl.innerHTML = tempDiv.innerHTML;
    }
};

// --- MCP Helper Functions (adapted from old_chat/js/plugins/mcp.js) ---

const toolsHeader = `### MCP Tools:

You can use tool calls. Make sure to follow the following XML-inspired format:
<dma:tool_call name="example_tool_name">
<parameter name="example_arg_name1">
example_arg_value1
</parameter>
<parameter name="example_arg_name2">
example_arg_value2
</parameter>
</dma:tool_call>
Do not escape any of the tool call arguments. The arguments will be parsed as normal text. There is one exception: If you need to write </dma:tool_call> or </parameter> as value inside a <parameter>, write it like <\/dma:tool_call> or <\/parameter>.

You can use multiple tools in one message. After a tool call, you will always get the tool response and with this another turn to continue your answer. Use tools only if you need them.

IMPORTANT: Write files only if explicitely instructed to do so.

#### Available Tools:\n\n`;


/**
 * Initializes the MCP connection, fetches tools.
 */
function initializeMcp() {
    if (!mcpUrl) return;
    mcpSessionId = localStorage.getItem(`mcpSession_${mcpUrl}`) || null;
    console.log('MCP: Pre-fetching tools from', mcpUrl);
    mcpJsonRpc('tools/list').then(response => {
        tools = Array.isArray(response.tools) ? response.tools : [];
        cachedToolsSection = generateToolsSection(tools);
        console.log('MCP: Tools section cached successfully.');
    }).catch(error => {
        console.error('MCP: Failed to pre-fetch tools', error);
        cachedToolsSection = '';
        // Optionally, notify the user in the UI
        alert(`Failed to connect to MCP server at ${mcpUrl}. Please check the URL and server status.\n\n${error.message}`);
    });
}

/**
 * Generates the tools Markdown section from a list of tools.
 * @param {Object[]} toolList - The list of tools.
 * @returns {string} The Markdown section.
 */
function generateToolsSection(toolList) {
    const sections = [];
    toolList.forEach((tool, idx) => {
        const desc = tool.description || 'No description provided.';
        const action = tool.name;
        const displayName = action.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        let argsStr = '';
        const properties = tool.inputSchema?.properties || {};
        const requiredSet = new Set(tool.inputSchema?.required || []);
        Object.entries(properties).forEach(([name, arg]) => {
            const argDesc = arg.description || arg.title || 'No description.';
            const argType = arg.type || 'unknown';
            const required = requiredSet.has(name) ? '(required)' : '(optional)';
            const defaultStr = arg.default !== undefined ? ` (default: ${JSON.stringify(arg.default)})` : '';
            argsStr += `   - \`${name}\`: ${argDesc} (type: ${argType})${required}${defaultStr}\n`;
        });
        const section = `${idx + 1}. **${displayName}**\n - **Description**: ${desc}\n - **Action** (dma:tool_call name): \`${action}\`\n - **Arguments** (parameter name): \n${argsStr}`;
        sections.push(section);
    });
    return sections.join('\n');
}

/**
 * Initializes the MCP session.
 */
async function initMcpSession() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        if (isInitialized) return;
        console.log('MCP: Initializing MCP session');
        const initParams = {
            protocolVersion: '2025-03-26',
            capabilities: { roots: { listChanged: false }, sampling: {} },
            clientInfo: { name: 'NewChatClient', version: '1.0.0' }
        };
        const initData = await sendMcpRequest('initialize', initParams, true);
        if (initData.protocolVersion !== '2025-03-26') {
            throw new Error(`Protocol version mismatch: requested 2025-03-26, got ${initData.protocolVersion}`);
        }
        if (!mcpSessionId) {
            throw new Error('No session ID returned in initialize response header');
        }
        localStorage.setItem(`mcpSession_${mcpUrl}`, mcpSessionId);
        await sendMcpRequest('notifications/initialized', {}, false, true);
        isInitialized = true;
        console.log('MCP: Session initialized', mcpSessionId);
    })();
    await initPromise;
    initPromise = null;
}

/**
 * Sends a JSON-RPC request to the MCP server.
 */
async function sendMcpRequest(method, params = {}, isInit = false, isNotification = false) {
    if (!mcpUrl) throw new Error('No MCP server URL set');
    const body = {
        jsonrpc: '2.0',
        method,
        params
    };
    if (!isNotification) {
        body.id = Math.floor(Math.random() * 1000000);
    }
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
    };
    if (mcpSessionId && !isInit) {
        headers['mcp-session-id'] = mcpSessionId;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const resp = await fetch(mcpUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!resp.ok) {
            const errorText = await resp.text();
            throw new Error(`MCP error: ${resp.statusText} - ${errorText}`);
        }
        const headerSession = resp.headers.get('mcp-session-id');
        if (headerSession) {
            mcpSessionId = headerSession;
            localStorage.setItem(`mcpSession_${mcpUrl}`, mcpSessionId);
        }
        if (isNotification) {
            return null;
        }

        const contentType = resp.headers.get('Content-Type') || '';
        if (contentType.includes('application/json')) {
            const data = await resp.json();
            if (data.error) {
                throw new Error(data.error.message || 'MCP call failed');
            }
            return data.result;
        } else if (contentType.includes('text/event-stream')) {
            const reader = resp.body.getReader();
            let buffer = '';
            let result = null;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += new TextDecoder().decode(value);
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Last incomplete line
                for (const line of lines) {
                    if (line.startsWith('event: message')) {
                        // Next line should be data:
                    } else if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        try {
                            const partial = JSON.parse(dataStr);
                            if (partial.jsonrpc) {
                                result = partial.result; // Assume last message has full result
                            }
                        } catch (e) {
                             // Ignore partial JSON
                             console.warn("MCP: Could not parse event-stream data chunk as JSON.", dataStr);
                        }
                    }
                }
            }
            if (result) return result;
            throw new Error('Invalid SSE response: No valid JSON-RPC result found in stream.');
        } else {
            throw new Error(`Unexpected Content-Type: ${contentType}`);
        }

    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('MCP request timed out');
        }
        throw error;
    }
}

/**
 * Performs a JSON-RPC call to the MCP server.
 */
async function mcpJsonRpc(method, params = {}, retry = false) {
    try {
        await initMcpSession();
        const result = await sendMcpRequest(method, params);
        return result;
    } catch (error) {
        console.error('MCP: JSON-RPC failure', error);
        if (error.message.includes('session')) { // Simplified error check
            localStorage.removeItem(`mcpSession_${mcpUrl}`);
            mcpSessionId = null;
            isInitialized = false;
            if (!retry) {
                console.log('MCP: Retrying MCP call after session re-init');
                return mcpJsonRpc(method, params, true);
            }
        }
        throw new AggregateError(
            [error],
            `Failed to perform MCP JSON-RPC call.\nURL: ${mcpUrl}, Method: ${method}, Params: ${JSON.stringify(params)}.\nOriginal error: ${error.message || 'Unknown'}.`
        );
    }
}


// --- Tool Call Processing Functions ---

/**
 * In this context, any non-agent call is considered an MCP call.
 * @param {Object} call - The tool call object.
 * @returns {boolean} - True if it's an MCP call.
 */
function filterMcpCalls(call) {
    return !call.name.endsWith('_agent');
}

/**
 * Executes a single MCP tool call.
 * @param {Object} call - The tool call to execute.
 * @param {Message} message - The original assistant message, for context.
 * @returns {Promise<Object>} A promise that resolves to a tool result object.
 */
async function executeMcpCall(call, message) {
    // Determine the effective tool settings
    const agentId = message.value.agent;
    const agent = agentId ? appInstance.agentManager.getAgent(agentId) : null;
    let effectiveToolSettings;

    if (agent && agent.useCustomToolSettings) {
        effectiveToolSettings = agent.toolSettings;
    } else {
        effectiveToolSettings = JSON.parse(localStorage.getItem('core_tool_settings')) || { allowAll: false, allowed: [] };
    }

    // Check if the tool is allowed
    const isAllowed = effectiveToolSettings.allowAll || effectiveToolSettings.allowed.includes(call.name);

    if (!isAllowed) {
        console.warn(`MCP: Tool call "${call.name}" blocked by settings.`);
        return {
            name: call.name,
            tool_call_id: call.id,
            content: null,
            error: `Tool "${call.name}" is not enabled in the current settings.`,
        };
    }

    console.log('MCP: Executing tool', call.name, 'with params', call.params);
    try {
        const result = await mcpJsonRpc('tools/call', { name: call.name, arguments: call.params });

        // Add sources to metadata for certain tools
        if (call.name === 'web_search' || call.name === 'browse_page' || call.name.startsWith('x_')) {
             if (!message.metadata) message.metadata = {};
             message.metadata.sources = result.sources || [];
             console.log('MCP: Added sources to metadata', result.sources?.length || 0);
        }

        let content = '';
        let error = null;

        if (result.isError) {
            error = result.content ? JSON.stringify(result.content) : 'Unknown error';
            content = null;
        } else {
            content = result.content ? JSON.stringify(result.content, null, 2) : '{}';
        }
        return { name: call.name, tool_call_id: call.id, content, error };
    } catch (err) {
        console.error('MCP: Tool execution error', err);
        return { name: call.name, tool_call_id: call.id, content: null, error: err.message || 'Unknown error' };
    }
}

pluginManager.register(mcpPlugin);
