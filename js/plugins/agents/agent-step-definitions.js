/**
 * @fileoverview Definitions for all agent flow step types.
 */

'use strict';

import { extractContentFromTurn, findLastMessageWithAlternatives, findLastAnswerChain } from './flow-helpers.js';

const stepTypes = {};

/**
 * Defines a new step type for the agent flow editor.
 * @param {string} type - The unique identifier for the step type.
 * @param {object} definition - The definition of the step type.
 * @param {string} definition.label - The user-friendly name for the step.
 * @param {function(): object} definition.getDefaults - A function that returns the default data for a new step.
 * @param {function(object, object): string} definition.render - A function that returns the HTML content for the step's card.
 * @param {function(object, HTMLElement)} definition.onUpdate - A function that handles updates when a UI element changes.
 * @param {function(object, object)} definition.execute - A function that executes the step's logic.
 */
function defineStep(type, definition) {
    if (stepTypes[type]) {
        console.warn(`Step type "${type}" is already defined. Overwriting.`);
    }
    stepTypes[type] = {
        ...definition,
        type: type,
    };
}

export { defineStep, stepTypes };

// --- Step Type Definitions ---

defineStep('simple-prompt', {
    label: 'Simple Prompt',

    getDefaults: () => ({
        agentId: '',
        prompt: '',
    }),

    render: (step, agentOptions) => `
        <h4>Simple Prompt</h4>
        <div class="flow-step-content">
            <label>Agent:</label>
            <select class="flow-step-agent flow-step-input" data-id="${step.id}" data-key="agentId">
                <option value="">Select Agent</option>
                ${agentOptions}
            </select>
            <label>Prompt:</label>
            <textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.prompt || ''}</textarea>
        </div>
    `,

    onUpdate: (step, target) => {
        const key = target.dataset.key;
        if (key === 'agentId') {
            step.agentId = target.value;
        } else if (key === 'prompt') {
            step.prompt = target.value;
        }
    },

    execute: (step, context) => {
        const { app, store, triggerError, stopFlow } = context;
        if (!step.agentId || !step.prompt) {
            triggerError(`Agent step is not fully configured.`);
            return stopFlow('Step not configured.');
        }
        const chat = store.get('currentChat');
        chat.activeAgentId = step.agentId;
        store.set('currentChat', { ...chat });
        app.submitUserMessage(step.prompt, 'user');
    },
});

defineStep('multi-prompt', {
    label: 'Multi Prompt',

    getDefaults: () => ({
        agentId: '',
        prompt: '',
        count: 2,
    }),

    render: (step, agentOptions) => `
        <h4>Multi Prompt</h4>
        <div class="flow-step-content">
            <label>Agent:</label>
            <select class="flow-step-agent flow-step-input" data-id="${step.id}" data-key="agentId">
                <option value="">Select Agent</option>
                ${agentOptions}
            </select>
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

    execute: (step, context) => {
        const { app, store, triggerError, stopFlow, multiMessageInfo } = context;
        if (!step.agentId || !step.prompt) {
            triggerError(`Multi-Message step is not fully configured.`);
            return stopFlow('Step not configured.');
        }
        multiMessageInfo.active = true;
        multiMessageInfo.step = step;
        multiMessageInfo.counter = 1;
        const chat = store.get('currentChat');
        chat.activeAgentId = step.agentId;
        store.set('currentChat', { ...chat });

        const chatlog = app.ui.chatBox.chatlog;
        chatlog.addMessage({ role: 'user', content: step.prompt });
        const assistantMessageToBranchFrom = chatlog.addMessage(null);
        multiMessageInfo.messageToBranchFrom = assistantMessageToBranchFrom;

        app.generateAIResponse({}, chatlog);
    },
});


defineStep('consolidator', {
    label: 'Alt. Consolidator',

    getDefaults: () => ({
        agentId: '',
        prePrompt: 'Please choose the best of the following answers:',
        postPrompt: 'Explain your choice.',
        onlyLastAnswer: false,
    }),

    render: (step, agentOptions) => `
        <h4>Alternatives Consolidator</h4>
        <div class="flow-step-content">
            <label>Agent:</label>
            <select class="flow-step-agent flow-step-input" data-id="${step.id}" data-key="agentId">
                <option value="">Select Agent</option>
                ${agentOptions}
            </select>
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
        const { app, store, triggerError, stopFlow } = context;
        const chatlog = app.ui.chatBox.chatlog;
        const sourceMessage = findLastMessageWithAlternatives(chatlog);

        if (!sourceMessage) {
            triggerError(`Consolidator could not find a preceding step with alternatives.`);
            return stopFlow('Invalid flow structure for Consolidator.');
        }

        const consolidatedContent = sourceMessage.answerAlternatives.messages.map((alternativeStartMessage, i) => {
            const { content: turnContent } = extractContentFromTurn(alternativeStartMessage, step.onlyLastAnswer);
            return `--- ALTERNATIVE ${i + 1} ---\n${turnContent}`;
        }).join('\n\n');

        const finalPrompt = `${step.prePrompt || ''}\n\n${consolidatedContent}\n\n${step.postPrompt || ''}`;
        const chat = store.get('currentChat');
        chat.activeAgentId = step.agentId;
        store.set('currentChat', { ...chat });
        app.submitUserMessage(finalPrompt, 'user');
    },
});

defineStep('echo-answer', {
    label: 'Echo Answer',

    getDefaults: () => ({
        agentId: '',
        prePrompt: 'Is this idea and code correct? Be concise.\n\n\n',
        postPrompt: '',
        deleteAIAnswer: true,
        deleteUserMessage: true,
        onlyLastAnswer: false,
    }),

    render: (step, agentOptions) => `
        <h4>Echo Answer</h4>
        <div class="flow-step-content">
            <label>Agent:</label>
            <select class="flow-step-agent flow-step-input" data-id="${step.id}" data-key="agentId">
                <option value="">Select Agent</option>
                ${agentOptions}
            </select>
            <label>Text before AI answer:</label>
            <textarea class="flow-step-pre-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="prePrompt">${step.prePrompt || ''}</textarea>
            <label>Text after AI answer:</label>
            <textarea class="flow-step-post-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="postPrompt">${step.postPrompt || ''}</textarea>
            <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-delete-ai flow-step-input" data-id="${step.id}" data-key="deleteAIAnswer" ${step.deleteAIAnswer ? 'checked' : ''}> Delete original AI answer</label>
            <label class="flow-step-checkbox-label"><input type="checkbox" class="flow-step-delete-user flow-step-input" data-id="${step.id}" data-key="deleteUserMessage" ${step.deleteUserMessage ? 'checked' : ''}> Delete original user message</label>
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
        else if (key === 'deleteAIAnswer') step.deleteAIAnswer = target.checked;
        else if (key === 'deleteUserMessage') step.deleteUserMessage = target.checked;
        else if (key === 'onlyLastAnswer') step.onlyLastAnswer = target.checked;
    },

    execute: (step, context) => {
        const { app, store, triggerError, stopFlow } = context;
        const chatlog = app.ui.chatBox.chatlog;

        const { startMessage, userMessageIndexToDelete } = findLastAnswerChain(chatlog);

        if (!startMessage) {
            triggerError('Echo Answer step could not find an AI answer to process.');
            return stopFlow('No AI answer found.');
        }

        const { content: fullAnswerText, messages: messagesInTurn } = extractContentFromTurn(startMessage, step.onlyLastAnswer);

        const newPrompt = `${step.prePrompt || ''}\n\n${fullAnswerText}\n\n${step.postPrompt || ''}`;

        if (step.deleteAIAnswer) {
            const originalIndices = messagesInTurn.map(m => m.originalIndex).filter(i => i !== undefined);
            const messagesToDelete = new Set(originalIndices);
            const indicesToDelete = Array.from(messagesToDelete).sort((a, b) => b - a);

            for (const index of indicesToDelete) {
                chatlog.deleteNthMessage(index);
            }

            if (step.deleteUserMessage && userMessageIndexToDelete !== -1) {
                const userMessage = chatlog.getNthMessage(userMessageIndexToDelete);
                if (userMessage && userMessage.value.role === 'user') {
                    chatlog.deleteNthMessage(userMessageIndexToDelete);
                }
            }
        }
        const chat = store.get('currentChat');
        chat.activeAgentId = step.agentId;
        store.set('currentChat', { ...chat });
        app.submitUserMessage(newPrompt, 'user');
    },
});


defineStep('clear-history', {
    label: 'Clear History',

    getDefaults: () => ({
        clearFrom: 2,
        clearTo: 1,
        clearToBeginning: true,
    }),

    render: (step) => `
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
            renderFlow(store); // Re-render to show/hide the 'to' input
        }
    },

    execute: (step, context) => {
        const { app, stopFlow, getNextStep, executeStep } = context;
        const chChatlog = app.ui.chatBox.chatlog;
        const chMessages = chChatlog.getActiveMessageValues();
        const userMessageIndices = chMessages
            .map((msg, i) => msg.role === 'user' ? i : -1)
            .filter(i => i !== -1);

        const clearFrom = step.clearFrom || 1;
        const clearTo = step.clearToBeginning ? userMessageIndices.length : (step.clearTo || 1);

        const fromIndex = userMessageIndices.length - clearTo;
        const toIndex = userMessageIndices.length - clearFrom;

        if (fromIndex < 0 || toIndex < 0 || fromIndex > toIndex) {
                stopFlow('Invalid range for Clear History.');
                return;
        }

        const startMsgIndex = userMessageIndices[fromIndex];
        const endMsgIndex = (toIndex + 1 < userMessageIndices.length) ? userMessageIndices[toIndex + 1] : chMessages.length;

        for (let i = endMsgIndex - 1; i >= startMsgIndex; i--) {
            chChatlog.deleteNthMessage(i);
        }

        const nextStep = getNextStep(step.id);
        if (nextStep) {
            executeStep(nextStep);
        } else {
            stopFlow('Flow execution complete.');
        }
    },
});

defineStep('branching-prompt', {
    label: 'Branching Prompt',

    getDefaults: () => ({
        conditionType: 'contains',
        condition: '',
    }),

    render: (step) => `
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
        const { app, triggerError, stopFlow, getNextStep, executeStep } = context;
        const bpLastMessage = app.ui.chatBox.chatlog.getLastMessage()?.value.content || '';
        let bpIsMatch = false;
        const bpCondition = step.condition || '';

        try {
            switch(step.conditionType) {
                case 'regex':
                    bpIsMatch = new RegExp(bpCondition).test(bpLastMessage);
                    break;
                case 'matches':
                    bpIsMatch = (bpLastMessage === bpCondition);
                    break;
                case 'contains':
                default:
                    bpIsMatch = bpLastMessage.includes(bpCondition);
                    break;
            }
        } catch (e) {
            triggerError(`Invalid regex in branching step: ${e.message}`);
            return stopFlow('Invalid regex.');
        }

        const outputName = bpIsMatch ? 'pass' : 'fail';
        const nextStep = getNextStep(step.id, outputName);
        if (nextStep) {
            executeStep(nextStep);
        } else {
            stopFlow('Flow execution complete.');
        }
    },
});

defineStep('conditional-stop', {
    label: 'Conditional Stop',

    getDefaults: () => ({
        conditionType: 'contains',
        condition: '',
        onMatch: 'stop',
    }),

    render: (step) => `
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
        const { app, triggerError, stopFlow, getNextStep, executeStep } = context;
        const lastMessage = app.ui.chatBox.chatlog.getLastMessage()?.value.content || '';
        let isMatch = false;
        const condition = step.condition || '';

        try {
            switch(step.conditionType) {
                case 'regex':
                    isMatch = new RegExp(condition).test(lastMessage);
                    break;
                case 'matches':
                    isMatch = (lastMessage === condition);
                    break;
                case 'contains':
                default:
                    isMatch = lastMessage.includes(condition);
                    break;
            }
        } catch (e) {
            triggerError(`Invalid regex in conditional step: ${e.message}`);
            return stopFlow('Invalid regex.');
        }

        let shouldContinue = true;
        if (isMatch) {
            if (step.onMatch === 'stop') {
                stopFlow('Flow stopped by conditional match.');
                shouldContinue = false;
            }
        } else {
            if (step.onMatch === 'continue') {
                stopFlow('Flow stopped: condition not met.');
                shouldContinue = false;
            }
        }

        if (shouldContinue) {
            const nextStep = getNextStep(step.id);
            if (nextStep) {
                executeStep(nextStep);
            } else {
                stopFlow('Flow execution complete.');
            }
        }
    },
});
