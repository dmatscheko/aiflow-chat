/**
 * @fileoverview Definitions for all flow step types.
 */

'use strict';

import { findLastMessageWithAlternatives, extractContentFromTurn, findLastAnswerChain } from './flow-helpers.js';

// This function will be called by the flows-plugin to generate the dropdown.
const getAgentsDropdown = (step, agents, a) => {
    const agentOptions = agents.map(agent =>
        `<option value="${agent.id}" ${step.agentId === agent.id ? 'selected' : ''}>${agent.name}</option>`
    ).join('');

    return `
        <label>Agent:</label>
        <select class="flow-step-agent flow-step-input" data-id="${step.id}" data-key="agentId">
            <option value="">Default AI</option>
            ${agentOptions}
        </select>`;
};


export const stepTypes = {
    'simple-prompt': {
        label: 'Simple Prompt',
        getDefaults: () => ({
            agentId: '',
            prompt: '',
        }),
        render: (step, agents) => `
            <h4>Simple Prompt</h4>
            <div class="flow-step-content">
                ${getAgentsDropdown(step, agents)}
                <label>Prompt:</label>
                <textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.prompt || ''}</textarea>
            </div>
        `,
        onUpdate: (step, target) => {
            const key = target.dataset.key;
            if (key === 'agentId') step.agentId = target.value;
            else if (key === 'prompt') step.prompt = target.value;
        },
        execute: (step, context) => {
            const chat = context.app.getActiveChat();
            if (!chat) {
                context.stopFlow('Error: No active chat found.');
                return;
            }
            chat.activeAgentId = step.agentId || null;
            context.app.submitMessage(step.prompt);
        },
    },
    'multi-prompt': {
        label: 'Multi Prompt',
        getDefaults: () => ({
            agentId: '',
            prompt: '',
            count: 2,
        }),
        render: (step, agents) => `
            <h4>Multi Prompt</h4>
            <div class="flow-step-content">
                ${getAgentsDropdown(step, agents)}
                <label>Prompt:</label>
                <textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.prompt || ''}</textarea>
                <label>Number of alternatives:</label>
                <input type="number" class="flow-step-count flow-step-input" data-id="${step.id}" data-key="count" value="${step.count || 1}" min="1" max="10">
            </div>
        `,
        onUpdate: (step, target) => {
            const key = target.dataset.key;
            if (key === 'agentId') step.agentId = target.value;
            else if (key === 'prompt') step.prompt = target.value;
            else if (key === 'count') step.count = parseInt(target.value, 10);
        },
        execute: async (step, context) => {
            const chat = context.app.getActiveChat();
            if (!chat) {
                context.stopFlow('Error: No active chat found.');
                return;
            }
            chat.activeAgentId = step.agentId || null;

            context.plugin.multiMessageInfo.active = true;
            context.plugin.multiMessageInfo.step = step;
            context.plugin.multiMessageInfo.counter = 0; // Will be incremented to 1 in onResponseComplete

            const userMessage = await context.app.submitMessage(step.prompt);
            context.plugin.multiMessageInfo.userMessage = userMessage;
        },
    },
    'consolidator': {
        label: 'Alt. Consolidator',
        getDefaults: () => ({
            agentId: '',
            prePrompt: 'Please choose the best of the following answers:',
            postPrompt: 'Explain your choice.',
            onlyLastAnswer: false,
        }),
        render: (step, agents) => `
            <h4>Alternatives Consolidator</h4>
            <div class="flow-step-content">
                ${getAgentsDropdown(step, agents)}
                <label>Text before alternatives:</label>
                <textarea class="flow-step-pre-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="prePrompt">${step.prePrompt || ''}</textarea>
                <label>Text after alternatives:</label>
                <textarea class="flow-step-post-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="postPrompt">${step.postPrompt || ''}</textarea>
                <label class="flow-step-checkbox-label">
                    <input type="checkbox" class="flow-step-only-last-answer flow-step-input" data-id="${step.id}" data-key="onlyLastAnswer" ${step.onlyLastAnswer ? 'checked' : ''}>
                    Only include each last answer
                </label>
            </div>
        `,
        onUpdate: (step, target) => {
            const key = target.dataset.key;
            if (key === 'agentId') step.agentId = target.value;
            else if (key === 'prePrompt') step.prePrompt = target.value;
            else if (key === 'postPrompt') step.postPrompt = target.value;
            else if (key === 'onlyLastAnswer') step.onlyLastAnswer = target.checked;
        },
        execute: (step, context) => {
            const chatLog = context.app.getActiveChat()?.log;
            if (!chatLog) {
                context.stopFlow('Error: No active chat found.');
                return;
            }

            const sourceMessage = findLastMessageWithAlternatives(chatLog);

            if (!sourceMessage) {
                context.stopFlow('Error: Consolidator could not find a preceding step with alternatives.');
                return;
            }

            const consolidatedContent = sourceMessage.answerAlternatives.messages.map((alternativeStartMessage, i) => {
                const { content: turnContent } = extractContentFromTurn(alternativeStartMessage, step.onlyLastAnswer);
                return `--- ALTERNATIVE ${i + 1} ---\n${turnContent}`;
            }).join('\n\n');

            const finalPrompt = `${step.prePrompt || ''}\n\n${consolidatedContent}\n\n${step.postPrompt || ''}`;

            const chat = context.app.getActiveChat();
            chat.activeAgentId = step.agentId || null;
            context.app.submitMessage(finalPrompt);
        },
    },
    'echo-answer': {
        label: 'Echo Answer',
        getDefaults: () => ({
            agentId: '',
            prePrompt: 'Is this idea and code correct? Be concise.\n\n\n',
            postPrompt: '',
            deleteAIAnswer: true,
            deleteUserMessage: true,
            onlyLastAnswer: false,
        }),
        render: (step, agents) => `
            <h4>Echo Answer</h4>
            <div class="flow-step-content">
                ${getAgentsDropdown(step, agents)}
                <label>Text before AI answer:</label>
                <textarea class="flow-step-pre-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="prePrompt">${step.prePrompt || ''}</textarea>
                <label>Text after AI answer:</label>
                <textarea class="flow-step-post-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="postPrompt">${step.postPrompt || ''}</textarea>
                <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-delete-ai flow-step-input" data-id="${step.id}" data-key="deleteAIAnswer" ${step.deleteAIAnswer ? 'checked' : ''}> Delete original AI answer</label>
                <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-delete-user flow-step-input" data-id="${step.id}" data-key="deleteUserMessage" ${step.deleteUserMessage ? 'checked' : ''}> Delete original user message</label>
                <label class="flow-step-checkbox-label">
                    <input type="checkbox" class="flow-step-only-last-answer flow-step-input" data-id="${step.id}" data-key="onlyLastAnswer" ${step.onlyLastAnswer ? 'checked' : ''}>
                    Only include last answer
                </label>
            </div>
        `,
        onUpdate: (step, target) => {
            const key = target.dataset.key;
            if (key === 'agentId') step.agentId = target.value;
            else if (key === 'prePrompt') step.prePrompt = target.value;
            else if (key === 'postPrompt') step.postPrompt = target.value;
            else if (key === 'deleteAIAnswer') step.deleteAIAnswer = target.checked;
            else if (key === 'deleteUserMessage') step.deleteUserMessage = target.checked;
            else if (key === 'onlyLastAnswer') step.onlyLastAnswer = target.checked;
        },
        execute: (step, context) => {
            const chatLog = context.app.getActiveChat()?.log;
            if (!chatLog) {
                context.stopFlow('Error: No active chat found.');
                return;
            }

            const { startMessage, userMessageIndex } = findLastAnswerChain(chatLog);

            if (!startMessage) {
                context.stopFlow('Error: Echo Answer could not find an AI answer to process.');
                return;
            }

            const { content: fullAnswerText } = extractContentFromTurn(startMessage, step.onlyLastAnswer);

            const newPrompt = `${step.prePrompt || ''}\n\n${fullAnswerText}\n\n${step.postPrompt || ''}`;

            if (step.deleteAIAnswer) {
                const startIndex = step.deleteUserMessage ? userMessageIndex : userMessageIndex + 1;
                chatLog.truncateActivePath(startIndex);
            }

            const chat = context.app.getActiveChat();
            chat.activeAgentId = step.agentId || null;
            context.app.submitMessage(newPrompt);
        },
    },
    'clear-history': {
        label: 'Clear History',
        getDefaults: () => ({
            clearFrom: 2,
            clearTo: 1,
            clearToBeginning: true,
        }),
        render: (step, agents) => `
            <h4>Clear History</h4>
            <div class="flow-step-content">
                <label>From answer #:</label>
                <input type="number" class="flow-step-clear-from flow-step-input" data-id="${step.id}" data-key="clearFrom" value="${step.clearFrom || 1}" min="1">
                <div class="clear-history-to-container" style="${step.clearToBeginning ? 'display: none;' : ''}">
                    <label>To answer #:</label>
                    <input type="number" class="flow-step-clear-to flow-step-input" data-id="${step.id}" data-key="clearTo" value="${step.clearTo || 1}" min="1">
                </div>
                <label class="flow-step-checkbox-label">
                    <input type="checkbox" class="flow-step-clear-beginning flow-step-input" data-id="${step.id}" data-key="clearToBeginning" ${step.clearToBeginning ? 'checked' : ''}>
                    Clear to beginning
                </label>
                <small>(1 is the last answer)<br><br></small>
            </div>
        `,
        onUpdate: (step, target, renderFlow, store) => {
            const key = target.dataset.key;
            if (key === 'clearFrom') step.clearFrom = parseInt(target.value, 10);
            else if (key === 'clearTo') step.clearTo = parseInt(target.value, 10);
            else if (key === 'clearToBeginning') {
                step.clearToBeginning = target.checked;
                // In the new arch, the plugin will re-render itself.
                // This might require a callback to the plugin's render function.
            }
        },
        execute: (step, context) => {
            const chatLog = context.app.getActiveChat()?.log;
            if (!chatLog) {
                context.stopFlow('Error: No active chat found.');
                return;
            }

            const messages = chatLog.getActiveMessageValues();
            const userMessageIndices = messages
                .map((msg, i) => msg.role === 'user' ? i : -1)
                .filter(i => i !== -1);

            const clearFrom = step.clearFrom || 1;
            const clearTo = step.clearToBeginning ? userMessageIndices.length : (step.clearTo || 1);

            const fromIndex = userMessageIndices.length - clearTo;
            const toIndex = userMessageIndices.length - clearFrom;

            if (fromIndex < 0 || toIndex < 0 || fromIndex > toIndex) {
                context.stopFlow('Error: Invalid range for Clear History.');
                return;
            }

            // The index for truncation is the index of the first user message to be cleared.
            const startIndex = userMessageIndices[fromIndex];

            chatLog.truncateActivePath(startIndex);

            const nextStep = context.getNextStep(step.id);
            if (nextStep) {
                context.executeStep(nextStep);
            } else {
                context.stopFlow('Flow complete.');
            }
        },
    },
    'branching-prompt': {
        label: 'Branching Prompt',
        getDefaults: () => ({
            conditionType: 'contains',
            condition: '',
        }),
        render: (step, agents) => `
            <h4>Branching Prompt</h4>
            <div class="flow-step-content">
                <label>Last Response Condition:</label>
                <select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType">
                    <option value="contains" ${step.conditionType === 'contains' ? 'selected' : ''}>Contains String</option>
                    <option value="matches" ${step.conditionType === 'matches' ? 'selected' : ''}>Matches String</option>
                    <option value="regex" ${step.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option>
                </select>
                <textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.condition || ''}</textarea>
            </div>
        `,
        onUpdate: (step, target) => {
            const key = target.dataset.key;
            if (key === 'conditionType') step.conditionType = target.value;
            else if (key === 'condition') step.condition = target.value;
        },
        execute: (step, context) => {
            const lastMessage = context.app.getActiveChat()?.log?.getLastMessage();
            if (!lastMessage || !lastMessage.value.content) {
                context.stopFlow('Error: Could not find a message to branch from.');
                return;
            }

            const content = lastMessage.value.content;
            let isMatch = false;
            try {
                switch (step.conditionType) {
                    case 'regex':
                        isMatch = new RegExp(step.condition).test(content);
                        break;
                    case 'matches':
                        isMatch = (content === step.condition);
                        break;
                    case 'contains':
                    default:
                        isMatch = content.includes(step.condition);
                        break;
                }
            } catch (e) {
                context.stopFlow(`Error in branching condition: ${e.message}`);
                return;
            }

            const outputName = isMatch ? 'pass' : 'fail';
            const nextStep = context.getNextStep(step.id, outputName);
            if (nextStep) {
                context.executeStep(nextStep);
            } else {
                context.stopFlow('Flow complete.');
            }
        },
    },
    'conditional-stop': {
        label: 'Conditional Stop',
        getDefaults: () => ({
            conditionType: 'contains',
            condition: '',
            onMatch: 'stop',
        }),
        render: (step, agents) => `
            <h4>Conditional Stop</h4>
            <div class="flow-step-content">
                <label>Last Response Condition:</label>
                <select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType">
                    <option value="contains" ${step.conditionType === 'contains' ? 'selected' : ''}>Contains String</option>
                    <option value="matches" ${step.conditionType === 'matches' ? 'selected' : ''}>Matches String</option>
                    <option value="regex" ${step.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option>
                </select>
                <textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.condition || ''}</textarea>
                <label>On Match:</label>
                <select class="flow-step-on-match flow-step-input" data-id="${step.id}" data-key="onMatch">
                    <option value="stop" ${step.onMatch === 'stop' ? 'selected' : ''}>Stop flow</option>
                    <option value="continue" ${step.onMatch === 'continue' ? 'selected' : ''}>Must match to continue</option>
                </select>
            </div>
        `,
        onUpdate: (step, target) => {
            const key = target.dataset.key;
            if (key === 'conditionType') step.conditionType = target.value;
            else if (key === 'condition') step.condition = target.value;
            else if (key === 'onMatch') step.onMatch = target.value;
        },
        execute: (step, context) => {
            const lastMessage = context.app.getActiveChat()?.log?.getLastMessage();
            if (!lastMessage || !lastMessage.value.content) {
                context.stopFlow('Error: Could not find a message to check.');
                return;
            }

            const content = lastMessage.value.content;
            let isMatch = false;
            try {
                switch (step.conditionType) {
                    case 'regex':
                        isMatch = new RegExp(step.condition).test(content);
                        break;
                    case 'matches':
                        isMatch = (content === step.condition);
                        break;
                    case 'contains':
                    default:
                        isMatch = content.includes(step.condition);
                        break;
                }
            } catch (e) {
                context.stopFlow(`Error in conditional stop: ${e.message}`);
                return;
            }

            let shouldContinue = true;
            if (isMatch) {
                if (step.onMatch === 'stop') {
                    context.stopFlow('Flow stopped by conditional match.');
                    shouldContinue = false;
                }
            } else { // Not a match
                if (step.onMatch === 'continue') {
                    context.stopFlow('Flow stopped: condition not met.');
                    shouldContinue = false;
                }
            }

            if (shouldContinue) {
                const nextStep = context.getNextStep(step.id);
                if (nextStep) {
                    context.executeStep(nextStep);
                } else {
                    context.stopFlow('Flow complete.');
                }
            }
        },
    }
};
