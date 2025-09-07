/**
 * @fileoverview Plugin for MCP (Model Context Protocol) integration.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { processToolCalls as genericProcessToolCalls } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../main.js').Chat} Chat
 * @typedef {import('../tool-processor.js').ToolSchema} ToolSchema
 * @typedef {import('./agents-plugin.js').Agent} Agent
 * @typedef {import('./agents-plugin.js').AgentManager} AgentManager
 */

// --- State Variables ---
/**
 * A cache to store tool schemas, keyed by the MCP server URL.
 * @type {Map<string, ToolSchema[]>}
 */
const mcpToolCache = new Map();
/**
 * A cache for MCP session IDs, keyed by the MCP server URL.
 * @type {Map<string, string>}
 */
const mcpSessionCache = new Map();
/**
 * Tracks ongoing initialization promises, keyed by MCP server URL.
 * @type {Map<string, Promise<any>>}
 */
const mcpInitPromises = new Map();

/** @type {App | null} */
let appInstance = null;

// --- Helper Functions ---

/**
 * Gets the effective MCP URL and tool list for a given agent.
 * Falls back to the Default Agent's configuration if the agent doesn't have custom settings.
 * @param {Agent | null} agent - The agent to get the config for. If null, uses the Default Agent.
 * @returns {{mcpUrl: string | null, tools: ToolSchema[]}}
 */
function getEffectiveMcpConfig(agent) {
    const agentManager = appInstance?.agentManager;
    if (!agentManager) return { mcpUrl: null, tools: [] };

    const defaultAgent = agentManager.getAgent('agent-default');
    let effectiveAgent = agent;

    // If the provided agent doesn't use custom model settings, fall back to default.
    if (agent && !agent.useCustomModelSettings) {
        effectiveAgent = defaultAgent;
    }
    // If no agent is provided, use the default.
    if (!effectiveAgent) {
        effectiveAgent = defaultAgent;
    }

    const mcpUrl = effectiveAgent?.modelSettings?.mcpServer || null;
    const tools = mcpUrl ? mcpToolCache.get(mcpUrl) || [] : [];

    return { mcpUrl, tools };
}

/**
 * Fetches the tool list for a given MCP server URL and updates the cache.
 * @param {string} url - The MCP server URL to fetch tools from.
 * @returns {Promise<ToolSchema[]>}
 */
async function fetchToolsForUrl(url) {
    console.log(`DEBUG: fetchToolsForUrl called with url: '${url}'`);
    if (!url) {
        mcpToolCache.set(url, []);
        return [];
    }
    console.log('MCP: Fetching tools from', url);
    try {
        const response = await mcpJsonRpc(url, 'tools/list');
        const tools = Array.isArray(response?.tools) ? response.tools : [];
        mcpToolCache.set(url, tools);
        console.log(`DEBUG: Successfully fetched and cached ${tools.length} tools for ${url}.`);
        // Trigger a UI update for any visible agent editor that uses this URL
        document.body.dispatchEvent(new CustomEvent('mcp-tools-updated', { detail: { url } }));
        return tools;
    } catch (error) {
        console.error(`MCP: Failed to fetch tools for ${url}`, error);
        alert(`Failed to connect to MCP server at ${url}. Please check the URL and server status.\n\n${error.message}`);
        mcpToolCache.set(url, []); // Cache empty array on failure
        return [];
    }
}

/**
 * Performs a JSON-RPC call to the MCP server.
 * @param {string} url - The MCP server URL.
 * @param {string} method - The JSON-RPC method name.
 * @param {object} [params={}] - The JSON-RPC parameters.
 * @param {boolean} [retry=false] - Internal flag to prevent infinite retry loops.
 * @returns {Promise<any>}
 */
async function mcpJsonRpc(url, method, params = {}, retry = false) {
    try {
        await initMcpSession(url);
        return await sendMcpRequest(url, method, params);
    } catch (error) {
        console.error('MCP: JSON-RPC failure', error);
        if (error.message.includes('session') && !retry) {
            mcpSessionCache.delete(url);
            mcpInitPromises.delete(url);
            console.log('MCP: Retrying MCP call after session re-init');
            return mcpJsonRpc(url, method, params, true);
        }
        throw new AggregateError([error], `Failed to perform MCP JSON-RPC call to ${url}.`);
    }
}

/**
 * Performs the full MCP session initialization handshake for a given URL.
 * @param {string} url - The MCP server URL.
 * @private
 */
async function initMcpSession(url) {
    if (mcpInitPromises.has(url)) return mcpInitPromises.get(url);

    const promise = (async () => {
        if (mcpSessionCache.has(url)) return;

        console.log(`MCP: Initializing session for ${url}`);
        const initParams = {
            protocolVersion: '2025-03-26',
            capabilities: { roots: { listChanged: false }, sampling: {} },
            clientInfo: { name: 'NewChatClient', version: '1.0.0' }
        };
        const respHeaders = await sendMcpRequest(url, 'initialize', initParams, false, true);
        const sessionId = respHeaders.get('mcp-session-id');

        if (!sessionId) {
            throw new Error('No session ID returned in initialize response header');
        }
        mcpSessionCache.set(url, sessionId);
        await sendMcpRequest(url, 'notifications/initialized', {}, true);
        console.log(`MCP: Session initialized for ${url}`, sessionId);
    })();

    mcpInitPromises.set(url, promise);
    try {
        await promise;
    } finally {
        mcpInitPromises.delete(url, promise);
    }
}

/**
 * Sends a raw JSON-RPC request to the MCP server.
 * @param {string} url - The MCP server URL.
 * @param {string} method - The JSON-RPC method name.
 * @param {object} params - The JSON-RPC parameters.
 * @param {boolean} [isNotification=false] - Whether this is a notification (no 'id').
 * @param {boolean} [returnHeaders=false] - Whether to return the response headers instead of the body.
 * @private
 */
async function sendMcpRequest(url, method, params, isNotification = false, returnHeaders = false) {
    if (!url) throw new Error('No MCP server URL set');
    const body = { jsonrpc: '2.0', method, params };
    if (!isNotification) {
        body.id = Math.floor(Math.random() * 1000000);
    }
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
    };
    const sessionId = mcpSessionCache.get(url);
    if (sessionId && method !== 'initialize') {
        headers['mcp-session-id'] = sessionId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
        clearTimeout(timeoutId);

        if (!resp.ok) {
            const errorText = await resp.text();
            throw new Error(`MCP error: ${resp.statusText} - ${errorText}`);
        }

        if (returnHeaders) {
            return resp.headers;
        }

        if (isNotification) return null;

        // Clone the response so we can read the body twice if needed
        const clonedResp = resp.clone();
        const rawText = await clonedResp.text();
        console.log(`DEBUG: Raw response from ${url} for method ${method}:`, rawText);

        try {
            // First, optimistically try to parse as JSON
            const data = await resp.json();
            if (data.error) throw new Error(data.error.message || 'MCP call failed');
            return data.result;
        } catch (error) {
            // If JSON parsing fails, check if it's an SSE stream
            if (error instanceof SyntaxError) {
                console.warn('MCP: JSON parsing failed, attempting to parse as event-stream.');
                const text = await clonedResp.text();
                if (text.includes('data:')) {
                    let result = null;
                    const lines = text.split('\n');
                    for (const line of lines) {
                         if (line.startsWith('data: ')) {
                            try {
                                const partial = JSON.parse(line.slice(6));
                                if (partial.jsonrpc) result = partial.result;
                            } catch (e) {
                                console.warn("MCP: Could not parse event-stream data chunk as JSON.", line.slice(6));
                            }
                        }
                    }
                    if (result) return result;
                }
            }
            // If all parsing fails, re-throw the original error
            throw error;
        }

    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') throw new Error('MCP request timed out');
        throw error;
    }
}

// --- Plugin Definition ---

/**
 * Plugin for integrating with an MCP (Model Context Protocol) server.
 * @type {import('../plugin-manager.js').Plugin & {getToolsForUrl: (url: string) => ToolSchema[], fetchToolsForUrl: (url: string) => Promise<ToolSchema[]>}}
 */
const mcpPlugin = {
    name: 'MCP',
    getToolsForUrl: (url) => mcpToolCache.get(url) || [],
    fetchToolsForUrl,

    onAppInit(app) {
        appInstance = app;
        app.mcp = {
            getToolsForUrl: mcpPlugin.getToolsForUrl,
            fetchToolsForUrl: mcpPlugin.fetchToolsForUrl,
        };
        // On startup, pre-fetch tools for the default agent.
        const { mcpUrl } = getEffectiveMcpConfig(null);
        if (mcpUrl) {
            fetchToolsForUrl(mcpUrl);
        }
    },

    beforeApiCall(payload, allSettings, agent) {
        const { mcpUrl, tools } = getEffectiveMcpConfig(agent);
        if (!mcpUrl || tools.length === 0) {
            return payload;
        }

        const dynamicToolsSection = generateToolsSection(agent, tools);
        if (dynamicToolsSection) {
            const systemPrompt = payload.messages.find(m => m.role === 'system');
            if (systemPrompt && !systemPrompt.content.includes(toolsHeader)) {
                systemPrompt.content += '\n\n' + toolsHeader + dynamicToolsSection;
            }
        }
        return payload;
    },

    async onResponseComplete(message, activeChat) {
        const agentId = activeChat.log.getLastMessage()?.agent || null;
        const agent = agentId ? appInstance.agentManager.getAgent(agentId) : null;
        const { mcpUrl, tools } = getEffectiveMcpConfig(agent);

        if (!mcpUrl) return;

        await genericProcessToolCalls(
            appInstance,
            activeChat,
            message,
            tools,
            (call) => !call.name.endsWith('_agent'), // filter
            (call, msg) => executeMcpCall(call, msg, mcpUrl) // executor
        );
    },

    onFormatMessageContent(contentEl, message) {
        // This function remains the same as it only depends on message metadata,
        // which is added during tool execution.
        if (!contentEl.innerHTML.includes('&lt;dma:render')) return;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentEl.innerHTML;
        tempDiv.querySelectorAll('dma\\:render[type="render_inline_citation"]').forEach(node => {
            const argNode = node.querySelector('argument[name="citation_id"]');
            const id = argNode ? parseInt(argNode.textContent.trim(), 10) : null;
            if (!id) return;
            const source = message.metadata?.sources?.[id - 1];
            const sup = document.createElement('sup');
            const a = document.createElement('a');
            if (source) {
                a.href = source.url;
                a.title = source.title || 'Source';
            } else {
                a.title = 'Citation not found';
                a.style.color = 'red';
            }
            a.textContent = `[${id}]`;
            a.target = '_blank';
            sup.appendChild(a);
            node.parentNode.replaceChild(sup, node);
        });
        contentEl.innerHTML = tempDiv.innerHTML;
    }
};

const toolsHeader = `### MCP Tools:\n...`; // Content is the same

/**
 * Generates the tools Markdown section for the system prompt.
 * @param {Agent | null} agent
 * @param {ToolSchema[]} availableTools
 * @returns {string}
 */
function generateToolsSection(agent, availableTools) {
    const agentManager = appInstance?.agentManager;
    if (!agentManager) return '';

    const defaultAgent = agentManager.getAgent('agent-default');
    let effectiveToolSettings = defaultAgent.toolSettings;
    if (agent?.useCustomToolSettings) {
        effectiveToolSettings = agent.toolSettings;
    }

    if (!effectiveToolSettings) return '';

    const allowedTools = effectiveToolSettings.allowAll
        ? availableTools
        : availableTools.filter(tool => effectiveToolSettings.allowed?.includes(tool.name));

    if (!allowedTools || allowedTools.length === 0) {
        return '';
    }
    // ... (rest of the function is the same, just uses allowedTools)
    return allowedTools.map((tool, idx) => {
        const desc = tool.description || 'No description provided.';
        const action = tool.name;
        const displayName = action.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        const properties = tool.inputSchema?.properties || {};
        const requiredSet = new Set(tool.inputSchema?.required || []);
        const argsStr = Object.entries(properties).map(([name, arg]) => {
            const argDesc = arg.description || arg.title || 'No description.';
            const argType = arg.type || 'unknown';
            const required = requiredSet.has(name) ? '(required)' : '(optional)';
            const defaultStr = arg.default !== undefined ? ` (default: ${JSON.stringify(arg.default)})` : '';
            return `   - \`${name}\`: ${argDesc} (type: ${argType})${required}${defaultStr}`;
        }).join('\n');
        return `${idx + 1}. **${displayName}**\n - **Description**: ${desc}\n - **Action** (dma:tool_call name): \`${action}\`\n - **Arguments** (parameter name): \n${argsStr}`;
    }).join('\n');
}

/**
 * Executes a single MCP tool call.
 * @param {import('../tool-processor.js').ToolCall} call
 * @param {Message} message
 * @param {string} mcpUrl
 * @returns {Promise<import('../tool-processor.js').ToolResult>}
 */
async function executeMcpCall(call, message, mcpUrl) {
    // ... (This function remains mostly the same, but takes mcpUrl as an argument)
    const agentId = message.agent;
    const agent = agentId ? appInstance.agentManager.getAgent(agentId) : null;
    const defaultAgent = appInstance.agentManager.getAgent('agent-default');
    let effectiveToolSettings = defaultAgent.toolSettings;
    if (agent?.useCustomToolSettings) {
        effectiveToolSettings = agent.toolSettings;
    }

    const isAllowed = effectiveToolSettings.allowAll || effectiveToolSettings.allowed?.includes(call.name);

    if (!isAllowed) {
        return { name: call.name, tool_call_id: call.id, error: `Tool "${call.name}" is not enabled.` };
    }

    try {
        const result = await mcpJsonRpc(mcpUrl, 'tools/call', { name: call.name, arguments: call.params });
        if (result.isError) {
            return { name: call.name, tool_call_id: call.id, error: JSON.stringify(result.content) };
        }
        if (call.name === 'web_search' || call.name === 'browse_page' || call.name.startsWith('x_')) {
            if (!message.metadata) message.metadata = {};
            message.metadata.sources = result.sources || [];
        }
        return { name: call.name, tool_call_id: call.id, content: JSON.stringify(result.content, null, 2) };
    } catch (err) {
        console.error('MCP: Tool execution error', err);
        return { name: call.name, tool_call_id: call.id, error: err.message || 'Unknown error' };
    }
}

pluginManager.register(mcpPlugin);
