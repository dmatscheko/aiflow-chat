/**
 * @fileoverview Plugin for integrating with a server that implements the
 * Model Context Protocol (MCP). This allows the AI model to discover and
 * execute external tools like web search, file I/O, etc. The plugin is
 * encapsulated in a singleton class to manage a single connection and
 * cache per MCP server URL.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { processToolCalls as genericProcessToolCalls } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('./chats-plugin.js').Chat} Chat
 * @typedef {import('../tool-processor.js').ToolSchema} ToolSchema
 * @typedef {import('./agents-plugin.js').Agent} Agent
 */

/**
 * The introductory text and instructions for using tools, which is injected
 * into an agent's system prompt if tools are available and enabled.
 * @const {string}
 */
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

You can use multiple tools in one message, but either use tools or write an answer in a message. Use tools only if you need them.

IMPORTANT: Write files only if explicitely instructed to do so.

#### Available Tools:\n\n`;

/**
 * Singleton class to manage all MCP (Model Context Protocol) communication.
 * This includes caching session data, fetching and caching tool definitions,
 * and executing tool calls. It ensures that for any given MCP server URL,
 * only one session initialization is attempted at a time.
 * @class
 */
class McpPlugin {
    /**
     * The singleton instance of the McpPlugin.
     * @type {McpPlugin | null}
     * @private
     */
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
     * Tracks ongoing initialization promises, keyed by MCP server URL, to prevent
     * race conditions where multiple requests might try to initialize a session simultaneously.
     * @type {Map<string, Promise<any>>}
     * @private
     */
    #initPromises = new Map();

    /**
     * The main application instance.
     * @type {App | null}
     * @private
     */
    #app = null;

    /**
     * The constructor enforces the singleton pattern. If an instance already exists,
     * it returns the existing instance.
     * @returns {McpPlugin} The singleton instance of the McpPlugin.
     */
    constructor() {
        if (McpPlugin.#instance) {
            return McpPlugin.#instance;
        }
        McpPlugin.#instance = this;
    }

    /**
     * Initializes the plugin by storing a reference to the main app instance.
     * @param {App} app - The main application instance.
     */
    init(app) {
        this.#app = app;
    }

    /**
     * Sends a raw JSON-RPC request to the MCP server. This is the lowest-level
     * communication method, handling the fetch call, headers, and body construction.
     * @param {string} url - The MCP server URL.
     * @param {string} method - The JSON-RPC method name (e.g., 'initialize', 'tools/list').
     * @param {object} params - The parameters for the JSON-RPC call.
     * @param {boolean} [isNotification=false] - If true, sends a notification (no 'id' field, no response expected).
     * @param {boolean} [returnHeaders=false] - If true, returns the response headers instead of the body.
     * @returns {Promise<any>} The result from the JSON-RPC response, or the headers, or null for notifications.
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
                // Fallback for servers that might incorrectly return a stream for a non-stream request.
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
     * Performs the full MCP session initialization handshake for a given URL,
     * including the `initialize` call and the `notifications/initialized` confirmation.
     * It uses the `#initPromises` map to prevent concurrent initialization attempts.
     * @param {string} url - The MCP server URL.
     * @returns {Promise<void>} A promise that resolves when the session is initialized.
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
     * A robust wrapper for making a JSON-RPC call to the MCP server. It handles session
     * initialization and automatically retries the call once if a session-related error occurs.
     * @param {string} url - The MCP server URL.
     * @param {string} method - The JSON-RPC method name.
     * @param {object} [params={}] - The JSON-RPC parameters.
     * @param {boolean} [retry=false] - Internal flag to prevent infinite retry loops.
     * @returns {Promise<any>} The result of the RPC call.
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
     * Executes a single MCP tool call after checking if the agent has permission to use it.
     * @param {import('../tool-processor.js').ToolCall} call - The tool call to execute.
     * @param {Message} message - The message containing the tool call, used to check agent permissions.
     * @param {string} mcpUrl - The URL of the MCP server to send the call to.
     * @returns {Promise<import('../tool-processor.js').ToolResult>} A promise that resolves to the tool's result.
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
     * Retrieves the list of available tools from a given MCP server URL.
     * It uses an in-memory cache to avoid redundant calls.
     * @param {string} url - The MCP server URL.
     * @param {boolean} [force=false] - If true, bypasses the cache and fetches fresh data.
     * @returns {Promise<ToolSchema[]>} A promise that resolves to an array of tool schemas.
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
     * Generates a Markdown-formatted string describing the available tools for an agent,
     * to be injected into the system prompt.
     * @param {Agent | null} agent - The agent for whom the tool list is being generated.
     * @param {ToolSchema[]} availableTools - The complete list of tools available from the server.
     * @returns {string} The formatted Markdown string describing the allowed tools.
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
     * A public accessor for the private app instance.
     * @returns {App} The main application instance.
     */
    getApp() {
        return this.#app;
    }

    /**
     * A public wrapper for the private `#executeMcpCall` method, allowing it to be
     * passed as a callback to the generic tool processor.
     * @param {import('../tool-processor.js').ToolCall} call - The tool call to execute.
     * @param {Message} message - The message containing the tool call.
     * @param {string} mcpUrl - The URL of the MCP server.
     * @returns {Promise<import('../tool-processor.js').ToolResult>} A promise that resolves to the tool's result.
     */
    executeMcpCall(call, message, mcpUrl) {
        return this.#executeMcpCall(call, message, mcpUrl);
    }

    /**
     * A public wrapper for the private `#mcpJsonRpc` method.
     * @param {string} method - The JSON-RPC method name.
     * @param {object} [params={}] - The JSON-RPC parameters.
     * @param {string} [url=null] - The MCP server URL. If null, the default will be used.
     * @returns {Promise<any>} The result of the RPC call.
     */
    mcpJsonRpc(method, params = {}, url = null) {
        const mcpUrl = url || this.#app.agentManager.getEffectiveApiConfig().toolSettings.mcpServer;
        return this.#mcpJsonRpc(mcpUrl, method, params);
    }
}

// --- Singleton Instance ---
/**
 * The singleton instance of the McpPlugin, used throughout the application.
 * @type {McpPlugin}
 */
const mcpPluginSingleton = new McpPlugin();

// --- Plugin Definition ---

/**
 * The plugin object for integrating with an MCP (Model Context Protocol) server.
 * This object defines the hooks that connect the MCP logic to the application's lifecycle.
 * @type {import('../plugin-manager.js').Plugin}
 */
const mcpPluginDefinition = {
    name: 'MCP',

    /**
     * The `onAppInit` hook, called when the application starts.
     * It initializes the MCP singleton and exposes a public `getTools` method on the app instance.
     * @param {App} app - The main application instance.
     */
    onAppInit(app) {
        mcpPluginSingleton.init(app);
        app.mcp = {
            getTools: mcpPluginSingleton.getTools.bind(mcpPluginSingleton),
            rpc: mcpPluginSingleton.mcpJsonRpc.bind(mcpPluginSingleton)
        };
    },

    /**
     * The `onSystemPromptConstruct` hook. It fetches the list of available tools for the
     * agent's configured MCP server and injects their definitions into the system prompt.
     * @param {string} systemPrompt - The system prompt constructed so far.
     * @param {object} allSettings - The agent's effective settings.
     * @param {Agent} agent - The agent instance.
     * @returns {Promise<string>} The modified system prompt.
     */
    async onSystemPromptConstruct(systemPrompt, allSettings, agent) {
        const mcpUrl = allSettings.toolSettings?.mcpServer;
        if (!mcpUrl) {
            return systemPrompt;
        }

        const tools = await mcpPluginSingleton.getTools(mcpUrl);
        if (tools.length === 0) {
            return systemPrompt;
        }

        const dynamicToolsSection = mcpPluginSingleton.generateToolsSection(agent, tools);
        if (dynamicToolsSection) {
            if (systemPrompt) {
                systemPrompt += '\n\n';
            }
            systemPrompt += toolsHeader + dynamicToolsSection;
        }
        return systemPrompt;
    },

    /**
     * The `onResponseComplete` hook. It parses the completed message for tool calls,
     * filters out any that are not MCP tools, and then executes them using the
     * generic tool processing logic.
     * @param {Message | null} message - The message that has just been completed.
     * @param {Chat} activeChat - The active chat instance.
     * @returns {Promise<boolean>} `true` if tool calls were processed, otherwise `false`.
     */
    async onResponseComplete(message, activeChat) {
        // This handler is for tool calls. If there's no message, it's an idle check, so do nothing.
        if (!message) {
            return false;
        }

        const app = mcpPluginSingleton.getApp();
        const agentId = message.agent || null;
        const effectiveConfig = app.agentManager.getEffectiveApiConfig(agentId);
        const mcpUrl = effectiveConfig.toolSettings.mcpServer;
        if (!mcpUrl) return false;

        const tools = await mcpPluginSingleton.getTools(mcpUrl);
        if (!tools || tools.length === 0) return false;

        return await genericProcessToolCalls(
            app,
            activeChat,
            message,
            tools,
            (call) => !call.name.endsWith('_agent'), // Don't handle agent-as-tool calls here.
            (call, msg) => mcpPluginSingleton.executeMcpCall(call, msg, mcpUrl) // Executor function.
        );
    },

    /**
     * The `onFormatMessageContent` hook. It specifically looks for and renders
     * inline citations generated by tools like web search.
     * @param {HTMLElement} contentEl - The HTML element containing the message content.
     * @param {Message} message - The message object, used to access metadata.
     */
    onFormatMessageContent(contentEl, message) {
        // The special syntax `&lt;dma:render` is used because the markdown renderer
        // escapes '<' to '&lt;'. We search for the escaped version.
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

/**
 * Registers the MCP Plugin with the application's plugin manager.
 */
pluginManager.register(mcpPluginDefinition);
