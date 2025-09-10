/**
 * @fileoverview Plugin for MCP (Model Context Protocol) integration, encapsulated in a singleton class.
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
 */

const toolsHeader = `### MCP Tools:\n...`; // Content is the same as before

/**
 * Singleton class to manage all MCP (Model Context Protocol) communication.
 * This includes caching session data, fetching and caching tool definitions,
 * and executing tool calls.
 */
class McpPlugin {
    /** @type {McpPlugin | null} */
    static #instance = null;

    /**
     * A cache to store tool schemas, keyed by the MCP server URL.
     * @type {Map<string, ToolSchema[]>}
     * @private
     */
    #toolCache = new Map();

    /**
     * A cache for MCP session IDs, keyed by the MCP server URL.
     * @type {Map<string, string>}
     * @private
     */
    #sessionCache = new Map();

    /**
     * Tracks ongoing initialization promises, keyed by MCP server URL.
     * @type {Map<string, Promise<any>>}
     * @private
     */
    #initPromises = new Map();

    /**
     * The application instance.
     * @type {App | null}
     * @private
     */
    #app = null;

    /**
     * Enforces the singleton pattern.
     * @returns {McpPlugin}
     */
    constructor() {
        if (McpPlugin.#instance) {
            return McpPlugin.#instance;
        }
        McpPlugin.#instance = this;
    }

    /**
     * Initializes the plugin and stores the app instance.
     * @param {App} app - The main application instance.
     */
    init(app) {
        this.#app = app;
    }

    /**
     * Sends a raw JSON-RPC request to the MCP server.
     * @param {string} url - The MCP server URL.
     * @param {string} method - The JSON-RPC method name.
     * @param {object} params - The JSON-RPC parameters.
     * @param {boolean} [isNotification=false] - Whether this is a notification (no 'id').
     * @param {boolean} [returnHeaders=false] - Whether to return the response headers instead of the body.
     * @returns {Promise<any>}
     * @private
     */
    async #sendMcpRequest(url, method, params, isNotification = false, returnHeaders = false) {
        if (!url) throw new Error('No MCP server URL set');
        const body = { jsonrpc: '2.0', method, params };
        if (!isNotification) {
            body.id = Math.floor(Math.random() * 1000000);
        }
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        };
        const sessionId = this.#sessionCache.get(url);
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

            const rawText = await resp.text();
            console.log(`DEBUG: Raw response from ${url} for method ${method}:`, rawText);

            try {
                const data = JSON.parse(rawText);
                if (data.error) throw new Error(data.error.message || 'MCP call failed');
                return data.result;
            } catch (error) {
                if (error instanceof SyntaxError && rawText.includes('data:')) {
                    console.warn('MCP: JSON parsing failed, attempting to parse as event-stream.');
                    let result = null;
                    const lines = rawText.split('\n');
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
                throw error;
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error('MCP request timed out');
            throw error;
        }
    }

    /**
     * Performs the full MCP session initialization handshake for a given URL.
     * @param {string} url - The MCP server URL.
     * @returns {Promise<void>}
     * @private
     */
    async #initMcpSession(url) {
        if (this.#initPromises.has(url)) return this.#initPromises.get(url);

        const promise = (async () => {
            if (this.#sessionCache.has(url)) return;

            console.log(`MCP: Initializing session for ${url}`);
            const initParams = {
                protocolVersion: '2025-03-26',
                capabilities: { roots: { listChanged: false }, sampling: {} },
                clientInfo: { name: 'NewChatClient', version: '1.0.0' }
            };
            const respHeaders = await this.#sendMcpRequest(url, 'initialize', initParams, false, true);
            const sessionId = respHeaders.get('mcp-session-id');

            if (!sessionId) {
                throw new Error('No session ID returned in initialize response header');
            }
            this.#sessionCache.set(url, sessionId);
            await this.#sendMcpRequest(url, 'notifications/initialized', {}, true);
            console.log(`MCP: Session initialized for ${url}`, sessionId);
        })();

        this.#initPromises.set(url, promise);
        try {
            await promise;
        } finally {
            this.#initPromises.delete(url);
        }
    }

    /**
     * Performs a JSON-RPC call to the MCP server, handling session initialization and retries.
     * @param {string} url - The MCP server URL.
     * @param {string} method - The JSON-RPC method name.
     * @param {object} [params={}] - The JSON-RPC parameters.
     * @param {boolean} [retry=false] - Internal flag to prevent infinite retry loops.
     * @returns {Promise<any>}
     * @private
     */
    async #mcpJsonRpc(url, method, params = {}, retry = false) {
        try {
            await this.#initMcpSession(url);
            return await this.#sendMcpRequest(url, method, params);
        } catch (error) {
            console.error('MCP: JSON-RPC failure', error);
            if (error.message.includes('session') && !retry) {
                this.#sessionCache.delete(url);
                this.#initPromises.delete(url);
                console.log('MCP: Retrying MCP call after session re-init');
                return this.#mcpJsonRpc(url, method, params, true);
            }
            throw new AggregateError([error], `Failed to perform MCP JSON-RPC call to ${url}.`);
        }
    }

    /**
     * Executes a single MCP tool call after checking agent permissions.
     * @param {import('../tool-processor.js').ToolCall} call
     * @param {Message} message
     * @param {string} mcpUrl
     * @returns {Promise<import('../tool-processor.js').ToolResult>}
     * @private
     */
    async #executeMcpCall(call, message, mcpUrl) {
        const agentId = message.agent;
        const agent = agentId ? this.#app.agentManager.getAgent(agentId) : null;
        const defaultAgent = this.#app.agentManager.getAgent('agent-default');
        let effectiveToolSettings = defaultAgent.toolSettings;
        if (agent?.useCustomToolSettings) {
            effectiveToolSettings = agent.toolSettings;
        }

        const isAllowed = effectiveToolSettings.allowAll || effectiveToolSettings.allowed?.includes(call.name);
        if (!isAllowed) {
            return { name: call.name, tool_call_id: call.id, error: `Tool "${call.name}" is not enabled.` };
        }

        try {
            const result = await this.#mcpJsonRpc(mcpUrl, 'tools/call', { name: call.name, arguments: call.params });
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

    /**
     * Gets tools for a given MCP server URL, using cache if available, or fetching otherwise.
     * @param {string} url - The MCP server URL.
     * @returns {Promise<ToolSchema[]>}
     */
    async getTools(url, force = false) {
        if (force) {
            this.#toolCache.delete(url);
            this.#initPromises.delete(url); // Also clear any pending/failed init promises
        }
        if (this.#toolCache.has(url)) {
            return this.#toolCache.get(url);
        }
        if (!url) {
            this.#toolCache.set(url, []);
            return [];
        }
        console.log('MCP: Fetching tools from', url);
        try {
            const response = await this.#mcpJsonRpc(url, 'tools/list');
            const tools = Array.isArray(response?.tools) ? response.tools : [];
            this.#toolCache.set(url, tools);
            console.log(`DEBUG: Successfully fetched and cached ${tools.length} tools for ${url}.`);
            document.body.dispatchEvent(new CustomEvent('mcp-tools-updated', { detail: { url } }));
            return tools;
        } catch (error) {
            console.error(`MCP: Failed to fetch tools for ${url}`, error);
            alert(`Failed to connect to MCP server at ${url}. Please check the URL and server status.\n\n${error.message}`);
            this.#toolCache.set(url, []);
            return [];
        }
    }

    /**
     * Generates the tools Markdown section for the system prompt based on agent settings.
     * @param {Agent | null} agent
     * @param {ToolSchema[]} availableTools
     * @returns {string}
     */
    generateToolsSection(agent, availableTools) {
        const agentManager = this.#app?.agentManager;
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
     * Gets the application instance.
     * @returns {App}
     */
    getApp() {
        return this.#app;
    }

    /**
     * A wrapper for the private #executeMcpCall method to be used in the plugin hooks.
     * @param {import('../tool-processor.js').ToolCall} call
     * @param {Message} message
     * @param {string} mcpUrl
     * @returns {Promise<import('../tool-processor.js').ToolResult>}
     */
    executeMcpCall(call, message, mcpUrl) {
        return this.#executeMcpCall(call, message, mcpUrl);
    }
}

// --- Singleton Instance ---
const mcpPluginSingleton = new McpPlugin();

// --- Plugin Definition ---

/**
 * Plugin for integrating with an MCP (Model Context Protocol) server.
 * @type {import('../plugin-manager.js').Plugin}
 */
const mcpPluginDefinition = {
    name: 'MCP',

    onAppInit(app) {
        mcpPluginSingleton.init(app);
        app.mcp = {
            getTools: mcpPluginSingleton.getTools.bind(mcpPluginSingleton)
        };
    },

    async beforeApiCall(payload, allSettings, agent) {
        const app = mcpPluginSingleton.getApp();
        const effectiveConfig = app.agentManager.getEffectiveApiConfig(agent?.id);
        const mcpUrl = effectiveConfig.mcpServer;
        if (!mcpUrl) return payload;

        const tools = await mcpPluginSingleton.getTools(mcpUrl);
        if (tools.length === 0) {
            return payload;
        }

        const dynamicToolsSection = mcpPluginSingleton.generateToolsSection(agent, tools);
        if (dynamicToolsSection) {
            const systemPrompt = payload.messages.find(m => m.role === 'system');
            if (systemPrompt && !systemPrompt.content.includes(toolsHeader)) {
                systemPrompt.content += '\n\n' + toolsHeader + dynamicToolsSection;
            }
        }
        return payload;
    },

    async onResponseComplete(message, activeChat) {
        const app = mcpPluginSingleton.getApp();
        const agentId = message.agent || null;
        const effectiveConfig = app.agentManager.getEffectiveApiConfig(agentId);
        const mcpUrl = effectiveConfig.mcpServer;
        if (!mcpUrl) return;

        const tools = await mcpPluginSingleton.getTools(mcpUrl);
        if (!tools || tools.length === 0) return;

        await genericProcessToolCalls(
            app,
            activeChat,
            message,
            tools,
            (call) => !call.name.endsWith('_agent'), // filter
            (call, msg) => mcpPluginSingleton.executeMcpCall(call, msg, mcpUrl) // executor
        );
    },

    onFormatMessageContent(contentEl, message) {
        if (!contentEl.innerHTML.includes('&lt;dma:render')) return;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentEl.innerHTML;
        tempDiv.querySelectorAll('dma\\:render[type="render_inline_citation"]').forEach(node => {
            const argNode = node.querySelector('argument[name="citation_id"]');
            const id = argNode ? parseInt(argNode.textContent.trim(), 10) : null;
            if (id === null || isNaN(id)) return;
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

pluginManager.register(mcpPluginDefinition);
