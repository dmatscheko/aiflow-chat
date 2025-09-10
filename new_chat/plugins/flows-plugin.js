/**
 * @fileoverview Plugin for creating and executing complex, node-based flows.
 * @version 2.1.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce } from '../utils.js';
import { responseProcessor } from './chats-plugin.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').Chat} Chat
 * @typedef {import('../main.js').View} View
 * @typedef {import('../main.js').Tab} Tab
 */

/**
 * @typedef {object} FlowStep
 * @property {string} id
 * @property {string} type
 * @property {number} x
 * @property {number} y
 * @property {object} data
 */

/**
 * @typedef {object} FlowConnection
 * @property {string} from
 * @property {string} to
 * @property {string} outputName
 */

/**
 * @typedef {object} Flow
 * @property {string} id
 * @property {string} name
 * @property {FlowStep[]} steps
 * @property {FlowConnection[]} connections
 */

/**
 * @typedef {object} FlowExecutionContext
 * @property {App} app
 * @property {(fromStepId: string, outputName?: string) => FlowStep | undefined} getNextStep
 * @property {(step: FlowStep) => void} executeStep
 * @property {(message?: string) => void} stopFlow
 */

/**
 * @typedef {object} FlowStepDefinition
 * @property {string} label
 * @property {() => object} getDefaults
 * @property {(step: FlowStep, agentOptions: string) => string} render
 * @property {(step: FlowStep, target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => void} onUpdate
 * @property {(step: FlowStep, context: FlowExecutionContext) => void} execute
 */

let flowsManager = null;

/**
 * Manages the entire lifecycle, execution, and UI of flows.
 * @class
 */
class FlowsManager {
    /** @param {App} app */
    constructor(app) {
        /** @type {App} */
        this.app = app;
        /** @type {Flow[]} */
        this.flows = this._loadFlows();
        /** @type {Object.<string, FlowStepDefinition & {type: string}>} */
        this.stepTypes = {};
        /** @type {FlowRunner | null} */
        this.activeFlowRunner = null;
        /** @type {object} */
        this.dragInfo = {};
        /** @type {object} */
        this.panInfo = {};
        /** @type {object} */
        this.connectionInfo = {};

        this._defineSteps();
    }

    // --- Core Flow Management ---
    _loadFlows() { try { return JSON.parse(localStorage.getItem('core_flows_v2')) || []; } catch (e) { console.error('Failed to load flows:', e); return []; } }
    _saveFlows() { localStorage.setItem('core_flows_v2', JSON.stringify(this.flows)); }
    /** @param {string} id */
    getFlow(id) { return this.flows.find(f => f.id === id); }
    /** @param {Omit<Flow, 'id'>} flowData */
    addFlow(flowData) { const newFlow = { ...flowData, id: `flow-${Date.now()}` }; this.flows.push(newFlow); this._saveFlows(); return newFlow; }
    /** @param {Flow} flowData */
    updateFlow(flowData) { const i = this.flows.findIndex(f => f.id === flowData.id); if (i !== -1) { this.flows[i] = flowData; this._saveFlows(); } }
    /** @param {string} id */
    deleteFlow(id) { this.flows = this.flows.filter(f => f.id !== id); this._saveFlows(); }
    /** @param {Flow} flowData */
    addFlowFromData(flowData) {
        const newFlow = { ...flowData, id: `flow-${Date.now()}` };
        this.flows.push(newFlow);
        this._saveFlows();
        const flowListEl = document.getElementById('flow-list');
        if (flowListEl) this.renderFlowList();
        return newFlow;
    }

    /** @param {string} flowId */
    startFlow(flowId) {
        const flow = this.getFlow(flowId);
        if (flow) {
            this.activeFlowRunner = new FlowRunner(flow, this.app, this);
            this.activeFlowRunner.start();
        }
    }

    // --- Step Definition ---
    /** @param {string} type, @param {FlowStepDefinition} definition */
    _defineStep(type, definition) { this.stepTypes[type] = { ...definition, type }; }
    _defineSteps() {
        const getAgentsDropdown = (step, agentOptions) => `
            <label>Agent:</label>
            <select class="flow-step-agent flow-step-input" data-id="${step.id}" data-key="agentId">
                <option value="">Default (Active Agent)</option>${agentOptions}
            </select>`;

        this._defineStep('simple-prompt', {
            label: 'Simple Prompt',
            getDefaults: () => ({ prompt: 'Hello, world!', agentId: '' }),
            render: (step, agentOptions) => `<h4>Simple Prompt</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}<label>Prompt:</label><textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.data.prompt || ''}</textarea></div>`,
            onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
            execute: (step, context) => {
                if (!step.data.prompt) return context.stopFlow('Simple Prompt step not configured.');
                context.app.dom.messageInput.value = step.data.prompt;
                context.app.chatManager.handleFormSubmit({ agentId: step.data.agentId });
            },
        });

        this._defineStep('multi-prompt', {
            label: 'Multi Prompt',
            getDefaults: () => ({ prompt: '', count: 2, agentId: '' }),
            render: (step, agentOptions) => `<h4>Multi Prompt</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}<label>Prompt:</label><textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.data.prompt || ''}</textarea><label>Number of alternatives:</label><input type="number" class="flow-step-count flow-step-input" data-id="${step.id}" data-key="count" value="${step.data.count || 1}" min="1" max="10"></div>`,
            onUpdate: (step, target) => { step.data[target.dataset.key] = target.dataset.key === 'count' ? parseInt(target.value, 10) : target.value; },
            execute: (step, context) => {
                console.log("Executing Multi-Prompt (not fully implemented, runs once)");
                if (!step.data.prompt) return context.stopFlow('Multi Prompt step is not configured.');
                context.app.dom.messageInput.value = step.data.prompt;
                context.app.chatManager.handleFormSubmit({ agentId: step.data.agentId });
            },
        });

        this._defineStep('consolidator', {
            label: 'Alt. Consolidator',
            getDefaults: () => ({ prePrompt: 'Please choose the best of the following answers:', postPrompt: 'Explain your choice.', agentId: '' }),
            render: (step, agentOptions) => `<h4>Alternatives Consolidator</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}<label>Text before alternatives:</label><textarea class="flow-step-pre-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="prePrompt">${step.data.prePrompt || ''}</textarea><label>Text after alternatives:</label><textarea class="flow-step-post-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="postPrompt">${step.data.postPrompt || ''}</textarea></div>`,
            onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
            execute: (step, context) => {
                console.log("Executing Consolidator (not implemented)");
                const nextStep = context.getNextStep(step.id);
                if (nextStep) context.executeStep(nextStep); else context.stopFlow();
            },
        });

        this._defineStep('echo-answer', {
            label: 'Echo Answer',
            getDefaults: () => ({ prePrompt: 'Is this idea and code correct? Be concise.\n\n\n', postPrompt: '', agentId: '' }),
            render: (step, agentOptions) => `<h4>Echo Answer</h4><div class="flow-step-content">${getAgentsDropdown(step, agentOptions)}<label>Text before AI answer:</label><textarea class="flow-step-pre-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="prePrompt">${step.data.prePrompt || ''}</textarea><label>Text after AI answer:</label><textarea class="flow-step-post-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="postPrompt">${step.data.postPrompt || ''}</textarea></div>`,
            onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
            execute: (step, context) => {
                console.log("Executing Echo Answer (not implemented)");
                const nextStep = context.getNextStep(step.id);
                if (nextStep) context.executeStep(nextStep); else context.stopFlow();
            },
        });

        this._defineStep('clear-history', {
            label: 'Clear History',
            getDefaults: () => ({ clearFrom: 1 }),
            render: (step) => `<h4>Clear History</h4><div class="flow-step-content"><label>Clear from message # (1 is last):</label><input type="number" class="flow-step-clear-from flow-step-input" data-id="${step.id}" data-key="clearFrom" value="${step.data.clearFrom || 1}" min="1"></div>`,
            onUpdate: (step, target) => { step.data.clearFrom = parseInt(target.value, 10); },
            execute: (step, context) => {
                console.log("Executing Clear History (not implemented)");
                const nextStep = context.getNextStep(step.id);
                if (nextStep) context.executeStep(nextStep); else context.stopFlow();
            },
        });

        this._defineStep('branching-prompt', {
            label: 'Branching Prompt',
            getDefaults: () => ({ conditionType: 'contains', condition: '' }),
            render: (step) => `<h4>Branching Prompt</h4><div class="flow-step-content"><label>Last Response Condition:</label><select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType"><option value="contains" ${step.data.conditionType === 'contains' ? 'selected' : ''}>Contains String</option><option value="matches" ${step.data.conditionType === 'matches' ? 'selected' : ''}>Matches String</option><option value="regex" ${step.data.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option></select><textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.data.condition || ''}</textarea></div>`,
            onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
            execute: (step, context) => {
                console.log("Executing Branching Prompt (not implemented)");
                const lastMessage = context.app.chatManager.getActiveChat()?.log.getLastMessage()?.content || '';
                let isMatch = false;
                try {
                    switch(step.data.conditionType) {
                        case 'regex': isMatch = new RegExp(step.data.condition).test(lastMessage); break;
                        case 'matches': isMatch = (lastMessage === step.data.condition); break;
                        default: isMatch = lastMessage.includes(step.data.condition); break;
                    }
                } catch (e) { return context.stopFlow('Invalid regex in branching step.'); }
                const nextStep = context.getNextStep(step.id, isMatch ? 'pass' : 'fail');
                if (nextStep) context.executeStep(nextStep); else context.stopFlow();
            },
        });

        this._defineStep('conditional-stop', {
            label: 'Conditional Stop',
            getDefaults: () => ({ conditionType: 'contains', condition: '', onMatch: 'stop' }),
            render: (step) => `<h4>Conditional Stop</h4><div class="flow-step-content"><label>Last Response Condition:</label><select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType"><option value="contains" ${step.data.conditionType === 'contains' ? 'selected' : ''}>Contains String</option><option value="matches" ${step.data.conditionType === 'matches' ? 'selected' : ''}>Matches String</option><option value="regex" ${step.data.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option></select><textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.data.condition || ''}</textarea><label>On Match:</label><select class="flow-step-on-match flow-step-input" data-id="${step.id}" data-key="onMatch"><option value="stop" ${step.data.onMatch === 'stop' ? 'selected' : ''}>Stop flow</option><option value="continue" ${step.data.onMatch === 'continue' ? 'selected' : ''}>Must match to continue</option></select></div>`,
            onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
            execute: (step, context) => {
                console.log("Executing Conditional Stop (not implemented)");
                const lastMessage = context.app.chatManager.getActiveChat()?.log.getLastMessage()?.content || '';
                let isMatch = false;
                try {
                    switch(step.data.conditionType) {
                        case 'regex': isMatch = new RegExp(step.data.condition).test(lastMessage); break;
                        case 'matches': isMatch = (lastMessage === step.data.condition); break;
                        default: isMatch = lastMessage.includes(step.data.condition); break;
                    }
                } catch (e) { return context.stopFlow('Invalid regex in conditional step.'); }
                if ((isMatch && step.data.onMatch === 'stop') || (!isMatch && step.data.onMatch === 'continue')) {
                    return context.stopFlow('Flow stopped by conditional stop.');
                }
                const nextStep = context.getNextStep(step.id);
                if (nextStep) context.executeStep(nextStep); else context.stopFlow();
            },
        });
    }

    // --- UI Rendering ---
    updateActiveFlowInList() {
        const flowListEl = document.getElementById('flow-list');
        if (!flowListEl || !this.app) return;
        const activeFlowId = this.app.activeView.type === 'flow-editor' ? this.app.activeView.id : null;
        flowListEl.querySelectorAll('li').forEach(item => item.classList.toggle('active', item.dataset.id === activeFlowId));
    }

    renderFlowList() {
        const listEl = document.getElementById('flow-list');
        if (!listEl) return;
        listEl.innerHTML = '';
        this.flows.forEach(flow => {
            const li = document.createElement('li');
            li.className = 'list-item';
            li.dataset.id = flow.id;
            li.innerHTML = `<span>${flow.name}</span><button class="delete-button">X</button>`;
            listEl.appendChild(li);
        });
        this.updateActiveFlowInList();
    }

    /** @param {string} flowId */
    renderFlowEditor(flowId) {
        const dropdownContent = Object.entries(this.stepTypes).map(([type, { label }]) => `<a href="#" data-step-type="${type}">${label}</a>`).join('');
        return `
            <div id="flow-editor-container">
                <div class="flow-toolbar">
                    <div class="dropdown" style="margin-right: 1rem;">
                        <button id="add-flow-step-btn" class="primary-btn">Add Step</button>
                        <div id="add-step-dropdown" class="dropdown-content">${dropdownContent}</div>
                    </div>
                </div>
                <div id="flow-canvas-wrapper"><div id="flow-canvas">
                    <svg id="flow-svg-layer"></svg>
                    <div id="flow-node-container"></div>
                </div></div>
            </div>`;
    }

    /** @param {Flow} flow */
    updateConnections(flow) {
        const nodeContainer = document.getElementById('flow-node-container');
        const svgLayer = document.getElementById('flow-svg-layer');
        if (!nodeContainer || !svgLayer) return;
        svgLayer.querySelectorAll('line').forEach(l => l.remove());
        flow.connections.forEach(conn => {
            const fromNode = nodeContainer.querySelector(`[data-id="${conn.from}"]`);
            const toNode = nodeContainer.querySelector(`[data-id="${conn.to}"]`);
            if (!fromNode || !toNode) return;
            const outConn = fromNode.querySelector(`.connector.bottom[data-output-name="${conn.outputName || 'default'}"]`);
            const inConn = toNode.querySelector('.connector.top');
            if (!outConn || !inConn) return;
            const x1 = fromNode.offsetLeft + outConn.offsetLeft + outConn.offsetWidth / 2;
            const y1 = fromNode.offsetTop + outConn.offsetTop + outConn.offsetHeight / 2;
            const x2 = toNode.offsetLeft + inConn.offsetLeft + inConn.offsetWidth / 2;
            const y2 = toNode.offsetTop + inConn.offsetTop + inConn.offsetHeight / 2;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1); line.setAttribute('y1', y1);
            line.setAttribute('x2', x2); line.setAttribute('y2', y2);
            line.setAttribute('stroke', 'var(--text-color)'); line.setAttribute('stroke-width', '2');
            line.setAttribute('marker-end', 'url(#arrowhead)');
            svgLayer.appendChild(line);
        });
    }

    /** @param {Flow} flow */
    renderFlow(flow) {
        const nodeContainer = document.getElementById('flow-node-container');
        const svgLayer = document.getElementById('flow-svg-layer');
        if (!nodeContainer || !svgLayer) return;
        nodeContainer.innerHTML = '';
        svgLayer.innerHTML = '<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="15" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-color)"></path></marker></defs>';
        const agentOptions = this.app.agentManager.agents.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        flow.steps.forEach(step => {
            const stepDef = this.stepTypes[step.type];
            if (!stepDef) return;
            const node = document.createElement('div');
            node.className = 'flow-step-card';
            node.dataset.id = step.id;
            node.style.left = `${step.x}px`; node.style.top = `${step.y}px`;
            const selectedAgentOptions = this.app.agentManager.agents.map(a => `<option value="${a.id}" ${step.data.agentId === a.id ? 'selected' : ''}>${a.name}</option>`).join('');
            let outputConnectors = `<div class="connector-group"><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="default"></div></div>`;
            if (step.type === 'branching-prompt') {
                outputConnectors = `<div class="connector-group"><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="pass"><span class="connector-label">Pass</span></div><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="fail"><span class="connector-label">Fail</span></div></div>`;
            }
            node.innerHTML = `<div class="connector top" data-id="${step.id}" data-type="in"></div>${stepDef.render(step, selectedAgentOptions)}<div class="flow-step-footer"><button class="delete-flow-step-btn" data-id="${step.id}">Delete</button></div>${outputConnectors}`;
            nodeContainer.appendChild(node);
        });
        this.updateConnections(flow);
    }

    /** @param {string | null} activeFlowId */
    getFlowSelectorHtml(activeFlowId) {
        const optionsHtml = this.flows.map(flow => `<option value="${flow.id}" ${flow.id === activeFlowId ? 'selected' : ''}>${flow.name}</option>`).join('');
        return `<div id="flow-runner-container"><label for="flow-selector">Flow:</label><select id="flow-selector"><option value="">Select a flow</option>${optionsHtml}</select><button id="run-chat-flow-btn">Run</button></div>`;
    }

    // --- Canvas Interaction ---
    _resetInteractions() {
        const canvas = document.getElementById('flow-canvas');
        if (canvas) canvas.classList.remove('panning');
        this.dragInfo = { active: false }; this.panInfo = { active: false };
        if (this.connectionInfo.tempLine) this.connectionInfo.tempLine.remove();
        this.connectionInfo = { active: false };
    }

    /** @param {MouseEvent} e, @param {Flow} flow, @param {() => void} debouncedUpdate */
    _handleCanvasMouseDown(e, flow, debouncedUpdate) {
        const target = e.target;
        if (target.classList.contains('connector') && target.dataset.type === 'out') {
            this.connectionInfo = { active: true, fromNode: target.closest('.flow-step-card'), fromConnector: target, tempLine: document.createElementNS('http://www.w3.org/2000/svg', 'line') };
            this.connectionInfo.tempLine.setAttribute('stroke', 'red'); this.connectionInfo.tempLine.setAttribute('stroke-width', '2');
            document.getElementById('flow-svg-layer').appendChild(this.connectionInfo.tempLine);
        } else if (target.closest('.flow-step-card') && !target.matches('input, textarea, select, button')) {
            e.preventDefault();
            this.dragInfo = { active: true, target: target.closest('.flow-step-card'), offsetX: e.clientX - target.closest('.flow-step-card').offsetLeft, offsetY: e.clientY - target.closest('.flow-step-card').offsetTop };
        } else if (e.target.id === 'flow-canvas' || e.target.id === 'flow-canvas-wrapper' || e.target.id === 'flow-svg-layer' || e.target.id === 'flow-node-container') {
            e.preventDefault();
            const wrapper = document.getElementById('flow-canvas-wrapper');
            this.panInfo = { active: true, startX: e.clientX, startY: e.clientY, scrollLeft: wrapper.scrollLeft, scrollTop: wrapper.scrollTop };
            e.target.closest('#flow-canvas').classList.add('panning');
        }
    }

    /** @param {MouseEvent} e, @param {Flow} flow */
    _handleCanvasMouseMove(e, flow) {
        if (this.dragInfo.active) {
            this.dragInfo.target.style.left = `${e.clientX - this.dragInfo.offsetX}px`;
            this.dragInfo.target.style.top = `${e.clientY - this.dragInfo.offsetY}px`;
            this.updateConnections(flow);
        } else if (this.connectionInfo.active) {
            const wrapper = document.getElementById('flow-canvas-wrapper');
            const rect = wrapper.getBoundingClientRect();
            const fromRect = this.connectionInfo.fromConnector.getBoundingClientRect();
            const startX = fromRect.left - rect.left + fromRect.width / 2 + wrapper.scrollLeft;
            const startY = fromRect.top - rect.top + fromRect.height / 2 + wrapper.scrollTop;
            const endX = e.clientX - rect.left + wrapper.scrollLeft;
            const endY = e.clientY - rect.top + wrapper.scrollTop;
            this.connectionInfo.tempLine.setAttribute('x1', startX); this.connectionInfo.tempLine.setAttribute('y1', startY);
            this.connectionInfo.tempLine.setAttribute('x2', endX); this.connectionInfo.tempLine.setAttribute('y2', endY);
        } else if (this.panInfo.active) {
            e.preventDefault();
            const wrapper = document.getElementById('flow-canvas-wrapper');
            wrapper.scrollLeft = this.panInfo.scrollLeft - (e.clientX - this.panInfo.startX);
            wrapper.scrollTop = this.panInfo.scrollTop - (e.clientY - this.panInfo.startY);
        }
    }

    /** @param {MouseEvent} e, @param {Flow} flow, @param {() => void} debouncedUpdate */
    _handleCanvasMouseUp(e, flow, debouncedUpdate) {
        if (this.dragInfo.active) {
            const step = flow.steps.find(s => s.id === this.dragInfo.target.dataset.id);
            if (step) {
                step.x = this.dragInfo.target.offsetLeft;
                step.y = this.dragInfo.target.offsetTop;
                debouncedUpdate();
            }
        } else if (this.connectionInfo.active) {
            const toConnector = e.target.closest('.connector');
            if (toConnector && toConnector.dataset.type === 'in') {
                const toNode = toConnector.closest('.flow-step-card');
                const fromNode = this.connectionInfo.fromNode;
                if (fromNode.dataset.id !== toNode.dataset.id) {
                    flow.connections.push({ from: fromNode.dataset.id, to: toNode.dataset.id, outputName: this.connectionInfo.fromConnector.dataset.outputName });
                    debouncedUpdate();
                    this.renderFlow(flow);
                }
            }
        }
        this._resetInteractions();
    }
}

/**
 * Executes a flow by traversing its steps and connections.
 * @class
 */
class FlowRunner {
    /**
     * @param {Flow} flow
     * @param {App} app
     * @param {FlowsManager} manager
     */
    constructor(flow, app, manager) {
        this.flow = flow;
        this.app = app;
        this.manager = manager;
        this.currentStepId = null;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        const startNode = this.flow.steps.find(s => !this.flow.connections.some(c => c.to === s.id));
        if (!startNode) return alert('Flow has no starting node!');
        this.isRunning = true;
        this.executeStep(startNode);
    }

    /** @param {string} [message='Flow stopped.'] */
    stop(message = 'Flow stopped.') {
        this.isRunning = false;
        this.currentStepId = null;
        console.log(message);
        this.manager.activeFlowRunner = null;
    }

    /** @param {FlowStep} step */
    executeStep(step) {
        if (!this.isRunning) return;
        this.currentStepId = step.id;
        const stepDef = this.manager.stepTypes[step.type];
        if (stepDef?.execute) {
            stepDef.execute(step, {
                app: this.app,
                getNextStep: (id, out) => this.getNextStep(id, out),
                executeStep: (next) => this.executeStep(next),
                stopFlow: (msg) => this.stop(msg),
            });
        } else {
            this.stop(`Unknown step type: ${step.type}`);
        }
    }

    /** @param {string} stepId, @param {string} [outputName='default'] */
    getNextStep(stepId, outputName = 'default') {
        const conn = this.flow.connections.find(c => c.from === stepId && (c.outputName || 'default') === outputName);
        return conn ? this.flow.steps.find(s => s.id === conn.to) : undefined;
    }

    continue() {
        if (!this.isRunning || !this.currentStepId) return;
        const proceed = () => {
            const stepDef = this.manager.stepTypes[this.flow.steps.find(s => s.id === this.currentStepId)?.type];
            if (stepDef?.execute?.toString().includes('handleFormSubmit')) {
                const nextStep = this.getNextStep(this.currentStepId);
                if (nextStep) this.executeStep(nextStep);
                else this.stop('Flow execution complete.');
            }
        };
        if (responseProcessor.isProcessing) responseProcessor.subscribeToCompletion(proceed);
        else proceed();
    }
}


const flowsPlugin = {
    name: 'Flows',
    /** @param {App} app */
    onAppInit(app) {
        flowsManager = new FlowsManager(app);
        app.flowsManager = flowsManager;

        pluginManager.registerView('flow-editor', (id) => flowsManager.renderFlowEditor(id));
    },

    /** @param {Tab[]} tabs */
    onTabsRegistered(tabs) {
        tabs.push({
            id: 'flows',
            label: 'Flows',
            viewType: 'flow-editor',
            onActivate: () => {
                const contentEl = document.getElementById('flows-pane');
                contentEl.innerHTML = `<div class="list-pane"><ul id="flow-list" class="item-list"></ul><button id="add-flow-btn" class="add-new-button">Add New Flow</button></div>`;
                flowsManager.renderFlowList();
                document.getElementById('add-flow-btn').addEventListener('click', () => {
                    const name = prompt('Enter a name for the new flow:');
                    if (name) {
                        flowsManager.addFlow({ name, steps: [], connections: [] });
                        flowsManager.renderFlowList();
                    }
                });
                document.getElementById('flow-list').addEventListener('click', (e) => {
                    const item = e.target.closest('.list-item');
                    if (!item) return;
                    const id = item.dataset.id;
                    if (e.target.classList.contains('delete-button')) {
                        e.stopPropagation();
                        if (confirm('Delete this flow?')) {
                            flowsManager.deleteFlow(id);
                            flowsManager.renderFlowList();
                        }
                    } else {
                        flowsManager.app.setView('flow-editor', id);
                    }
                });
            }
        });
        return tabs;
    },

    /** @param {View} view, @param {Chat} chat */
    onViewRendered(view, chat) {
        if (view.type === 'flow-editor') {
            const flow = flowsManager.getFlow(view.id);
            if (!flow) return;
            const debouncedUpdate = debounce(() => flowsManager.updateFlow(flow), 500);
            flowsManager.renderFlow(flow);
            const canvas = document.getElementById('flow-canvas');
            canvas.addEventListener('mousedown', (e) => flowsManager._handleCanvasMouseDown(e, flow, debouncedUpdate));
            canvas.addEventListener('mousemove', (e) => flowsManager._handleCanvasMouseMove(e, flow));
            canvas.addEventListener('mouseup', (e) => flowsManager._handleCanvasMouseUp(e, flow, debouncedUpdate));
            canvas.addEventListener('change', (e) => {
                const step = flow.steps.find(s => s.id === e.target.dataset.id);
                if (step && flowsManager.stepTypes[step.type]?.onUpdate) {
                    flowsManager.stepTypes[step.type].onUpdate(step, e.target);
                    debouncedUpdate();
                }
            });
            canvas.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-flow-step-btn')) {
                    const stepId = e.target.dataset.id;
                    flow.steps = flow.steps.filter(s => s.id !== stepId);
                    flow.connections = flow.connections.filter(c => c.from !== stepId && c.to !== stepId);
                    flowsManager.updateFlow(flow);
                    flowsManager.renderFlow(flow);
                }
            });
            const dropdown = document.getElementById('add-step-dropdown');
            document.getElementById('add-flow-step-btn').addEventListener('click', (e) => { e.stopPropagation(); dropdown.classList.toggle('show'); });
            dropdown.addEventListener('click', (e) => {
                const type = e.target.dataset.stepType;
                if (type && flowsManager.stepTypes[type]) {
                    flow.steps.push({ id: `step-${Date.now()}`, type, x: 50, y: 50, data: flowsManager.stepTypes[type].getDefaults() });
                    flowsManager.updateFlow(flow);
                    flowsManager.renderFlow(flow);
                    dropdown.classList.remove('show');
                }
            });
            window.addEventListener('click', (e) => { if (!e.target.matches('#add-flow-step-btn')) dropdown.classList.remove('show'); });
        }
        flowsManager.updateActiveFlowInList();
    },

    /** @param {Message} message, @param {Chat} chat */
    onResponseComplete(message, chat) {
        if (flowsManager.activeFlowRunner) {
            flowsManager.activeFlowRunner.continue();
        }
    }
};

pluginManager.register(flowsPlugin);
