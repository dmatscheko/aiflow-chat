/**
 * @fileoverview Plugin for creating and executing complex, node-based flows.
 * @version 1.0.1
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce } from '../utils.js';
import { responseQueueManager } from '../response-queue.js';

let appInstance = null;

/**
 * @typedef {object} FlowStep
 * @property {string} id - The unique identifier for the step.
 * @property {string} type - The type of the step.
 * @property {number} x - The x-coordinate on the canvas.
 * @property {number} y - The y-coordinate on the canvas.
 * @property {Object.<string, any>} data - The specific data for the step, including agentId.
 */

/**
 * @typedef {object} FlowConnection
 * @property {string} from - The ID of the source step.
 * @property {string} to - The ID of the target step.
 * @property {string} outputName - The name of the output connector on the source step.
 */

/**
 * @typedef {object} Flow
 * @property {string} id - The unique identifier for the flow.
 * @property {string} name - The name of the flow.
 * @property {FlowStep[]} steps - An array of steps in the flow.
 * @property {FlowConnection[]} connections - An array of connections between steps.
 */

const stepTypes = {};

function defineStep(type, definition) {
    stepTypes[type] = { ...definition, type };
}

function getAgentsDropdown(step, agentOptions) {
    return `
        <label>Agent:</label>
        <select class="flow-step-agent flow-step-input" data-id="${step.id}" data-key="agentId">
            <option value="">Default AI</option>
            ${agentOptions}
        </select>`;
}

// --- Step Definitions ---

defineStep('simple-prompt', {
    label: 'Simple Prompt',
    getDefaults: () => ({ prompt: 'Hello, world!', agentId: '' }),
    render: (step, agentOptions) => `
        <h4>Simple Prompt</h4>
        <div class="flow-step-content">
            ${getAgentsDropdown(step, agentOptions)}
            <label>Prompt:</label>
            <textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.data.prompt || ''}</textarea>
        </div>
    `,
    onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
    execute: (step, context) => {
        if (!step.data.prompt) return context.stopFlow('Simple Prompt step is not configured.');
        context.app.setActiveAgent(step.data.agentId);
        context.app.dom.messageInput.value = step.data.prompt;
        context.app.handleFormSubmit();
    },
});

defineStep('multi-prompt', {
    label: 'Multi Prompt',
    getDefaults: () => ({ prompt: '', count: 2, agentId: '' }),
    render: (step, agentOptions) => `
        <h4>Multi Prompt</h4>
        <div class="flow-step-content">
            ${getAgentsDropdown(step, agentOptions)}
            <label>Prompt:</label>
            <textarea class="flow-step-prompt flow-step-input" rows="3" data-id="${step.id}" data-key="prompt">${step.data.prompt || ''}</textarea>
            <label>Number of alternatives:</label>
            <input type="number" class="flow-step-count flow-step-input" data-id="${step.id}" data-key="count" value="${step.data.count || 1}" min="1" max="10">
        </div>
    `,
    onUpdate: (step, target) => { step.data[target.dataset.key] = target.dataset.key === 'count' ? parseInt(target.value, 10) : target.value; },
    execute: (step, context) => {
        console.log("Executing Multi-Prompt (not fully implemented, runs once)");
        if (!step.data.prompt) return context.stopFlow('Multi Prompt step is not configured.');
        context.app.setActiveAgent(step.data.agentId);
        context.app.dom.messageInput.value = step.data.prompt;
        context.app.handleFormSubmit();
    },
});

defineStep('consolidator', {
    label: 'Alt. Consolidator',
    getDefaults: () => ({ prePrompt: 'Please choose the best of the following answers:', postPrompt: 'Explain your choice.', agentId: '' }),
    render: (step, agentOptions) => `
        <h4>Alternatives Consolidator</h4>
        <div class="flow-step-content">
            ${getAgentsDropdown(step, agentOptions)}
            <label>Text before alternatives:</label>
            <textarea class="flow-step-pre-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="prePrompt">${step.data.prePrompt || ''}</textarea>
            <label>Text after alternatives:</label>
            <textarea class="flow-step-post-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="postPrompt">${step.data.postPrompt || ''}</textarea>
        </div>
    `,
    onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
    execute: (step, context) => {
        console.log("Executing Consolidator (not implemented)");
        const nextStep = context.getNextStep(step.id);
        if (nextStep) context.executeStep(nextStep); else context.stopFlow();
    },
});

defineStep('echo-answer', {
    label: 'Echo Answer',
    getDefaults: () => ({ prePrompt: 'Is this idea and code correct? Be concise.\n\n\n', postPrompt: '', agentId: '' }),
    render: (step, agentOptions) => `
        <h4>Echo Answer</h4>
        <div class="flow-step-content">
            ${getAgentsDropdown(step, agentOptions)}
            <label>Text before AI answer:</label>
            <textarea class="flow-step-pre-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="prePrompt">${step.data.prePrompt || ''}</textarea>
            <label>Text after AI answer:</label>
            <textarea class="flow-step-post-prompt flow-step-input" rows="2" data-id="${step.id}" data-key="postPrompt">${step.data.postPrompt || ''}</textarea>
        </div>
    `,
    onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
    execute: (step, context) => {
        console.log("Executing Echo Answer (not implemented)");
        const nextStep = context.getNextStep(step.id);
        if (nextStep) context.executeStep(nextStep); else context.stopFlow();
    },
});

defineStep('clear-history', {
    label: 'Clear History',
    getDefaults: () => ({ clearFrom: 1 }),
    render: (step) => `
        <h4>Clear History</h4>
        <div class="flow-step-content">
            <label>Clear from message # (1 is last):</label>
            <input type="number" class="flow-step-clear-from flow-step-input" data-id="${step.id}" data-key="clearFrom" value="${step.data.clearFrom || 1}" min="1">
        </div>
    `,
    onUpdate: (step, target) => { step.data.clearFrom = parseInt(target.value, 10); },
    execute: (step, context) => {
        console.log("Executing Clear History (not implemented)");
        const nextStep = context.getNextStep(step.id);
        if (nextStep) context.executeStep(nextStep); else context.stopFlow();
    },
});

defineStep('branching-prompt', {
    label: 'Branching Prompt',
    getDefaults: () => ({ conditionType: 'contains', condition: '' }),
    render: (step) => `
        <h4>Branching Prompt</h4>
        <div class="flow-step-content">
            <label>Last Response Condition:</label>
            <select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType">
                <option value="contains" ${step.data.conditionType === 'contains' ? 'selected' : ''}>Contains String</option>
                <option value="matches" ${step.data.conditionType === 'matches' ? 'selected' : ''}>Matches String</option>
                <option value="regex" ${step.data.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option>
            </select>
            <textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.data.condition || ''}</textarea>
        </div>
    `,
    onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
    execute: (step, context) => {
        console.log("Executing Branching Prompt (not implemented)");
        const lastMessage = context.app.getActiveChat()?.log.getLastMessage()?.content || '';
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

defineStep('conditional-stop', {
    label: 'Conditional Stop',
    getDefaults: () => ({ conditionType: 'contains', condition: '', onMatch: 'stop' }),
    render: (step) => `
        <h4>Conditional Stop</h4>
        <div class="flow-step-content">
            <label>Last Response Condition:</label>
            <select class="flow-step-condition-type flow-step-input" data-id="${step.id}" data-key="conditionType">
                <option value="contains" ${step.data.conditionType === 'contains' ? 'selected' : ''}>Contains String</option>
                <option value="matches" ${step.data.conditionType === 'matches' ? 'selected' : ''}>Matches String</option>
                <option value="regex" ${step.data.conditionType === 'regex' ? 'selected' : ''}>Matches Regex</option>
            </select>
            <textarea class="flow-step-condition flow-step-input" rows="2" data-id="${step.id}" data-key="condition" placeholder="Enter value...">${step.data.condition || ''}</textarea>
            <label>On Match:</label>
            <select class="flow-step-on-match flow-step-input" data-id="${step.id}" data-key="onMatch">
                <option value="stop" ${step.data.onMatch === 'stop' ? 'selected' : ''}>Stop flow</option>
                <option value="continue" ${step.data.onMatch === 'continue' ? 'selected' : ''}>Must match to continue</option>
            </select>
        </div>
    `,
    onUpdate: (step, target) => { step.data[target.dataset.key] = target.value; },
    execute: (step, context) => {
        console.log("Executing Conditional Stop (not implemented)");
        const lastMessage = context.app.getActiveChat()?.log.getLastMessage()?.content || '';
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


// --- Flow Manager ---
class FlowManager {
    constructor() { this.flows = this._loadFlows(); }
    _loadFlows() { try { return JSON.parse(localStorage.getItem('core_flows_v2')) || []; } catch (e) { console.error('Failed to load flows:', e); return []; } }
    _saveFlows() { localStorage.setItem('core_flows_v2', JSON.stringify(this.flows)); }
    getFlow(id) { return this.flows.find(f => f.id === id); }
    addFlow(flowData) { this.flows.push({ ...flowData, id: `flow-${Date.now()}` }); this._saveFlows(); }
    updateFlow(flowData) { const i = this.flows.findIndex(f => f.id === flowData.id); if (i !== -1) { this.flows[i] = flowData; this._saveFlows(); } }
    deleteFlow(id) { this.flows = this.flows.filter(f => f.id !== id); this._saveFlows(); }
}
const flowManager = new FlowManager();

// --- Flow Runner ---
class FlowRunner {
    constructor(flow, app) { this.flow = flow; this.app = app; this.currentStepId = null; this.isRunning = false; }
    start() {
        if (this.isRunning) return;
        const startNode = this.flow.steps.find(s => !this.flow.connections.some(c => c.to === s.id));
        if (!startNode) return alert('Flow has no starting node!');
        this.isRunning = true;
        this.executeStep(startNode);
    }
    stop(message = 'Flow stopped.') { this.isRunning = false; this.currentStepId = null; console.log(message); activeFlowRunner = null; }
    executeStep(step) {
        if (!this.isRunning) return;
        this.currentStepId = step.id;
        const stepDef = stepTypes[step.type];
        if (stepDef?.execute) {
            stepDef.execute(step, {
                app: this.app,
                getNextStep: (id, out) => this.getNextStep(id, out),
                executeStep: (next) => this.executeStep(next),
                stopFlow: (msg) => this.stop(msg),
            });
        } else { this.stop(`Unknown step type: ${step.type}`); }
    }
    getNextStep(stepId, outputName = 'default') {
        const conn = this.flow.connections.find(c => c.from === stepId && (c.outputName || 'default') === outputName);
        return conn ? this.flow.steps.find(s => s.id === conn.to) : null;
    }
    continue() {
        if (!this.isRunning || !this.currentStepId) return;

        const proceed = () => {
            const stepDef = stepTypes[this.flow.steps.find(s => s.id === this.currentStepId)?.type];
            // The check for handleFormSubmit ensures we only auto-advance after steps that trigger an AI response.
            if (stepDef?.execute?.toString().includes('handleFormSubmit')) {
                const nextStep = this.getNextStep(this.currentStepId);
                if (nextStep) {
                    this.executeStep(nextStep);
                } else {
                    this.stop('Flow execution complete.');
                }
            }
        };

        // Wait for the AI response queue to be fully processed before continuing the flow.
        if (responseQueueManager.isProcessing) {
            console.log('Flows: AI queue is busy, waiting for completion...');
            responseQueueManager.subscribeToCompletion(proceed);
        } else {
            console.log('Flows: AI queue is clear, proceeding immediately.');
            proceed();
        }
    }
}
let activeFlowRunner = null;

// --- UI Rendering ---
function renderFlowList() {
    const listEl = document.getElementById('flow-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    flowManager.flows.forEach(flow => {
        const li = document.createElement('li');
        li.className = 'flow-list-item';
        li.dataset.id = flow.id;
        li.innerHTML = `<span>${flow.name}</span><button class="delete-flow-btn">X</button>`;
        listEl.appendChild(li);
    });
}

function renderFlowEditor(flowId) {
    const flow = flowManager.getFlow(flowId);
    const dropdownContent = Object.entries(stepTypes).map(([type, { label }]) => `<a href="#" data-step-type="${type}">${label}</a>`).join('');
    return `
        <div id="flow-editor-container">
            <div class="flow-toolbar">
                <h3>${flow?.name || 'Flow Editor'}</h3>
                <div class="dropdown">
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

function updateConnections(flow) {
    const nodeContainer = document.getElementById('flow-node-container');
    const svgLayer = document.getElementById('flow-svg-layer');
    if (!nodeContainer || !svgLayer) return;

    // Clear only the lines, not the whole SVG, to keep the marker defs
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
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', 'var(--text-color)');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('marker-end', 'url(#arrowhead)');
        svgLayer.appendChild(line);
    });
}

function renderFlow(flow) {
    const nodeContainer = document.getElementById('flow-node-container');
    const svgLayer = document.getElementById('flow-svg-layer');
    if (!nodeContainer || !svgLayer) return;

    nodeContainer.innerHTML = '';
    svgLayer.innerHTML = ''; // Clear everything initially

    // Add SVG marker definitions
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '15');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto-start-reverse');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    path.setAttribute('fill', 'var(--text-color)');
    marker.appendChild(path);
    defs.appendChild(marker);
    svgLayer.appendChild(defs);

    const agentOptions = appInstance.agentManager.agents.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

    // Render step nodes
    flow.steps.forEach(step => {
        const stepDef = stepTypes[step.type];
        if (!stepDef) return;
        const node = document.createElement('div');
        node.className = 'flow-step-card';
        node.dataset.id = step.id;
        node.style.left = `${step.x}px`;
        node.style.top = `${step.y}px`;
        const selectedAgentOptions = appInstance.agentManager.agents.map(a => `<option value="${a.id}" ${step.data.agentId === a.id ? 'selected' : ''}>${a.name}</option>`).join('');

        let outputConnectors = `<div class="connector-group"><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="default"></div></div>`;
        if (step.type === 'branching-prompt') {
            outputConnectors = `<div class="connector-group">
                <div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="pass"><span class="connector-label">Pass</span></div>
                <div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="fail"><span class="connector-label">Fail</span></div>
            </div>`;
        }

        node.innerHTML = `
            <div class="connector top" data-id="${step.id}" data-type="in"></div>
            ${stepDef.render(step, selectedAgentOptions)}
            <div class="flow-step-footer"><button class="delete-flow-step-btn" data-id="${step.id}">Delete</button></div>
            ${outputConnectors}`;
        nodeContainer.appendChild(node);
    });

    // Draw connections using the new function
    updateConnections(flow);
}


// --- Canvas Interaction ---
let dragInfo = {}, panInfo = {}, connectionInfo = {};
function resetInteractions() {
    dragInfo = { active: false }; panInfo = { active: false };
    if (connectionInfo.tempLine) connectionInfo.tempLine.remove();
    connectionInfo = { active: false };
    document.getElementById('flow-canvas-wrapper').style.cursor = 'grab';
}

function handleCanvasMouseDown(e, flow, debouncedUpdate) {
    const target = e.target;
    if (target.classList.contains('connector') && target.dataset.type === 'out') {
        connectionInfo = { active: true, fromNode: target.closest('.flow-step-card'), fromConnector: target, tempLine: document.createElementNS('http://www.w3.org/2000/svg', 'line') };
        connectionInfo.tempLine.setAttribute('stroke', 'red'); connectionInfo.tempLine.setAttribute('stroke-width', '2');
        document.getElementById('flow-svg-layer').appendChild(connectionInfo.tempLine);
    } else if (target.closest('.flow-step-card') && !target.matches('input, textarea, select, button')) {
        e.preventDefault();
        dragInfo = { active: true, target: target.closest('.flow-step-card'), offsetX: e.clientX - target.closest('.flow-step-card').offsetLeft, offsetY: e.clientY - target.closest('.flow-step-card').offsetTop };
    } else if (e.target.id === 'flow-canvas' || e.target.id === 'flow-canvas-wrapper') {
        e.preventDefault();
        const wrapper = document.getElementById('flow-canvas-wrapper');
        panInfo = { active: true, startX: e.clientX, startY: e.clientY, scrollLeft: wrapper.scrollLeft, scrollTop: wrapper.scrollTop };
        wrapper.style.cursor = 'grabbing';
    }
}

function handleCanvasMouseMove(e, flow, debouncedUpdate) {
    if (dragInfo.active) {
        const newX = e.clientX - dragInfo.offsetX;
        const newY = e.clientY - dragInfo.offsetY;
        dragInfo.target.style.left = `${newX}px`;
        dragInfo.target.style.top = `${newY}px`;
        updateConnections(flow); // Only update connections, no full re-render
    } else if (connectionInfo.active) {
        const wrapper = document.getElementById('flow-canvas-wrapper');
        const rect = wrapper.getBoundingClientRect();
        const fromRect = connectionInfo.fromConnector.getBoundingClientRect();
        const startX = fromRect.left - rect.left + fromRect.width / 2 + wrapper.scrollLeft;
        const startY = fromRect.top - rect.top + fromRect.height / 2 + wrapper.scrollTop;
        const endX = e.clientX - rect.left + wrapper.scrollLeft;
        const endY = e.clientY - rect.top + wrapper.scrollTop;
        connectionInfo.tempLine.setAttribute('x1', startX); connectionInfo.tempLine.setAttribute('y1', startY);
        connectionInfo.tempLine.setAttribute('x2', endX); connectionInfo.tempLine.setAttribute('y2', endY);
    } else if (panInfo.active) {
        e.preventDefault();
        const wrapper = document.getElementById('flow-canvas-wrapper');
        wrapper.scrollLeft = panInfo.scrollLeft - (e.clientX - panInfo.startX);
        wrapper.scrollTop = panInfo.scrollTop - (e.clientY - panInfo.startY);
    }
}

function handleCanvasMouseUp(e, flow, debouncedUpdate) {
    if (dragInfo.active) {
        const step = flow.steps.find(s => s.id === dragInfo.target.dataset.id);
        if (step) {
            step.x = dragInfo.target.offsetLeft;
            step.y = dragInfo.target.offsetTop;
            debouncedUpdate();
        }
    } else if (connectionInfo.active) {
        const toConnector = e.target.closest('.connector');
        if (toConnector && toConnector.dataset.type === 'in') {
            const toNode = toConnector.closest('.flow-step-card');
            const fromNode = connectionInfo.fromNode;
            if (fromNode.dataset.id !== toNode.dataset.id) {
                flow.connections.push({ from: fromNode.dataset.id, to: toNode.dataset.id, outputName: connectionInfo.fromConnector.dataset.outputName });
                debouncedUpdate();
                renderFlow(flow);
            }
        }
    }
    resetInteractions();
}

// --- Plugin Definition ---
const flowsPlugin = {
    name: 'Flows',
    onAppInit(app) { appInstance = app; pluginManager.registerView('flow-editor', renderFlowEditor); },
    onChatAreaRender(currentHtml) {
        const flowSelectorHtml = `
            <div id="flow-runner-container">
                <label for="flow-selector">Flow:</label>
                <select id="flow-selector">
                    <option value="">Select a flow</option>
                </select>
                <button id="run-chat-flow-btn">Run</button>
            </div>
        `;
        return currentHtml + flowSelectorHtml;
    },
    onChatSwitched(chat) {
        const selector = document.getElementById('flow-selector');
        if (!selector) return;

        selector.innerHTML = '<option value="">Select a flow</option>';
        flowManager.flows.forEach(flow => {
            const option = document.createElement('option');
            option.value = flow.id;
            option.textContent = flow.name;
            selector.appendChild(option);
        });
    },
    onTabsRegistered(tabs) {
        tabs.push({
            id: 'flows', label: 'Flows', onActivate: () => {
                const contentEl = document.getElementById('flows-pane');
                contentEl.innerHTML = `<div class="pane-header"><h3>Flows</h3><button id="add-flow-btn" class="primary-btn">Add New Flow</button></div><ul id="flow-list"></ul>`;
                renderFlowList();
                document.getElementById('add-flow-btn').addEventListener('click', () => { const name = prompt('Enter a name for the new flow:'); if (name) { flowManager.addFlow({ name, steps: [], connections: [] }); renderFlowList(); } });
                document.getElementById('flow-list').addEventListener('click', (e) => {
                    const item = e.target.closest('.flow-list-item'); if (!item) return;
                    const id = item.dataset.id;
                    if (e.target.classList.contains('delete-flow-btn')) {
                        e.stopPropagation();
                        if (confirm('Delete this flow?')) {
                            flowManager.deleteFlow(id);
                            renderFlowList();
                        }
                    } else {
                        appInstance.setView('flow-editor', id);
                    }
                });
            }
        });
        return tabs;
    },
    onViewRendered(view) {
        if (view.type === 'flow-editor') {
            const flow = flowManager.getFlow(view.id); if (!flow) return;

            const debouncedUpdate = debounce(() => flowManager.updateFlow(flow), 500);

            renderFlow(flow);
            const canvas = document.getElementById('flow-canvas');
            canvas.addEventListener('mousedown', (e) => handleCanvasMouseDown(e, flow, debouncedUpdate));
            canvas.addEventListener('mousemove', (e) => handleCanvasMouseMove(e, flow, debouncedUpdate));
            canvas.addEventListener('mouseup', (e) => handleCanvasMouseUp(e, flow, debouncedUpdate));
            canvas.addEventListener('change', (e) => {
                const step = flow.steps.find(s => s.id === e.target.dataset.id);
                if (step && stepTypes[step.type]?.onUpdate) {
                    stepTypes[step.type].onUpdate(step, e.target);
                    debouncedUpdate();
                }
            });
            canvas.addEventListener('click', (e) => {
                 if (e.target.classList.contains('delete-flow-step-btn')) {
                    const stepId = e.target.dataset.id;
                    flow.steps = flow.steps.filter(s => s.id !== stepId);
                    flow.connections = flow.connections.filter(c => c.from !== stepId && c.to !== stepId);
                    flowManager.updateFlow(flow);
                    renderFlow(flow);
                }
            });
            const dropdown = document.getElementById('add-step-dropdown');
            document.getElementById('add-flow-step-btn').addEventListener('click', (e) => { e.stopPropagation(); dropdown.classList.toggle('show'); });
            dropdown.addEventListener('click', (e) => {
                const type = e.target.dataset.stepType;
                if (type && stepTypes[type]) {
                    flow.steps.push({ id: `step-${Date.now()}`, type, x: 50, y: 50, data: stepTypes[type].getDefaults() });
                    flowManager.updateFlow(flow);
                    renderFlow(flow);
                    dropdown.classList.remove('show');
                }
            });
            window.addEventListener('click', (e) => { if (!e.target.matches('#add-flow-step-btn')) dropdown.classList.remove('show'); });
        } else if (view.type === 'chat') {
            const runBtn = document.getElementById('run-chat-flow-btn');
            if (runBtn) {
                runBtn.addEventListener('click', () => {
                    const selector = document.getElementById('flow-selector');
                    const flowId = selector.value;
                    if (flowId) {
                        const flow = flowManager.getFlow(flowId);
                        if (flow) {
                            activeFlowRunner = new FlowRunner(flow, appInstance);
                            activeFlowRunner.start();
                        }
                    }
                });
            }
        }
    },
    onResponseComplete(message, chat) { if (activeFlowRunner) activeFlowRunner.continue(); }
};

pluginManager.register(flowsPlugin);
