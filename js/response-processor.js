/**
 * @fileoverview Manages the queue and execution of AI response generation.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';
import { parseToolCalls } from './tool-processor.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./main.js').Chat} Chat
 * @typedef {import('./chat-data.js').Message} Message
 * @typedef {import('./tool-processor.js').ToolCall} ToolCall
 */

/**
 * Manages the queue and execution of AI response generation.
 * It scans for pending messages, processes them, and then allows plugins
 * to handle the completed response, potentially creating more work. This cycle
 * continues until no more work is pending and no plugin takes further action.
 * @class
 */
class ResponseProcessor {
    constructor() {
        /** @type {boolean} */
        this.isProcessing = false;
        /** @type {App | null} */
        this.app = null;
    }

    /**
     * Schedules a processing check. If not already processing, it starts the loop.
     * @param {App} app - The main application instance.
     */
    scheduleProcessing(app) {
        this.app = app;
        if (!this.isProcessing) {
            this.processLoop();
        }
    }

    /**
     * Finds the next pending message across all chats.
     * @returns {{chat: Chat, message: Message} | null}
     * @private
     */
    _findNextPendingMessage() {
        if (!this.app) return null;
        for (const chat of this.app.chatManager.chats) {
            const pendingMessage = chat.log.findNextPendingMessage();
            if (pendingMessage) {
                return { chat, message: pendingMessage };
            }
        }
        return null;
    }

    /**
     * The main processing loop.
     * @private
     */
    async processLoop() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            while (true) {
                let actionTaken = false;
                const activeChat = this.app.chatManager.getActiveChat();
                if (!activeChat) break;

                // 1. Handle pending AI message generation
                const workItem = this._findNextPendingMessage();
                if (workItem) {
                    await this.processMessage(workItem.chat, workItem.message);
                    actionTaken = true;
                    // After generating content, immediately check for tool calls in the new message
                    // and continue the loop to process them.
                    continue;
                }

                // 2. Handle completed assistant message (check for tool calls, agent returns)
                const lastMessage = activeChat.log.getLastMessage();
                if (lastMessage?.value.role === 'assistant' && lastMessage.value.content) {
                    const handled = await this.handleCompletedAssistantTurn(activeChat, lastMessage);
                    if (handled) {
                        actionTaken = true;
                        continue; // Loop again as a new turn might have been queued
                    }
                }

                // 3. Handle returning from a sub-agent call
                if (activeChat.callStack.length > 0) {
                    const lastMessage = activeChat.log.getLastMessage();
                    // Check if the last message is a tool response or a final assistant message from the sub-agent
                    if (lastMessage && (lastMessage.value.role === 'tool' || (lastMessage.value.role === 'assistant' && lastMessage.value.content))) {
                        const handled = await this.handleAgentReturn(activeChat);
                        if (handled) {
                            actionTaken = true;
                            continue;
                        }
                    }
                }

                // 4. Handle idle state (e.g., for flows plugin)
                if (!actionTaken) {
                    const idleAction = await pluginManager.triggerSequentially('onResponseComplete', null, activeChat);
                    if (idleAction) {
                        actionTaken = true;
                        continue;
                    }
                }

                // If no actions were taken in a full pass, exit the loop.
                if (!actionTaken) {
                    break;
                }
            }
        } catch (error) {
            console.error('Error in processing loop:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Handles a completed assistant turn by checking for and executing tool/agent calls.
     * @param {Chat} chat
     * @param {Message} assistantMsg
     * @returns {Promise<boolean>} True if an action was taken.
     */
    async handleCompletedAssistantTurn(chat, assistantMsg) {
        const { toolCalls } = parseToolCalls(assistantMsg.value.content);
        if (toolCalls.length === 0) return false;

        // Separate agent calls from regular tool calls
        const agentManager = this.app.agentManager;
        const allAgentIds = new Set(agentManager.agents.map(a => a.id));
        const agentCalls = toolCalls.filter(call => allAgentIds.has(call.name));
        const standardToolCalls = toolCalls.filter(call => !allAgentIds.has(call.name));

        // Prioritize agent calls. For now, we'll handle the first one if it exists.
        // A more advanced implementation could handle multiple agent calls.
        if (agentCalls.length > 0) {
            const call = agentCalls[0];
            const callingAgentId = assistantMsg.value.agent || 'agent-default';
            const targetAgentId = call.name;

            // Push state to the call stack
            chat.callStack.push({
                returnToAgentId: callingAgentId,
                originalMessageId: assistantMsg.id,
                toolCallId: call.id,
            });

            // Add a tool message representing the sub-agent's response
            const prompt = call.params.prompt || '';
            chat.log.addMessage({ role: 'user', content: prompt, agent: targetAgentId });
            chat.log.addMessage({ role: 'assistant', content: null, agent: targetAgentId });
            this.scheduleProcessing(this.app);
            return true;
        }

        // If no agent calls, process standard tool calls
        if (standardToolCalls.length > 0) {
            const results = await pluginManager.triggerSequentiallyAsync('onToolCall', standardToolCalls, assistantMsg, chat);
            const toolResults = results.flat().filter(Boolean);

            if (toolResults.length > 0) {
                let toolContents = '';
                toolResults.forEach((tr) => {
                    const inner = tr.error ? `<error>\n${tr.error}\n</error>` : `<content>\n${tr.content}\n</content>`;
                    toolContents += `<dma:tool_response name="${tr.name}" tool_call_id="${tr.tool_call_id}">\n${inner}\n</dma:tool_response>\n`;
                });
                chat.log.addMessage({ role: 'tool', content: toolContents });
                chat.log.addMessage({ role: 'assistant', content: null, agent: assistantMsg.value.agent });
                this.scheduleProcessing(this.app);
                return true;
            }
        }

        return false;
    }

    /**
     * Handles the return from a sub-agent call.
     * @param {Chat} chat
     * @returns {Promise<boolean>} True if an action was taken.
     */
    async handleAgentReturn(chat) {
        const lastMessage = chat.log.getLastMessage();
        const returnInfo = chat.callStack.pop();

        if (!returnInfo || !lastMessage) return false;

        // The content for the tool_response is the final output from the sub-agent.
        const result_content = lastMessage.value.content;

        const toolResponse = {
            role: 'tool',
            content: `<dma:tool_response name="${lastMessage.value.agent}" tool_call_id="${returnInfo.toolCallId}">\n<content>\n${result_content}\n</content>\n</dma:tool_response>\n`,
        };
        chat.log.addMessage(toolResponse);

        // Queue up the next turn for the original calling agent.
        chat.log.addMessage({ role: 'assistant', content: null, agent: returnInfo.returnToAgentId });
        this.scheduleProcessing(this.app);
        return true;
    }

    /**
     * Processes a single pending assistant message by making an API call.
     * @param {Chat} chat
     * @param {Message} assistantMsg
     * @private
     */
    async processMessage(chat, assistantMsg) {
        const app = this.app;
        if (!app || assistantMsg.value.role !== 'assistant' || assistantMsg.value.content !== null) return;

        app.dom.stopButton.style.display = 'block';
        app.abortController = new AbortController();

        try {
            const messages = chat.log.getHistoryBeforeMessage(assistantMsg);
            if (!messages) {
                assistantMsg.value.content = "Error: Could not reconstruct message history.";
                chat.log.notify();
                return;
            }

            const agentId = assistantMsg.value.agent || (chat.callStack.length > 0 ? chat.callStack[chat.callStack.length - 1].returnToAgentId : 'agent-default');
            const agent = agentId ? app.agentManager.getAgent(agentId) : null;
            const effectiveConfig = app.agentManager.getEffectiveApiConfig(agentId);
            const finalSystemPrompt = await pluginManager.triggerAsync('onSystemPromptConstruct', effectiveConfig.systemPrompt, effectiveConfig, agent);

            if (finalSystemPrompt) {
                messages.unshift({ role: 'system', content: finalSystemPrompt });
            }

            const payload = {
                model: effectiveConfig.model,
                messages: messages,
                stream: true,
                temperature: parseFloat(effectiveConfig.temperature),
                top_p: effectiveConfig.top_p ? parseFloat(effectiveConfig.top_p) : undefined,
            };

            assistantMsg.value.model = payload.model;
            assistantMsg.value.content = ''; // Start filling content
            chat.log.notify();

            const reader = await app.apiService.streamChat(payload, effectiveConfig.apiUrl, effectiveConfig.apiKey, app.abortController.signal);
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                const deltas = lines
                    .map(line => line.replace(/^data: /, '').trim())
                    .filter(line => line !== '' && line !== '[DONE]')
                    .map(line => {
                        try {
                            return JSON.parse(line);
                        } catch (e) { return null; }
                    })
                    .filter(Boolean)
                    .map(json => json.choices[0].delta.content)
                    .filter(Boolean);

                if (deltas.length > 0) {
                    assistantMsg.value.content += deltas.join('');
                    chat.log.notify();
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                assistantMsg.value.content = `Error: ${error.message}`;
            } else {
                assistantMsg.value.content += '\n\n[Aborted by user]';
            }
        } finally {
            app.abortController = null;
            app.dom.stopButton.style.display = 'none';
            chat.log.notify();
            if (chat.title === 'New Chat' && !chat.log.getLastMessage()?.value.content?.includes('Aborted')) {
                const firstUserMessage = chat.log.getActiveMessageValues().find(m => m.role === 'user');
                if (firstUserMessage) {
                    chat.title = firstUserMessage.content.substring(0, 20) + '...';
                    this.app.chatManager.saveChats();
                    if (this.app.activeView.id === chat.id) this.app.renderMainView();
                }
            }
            this.app.chatManager.renderChatList();
            // Instead of breaking the loop, we schedule another processing cycle
            // to handle the newly generated content (e.g., for tool calls).
            this.scheduleProcessing(this.app);
        }
    }
}

export const responseProcessor = new ResponseProcessor();
