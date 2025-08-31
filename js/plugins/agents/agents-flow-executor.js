/**
 * @fileoverview Flow execution logic for the agents plugin.
 */

'use strict';

import { log, triggerError } from '../../utils/logger.js';
import { stepTypes } from './agent-step-definitions.js';

class AgentFlowExecutor {
    constructor(plugin) {
        this.plugin = plugin;
        this.store = plugin.store;
    }

    toggleFlow() {
        if (this.plugin.flowRunning) this.stopFlow();
        else this.startFlow();
    }

    updateRunButton(isRunning) {
        document.getElementById('run-flow-btn').textContent = isRunning ? 'Stop Flow' : 'Run Flow';
    }

    stopFlow(message = 'Flow stopped.') {
        this.plugin.flowRunning = false;
        this.plugin.currentStepId = null;
        this.plugin.multiMessageInfo = { active: false, step: null, counter: 0, messageToBranchFrom: null };
        this.updateRunButton(false);
        this.plugin.app.ui.submitButton.disabled = false;
        const chat = this.store.get('currentChat');
        if (chat) {
            chat.activeAgentId = null;
            this.store.set('currentChat', { ...chat });
        }
        log(3, message);
    }

    executeStep(step) {
        if (!this.plugin.flowRunning) return;
        if (this.plugin.stepCounter++ >= this.plugin.maxSteps) {
            triggerError('Flow execution stopped: Maximum step limit reached.');
            this.stopFlow();
            return;
        }

        this.plugin.currentStepId = step.id;
        const type = step.type || 'simple-prompt';
        const stepDefinition = stepTypes[type];

        if (stepDefinition && stepDefinition.execute) {
            const context = {
                app: this.plugin.app,
                store: this.store,
                triggerError: triggerError,
                stopFlow: (message) => this.stopFlow(message),
                getNextStep: (stepId, outputName) => this.getNextStep(stepId, outputName),
                executeStep: (nextStep) => this.executeStep(nextStep),
                multiMessageInfo: this.plugin.multiMessageInfo,
            };
            stepDefinition.execute(step, context);
        } else {
            triggerError(`Unknown or non-executable step type: ${type}`);
            this.stopFlow('Unknown step type.');
        }
    }

    startFlow() {
        log(3, 'Starting flow execution...');
        const chat = this.store.get('currentChat');
        const { steps, connections } = chat.flow;
        if (!steps || steps.length === 0) {
            triggerError('Flow has no steps.');
            return;
        }
        const nodesWithIncoming = new Set((connections || []).map(c => c.to));
        const startingNodes = steps.filter(s => !nodesWithIncoming.has(s.id));
        if (startingNodes.length !== 1) {
            triggerError('Flow must have exactly one starting node.');
            return;
        }
        this.plugin.flowRunning = true;
        this.plugin.stepCounter = 0;
        this.updateRunButton(true);
        this.plugin.app.ui.submitButton.disabled = true;
        this.executeStep(startingNodes[0]);
    }

    getNextStep(stepId, outputName = 'default') {
        const chat = this.store.get('currentChat');
        const connection = chat.flow.connections.find(c => c.from === stepId && (c.outputName || 'default') === outputName);
        return connection ? chat.flow.steps.find(s => s.id === connection.to) : null;
    }
}

export { AgentFlowExecutor };
