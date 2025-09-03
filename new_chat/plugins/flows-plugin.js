/**
 * @fileoverview Plugin for the flow editor.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { stepTypes } from './flow-step-definitions.js';
import { exportJson, importJson } from '../utils.js';

const flowsPlugin = {
    /** @type {import('../main.js').App} */
    app: null,
    dragInfo: { active: false, target: null, offsetX: 0, offsetY: 0 },
    connectionInfo: { active: false, fromNode: null, fromConnector: null, tempLine: null },
    flowRunning: false,
    currentStepId: null,
    multiMessageInfo: { active: false, step: null, counter: 0, userMessage: null },

    /**
     * Initializes the plugin.
     * @param {import('../main.js').App} app The main application instance.
     */
    onAppInit(app) {
        this.app = app;
    },

    /**
     * Registers the 'Flow' tab.
     * @param {Array<Object>} tabs The original tabs array.
     * @returns {Array<Object>} The modified tabs array.
     */
    onTabsRegistered(tabs) {
        tabs.push({
            id: 'flow',
            label: 'Flow',
            onActivate: () => this.renderFlowTab(),
        });
        return tabs;
    },

    /**
     * Renders the content of the 'Flow' tab.
     */
    renderFlowTab() {
        const pane = document.getElementById('flow-pane');
        if (!pane) return;

        const dropdownContent = Object.entries(stepTypes)
            .map(([type, { label }]) => `<a href="#" data-step-type="${type}">${label}</a>`)
            .join('');

        pane.innerHTML = `
            <div class="flow-toolbar">
                <div class="dropdown">
                    <button id="add-step-btn">Add Step &#9662;</button>
                    <div id="add-step-dropdown" class="dropdown-content">
                        ${dropdownContent}
                    </div>
                </div>
                <button id="run-flow-btn">Run Flow</button>
                <button id="export-flow-btn">Export Flow</button>
                <button id="import-flow-btn">Import Flow</button>
            </div>
            <div id="flow-canvas-wrapper">
                <div id="flow-canvas">
                    <svg id="flow-svg-layer"></svg>
                    <div id="flow-node-container"></div>
                </div>
            </div>
        `;

        this.renderFlow();
        this.initEventListeners();
    },

    /**
     * Renders the visual representation of the flow from chat data.
     */
    renderFlow() {
        const chat = this.app.getActiveChat();
        const nodeContainer = document.getElementById('flow-node-container');
        const svgLayer = document.getElementById('flow-svg-layer');

        if (!nodeContainer || !svgLayer) return;

        nodeContainer.innerHTML = '';
        svgLayer.innerHTML = '';

        if (!chat || !chat.flow || !chat.flow.steps) {
            return;
        }

        const agents = chat.agents || [];

        // Render nodes
        chat.flow.steps.forEach(step => {
            const stepDef = stepTypes[step.type];
            if (!stepDef) {
                console.error(`Unknown step type: ${step.type}`);
                return;
            }

            const node = document.createElement('div');
            node.className = 'flow-step-card';
            node.dataset.id = step.id;
            node.style.left = `${step.x}px`;
            node.style.top = `${step.y}px`;

            const content = stepDef.render(step, agents);

            let outputConnectors = '';
            if (step.type === 'branching-prompt') {
                outputConnectors = `
                    <div class="connector-group">
                        <div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="pass"><span class="connector-label">Pass</span></div>
                        <div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="fail"><span class="connector-label">Fail</span></div>
                    </div>`;
            } else {
                outputConnectors = `<div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="default"></div>`;
            }

            node.innerHTML = `
                <div class="connector top" data-id="${step.id}" data-type="in"></div>
                ${content}
                <div class="flow-step-buttons">
                    <button class="delete-flow-step-btn" data-id="${step.id}">Delete</button>
                </div>
                 ${outputConnectors}
            `;
            nodeContainer.appendChild(node);
        });

        // Define SVG marker for arrowheads
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `
            <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-color)"></path>
            </marker>
        `;
        svgLayer.appendChild(defs);

        // Render connections
        if (chat.flow.connections) {
            chat.flow.connections.forEach(conn => {
                const fromNode = nodeContainer.querySelector(`.flow-step-card[data-id="${conn.from}"]`);
                const toNode = nodeContainer.querySelector(`.flow-step-card[data-id="${conn.to}"]`);
                if (fromNode && toNode) {
                    const outConnector = fromNode.querySelector(`.connector.bottom[data-output-name="${conn.outputName || 'default'}"]`);
                    const inConnector = toNode.querySelector('.connector.top');

                    if (!outConnector || !inConnector) return;

                    const x1 = fromNode.offsetLeft + outConnector.offsetLeft + outConnector.offsetWidth / 2;
                    const y1 = fromNode.offsetTop + outConnector.offsetTop + outConnector.offsetHeight / 2;
                    const x2 = toNode.offsetLeft + inConnector.offsetLeft + inConnector.offsetWidth / 2;
                    const y2 = toNode.offsetTop + inConnector.offsetTop + inConnector.offsetHeight;

                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    const d = `M ${x1} ${y1} C ${x1} ${y1 + 50}, ${x2} ${y2 - 50}, ${x2} ${y2}`;
                    line.setAttribute('d', d);
                    line.setAttribute('stroke', 'var(--text-color)');
                    line.setAttribute('stroke-width', '2');
                    line.setAttribute('fill', 'none');
                    line.setAttribute('marker-end', 'url(#arrowhead)');
                    svgLayer.appendChild(line);

                    // Add a delete button for the connection
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'delete-connection-btn';
                    deleteBtn.innerHTML = '&times;';
                    deleteBtn.dataset.from = conn.from;
                    deleteBtn.dataset.to = conn.to;
                    deleteBtn.dataset.output = conn.outputName || 'default';
                    deleteBtn.style.position = 'absolute';
                    deleteBtn.style.left = `${(x1 + x2) / 2 - 8}px`;
                    deleteBtn.style.top = `${(y1 + y2) / 2 - 8}px`;
                    nodeContainer.appendChild(deleteBtn);
                }
            });
        }
    },

    /**
     * Initializes event listeners for the flow editor UI.
     */
    initEventListeners() {
        const pane = document.getElementById('flow-pane');
        if (!pane) return;

        pane.addEventListener('click', (e) => this.handleClick(e));
        pane.addEventListener('change', (e) => this.handleUpdate(e));

        const canvas = document.getElementById('flow-canvas');
        if(!canvas) return;
        canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e)); // End drag if mouse leaves canvas
    },

    handleClick(e) {
        const target = e.target;
        // --- Add Step Dropdown ---
        if (target.id === 'add-step-btn') {
            document.getElementById('add-step-dropdown').classList.toggle('show');
        } else if (target.closest('.dropdown-content a')) {
            e.preventDefault();
            const stepType = target.dataset.stepType;
            this.addFlowStep(stepType);
            document.getElementById('add-step-dropdown').classList.remove('show');
        } else if (!target.closest('.dropdown')) {
            const dropdown = document.getElementById('add-step-dropdown');
            if (dropdown && dropdown.classList.contains('show')) {
                dropdown.classList.remove('show');
            }
        }

        // --- Delete Step ---
        if (target.classList.contains('delete-flow-step-btn')) {
            const stepId = target.dataset.id;
            if (confirm('Are you sure you want to delete this step?')) {
                this.deleteFlowStep(stepId);
            }
        }

        // --- Delete Connection ---
        if (target.classList.contains('delete-connection-btn')) {
            const fromId = target.dataset.from;
            const toId = target.dataset.to;
            const outputName = target.dataset.output;
            this.deleteConnection(fromId, toId, outputName);
        }

        // --- Run Flow ---
        if (target.id === 'run-flow-btn') {
            this.toggleFlow();
        }

        // --- Import/Export ---
        if (target.id === 'export-flow-btn') {
            this.exportFlow();
        }
        if (target.id === 'import-flow-btn') {
            this.importFlow();
        }
    },

    handleUpdate(e) {
        const target = e.target;
        if (!target.classList.contains('flow-step-input')) return;

        const stepId = target.dataset.id;
        const chat = this.app.getActiveChat();
        if (!chat || !chat.flow) return;

        const step = chat.flow.steps.find(s => s.id === stepId);
        if (!step) return;

        const stepDef = stepTypes[step.type];
        if (stepDef && stepDef.onUpdate) {
            stepDef.onUpdate(step, target);
            this.app.saveChats();
        }
    },

    handleMouseDown(e) {
        const target = e.target;

        // Prevent starting a drag on interactive elements within a node
        if (target.matches('input, select, textarea, button, label')) {
            return;
        }

        if (target.classList.contains('connector')) {
            this.connectionInfo.active = true;
            this.connectionInfo.fromNode = target.closest('.flow-step-card');
            this.connectionInfo.fromConnector = target;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            line.setAttribute('stroke', 'var(--accent-color)');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('fill', 'none');
            this.connectionInfo.tempLine = line;
            document.getElementById('flow-svg-layer').appendChild(line);

        } else if (target.closest('.flow-step-card')) {
            e.preventDefault();
            this.dragInfo.active = true;
            this.dragInfo.target = target.closest('.flow-step-card');
            const rect = this.dragInfo.target.getBoundingClientRect();
            this.dragInfo.offsetX = e.clientX - rect.left;
            this.dragInfo.offsetY = e.clientY - rect.top;
        }
    },

    handleMouseMove(e) {
        if (this.dragInfo.active) {
            const newX = e.clientX - this.dragInfo.offsetX;
            const newY = e.clientY - this.dragInfo.offsetY;
            this.dragInfo.target.style.left = `${newX}px`;
            this.dragInfo.target.style.top = `${newY}px`;
            this.renderFlow(); // Re-render to update connections
        } else if (this.connectionInfo.active) {
            const fromRect = this.connectionInfo.fromConnector.getBoundingClientRect();
            const canvasRect = document.getElementById('flow-canvas').getBoundingClientRect();

            const startX = fromRect.left - canvasRect.left + fromRect.width / 2;
            const startY = fromRect.top - canvasRect.top + fromRect.height / 2;
            const endX = e.clientX - canvasRect.left;
            const endY = e.clientY - canvasRect.top;

            const d = `M ${startX} ${startY} C ${startX} ${startY + 50}, ${endX} ${endY - 50}, ${endX} ${endY}`;
            this.connectionInfo.tempLine.setAttribute('d', d);
        }
    },

    handleMouseUp(e) {
        if (this.dragInfo.active) {
            const stepId = this.dragInfo.target.dataset.id;
            const chat = this.app.getActiveChat();
            const step = chat.flow.steps.find(s => s.id === stepId);
            if (step) {
                // We need to account for the canvas wrapper's scroll position
                const canvasWrapper = document.getElementById('flow-canvas-wrapper');
                step.x = this.dragInfo.target.offsetLeft;
                step.y = this.dragInfo.target.offsetTop;
                this.app.saveChats();
            }
        } else if (this.connectionInfo.active) {
            const toConnector = e.target.closest('.connector[data-type="in"]');
            if (toConnector) {
                const fromNode = this.connectionInfo.fromNode;
                const toNode = toConnector.closest('.flow-step-card');
                const fromId = fromNode.dataset.id;
                const toId = toNode.dataset.id;
                const outputName = this.connectionInfo.fromConnector.dataset.outputName;

                if (fromId !== toId) {
                    this.addConnection(fromId, toId, outputName);
                }
            }
            this.connectionInfo.tempLine.remove();
        }

        this.dragInfo.active = false;
        this.connectionInfo.active = false;
    },

    /**
     * Adds a new step to the flow.
     * @param {string} type The type of step to add.
     */
    addFlowStep(type) {
        const chat = this.app.getActiveChat();
        if (!chat) return;

        if (!chat.flow) {
            chat.flow = { steps: [], connections: [] };
        }

        const stepDef = stepTypes[type];
        if (!stepDef) return;

        const newStep = {
            id: `step-${Date.now()}`,
            type: type,
            x: 100,
            y: 100,
            ...stepDef.getDefaults(),
        };

        chat.flow.steps.push(newStep);
        this.app.saveChats();
        this.renderFlow();
    },

    deleteFlowStep(stepId) {
        const chat = this.app.getActiveChat();
        if (!chat || !chat.flow) return;

        chat.flow.steps = chat.flow.steps.filter(s => s.id !== stepId);
        chat.flow.connections = chat.flow.connections.filter(c => c.from !== stepId && c.to !== stepId);

        this.app.saveChats();
        this.renderFlow();
    },

    addConnection(fromId, toId, outputName) {
        const chat = this.app.getActiveChat();
        if (!chat || !chat.flow) return;

        if (!chat.flow.connections) {
            chat.flow.connections = [];
        }

        // Prevent duplicate connections from the same output port
        const exists = chat.flow.connections.some(c => c.from === fromId && c.outputName === outputName);
        if (exists) {
            console.warn("An output connection from this port already exists.");
            return;
        }

        // Prevent connecting to self
        if (fromId === toId) return;

        chat.flow.connections.push({ from: fromId, to: toId, outputName: outputName });
        this.app.saveChats();
        this.renderFlow();
    },

    deleteConnection(fromId, toId, outputName) {
        const chat = this.app.getActiveChat();
        if (!chat || !chat.flow || !chat.flow.connections) return;

        chat.flow.connections = chat.flow.connections.filter(c =>
            !(c.from === fromId && c.to === toId && (c.outputName || 'default') === outputName)
        );

        this.app.saveChats();
        this.renderFlow();
    },

    // --- Flow Execution ---

    toggleFlow() {
        if (this.flowRunning) {
            this.stopFlow();
        } else {
            this.startFlow();
        }
    },

    updateRunButton(isRunning) {
        const btn = document.getElementById('run-flow-btn');
        if (btn) {
            btn.textContent = isRunning ? 'Stop Flow' : 'Run Flow';
            btn.classList.toggle('active', isRunning);
        }
    },

    startFlow() {
        console.log('Starting flow...');
        const chat = this.app.getActiveChat();
        if (!chat || !chat.flow || !chat.flow.steps || chat.flow.steps.length === 0) {
            alert('Flow has no steps.');
            return;
        }

        const { steps, connections } = chat.flow;
        const nodesWithIncoming = new Set((connections || []).map(c => c.to));
        const startingNodes = steps.filter(s => !nodesWithIncoming.has(s.id));

        if (startingNodes.length === 0) {
            alert('Flow has no starting node (a node with no incoming connections).');
            return;
        }
        if (startingNodes.length > 1) {
            alert('Flow has multiple starting nodes. Please ensure there is only one.');
            return;
        }

        this.flowRunning = true;
        this.updateRunButton(true);
        this.executeStep(startingNodes[0]);
    },

    stopFlow(message = 'Flow stopped by user.') {
        console.log(message);
        this.flowRunning = false;
        this.currentStepId = null;
        this.multiMessageInfo = { active: false, step: null, counter: 0, userMessage: null };
        this.updateRunButton(false);
    },

    executeStep(step) {
        if (!this.flowRunning) return;

        console.log(`Executing step: ${step.id} (${step.type})`);
        this.currentStepId = step.id;
        // Highlight current step visually
        // TODO: Add visual highlight

        const stepDef = stepTypes[step.type];
        if (stepDef && stepDef.execute) {
            const context = {
                app: this.app,
                plugin: this,
                stopFlow: (message) => this.stopFlow(message),
                getNextStep: (stepId, outputName) => this.getNextStep(stepId, outputName),
                executeStep: (nextStep) => this.executeStep(nextStep),
            };
            stepDef.execute(step, context);
        } else {
            this.stopFlow(`Error: Unknown or non-executable step type: ${step.type}`);
        }
    },

    getNextStep(stepId, outputName = 'default') {
        const chat = this.app.getActiveChat();
        if (!chat || !chat.flow || !chat.flow.connections) return null;

        const connection = chat.flow.connections.find(c => c.from === stepId && (c.outputName || 'default') === outputName);
        if (connection) {
            return chat.flow.steps.find(s => s.id === connection.to);
        }
        return null;
    },

    onResponseComplete(message, chat) {
        if (!this.flowRunning) return;

        if (this.multiMessageInfo.active) {
            this.multiMessageInfo.counter++;
            const { step, counter, userMessage } = this.multiMessageInfo;

            if (counter < step.count) {
                // Generate another alternative
                this.app.generateAssistantResponse(userMessage);
            } else {
                // All alternatives generated, move to the next step
                this.multiMessageInfo = { active: false, step: null, counter: 0, userMessage: null };
                const nextStep = this.getNextStep(this.currentStepId);
                if (nextStep) {
                    this.executeStep(nextStep);
                } else {
                    this.stopFlow('Flow complete.');
                }
            }
        } else {
            // Default behavior: move to the next step
            const nextStep = this.getNextStep(this.currentStepId);
            if (nextStep) {
                this.executeStep(nextStep);
            } else {
                this.stopFlow('Flow complete.');
            }
        }
    },

    // --- Import / Export ---

    exportFlow() {
        const chat = this.app.getActiveChat();
        if (!chat || !chat.flow) {
            alert('No flow to export.');
            return;
        }
        const filename = `flow_${chat.title.replace(/\s+/g, '_')}`;
        exportJson(chat.flow, filename);
    },

    importFlow() {
        importJson('.json', (importedFlow) => {
            if (importedFlow && Array.isArray(importedFlow.steps) && Array.isArray(importedFlow.connections)) {
                const chat = this.app.getActiveChat();
                chat.flow = importedFlow;
                this.app.saveChats();
                this.renderFlow();
            } else {
                alert('Invalid flow file format.');
            }
        });
    }
};

pluginManager.register(flowsPlugin);
     * @param {string} type The type of step to add.
     */
    addFlowStep(type) {
        const chat = this.app.getActiveChat();
        if (!chat) return;

        if (!chat.flow) {
            chat.flow = { steps: [], connections: [] };
        }

        const stepDef = stepTypes[type];
        if (!stepDef) return;

        const newStep = {
            id: `step-${Date.now()}`,
            type: type,
            x: 100,
            y: 100,
            ...stepDef.getDefaults(),
        };

        chat.flow.steps.push(newStep);
        this.app.saveChats();
        this.renderFlow();
    }
};

pluginManager.register(flowsPlugin);
