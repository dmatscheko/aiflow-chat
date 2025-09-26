/**
 * @fileoverview Plugin to manage the turn-taking logic in the chat.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { parseToolCalls } from '../tool-processor.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../plugins/chats-plugin.js').Chat} Chat
 */

class TurnManagerPlugin {
    /** @type {App} */
    app = null;

    /** @param {App} app */
    init(app) {
        this.app = app;
    }

    /**
     * This hook is the central point for deciding what happens after an assistant's response or a tool's result.
     * It's triggered on idle, allowing it to assess the complete state of the chat.
     * @param {Message | null} message - The message that was just processed. Can be null on idle checks.
     * @param {Chat} activeChat - The active chat instance.
     * @returns {Promise<boolean>} - True if an action was taken, false otherwise.
     */
    async onResponseComplete(message, activeChat) {
        // This logic should only run when the system is idle (message is null),
        // ensuring all previous actions (like tool calls) for a turn are complete.
        if (message !== null) {
            return false;
        }

        // If there's already a pending message, don't do anything.
        if (activeChat.log.findNextPendingMessage()) {
            return false;
        }

        const lastMessage = activeChat.log.getLastMessage();
        if (!lastMessage) return false;

        // Case 1: The last message was an assistant with tool calls.
        // The other plugins have run, added 'tool' messages, but haven't queued a new turn.
        // Now it's our turn to queue the next assistant response.
        if (lastMessage.value.role === 'tool') {
            // Find the assistant message that generated these tool calls.
            const history = activeChat.log.getActiveMessages();
            let parentAssistantMsg = null;
            for (let i = history.length - 2; i >= 0; i--) {
                if (history[i].value.role === 'assistant') {
                    parentAssistantMsg = history[i];
                    break;
                }
            }

            if (parentAssistantMsg) {
                const agentId = parentAssistantMsg.value.agent || 'agent-default';
                activeChat.log.addMessage({ role: 'assistant', content: null, agent: agentId });
                this.app.responseProcessor.scheduleProcessing(this.app);
                return true; // Action taken
            }
        }

        // Case 2: The last message was an assistant, but it contained no tool calls.
        // This could be the end of a sub-agent's turn.
        if (lastMessage.value.role === 'assistant' && lastMessage.value.content) {
            const { toolCalls } = parseToolCalls(lastMessage.value.content);
            if (toolCalls.length > 0) {
                // This case should be handled by the tool plugins first.
                // By the time we get an idle check, the tool results should have been added.
                return false;
            }

            // --- Agent Stack Logic ---
            const agentStack = activeChat.agentStack || [];
            if (agentStack.length > 0) {
                const currentTurn = agentStack[agentStack.length - 1];

                // Check if the message comes from the agent at the top of the stack.
                if (lastMessage.value.agent === currentTurn.agentId) {
                    agentStack.pop(); // The sub-agent's turn is over.

                    // The sub-agent's final response becomes a tool_response for the calling agent.
                    const toolResponse = {
                        role: 'tool',
                        content: `<dma:tool_response name="${currentTurn.agentId}" tool_call_id="${currentTurn.toolCallId}">\n<content>\n${lastMessage.value.content}\n</content>\n</dma:tool_response>\n`,
                        name: currentTurn.agentId,
                        tool_call_id: currentTurn.toolCallId,
                    };

                    // We add the tool response and then immediately queue the calling agent's turn.
                    activeChat.log.addMessage(toolResponse);

                    // A new pending message for the calling agent will be added in the next idle loop by Case 1.
                    this.app.responseProcessor.scheduleProcessing(this.app);
                    return true; // We took an action.
                }
            }
        }

        // If we reach here, no action is needed. The conversation is either complete or waiting for user input.
        return false;
    }
}

const turnManagerPluginInstance = new TurnManagerPlugin();

pluginManager.register({
    name: 'Turn Manager Plugin',
    onAppInit: (app) => turnManagerPluginInstance.init(app),
    onResponseComplete: (message, activeChat) => turnManagerPluginInstance.onResponseComplete(message, activeChat),
});