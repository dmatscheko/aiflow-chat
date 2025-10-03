/**
 * @fileoverview Plugin for MCP (Model Context Protocol) integration.
 * This plugin acts as a tool executor for standard MCP tools.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { toolCallManager } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../tool-processor.js').ToolCall} ToolCall
 * @typedef {import('../tool-processor.js').ToolCallJob} ToolCallJob
 * @typedef {import('../tool-processor.js').ToolSchema} ToolSchema
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
 */
class McpPlugin {
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

    /**
     * @param {App} app
     */
    init(app) {
        this.#app = app;
        toolCallManager.registerExecutor('mcp-executor', {
            canExecute: (call) => this.canExecute(call),
            execute: (call, job) => this.execute(call, job),
        });
    }

    /**
     * Checks if this executor can handle the given tool call.
     * It handles any call that is not an agent-to-agent call.
     * @param {ToolCall} call
     * @returns {boolean}
     */
    canExecute(call) {
        if (!this.#app || !this.#app.agentManager) return false;
        const agentIds = new Set(this.#app.agentManager.agents.map(a => a.id));
        return !agentIds.has(call.name);
    }

    /**
     * Executes an MCP tool call.
     * @param {ToolCall} call
     * @param {ToolCallJob} job
     */
    async execute(call, job) {
        const agentId = job.callingAgentId;
        const effectiveConfig = this.#app.agentManager.getEffectiveApiConfig(agentId);
        const mcpUrl = effectiveConfig.toolSettings?.mcpServer;

        if (!mcpUrl) {
            return toolCallManager.notifyCallComplete(job.id, {
                tool_call_id: call.tool_call_id, name: call.name, error: 'No MCP server URL is configured.', content: null
            });
        }

        const agent = agentId ? this.#app.agentManager.getAgent(agentId) : null;
        const defaultAgent = this.#app.agentManager.getAgent('agent-default');
        let effectiveToolSettings = defaultAgent.toolSettings;
        if (agent?.useCustomToolSettings) {
            effectiveToolSettings = agent.toolSettings;
        }

        const isAllowed = effectiveToolSettings.allowAll || effectiveToolSettings.allowed?.includes(call.name);
        if (!isAllowed) {
            return toolCallManager.notifyCallComplete(job.id, {
                tool_call_id: call.tool_call_id, name: call.name, error: `Tool "${call.name}" is not enabled for the agent.`, content: null
            });
        }

        try {
            const result = await this.#mcpJsonRpc(mcpUrl, 'tools/call', { name: call.name, arguments: call.params });
            if (result.isError) {
                return toolCallManager.notifyCallComplete(job.id, {
                    tool_call_id: call.tool_call_id, name: call.name, error: JSON.stringify(result.content), content: null
                });
            }

            if (call.name === 'web_search' || call.name === 'browse_page' || call.name.startsWith('x_')) {
                if (!job.originalMessage.metadata) job.originalMessage.metadata = {};
                job.originalMessage.metadata.sources = result.sources || [];
            }

            toolCallManager.notifyCallComplete(job.id, {
                tool_call_id: call.tool_call_id, name: call.name, content: JSON.stringify(result.content, null, 2), error: null
            });

        } catch (err) {
            console.error('MCP: Tool execution error', err);
            toolCallManager.notifyCallComplete(job.id, {
                tool_call_id: call.tool_call_id, name: call.name, error: err.message || 'Unknown error', content: null
            });
        }
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
                    let result = null;
                    const lines = rawText.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const partial = JSON.parse(line.slice(6));
                                if (partial.jsonrpc) result = partial.result;
                            } catch (e) {
                                console.warn("MCP: Could not parse event-stream data chunk.", line.slice(6));
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
            if (!sessionId) throw new Error('No session ID in initialize response');
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
            console.error('MCP: JSON-RPC failure', error);
            if (error.message.includes('session') && !retry) {
                this.#sessionCache.delete(url);
                this.#initPromises.delete(url);
                return this.#mcpJsonRpc(url, method, params, true);
            }
            throw new AggregateError([error], `Failed MCP call to ${url}.`);
        }
    }

    async getTools(url, force = false) {
        if (force) {
            this.#toolCache.delete(url);
            this.#initPromises.delete(url);
        }
        if (this.#toolCache.has(url)) return this.#toolCache.get(url);
        if (!url) {
            this.#toolCache.set(url, []);
            return [];
        }
        try {
            const response = await this.#mcpJsonRpc(url, 'tools/list');
            const tools = Array.isArray(response?.tools) ? response.tools : [];
            this.#toolCache.set(url, tools);
            document.body.dispatchEvent(new CustomEvent('mcp-tools-updated', { detail: { url } }));
            return tools;
        } catch (error) {
            console.error(`MCP: Failed to fetch tools for ${url}`, error);
            alert(`Failed to connect to MCP server at ${url}.\n\n${error.message}`);
            this.#toolCache.set(url, []);
            return [];
        }
    }

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
        if (!allowedTools || allowedTools.length === 0) return '';
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
}

const mcpPluginSingleton = new McpPlugin();

const mcpPluginDefinition = {
    name: 'MCP',

    onAppInit(app) {
        mcpPluginSingleton.init(app);
        app.mcp = {
            getTools: mcpPluginSingleton.getTools.bind(mcpPluginSingleton)
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