/**
 * @fileoverview Plugin for creating, managing, and executing complex, node-based
 * workflows called "Flows". This plugin provides a visual editor for building
 * flows and a runner for executing their logic.
 * @version 2.3.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { debounce, importJson, exportJson, generateUniqueName } from '../utils.js';
import { registerFlowStepDefinitions } from './flows-plugin-step-definitions.js';
import { DataManager } from '../data-manager.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('./chats-plugin.js').Chat} Chat
 * @typedef {import('../main.js').View} View
 * @typedef {import('../main.js').Tab} Tab
 */

/**
 * Represents a single step (or node) within a flow.
 * @typedef {object} FlowStep
 * @property {string} id - The unique identifier for this step instance.
 * @property {string} type - The type of the step (e.g., 'simple-prompt', 'branch').
 * @property {number} x - The x-coordinate of the step's position on the canvas.
 * @property {number} y - The y-coordinate of the step's position on the canvas.
 * @property {boolean} isMinimized - Whether the step's UI is currently minimized.
 * @property {object} data - A key-value store for the step's specific configuration data.
 */

/**
 * Represents a connection (or edge) between two steps in a flow.
 * @typedef {object} FlowConnection
 * @property {string} from - The ID of the step where the connection originates.
 * @property {string} to - The ID of the step where the connection terminates.
 * @property {string} outputName - The name of the output connector on the 'from' step.
 */

/**
 * Represents a complete flow, including its steps and their connections.
 * @typedef {object} Flow
 * @property {string} id - The unique identifier for the flow.
 * @property {string} name - The display name of the flow.
 * @property {FlowStep[]} steps - An array of all the steps in the flow.
 * @property {FlowConnection[]} connections - An array of all the connections in the flow.
 */

/**
 * The execution context object passed to a step's `execute` function.
 * It provides the step with access to the application and methods to control the flow's execution.
 * @typedef {object} FlowExecutionContext
 * @property {App} app - The main application instance.
 * @property {(fromStepId: string, outputName?: string) => FlowStep | undefined} getNextStep - A function to get the next step connected to a specific output.
 * @property {(step: FlowStep) => void} executeStep - A function to immediately execute a given step.
 * @property {(message?: string) => void} stopFlow - A function to stop the current flow's execution.
 */

/**
 * Defines the behavior and appearance of a type of flow step.
 * @typedef {object} FlowStepDefinition
 * @property {string} label - The display name of the step type in the "Add Step" menu.
 * @property {() => object} getDefaults - A function that returns the default data object for a new step of this type.
 * @property {(step: FlowStep, agentOptions: string) => string} render - A function that returns the HTML for the step's UI.
 * @property {(step: FlowStep, target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, renderAndConnect: () => void) => void} onUpdate - A function called when a UI input value changes.
 * @property {(step: FlowStep, context: FlowExecutionContext) => void} execute - The function that contains the step's execution logic.
 */

let flowManager = null;

/**
 * Manages the entire lifecycle, execution, and UI of flows. It handles loading,
 * saving, and editing flows, as well as orchestrating the flow editor canvas
 * and delegating execution to the `FlowRunner`.
 * @class
 */
export class FlowManager {
    /**
     * Creates an instance of FlowManager.
     * @constructor
     * @param {App} app The main application instance.
     */
    constructor(app) {
        this.app = app;
        this.listPane = null;
        this.dataManager = new DataManager('core_flows', 'flow');
        this.flows = this.dataManager.getAll();
        this.stepTypes = {};
        this.activeFlowRunner = null;
        this.dragInfo = {};
        this.panInfo = {};
        this.connectionInfo = {};
        this._defineSteps();
    }

    /**
     * Retrieves a flow by its ID.
     * @param {string} id The ID of the flow to retrieve.
     * @returns {Flow|undefined} The flow object, or undefined if not found.
     */
    getFlow(id) { return this.dataManager.get(id); }

    /**
     * Adds a new flow.
     * @param {object} flowData The data for the new flow.
     * @returns {Flow} The newly created flow.
     */
    addFlow(flowData) {
        const existingNames = this.flows.map(f => f.name);
        const name = generateUniqueName(flowData.name || 'New Flow', existingNames);
        return this.dataManager.add({ ...flowData, name });
    }

    /**
     * Updates an existing flow.
     * @param {Flow} flowData The flow data to update.
     */
    updateFlow(flowData) { this.dataManager.update(flowData); }

    /**
     * Deletes a flow by its ID.
     * @param {string} id The ID of the flow to delete.
     */
    deleteFlow(id) { this.dataManager.delete(id); }

    /**
     * Adds a flow from imported data.
     * @param {object} flowData The flow data to import.
     * @returns {Flow} The added flow.
     */
    addFlowFromData(flowData) {
        const newFlow = this.dataManager.addFromData(flowData);
        if (this.listPane) {
            this.listPane.renderList();
        }
        return newFlow;
    }

    /**
     * Starts the execution of a flow.
     * @param {string} flowId The ID of the flow to start.
     */
    async startFlow(flowId) {
        const flow = this.getFlow(flowId);
        if (flow) {
            this.activeFlowRunner = new FlowRunner(flow, this.app, this);
            await this.activeFlowRunner.start();
        }
    }

    /**
     * Defines a new type of flow step.
     * @param {string} type The type of the step.
     * @param {FlowStepDefinition} definition The definition of the step.
     * @private
     */
    _defineStep(type, definition) { this.stepTypes[type] = { ...definition, type }; }

    /**
     * Registers all the standard flow step definitions.
     * @private
     */
    _defineSteps() {
        registerFlowStepDefinitions(this);
    }

    /**
     * Updates the active flow in the list pane.
     */
    updateActiveFlowInList() {
        if (this.listPane) {
            this.listPane.updateActiveItem();
        }
    }

    /**
     * Renders the placeholder container for the flow editor view.
     * @param {string | null} flowId - The ID of the flow to render the editor for. If null, shows a welcome message.
     * @returns {string} The HTML string for the editor's container.
     */
    renderFlowEditor(flowId) {
        if (flowId) {
            return `
                <div id="flow-editor-container" data-flow-id="${flowId}">
                    <div id="flow-canvas-wrapper"><div id="flow-canvas">
                        <svg id="flow-svg-layer"></svg>
                        <div id="flow-node-container"></div>
                    </div></div>
                </div>`;
        } else {
            return `
                <div id="flow-editor-container">
                    <div class="centered-message" style="text-align: center; padding: 2rem; color: var(--text-color-secondary);">
                        Select a flow from the list on the right, or create a new one to get started.
                    </div>
                </div>`;
        }
    }

    /**
     * Renders the connections (lines) between steps on the SVG layer.
     * @param {Flow} flow - The flow whose connections are to be rendered.
     */
    updateConnections(flow) {
        const nodeContainer = document.getElementById('flow-node-container');
        const svgLayer = document.getElementById('flow-svg-layer');
        if (!nodeContainer || !svgLayer) return;

        // Clear previous connections and buttons
        svgLayer.querySelectorAll('line').forEach(l => l.remove());
        nodeContainer.querySelectorAll('.delete-connection-btn').forEach(btn => btn.remove());

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
            line.setAttribute('stroke', 'var(--text-color)');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('marker-end', 'url(#arrowhead)');
            svgLayer.appendChild(line);

            // Add delete button at the midpoint of the connection
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-connection-btn';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.dataset.from = conn.from;
            deleteBtn.dataset.to = conn.to;
            deleteBtn.dataset.outputName = conn.outputName || 'default';
            deleteBtn.style.position = 'absolute';
            deleteBtn.style.left = `${(x1 + x2) / 2 - 8}px`;
            deleteBtn.style.top = `${(y1 + y2) / 2 - 8}px`;
            nodeContainer.appendChild(deleteBtn);
        });
    }

    /**
     * Renders all the steps (nodes) for a given flow onto the canvas.
     * @param {Flow} flow - The flow to render.
     */
    renderFlow(flow) {
        const nodeContainer = document.getElementById('flow-node-container');
        if (!nodeContainer) return;
        nodeContainer.innerHTML = ''; // Clear only the nodes

        const svgLayer = document.getElementById('flow-svg-layer');
        if (svgLayer && !svgLayer.querySelector('defs')) {
            // Add SVG definitions for the arrowhead marker on connections.
            svgLayer.innerHTML = '<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="15" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-color)"></path></marker></defs>';
        }

        const agentOptions = this.app.agentManager.agents.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        flow.steps.forEach(step => {
            const stepDef = this.stepTypes[step.type];
            if (!stepDef) return;
            const node = document.createElement('div');
            const cardClass = `flow-step-card ${step.isMinimized ? 'minimized' : ''}`;
            node.className = cardClass.trim();
            node.dataset.id = step.id;
            node.style.left = `${step.x}px`;
            node.style.top = `${step.y}px`;
            if (stepDef.color) {
                node.style.backgroundColor = stepDef.color;
            }
            const selectedAgentOptions = this.app.agentManager.agents.map(a => `<option value="${a.id}" ${step.data.agentId === a.id ? 'selected' : ''}>${a.name}</option>`).join('');
            const outputConnectors = stepDef.renderOutputConnectors
                ? stepDef.renderOutputConnectors(step)
                : `<div class="connector-group"><div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="default"></div></div>`;
            node.innerHTML = `<button class="minimize-flow-step-btn" data-id="${step.id}">${step.isMinimized ? '+' : '-'}</button><div class="connector top" data-id="${step.id}" data-type="in"></div>${stepDef.render(step, selectedAgentOptions)}<div class="flow-step-footer"><button class="delete-flow-step-btn" data-id="${step.id}">Delete</button></div>${outputConnectors}`;
            nodeContainer.appendChild(node);

            if (stepDef.onMount) {
                stepDef.onMount(step, node, this.app);
            }
        });
    }

    // --- Canvas Interaction ---
    /**
     * Resets all canvas interaction states (dragging, panning, connecting).
     * @private
     */
    _resetInteractions() {
        const canvas = document.getElementById('flow-canvas');
        if (canvas) canvas.classList.remove('panning');
        this.dragInfo = { active: false }; this.panInfo = { active: false };
        if (this.connectionInfo.tempLine) this.connectionInfo.tempLine.remove();
        this.connectionInfo = { active: false };
    }

    /**
     * Handles the `mousedown` event on the flow canvas to initiate dragging,
     * panning, or creating a new connection.
     * @param {MouseEvent} e - The mouse event.
     * @param {Flow} flow - The current flow.
     * @param {() => void} debouncedUpdate - The debounced function to save the flow.
     * @private
     */
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

    /**
     * Handles the `mousemove` event on the flow canvas to update the position
     * of a dragged node, pan the canvas, or draw a temporary connection line.
     * @param {MouseEvent} e - The mouse event.
     * @param {Flow} flow - The current flow.
     * @private
     */
    _handleCanvasMouseMove(e, flow) {
        if (this.dragInfo.active) {
            this.dragInfo.target.style.left = `${e.clientX - this.dragInfo.offsetX}px`;
            this.dragInfo.target.style.top = `${e.clientY - this.dragInfo.offsetY}px`;
            this.updateConnections(flow);
        } else if (this.connectionInfo.active) {
            const fromNode = this.connectionInfo.fromNode;
            const outConn = this.connectionInfo.fromConnector;
            const wrapper = document.getElementById('flow-canvas-wrapper');
            const rect = wrapper.getBoundingClientRect();

            const startX = fromNode.offsetLeft + outConn.offsetLeft + outConn.offsetWidth / 2;
            const startY = fromNode.offsetTop + outConn.offsetTop + outConn.offsetHeight / 2;

            const endX = e.clientX - rect.left + wrapper.scrollLeft;
            const endY = e.clientY - rect.top + wrapper.scrollTop;

            this.connectionInfo.tempLine.setAttribute('x1', startX);
            this.connectionInfo.tempLine.setAttribute('y1', startY);
            this.connectionInfo.tempLine.setAttribute('x2', endX);
            this.connectionInfo.tempLine.setAttribute('y2', endY);
        } else if (this.panInfo.active) {
            e.preventDefault();
            const wrapper = document.getElementById('flow-canvas-wrapper');
            wrapper.scrollLeft = this.panInfo.scrollLeft - (e.clientX - this.panInfo.startX);
            wrapper.scrollTop = this.panInfo.scrollTop - (e.clientY - this.panInfo.startY);
        }
    }

    /**
     * Handles the `mouseup` event on the flow canvas to finalize dragging,
     * panning, or creating a new connection.
     * @param {MouseEvent} e - The mouse event.
     * @param {Flow} flow - The current flow.
     * @param {() => void} debouncedUpdate - The debounced function to save the flow.
     * @private
     */
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
                    // Re-render to show the new connection
                    const renderAndConnect = () => {
                        this.renderFlow(flow);
                        setTimeout(() => this.updateConnections(flow), 0);
                    };
                    renderAndConnect();
                }
            }
        }
        this._resetInteractions();
    }
}

/**
 * Executes a flow by traversing its steps and connections based on the flow's
 * structure and the logic defined in each step.
 * @class
 */
class FlowRunner {
    /**
     * Creates an instance of FlowRunner.
     * @param {Flow} flow - The flow to be executed.
     * @param {App} app - The main application instance.
     * @param {FlowManager} manager - The `FlowManager` instance.
     */
    constructor(flow, app, manager) {
        this.flow = flow;
        this.app = app;
        this.manager = manager;
        this.currentStepId = null;
        this.isRunning = false;
        this.multiPromptInfo = { active: false, step: null, counter: 0, baseMessage: null };
    }

    /**
     * Starts the execution of the flow. It finds the starting node (one with no
     * incoming connections) and begins execution from there.
     */
    async start() {
        if (this.isRunning) return;
        const startNode = this.flow.steps.find(s => !this.flow.connections.some(c => c.to === s.id));
        if (!startNode) return alert('Flow has no starting node!');
        this.isRunning = true;
        await this.executeStep(startNode);
    }

    /**
     * Stops the execution of the flow and resets its state.
     * @param {string} [message='Flow stopped.'] - A message to log to the console.
     */
    stop(message = 'Flow stopped.') {
        this.isRunning = false;
        this.currentStepId = null;
        this.multiPromptInfo = { active: false, step: null, counter: 0, baseMessage: null };
        console.log(message);
        this.manager.activeFlowRunner = null;
    }

    /**
     * Executes a single step of the flow.
     * @param {FlowStep} step - The step to execute.
     */
    async executeStep(step) {
        if (!this.isRunning) return;
        this.currentStepId = step.id;
        const stepDef = this.manager.stepTypes[step.type];
        if (stepDef?.execute) {
            await stepDef.execute(step, {
                app: this.app,
                getNextStep: (id, out) => this.getNextStep(id, out),
                executeStep: async (next) => await this.executeStep(next),
                stopFlow: (msg) => this.stop(msg),
            });
        } else {
            this.stop(`Unknown step type: ${step.type}`);
        }
    }

    /**
     * Finds the next step in the flow connected to a given step's output.
     * @param {string} stepId - The ID of the step to start from.
     * @param {string} [outputName='default'] - The name of the output connector.
     * @returns {FlowStep | undefined} The next step, or `undefined` if not found.
     */
    getNextStep(stepId, outputName = 'default') {
        const conn = this.flow.connections.find(c => c.from === stepId && (c.outputName || 'default') === outputName);
        return conn ? this.flow.steps.find(s => s.id === conn.to) : undefined;
    }

    /**
     * Continues the flow execution after an asynchronous operation (like an AI response) has completed.
     * This method is called by the `onResponseComplete` hook.
     * @param {Message | null} message - The message that was just completed, or `null` if it's an idle check.
     * @param {Chat} chat - The active chat instance.
     * @returns {boolean} `true` if the flow proceeded and scheduled new work, `false` otherwise.
     */
    async continue(message, chat) {
         // Only act when a flow is running, a step is selected, and the AI is idle.
        if (!this.isRunning || !this.currentStepId || message !== null) return false;

        if (this.multiPromptInfo.active) {
            // --- Multi-Prompt Handling ---
            const info = this.multiPromptInfo;
            const step = info.step;

            if (info.counter < step.data.count) {
                info.counter++;
                // Add a new alternative with a pending message.
                chat.log.addAlternative(info.baseMessage, { role: 'assistant', content: null, agent: step.data.agentId });
                // Trigger the processing of the new pending message.
                this.app.responseProcessor.scheduleProcessing(this.app);
                return true; // Flow is still active, handled work.
            } else {
                // Multi-prompt is finished.
                this.multiPromptInfo = { active: false, step: null, counter: 0, baseMessage: null };
                const nextStep = this.getNextStep(step.id);
                if (nextStep) {
                    await this.executeStep(nextStep);
                    return true; // A new step was executed.
                } else {
                    this.stop('Flow execution complete.');
                    return false; // Flow finished, no new work.
                }
            }
        } else {
            // --- Normal Prompt Handling ---
            const stepDef = this.manager.stepTypes[this.flow.steps.find(s => s.id === this.currentStepId)?.type];
            if (stepDef?.execute?.toString().includes('handleFormSubmit')) {
                const nextStep = this.getNextStep(this.currentStepId);
                if (nextStep) {
                    await this.executeStep(nextStep);
                    return true; // A new step was executed.
                } else {
                    this.stop('Flow execution complete.');
                    return false; // Flow finished, no new work.
                }
            }
        }

        return false;
    }
}

// Initialize FlowManager and register views on app init
pluginManager.register({
    name: 'Flows',
    onAppInit(app) {
        flowManager = new FlowManager(app);
        app.flowManager = flowManager;
        pluginManager.registerView('flow-editor', (id) => flowManager.renderFlowEditor(id));
    },

    onViewRendered(view) {
        if (view.type === 'flow-editor') {
            if (flowManager.listPane) {
                flowManager.listPane.renderActions();
                flowManager.listPane.updateActiveItem();
            }

            const flow = flowManager.getFlow(view.id);
            if (flow) {
                const renderAndConnect = () => {
                    flowManager.renderFlow(flow);
                    // Use a timeout to ensure nodes are in the DOM before drawing connections
                    setTimeout(() => flowManager.updateConnections(flow), 0);
                };

                const debouncedUpdate = debounce(() => flowManager.updateFlow(flow), 500);

                renderAndConnect(); // Initial render

                const canvas = document.getElementById('flow-canvas');
                // Use a proxy element for event delegation to avoid re-attaching listeners
                const canvasProxy = canvas.closest('#flow-editor-container');

                // Check if listener is already attached to avoid duplicates
                if (!canvasProxy.dataset.eventsAttached) {
                     canvasProxy.dataset.eventsAttached = 'true';
                     canvasProxy.addEventListener('mousedown', (e) => flowManager._handleCanvasMouseDown(e, flow, debouncedUpdate));
                     canvasProxy.addEventListener('mousemove', (e) => flowManager._handleCanvasMouseMove(e, flow));
                     canvasProxy.addEventListener('mouseup', (e) => flowManager._handleCanvasMouseUp(e, flow, debouncedUpdate));
                     canvasProxy.addEventListener('change', (e) => {
                        const stepId = e.target.closest('.flow-step-card')?.dataset.id;
                        if (!stepId) return;
                        const step = flow.steps.find(s => s.id === stepId);
                        if (step && flowManager.stepTypes[step.type]?.onUpdate) {
                            flowManager.stepTypes[step.type].onUpdate(step, e.target, renderAndConnect);
                            debouncedUpdate();
                        }
                    });
                     canvasProxy.addEventListener('click', (e) => {
                        const target = e.target;
                        if (target.classList.contains('delete-flow-step-btn')) {
                            const stepId = target.closest('.flow-step-card').dataset.id;
                            flow.steps = flow.steps.filter(s => s.id !== stepId);
                            flow.connections = flow.connections.filter(c => c.from !== stepId && c.to !== stepId);
                        } else if (target.classList.contains('delete-connection-btn')) {
                            const { from, to, outputName } = target.dataset;
                            flow.connections = flow.connections.filter(c =>
                                !(c.from === from && c.to === to && (c.outputName || 'default') === outputName)
                            );
                        } else if (target.classList.contains('minimize-flow-step-btn')) {
                            const stepId = target.closest('.flow-step-card').dataset.id;
                            const step = flow.steps.find(s => s.id === stepId);
                            if (step) step.isMinimized = !step.isMinimized;
                        } else {
                            return; // Not a relevant click, do nothing
                        }
                        flowManager.updateFlow(flow);
                        renderAndConnect();
                    });
                }
            }
        }
    },

    async onResponseComplete(message, chat) {
        if (!flowManager.activeFlowRunner) {
            return false;
        }
        return await flowManager.activeFlowRunner.continue(message, chat);
    },

    onRightPanelRegister(rightPanelManager) {
        rightPanelManager.registerTab({
            id: 'flows',
            label: 'Flows',
            viewType: 'flow-editor',
            listPane: {
                dataManager: flowManager.dataManager,
                viewType: 'flow-editor',
                addNewButtonLabel: 'Add New Flow',
                onAddNew: () => flowManager.addFlow({ name: 'New Flow', steps: [], connections: [] }),
                getItemName: (item) => item.name,
                onDelete: (itemId, itemName) => {
                    const flow = flowManager.getFlow(itemId);
                    if (flow && flow.steps.length > 0) {
                        return confirm('This flow is not empty. Are you sure you want to delete it?');
                    }
                    return true;
                },
                actions: () => {
                    const activeFlow = flowManager.getFlow(flowManager.app.activeView.id);
                    const actions = [{
                        id: 'load-flow-btn',
                        label: 'Load Flow',
                        className: 'btn-gray',
                        onClick: () => importJson('.flow', (data) => {
                            const newFlow = flowManager.addFlowFromData(data);
                            flowManager.app.setView('flow-editor', newFlow.id);
                        }),
                    }];

                    if (activeFlow) {
                        actions.push({
                            id: 'save-flow-btn',
                            label: 'Save Flow',
                            className: 'btn-gray',
                            onClick: () => exportJson(activeFlow, activeFlow.name.replace(/[^a-z0-9]/gi, '_').toLowerCase(), 'flow'),
                        });
                    }
                    return actions;
                },
            },
            onActivate: () => {
                if (!flowManager.app.lastActiveIds['flow-editor']) {
                    flowManager.app.setView('flow-editor', null);
                }
            },
        });
    },

    onTitleBarRegister(config, view, app) {
        if (view.type !== 'flow-editor') {
            return config;
        }

        const flow = flowManager.getFlow(view.id);
        if (flow) {
            config.titleParts = [{
                text: flow.name,
                onSave: (newName) => {
                    flow.name = newName;
                    flowManager.updateFlow(flow);
                    if (flowManager.listPane) {
                        flowManager.listPane.renderList();
                    }
                    app.topPanelManager.render();
                }
            }];

            const dropdownContent = Object.entries(flowManager.stepTypes)
                .map(([type, { label, icon, color }]) => {
                    if (icon && color) {
                        const coloredIcon = icon.replace('<svg', `<svg style="stroke: ${color};"`);
                        return `<a href="#" data-step-type="${type}">${coloredIcon} ${label}</a>`;
                    }
                    return `<a href="#" data-step-type="${type}">${icon || ''} ${label}</a>`;
                })
                .join('');

            config.buttons = [{
                id: 'add-flow-step-btn',
                label: 'Add Step ▾',
                className: 'primary-btn',
                dropdownContent: dropdownContent,
                onClick: (e) => {
                    const type = e.target.dataset.stepType;
                    if (type && flowManager.stepTypes[type]) {
                        const stepData = flowManager.stepTypes[type].getDefaults();
                        flow.steps.push({
                            id: `step-${Date.now()}`, type, x: 50, y: 50, isMinimized: false, data: stepData
                        });
                        flowManager.updateFlow(flow);
                        // Re-render view to show the new step
                        app.renderMainView();
                    }
                }
            }];
        } else {
            config.titleParts = ['Flow Editor'];
            config.buttons = [];
        }

        return config;
    }
});
