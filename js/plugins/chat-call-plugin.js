/**
 * @fileoverview Plugin that enables agents to send messages to other chats.
 * This allows for cross-chat communication where an AI agent can write a message
 * to a different chat (as if a user typed it), trigger a response, and receive
 * the result back as a tool response.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { processToolCalls as genericProcessToolCalls } from '../tool-processor.js';
import { DEFAULT_AGENT_ID } from '../constants.js';
import { appendSystemPromptSection } from '../utils.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('./chats-plugin.js').Chat} Chat
 */

/**
 * The tool name used for chat calls.
 * @const {string}
 */
const CHAT_CALL_TOOL_NAME = 'chat_call';

/**
 * Instructions injected into the system prompt when chat calls are available.
 * @const {string}
 */
const chatCallsHeader = `### Chat Calls:

You can send messages to other chats. The message will be added to the target chat as a user message, and the AI in that chat will generate a response. You receive the response back as a tool result.

Example of calling another chat:
<dma:tool_call name="chat_call">
<parameter name="chat_id">
chat-123456789
</parameter>
<parameter name="message">
What is the status of the project?
</parameter>
</dma:tool_call>

Parameter Description:
  - \`chat_id\`: The ID of the target chat to send the message to. (type: string)(required)
  - \`message\`: The message to send to the target chat, as if a user typed it. (type: string)(required)

#### Available Chats:\n\n`;

/**
 * Implements the logic for cross-chat communication.
 * @class
 */
class ChatCallPlugin {
    /**
     * The main application instance.
     * @type {App | null}
     */
    app = null;

    /**
     * Initializes the plugin and stores a reference to the main app instance.
     * @param {App} app - The main application instance.
     */
    init(app) {
        this.app = app;
    }

    /**
     * Hooks into the system prompt construction to add information about callable chats.
     * @param {string} systemPrompt - The system prompt constructed so far.
     * @param {object} allSettings - The combined settings object for the agent.
     * @param {object} agent - The agent for which the prompt is being constructed.
     * @returns {Promise<string>} The modified system prompt.
     */
    async onSystemPromptConstruct(systemPrompt, allSettings, agent) {
        const effectiveChatCallSettings = allSettings.chatCallSettings;
        if (!effectiveChatCallSettings) {
            return systemPrompt;
        }

        const chatManager = this.app.chatManager;
        if (!chatManager) return systemPrompt;

        const allChats = chatManager.chats;
        const callableChats = effectiveChatCallSettings.allowAll
            ? allChats
            : allChats.filter(c => effectiveChatCallSettings.allowed?.includes(c.id));

        if (callableChats.length === 0) {
            return systemPrompt;
        }

        const chatsSection = callableChats.map((c, idx) => {
            return `${idx + 1}. **${c.title} (ID: ${c.id})**`;
        }).join('\n');

        return appendSystemPromptSection(systemPrompt, chatCallsHeader + chatsSection);
    }

    /**
     * Hooks into the response completion event to detect and handle chat call tool calls.
     * @param {Message | null} message - The message that has just been completed.
     * @param {Chat} activeChat - The active chat instance.
     * @returns {Promise<boolean>} True if a chat call was handled.
     */
    async onResponseComplete(message, activeChat) {
        if (!message || !message.value.content) {
            return false;
        }

        const app = this.app;
        const agentId = message.agent || DEFAULT_AGENT_ID;
        const effectiveConfig = app.agentManager.getEffectiveApiConfig(agentId);
        const chatCallSettings = effectiveConfig.chatCallSettings;
        if (!chatCallSettings) return false;
        // If no chats are allowed, skip processing entirely
        if (!chatCallSettings.allowAll && (!chatCallSettings.allowed || chatCallSettings.allowed.length === 0)) {
            return false;
        }

        // Define the chat_call tool schema for parsing
        const chatCallToolSchema = [{
            name: CHAT_CALL_TOOL_NAME,
            inputSchema: {
                properties: {
                    chat_id: { type: 'string' },
                    message: { type: 'string' },
                },
                required: ['chat_id', 'message'],
            },
        }];

        return await genericProcessToolCalls(
            app,
            activeChat,
            message,
            chatCallToolSchema,
            (call) => call.name === CHAT_CALL_TOOL_NAME,
            (call, msg) => this._executeChatCall(call, msg, chatCallSettings),
            { createPendingMessage: true }
        );
    }

    /**
     * Executes a single chat call by sending a message to the target chat
     * and waiting for the AI response.
     * @param {object} call - The tool call to execute.
     * @param {Message} message - The message containing the tool call.
     * @param {object} chatCallSettings - The effective chat call settings.
     * @returns {Promise<object>} The tool result.
     * @private
     */
    async _executeChatCall(call, message, chatCallSettings) {
        const app = this.app;
        const chatId = call.params.chat_id;
        const userMessage = call.params.message;

        if (!chatId || !userMessage) {
            return {
                name: call.name,
                tool_call_id: call.id,
                error: 'Both "chat_id" and "message" parameters are required.',
            };
        }

        // Check permissions
        const isAllowed = chatCallSettings.allowAll || chatCallSettings.allowed?.includes(chatId);
        if (!isAllowed) {
            return {
                name: call.name,
                tool_call_id: call.id,
                error: `Chat call to "${chatId}" is not permitted.`,
            };
        }

        const targetChat = app.chatManager.chats.find(c => c.id === chatId);
        if (!targetChat) {
            return {
                name: call.name,
                tool_call_id: call.id,
                error: `Chat "${chatId}" not found.`,
            };
        }

        // Add user message to target chat
        targetChat.log.addMessage({ role: 'user', content: userMessage }, {});

        // Add pending assistant message to target chat
        const agentForTargetChat = targetChat.agent || null;
        targetChat.log.addMessage(
            { role: 'assistant', content: null, agent: agentForTargetChat },
            {}
        );

        // Schedule processing for the target chat and wait for completion
        const responseContent = await this._waitForChatResponse(targetChat);

        return {
            name: call.name,
            tool_call_id: call.id,
            content: responseContent,
        };
    }

    /**
     * Schedules processing for a target chat and waits for all processing to complete.
     * Returns a promise that resolves with the last assistant's response content.
     * @param {Chat} targetChat - The target chat to process.
     * @returns {Promise<string>} The assistant's response content.
     * @private
     */
    _waitForChatResponse(targetChat) {
        return new Promise((resolve) => {
            const chatId = targetChat.id;

            // Start processing the target chat
            this.app.responseProcessor.scheduleProcessing(this.app, chatId);

            // Poll for processing completion. We can't just subscribe to log changes
            // because those fire during streaming. Instead, we check periodically
            // whether the chat's processing loop has finished.
            const checkInterval = setInterval(() => {
                if (!this.app.responseProcessor.isChatProcessing(chatId)) {
                    clearInterval(checkInterval);
                    // Processing is done - get the last assistant message
                    const messages = targetChat.log.getActiveMessages();
                    let lastAssistantContent = 'No response generated.';
                    for (let i = messages.length - 1; i >= 0; i--) {
                        if (messages[i].value.role === 'assistant' && messages[i].value.content !== null) {
                            lastAssistantContent = messages[i].value.content;
                            break;
                        }
                    }
                    resolve(lastAssistantContent);
                }
            }, 200);
        });
    }
}

/**
 * The singleton instance of the ChatCallPlugin.
 * @type {ChatCallPlugin}
 */
const chatCallPluginInstance = new ChatCallPlugin();

/**
 * Registers the Chat Call Plugin with the application's plugin manager.
 */
pluginManager.register({
    name: 'Chat Call Plugin',
    onAppInit: (app) => chatCallPluginInstance.init(app),
    onSystemPromptConstruct: (systemPrompt, allSettings, agent) => chatCallPluginInstance.onSystemPromptConstruct(systemPrompt, allSettings, agent),
    onResponseComplete: (message, activeChat) => chatCallPluginInstance.onResponseComplete(message, activeChat),
});
