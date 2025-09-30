/**
 * @fileoverview Plugin for MCP (Model Context Protocol) integration, encapsulated in a singleton class.
 * This plugin is responsible for fetching tool lists from an MCP server, constructing the
 * tool section of the system prompt, and executing MCP tool calls when requested by the ToolCallManager.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { toolCallManager } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../tool-processor.js').ToolSchema} ToolSchema
 * @typedef {import('../tool-processor.js').ToolCall} ToolCall
 * @typedef {import('../tool-processor.js').ToolCallJob} ToolCallJob
 * @typedef {import('../tool-processor.js').ToolResult} ToolResult
 * @typedef {import('./agents-plugin.js').Agent} Agent
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
 * and executing tool calls.
 * @class
 */
class McpPlugin {
    /** @type {App} */
    app = null;
    /** @type {Map<string, ToolSchema[]>} */
    toolCache = new Map();
    /** @type {Map<string, string>} */
    sessionCache = new Map();
    /** @type {Map<string, Promise<any>>} */
    initPromises = new Map();

    /**
     * Initializes the plugin and stores the app instance.
     * @param {App} app - The main application instance.
     */
    init(app) {
        this.app = app;
    }

    /**
     * Executes a single MCP tool call.
     * This method is called by the ToolCallManager. It handles permissions,
     * makes the call to the MCP server, and reports the result back to the manager.
     * @param {ToolCall} call - The tool call to execute.
     * @param {ToolCallJob} job - The job this call belongs to.
     */
    async executeCall(call, job) {
        const { sourceMessage } = job;
        const agentId = sourceMessage.value.agent || null;
        const effectiveConfig = this.app.agentManager.getEffectiveApiConfig(agentId);
        const mcpUrl = effectiveConfig.toolSettings?.mcpServer;

        let result;
        if (!mcpUrl) {
            result = {
                name: call.name,
                tool_call_id: call.tool_call_id,
                content: null,
                error: 'MCP server URL is not configured for the active agent.',
            };
        } else {
            result = await this.performMcpCall(call, sourceMessage, mcpUrl);
        }

        toolCallManager.notifyCallComplete(job.id, result);
    }

    /**
     * Performs the actual tool call to the MCP server, including permission checks.
     * @param {ToolCall} call - The tool call to execute.
     * @param {Message} message - The message containing the tool call.
     * @param {string} mcpUrl - The URL of the MCP server.
     * @returns {Promise<ToolResult>} The result of the tool execution.
     * @private
     */
    async performMcpCall(call, message, mcpUrl) {
        const agentId = message.value.agent;
        const agent = agentId ? this.app.agentManager.getAgent(agentId) : null;
        const defaultAgent = this.app.agentManager.getAgent('agent-default');
        let effectiveToolSettings = defaultAgent.toolSettings;
        if (agent?.useCustomToolSettings) {
            effectiveToolSettings = agent.toolSettings;
        }

        const isAllowed = effectiveToolSettings.allowAll || effectiveToolSettings.allowed?.includes(call.name);
        if (!isAllowed) {
            return { name: call.name, tool_call_id: call.tool_call_id, content: null, error: `Tool "${call.name}" is not enabled for the current agent.` };
        }

        try {
            const result = await this.mcpJsonRpc(mcpUrl, 'tools/call', { name: call.name, arguments: call.params });
            const content = result.content !== undefined ? JSON.stringify(result.content, null, 2) : null;

            if (result.isError) {
                return { name: call.name, tool_call_id: call.tool_call_id, content: null, error: content };
            }
            if (call.name === 'web_search' || call.name === 'browse_page' || call.name.startsWith('x_')) {
                if (!message.metadata) message.metadata = {};
                message.metadata.sources = result.sources || [];
            }
            return { name: call.name, tool_call_id: call.tool_call_id, content: content, error: null };
        } catch (err) {
            console.error('MCP: Tool execution error', err);
            return { name: call.name, tool_call_id: call.tool_call_id, content: null, error: err.message || 'Unknown error during tool execution.' };
        }
    }

    /**
     * Gets tools for a given MCP server URL, using cache if available, or fetching otherwise.
     * @param {string} url - The MCP server URL.
     * @param {boolean} [force=false] - If true, bypasses the cache and fetches fresh data.
     * @returns {Promise<ToolSchema[]>}
     */
    async getTools(url, force = false) {
        if (force) {
            this.toolCache.delete(url);
            this.initPromises.delete(url);
        }
        if (this.toolCache.has(url)) {
            return this.toolCache.get(url);
        }
        if (!url) {
            this.toolCache.set(url, []);
            return [];
        }
        console.log('MCP: Fetching tools from', url);
        try {
            const response = await this.mcpJsonRpc(url, 'tools/list');
            const tools = Array.isArray(response?.tools) ? response.tools : [];
            this.toolCache.set(url, tools);
            document.body.dispatchEvent(new CustomEvent('mcp-tools-updated', { detail: { url } }));
            return tools;
        } catch (error) {
            console.error(`MCP: Failed to fetch tools for ${url}`, error);
            alert(`Failed to connect to MCP server at ${url}. Please check the URL and server status.\n\n${error.message}`);
            this.toolCache.set(url, []);
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
        const agentManager = this.app?.agentManager;
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

    // --- Private MCP Communication Methods ---

    async #initMcpSession(url) {
        if (this.initPromises.has(url)) return this.initPromises.get(url);
        const promise = (async () => {
            if (this.sessionCache.has(url)) return;
            const initParams = { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'CoreChat' } };
            const respHeaders = await this.#sendMcpRequest(url, 'initialize', initParams, false, true);
            const sessionId = respHeaders.get('mcp-session-id');
            if (!sessionId) throw new Error('No session ID in initialize response');
            this.sessionCache.set(url, sessionId);
            await this.#sendMcpRequest(url, 'notifications/initialized', {}, true);
        })();
        this.initPromises.set(url, promise);
        try { await promise; } finally { this.initPromises.delete(url); }
    }

    async mcpJsonRpc(url, method, params = {}, retry = false) {
        try {
            await this.#initMcpSession(url);
            return await this.#sendMcpRequest(url, method, params);
        } catch (error) {
            console.error('MCP: JSON-RPC failure', error);
            if (error.message.includes('session') && !retry) {
                this.sessionCache.delete(url);
                this.initPromises.delete(url);
                return this.mcpJsonRpc(url, method, params, true);
            }
            throw new AggregateError([error], `Failed to perform MCP JSON-RPC call to ${url}.`);
        }
    }

    async #sendMcpRequest(url, method, params, isNotification = false, returnHeaders = false) {
        if (!url) throw new Error('No MCP server URL set');
        const body = { jsonrpc: '2.0', method, params };
        if (!isNotification) body.id = `mcp_${Date.now()}`;

        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        const sessionId = this.sessionCache.get(url);
        if (sessionId) headers['mcp-session-id'] = sessionId;

        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!resp.ok) throw new Error(`MCP error: ${resp.statusText} - ${await resp.text()}`);
        if (returnHeaders) return resp.headers;
        if (isNotification) return null;

        const data = await resp.json();
        if (data.error) throw new Error(data.error.message || 'MCP call failed');
        return data.result;
    }
}

const mcpPluginSingleton = new McpPlugin();

const mcpPluginDefinition = {
    name: 'MCP Plugin',
    instance: mcpPluginSingleton, // Expose instance for the ToolCallManager

    onAppInit(app) {
        mcpPluginSingleton.init(app);
        app.mcp = {
            getTools: mcpPluginSingleton.getTools.bind(mcpPluginSingleton),
        };
    },

    async onSystemPromptConstruct(systemPrompt, allSettings, agent) {
        const mcpUrl = allSettings.toolSettings?.mcpServer;
        if (!mcpUrl) return systemPrompt;

        const tools = await mcpPluginSingleton.getTools(mcpUrl);
        if (tools.length === 0) return systemPrompt;

        const dynamicToolsSection = mcpPluginSingleton.generateToolsSection(agent, tools);
        if (dynamicToolsSection) {
            if (systemPrompt) systemPrompt += '\n\n';
            systemPrompt += toolsHeader + dynamicToolsSection;
        }
        return systemPrompt;
    },

    onFormatMessageContent(contentEl, message) {
        // This is a rendering concern, unrelated to tool execution logic.
        // It's safe to keep as is.
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