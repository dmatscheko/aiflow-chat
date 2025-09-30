/**
 * @fileoverview Plugin for MCP (Model Context Protocol) integration, encapsulated in a singleton class.
 * @version 2.0.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { parseToolCalls } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../main.js').Chat} Chat
 * @typedef {import('../tool-processor.js').ToolSchema} ToolSchema
 * @typedef {import('../tool-processor.js').ToolCall} ToolCall
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
Do not escape any of the tool call arguments. The arguments will be parsed as normal text. There is one exception: If you need to write </dma:tool_call> or </parameter> as value inside a <parameter>, write it like <\\/dma:tool_call> or <\\/parameter>.

You can use multiple tools in one message, but either use tools or write an answer in a message. Use tools only if you need them.

IMPORTANT: Write files only if explicitely instructed to do so.

#### Available Tools:\\n\\n`;

/**
 * Singleton class to manage all MCP (Model Context Protocol) communication.
 * This includes caching session data, fetching and caching tool definitions,
 * and executing tool calls.
 */
class McpPlugin {
    /** @type {McpPlugin | null} */
    static #instance = null;

    /** @type {Map<string, ToolSchema[]>} */
    #toolCache = new Map();
    /** @type {Map<string, string>} */
    #sessionCache = new Map();
    /** @type {Map<string, Promise<any>>} */
    #initPromises = new Map();
    /** @type {App | null} */
    #app = null;

    constructor() {
        if (McpPlugin.#instance) {
            return McpPlugin.#instance;
        }
        McpPlugin.#instance = this;
    }

    /** @param {App} app */
    init(app) {
        this.#app = app;
    }

    /** @returns {App} */
    getApp() {
        return this.#app;
    }

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

            if (returnHeaders) return resp.headers;
            if (isNotification) return null;

            const rawText = await resp.text();
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

    async #initMcpSession(url) {
        if (this.#initPromises.has(url)) return this.#initPromises.get(url);
        const promise = (async () => {
            if (this.#sessionCache.has(url)) return;
            const initParams = {
                protocolVersion: '2025-03-26',
                capabilities: { roots: { listChanged: false }, sampling: {} },
                clientInfo: { name: 'NewChatClient', version: '1.0.0' }
            };
            const respHeaders = await this.#sendMcpRequest(url, 'initialize', initParams, false, true);
            const sessionId = respHeaders.get('mcp-session-id');
            if (!sessionId) throw new Error('No session ID returned');
            this.#sessionCache.set(url, sessionId);
            await this.#sendMcpRequest(url, 'notifications/initialized', {}, true);
        })();
        this.#initPromises.set(url, promise);
        try {
            await promise;
        } finally {
            this.#initPromises.delete(url);
        }
    }

    async #mcpJsonRpc(url, method, params = {}, retry = false) {
        try {
            await this.#initMcpSession(url);
            return await this.#sendMcpRequest(url, method, params);
        } catch (error) {
            if (error.message.includes('session') && !retry) {
                this.#sessionCache.delete(url);
                this.#initPromises.delete(url);
                return this.#mcpJsonRpc(url, method, params, true);
            }
            throw new AggregateError([error], `Failed to perform MCP JSON-RPC call to ${url}.`);
        }
    }

    /**
     * Executes a single MCP tool call after checking agent permissions.
     * @param {ToolCall} call
     * @param {Message} message
     * @returns {Promise<ToolResult>}
     */
    async executeMcpCall(call, message) {
        const agentId = message.value.agent;
        const effectiveConfig = this.#app.agentManager.getEffectiveApiConfig(agentId);
        const mcpUrl = effectiveConfig.toolSettings?.mcpServer;

        if (!mcpUrl) {
            return { name: call.name, tool_call_id: call.id, error: 'No MCP server URL is configured for the active agent.' };
        }

        const agent = agentId ? this.#app.agentManager.getAgent(agentId) : null;
        const isAllowed = effectiveConfig.toolSettings.allowAll || effectiveConfig.toolSettings.allowed?.includes(call.name);
        if (!isAllowed) {
            return { name: call.name, tool_call_id: call.id, error: `Tool "${call.name}" is not enabled for the current agent.` };
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
            return { name: call.name, tool_call_id: call.id, error: err.message || 'Unknown error during MCP call' };
        }
    }

    /** @param {string} url, @param {boolean} [force=false] */
    async getTools(url, force = false) {
        if (force) {
            this.#toolCache.delete(url);
            this.#initPromises.delete(url);
        }
        if (this.#toolCache.has(url)) return this.#toolCache.get(url);
        if (!url) return [];
        try {
            const response = await this.#mcpJsonRpc(url, 'tools/list');
            const tools = Array.isArray(response?.tools) ? response.tools : [];
            this.#toolCache.set(url, tools);
            document.body.dispatchEvent(new CustomEvent('mcp-tools-updated', { detail: { url } }));
            return tools;
        } catch (error) {
            alert(`Failed to connect to MCP server at ${url}.\n\n${error.message}`);
            return [];
        }
    }

    /** @param {Agent | null} agent, @param {ToolSchema[]} availableTools */
    generateToolsSection(agent, availableTools) {
        const effectiveToolSettings = this.#app.agentManager.getEffectiveApiConfig(agent?.id).toolSettings;
        if (!effectiveToolSettings) return '';
        const allowedTools = effectiveToolSettings.allowAll
            ? availableTools
            : availableTools.filter(tool => effectiveToolSettings.allowed?.includes(tool.name));
        if (allowedTools.length === 0) return '';
        return allowedTools.map((tool, idx) => {
            const properties = tool.inputSchema?.properties || {};
            const requiredSet = new Set(tool.inputSchema?.required || []);
            const argsStr = Object.entries(properties).map(([name, arg]) => `   - \`${name}\`: ${arg.description || 'No description.'} (type: ${arg.type || 'unknown'})${requiredSet.has(name) ? '(required)' : ''}`).join('\n');
            return `${idx + 1}. **${tool.name}**\n - **Description**: ${tool.description || 'No description.'}\n - **Action**: \`${tool.name}\`\n - **Arguments**:\n${argsStr}`;
        }).join('\n');
    }
}

const mcpPluginSingleton = new McpPlugin();

const mcpPluginDefinition = {
    name: 'MCP',

    onAppInit(app) {
        mcpPluginSingleton.init(app);
        app.mcp = { getTools: mcpPluginSingleton.getTools.bind(mcpPluginSingleton) };
    },

    async onSystemPromptConstruct(systemPrompt, allSettings, agent) {
        const mcpUrl = allSettings.toolSettings?.mcpServer;
        if (!mcpUrl) return systemPrompt;
        const tools = await mcpPluginSingleton.getTools(mcpUrl);
        if (tools.length === 0) return systemPrompt;
        const dynamicToolsSection = mcpPluginSingleton.generateToolsSection(agent, tools);
        return dynamicToolsSection ? `${systemPrompt}\n\n${toolsHeader}${dynamicToolsSection}` : systemPrompt;
    },

    /**
     * @param {ToolCall[]} toolCalls
     * @param {Message} message
     * @param {Chat} activeChat
     */
    async onToolCallParse(toolCalls, message, activeChat) {
        if (!message?.value.content) return toolCalls;
        const app = mcpPluginSingleton.getApp();
        const effectiveConfig = app.agentManager.getEffectiveApiConfig(message.value.agent);
        const mcpUrl = effectiveConfig.toolSettings?.mcpServer;
        if (!mcpUrl) return toolCalls;

        const mcpTools = await mcpPluginSingleton.getTools(mcpUrl);
        if (!mcpTools || mcpTools.length === 0) return toolCalls;

        const parsedResult = parseToolCalls(message.value.content, mcpTools);
        if (!parsedResult) return toolCalls;

        const allAgentIds = new Set(app.agentManager.agents.map(a => a.id));
        const mcpCalls = parsedResult.toolCalls.filter(call => !allAgentIds.has(call.name));

        if (mcpCalls.length > 0) {
            toolCalls.push(...mcpCalls);
            message.value.content = parsedResult.modifiedContent;
            message.cache = null;
            activeChat.log.notify();
        }
        return toolCalls;
    },

    /**
     * @param {ToolCall} call
     * @param {Message} message
     * @returns {Promise<ToolResult|null>}
     */
    async onToolCallExecute(call, message) {
        const app = mcpPluginSingleton.getApp();
        const allAgentIds = new Set(app.agentManager.agents.map(a => a.id));
        if (allAgentIds.has(call.name)) return null;
        return await mcpPluginSingleton.executeMcpCall(call, message);
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