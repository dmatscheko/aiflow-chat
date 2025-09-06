/**
 * @fileoverview Plugin for MCP (Model Context Protocol) integration.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { processToolCalls as genericProcessToolCalls } from '../tool-processor.js';
import { ChatLog } from '../chat-data.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').Setting} Setting
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../main.js').Chat} Chat
 * @typedef {import('../tool-processor.js').ToolSchema} ToolSchema
 * @typedef {import('../tool-processor.js').ToolCall} ToolCall
 * @typedef {import('../tool-processor.js').ToolResult} ToolResult
 * @typedef {import('./agents-plugin.js').Agent} Agent
 */

// --- State Variables ---
/** @type {string | null} */
let mcpUrl = null;
/** @type {string | null} */
let mcpSessionId = null;
/** @type {ToolSchema[]} */
let tools = [];
/** @type {boolean} */
let isInitialized = false;
/** @type {Promise<void> | null} */
let initPromise = null;
/** @type {App | null} */
let appInstance = null;


/**
 * Plugin for integrating with an MCP (Model Context Protocol) server.
 * Handles tool discovery, session management, and tool execution.
 * @type {import('../plugin-manager.js').Plugin & {getTools: () => ToolSchema[]}}
 */
const mcpPlugin = {
    name: 'MCP',

    /**
     * Get the list of available tools fetched from the MCP server.
     * @returns {ToolSchema[]} The list of tools.
     */
    getTools: () => tools,

    /**
     * Registers the 'MCP Server URL' setting with a declarative listener.
     * @param {Setting[]} settings - The original settings array.
     * @returns {Setting[]} The modified settings array.
     */
    onSettingsRegistered(settings) {
        // Find the toolSettings definition and remove it, we'll re-add it if needed.
        const toolSettingsIndex = settings.findIndex(s => s.id === 'toolSettings');
        if (toolSettingsIndex > -1) {
            settings.splice(toolSettingsIndex, 1);
        }

        settings.push({
            id: 'mcpServer',
            label: 'MCP Server URL',
            type: 'text',
            placeholder: 'e.g., http://localhost:3000/mcp',
            default: '',
            listeners: {
                'change': (event, context) => {
                    // The app's core listener already saves the settings.
                    // We just need to react to the change.
                    const newUrl = context.getValue();
                    console.log('MCP: URL changed, re-initializing...', newUrl);
                    isInitialized = false; // Reset initialization state
                    mcpUrl = newUrl;
                    initializeMcp(); // This will fetch tools and refresh the UI
                }
            }
        });

        // Re-add the tool settings definition if we have tools
        if (appInstance) {
            const toolSettingsDef = appInstance.getToolSettingsDefinition();
            if (toolSettingsDef) {
                settings.push(toolSettingsDef);
            }
        }

        return settings;
    },

    /**
     * Initializes the MCP connection when the app starts.
     * @param {App} app - The main application instance.
     */
    onAppInit(app) {
        appInstance = app;
        // Expose the plugin's API to the app instance
        app.mcp = {
            getTools: mcpPlugin.getTools
        };

        // The App class now handles loading settings into `app.currentSettings`
        mcpUrl = app.currentSettings.mcpServer || '';
        if (mcpUrl) {
            console.log('MCP: URL found, initializing...', mcpUrl);
            initializeMcp();
        } else {
            console.log('MCP: No URL, skipping initialization.');
        }
    },

    /**
     * Injects the available tools list into the system prompt before an API call.
     * @param {object} payload - The original API payload.
     * @param {object} allSettings - All current settings from the app instance.
     * @param {Agent | null} agent - The active agent, if any.
     * @returns {object} The modified payload.
     */
    beforeApiCall(payload, allSettings, agent) {
        if (!mcpUrl || tools.length === 0) {
            return payload;
        }

        const dynamicToolsSection = generateToolsSection(agent);

        if (dynamicToolsSection) {
            const systemPrompt = payload.messages.find(m => m.role === 'system');
            if (systemPrompt) {
                if (!systemPrompt.content.includes(toolsHeader)) {
                    systemPrompt.content += '\n\n' + toolsHeader + dynamicToolsSection;
                }
            }
        }
        return payload;
    },

    /**
     * Checks for and processes any tool calls in a completed assistant message.
     * @param {Message} message - The completed assistant message.
     * @param {Chat} activeChat - The active chat instance.
     */
    async onResponseComplete(message, activeChat) {
        if (!mcpUrl) return;
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
     * Post-processes message content to render MCP-specific elements, like citations.
     * @param {HTMLElement} contentEl - The content element.
     * @param {Message} message - The message object, used to access metadata.
     */
    onFormatMessageContent(contentEl, message) {
        if (!contentEl.innerHTML.includes('&lt;dma:render')) return;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentEl.innerHTML;
        tempDiv.querySelectorAll('dma\\:render[type="render_inline_citation"]').forEach(node => {
            const argNode = node.querySelector('argument[name="citation_id"]');
            const id = argNode ? parseInt(argNode.textContent.trim(), 10) : null;
            if (id === null) return node.parentNode.removeChild(node);
            const source = message.metadata?.sources?.[id - 1];
            const sup = document.createElement('sup');
            const a = document.createElement('a');
            a.href = source?.url || '#';
            a.title = source?.title || 'Source not found';
            a.textContent = `[${id}]`;
            a.target = '_blank';
            if (!source) a.style.color = 'red';
            sup.appendChild(a);
            node.parentNode.replaceChild(sup, node);
        });
        contentEl.innerHTML = tempDiv.innerHTML;
    }
};

const toolsHeader = `### MCP Tools:\n...`; // Keep header as is

/**
 * Initializes the MCP connection by fetching the tool list.
 * @private
 */
function initializeMcp() {
    if (!mcpUrl) {
        tools = [];
        if (appInstance) appInstance.refreshSettingsUI();
        return;
    }
    mcpSessionId = localStorage.getItem(`mcpSession_${mcpUrl}`) || null;
    console.log('MCP: Pre-fetching tools from', mcpUrl);
    mcpJsonRpc('tools/list').then(response => {
        tools = Array.isArray(response.tools) ? response.tools : [];
        console.log('MCP: Tools fetched successfully.');
        if (appInstance) {
            // This will re-run defineSettings and re-render the whole panel,
            // including the now-populated tool list.
            appInstance.refreshSettingsUI();
        }
    }).catch(error => {
        tools = [];
        console.error('MCP: Failed to pre-fetch tools', error);
        alert(`Failed to connect to MCP server at ${mcpUrl}. Please check the URL and server status.\n\n${error.message}`);
        if (appInstance) appInstance.refreshSettingsUI();
    });
}

/**
 * Generates the tools Markdown section for the system prompt based on the current settings.
 * @param {Agent | null} agent - The active agent, if any, to check for custom tool settings.
 * @returns {string} The Markdown section, or an empty string if no tools are allowed.
 * @private
 */
function generateToolsSection(agent) {
    let effectiveToolSettings;
    if (agent && agent.useCustomToolSettings) {
        effectiveToolSettings = agent.toolSettings;
    } else {
        // Get settings from the app's central store, not localStorage directly
        effectiveToolSettings = appInstance?.currentSettings?.toolSettings || { allowAll: true, allowed: [] };
    }

    const allowedTools = effectiveToolSettings.allowAll
        ? tools
        : tools.filter(tool => effectiveToolSettings.allowed.includes(tool.name));

    if (allowedTools.length === 0) return '';

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
        return `${idx + 1}. **${displayName}**\n - **Description**: ${desc}\n - **Action**: \`${action}\`\n - **Arguments**:\n${argsStr}`;
    }).join('\n\n');
}

/**
 * Performs the full MCP session initialization handshake.
 * @private
 */
async function initMcpSession() {
    if (initPromise) return initPromise;
    const performInit = async () => {
        if (isInitialized) return;
        console.log('MCP: Initializing MCP session');
        const initParams = { protocolVersion: '2025-03-26' };
        const initData = await sendMcpRequest('initialize', initParams, true);
        if (initData.protocolVersion !== '2025-03-26') throw new Error(`Protocol version mismatch`);
        if (!mcpSessionId) throw new Error('No session ID returned');
        localStorage.setItem(`mcpSession_${mcpUrl}`, mcpSessionId);
        await sendMcpRequest('notifications/initialized', {}, false, true);
        isInitialized = true;
        console.log('MCP: Session initialized', mcpSessionId);
    };
    initPromise = performInit().finally(() => { initPromise = null; });
    await initPromise;
}

/**
 * Sends a raw JSON-RPC request to the MCP server.
 * @private
 */
async function sendMcpRequest(method, params = {}, isInit = false, isNotification = false) {
    if (!mcpUrl) throw new Error('No MCP server URL set');
    const body = { jsonrpc: '2.0', method, params };
    if (!isNotification) body.id = Math.floor(Math.random() * 1000000);
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
    if (mcpSessionId && !isInit) headers['mcp-session-id'] = mcpSessionId;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const resp = await fetch(mcpUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
        clearTimeout(timeoutId);
        if (!resp.ok) throw new Error(`MCP error: ${resp.statusText} - ${await resp.text()}`);
        const headerSession = resp.headers.get('mcp-session-id');
        if (headerSession) {
            mcpSessionId = headerSession;
            localStorage.setItem(`mcpSession_${mcpUrl}`, mcpSessionId);
        }
        if (isNotification) return null;

        const contentType = resp.headers.get('Content-Type') || '';
        if (contentType.includes('application/json')) {
            const data = await resp.json();
            if (data.error) throw new Error(data.error.message || 'MCP call failed');
            return data.result;
        } else if (contentType.includes('text/event-stream')) {
            const text = await resp.text();
            // Find the last valid JSON object in the stream
            const jsonObjects = text.match(/data: ({.*})\n/g);
            if (!jsonObjects) throw new Error('Invalid SSE response: No JSON data found.');
            const lastData = jsonObjects.pop().slice(6);
            const data = JSON.parse(lastData);
            if (data.error) throw new Error(data.error.message || 'MCP call failed');
            return data.result;
        } else {
            throw new Error(`Unexpected Content-Type: ${contentType}`);
        }
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') throw new Error('MCP request timed out');
        throw error;
    }
}

/**
 * Performs a JSON-RPC call to the MCP server.
 * @private
 */
async function mcpJsonRpc(method, params = {}, retry = false) {
    try {
        await initMcpSession();
        return await sendMcpRequest(method, params);
    } catch (error) {
        console.error('MCP: JSON-RPC failure', error);
        if (error.message.includes('session') && !retry) {
            localStorage.removeItem(`mcpSession_${mcpUrl}`);
            mcpSessionId = null;
            isInitialized = false;
            console.log('MCP: Retrying MCP call after session re-init');
            return mcpJsonRpc(method, params, true);
        }
        throw error;
    }
}

/**
 * Filters for MCP tool calls.
 * @private
 */
function filterMcpCalls(call) {
    return !call.name.endsWith('_agent');
}

/**
 * Executes a single MCP tool call after checking permissions.
 * @private
 */
async function executeMcpCall(call, message) {
    const agentId = message.value.agent;
    const agent = agentId ? appInstance.agentManager.getAgent(agentId) : null;
    let effectiveToolSettings;

    if (agent && agent.useCustomToolSettings) {
        effectiveToolSettings = agent.toolSettings;
    } else {
        effectiveToolSettings = appInstance?.currentSettings?.toolSettings || { allowAll: false, allowed: [] };
    }

    if (!effectiveToolSettings.allowAll && !effectiveToolSettings.allowed.includes(call.name)) {
        console.warn(`MCP: Tool call "${call.name}" blocked by settings.`);
        return { name: call.name, tool_call_id: call.id, content: null, error: `Tool "${call.name}" is not enabled.` };
    }

    console.log('MCP: Executing tool', call.name, 'with params', call.params);
    try {
        const result = await mcpJsonRpc('tools/call', { name: call.name, arguments: call.params });
        if (result.isError) {
            return { name: call.name, tool_call_id: call.id, content: null, error: JSON.stringify(result.content) };
        }
        if (result.sources) {
            if (!message.metadata) message.metadata = {};
            message.metadata.sources = result.sources;
        }
        return { name: call.name, tool_call_id: call.id, content: JSON.stringify(result.content, null, 2), error: null };
    } catch (err) {
        console.error('MCP: Tool execution error', err);
        return { name: call.name, tool_call_id: call.id, content: null, error: err.message || 'Unknown error' };
    }
}

pluginManager.register(mcpPlugin);
