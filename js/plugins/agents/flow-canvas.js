/**
 * @fileoverview Manages the flow canvas UI and interactions.
 */

'use strict';

import { createControlButton } from '../../utils/ui.js';
import { log } from '../../utils/logger.js';
import { stepTypes } from './agent-step-definitions.js';

const INTERACTIVE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'LABEL'];

class FlowCanvas {
    constructor(store, agentsPlugin) {
        this.store = store;
        this.agentsPlugin = agentsPlugin;
        this.canvas = document.getElementById('flow-canvas');
        this.nodeContainer = document.getElementById('flow-node-container');
        this.svgLayer = document.getElementById('flow-svg-layer');
        this.canvasWrapper = document.getElementById('flow-canvas-wrapper');

        this.dragInfo = { active: false, target: null, offsetX: 0, offsetY: 0 };
        this.panInfo = { active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 };
        this.connectionInfo = { active: false, fromNode: null, fromConnector: null, tempLine: null };

        this.init();
    }

    init() {
        this.canvas.addEventListener('mousedown', e => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', e => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', e => this.handleMouseUp(e));
        this.canvas.addEventListener('click', e => this.handleClick(e));
        this.canvas.addEventListener('change', e => this.handleStepChange(e));

        this.store.subscribe('currentChat', () => {
            setTimeout(() => this.render(), 0);
        });
    }

    render() {
        const chat = this.store.get('currentChat');
        const nodeContainer = this.nodeContainer;
        const svgLayer = this.svgLayer;
        nodeContainer.innerHTML = '';
        svgLayer.innerHTML = '';
        if (!chat || !chat.flow) return;

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

        (chat.flow.steps || []).forEach(step => {
            const node = document.createElement('div');
            node.className = 'flow-step-card';
            if (step.type) {
                node.classList.add(`flow-step-${step.type}`);
            }
            if (step.isMinimized) {
                node.classList.add('minimized');
            }
            node.dataset.id = step.id;
            node.style.left = `${step.x}px`;
            node.style.top = `${step.y}px`;
            const type = step.type || 'agent'; // Default to agent for old steps
            const agentOptions = (chat.agents || []).map(a => `<option value="${a.id}" ${step.agentId === a.id ? 'selected' : ''}>${a.name}</option>`).join('');

            const stepDefinition = stepTypes[type];
            let content = '';
            if (stepDefinition && stepDefinition.render) {
                content = stepDefinition.render(step, agentOptions);
            } else {
                content = `<h4>Unknown Step Type: ${type}</h4>`;
            }

            let outputConnectors = '';
            if (type === 'branching-prompt') {
                outputConnectors = `
                    <div class="connector-group">
                        <div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="pass"><span class="connector-label">Pass</span></div>
                        <div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="fail"><span class="connector-label">Fail</span></div>
                    </div>
                `;
            } else {
                outputConnectors = `<div class="connector bottom" data-id="${step.id}" data-type="out" data-output-name="default"></div>`;
            }


            node.innerHTML = `
                <button class="minimize-flow-step-btn" data-id="${step.id}">${step.isMinimized ? '+' : '-'}</button>
                <div class="connector top" data-id="${step.id}" data-type="in"></div>
                ${content}
                <div class="flow-step-content">
                    <button class="delete-flow-step-btn agents-flow-btn" data-id="${step.id}">Delete Step</button>
                </div>
                ${outputConnectors}
            `;
            nodeContainer.appendChild(node);
        });

        (chat.flow.connections || []).forEach(conn => {
            const fromNode = nodeContainer.querySelector(`.flow-step-card[data-id="${conn.from}"]`);
            const toNode = nodeContainer.querySelector(`.flow-step-card[data-id="${conn.to}"]`);
            if (fromNode && toNode) {
                const outConnector = fromNode.querySelector(`.connector.bottom[data-output-name="${conn.outputName || 'default'}"]`);
                const inConnector = toNode.querySelector('.connector.top');
                if (!outConnector) {
                    console.error('Could not find output connector for connection:', conn);
                    return;
                }
                const x1 = fromNode.offsetLeft + outConnector.offsetLeft + outConnector.offsetWidth / 2;
                const y1 = fromNode.offsetTop + outConnector.offsetTop + outConnector.offsetHeight / 2;
                const x2 = toNode.offsetLeft + inConnector.offsetLeft + inConnector.offsetWidth / 2;
                const y2 = toNode.offsetTop + inConnector.offsetTop + inConnector.offsetHeight / 2;
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', x1);
                line.setAttribute('y1', y1);
                line.setAttribute('x2', x2);
                line.setAttribute('y2', y2);
                line.setAttribute('stroke', 'var(--text-color)');
                line.setAttribute('stroke-width', '2');
                line.setAttribute('marker-end', 'url(#arrowhead)');
                svgLayer.appendChild(line);

                // Create a proper HTML button for deleting connections
                const deleteBtn = createControlButton(
                    'Delete Connection',
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 17.069 22H6.93a2 2 0 0 1-1.995-1.858L4.07 8H3a1 1 0 0 1 0-2h4V4zm2 2h6V4H9v2zM6.074 8l.857 12H17.07l.857-12H6.074zM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z" fill="currentColor"/></svg>');
                deleteBtn.classList.add('delete-connection-btn');
                deleteBtn.dataset.from = conn.from;
                deleteBtn.dataset.to = conn.to;
                deleteBtn.dataset.outputName = conn.outputName || 'default';
                deleteBtn.style.position = 'absolute';
                deleteBtn.style.left = `${(x1 + x2) / 2 - 12}px`;
                deleteBtn.style.top = `${(y1 + y2) / 2 - 12}px`;
                deleteBtn.style.zIndex = '10';
                nodeContainer.appendChild(deleteBtn);
            }
        });
    }

    handleMouseDown(e) {
        const target = e.target;
        const canvasWrapper = this.canvasWrapper;

        // Prevent interference with form elements inside a step card
        if (target.closest('.flow-step-card') && INTERACTIVE_TAGS.includes(target.tagName)) {
            return;
        }

        if (target.classList.contains('connector')) {
            this.connectionInfo.active = true;
            this.connectionInfo.fromNode = target.closest('.flow-step-card');
            this.connectionInfo.fromConnector = target;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('stroke', 'red');
            line.setAttribute('stroke-width', '2');
            this.connectionInfo.tempLine = line;
            this.svgLayer.appendChild(line);
        } else if (target.closest('.flow-step-card') && !INTERACTIVE_TAGS.includes(target.tagName)) {
            e.preventDefault();
            this.dragInfo.active = true;
            this.dragInfo.target = target.closest('.flow-step-card');
            this.dragInfo.offsetX = e.clientX - this.dragInfo.target.offsetLeft;
            this.dragInfo.offsetY = e.clientY - this.dragInfo.target.offsetTop;
        } else if (e.target.id === 'flow-canvas' || e.target.id === 'flow-node-container' || e.target.id === 'flow-svg-layer') {
            e.preventDefault();
            this.panInfo.active = true;
            this.panInfo.startX = e.clientX;
            this.panInfo.startY = e.clientY;
            this.panInfo.scrollLeft = canvasWrapper.scrollLeft;
            this.panInfo.scrollTop = canvasWrapper.scrollTop;
            e.target.closest('#flow-canvas').classList.add('panning');
        }
    }

    handleMouseMove(e) {
        if (this.dragInfo.active) {
            const newX = e.clientX - this.dragInfo.offsetX;
            const newY = e.clientY - this.dragInfo.offsetY;
            this.dragInfo.target.style.left = `${newX}px`;
            this.dragInfo.target.style.top = `${newY}px`;
            const step = this.store.get('currentChat').flow.steps.find(s => s.id === this.dragInfo.target.dataset.id);
            if (step) { step.x = newX; step.y = newY; }
            this.render();
        } else if (this.connectionInfo.active) {
            const fromRect = this.connectionInfo.fromConnector.getBoundingClientRect();
            const canvasWrapper = this.canvasWrapper;
            const canvasRect = canvasWrapper.getBoundingClientRect();
            const startX = fromRect.left - canvasRect.left + fromRect.width / 2 + canvasWrapper.scrollLeft;
            const startY = fromRect.top - canvasRect.top + fromRect.height / 2 + canvasWrapper.scrollTop;
            this.connectionInfo.tempLine.setAttribute('x1', startX);
            this.connectionInfo.tempLine.setAttribute('y1', startY);
            this.connectionInfo.tempLine.setAttribute('x2', e.clientX - canvasRect.left + canvasWrapper.scrollLeft);
            this.connectionInfo.tempLine.setAttribute('y2', e.clientY - canvasRect.top + canvasWrapper.scrollTop);
        } else if (this.panInfo.active) {
            e.preventDefault();
            const canvasWrapper = this.canvasWrapper;
            const dx = e.clientX - this.panInfo.startX;
            const dy = e.clientY - this.panInfo.startY;
            canvasWrapper.scrollLeft = this.panInfo.scrollLeft - dx;
            canvasWrapper.scrollTop = this.panInfo.scrollTop - dy;
        }
    }

    handleMouseUp(e) {
        if (this.dragInfo.active) {
            this.store.set('currentChat', { ...this.store.get('currentChat') });
        } else if (this.connectionInfo.active) {
            const toConnector = e.target.classList.contains('connector') ? e.target : e.target.closest('.connector');
            if (toConnector && toConnector.dataset.type === 'in' && toConnector !== this.connectionInfo.fromConnector) {
                const toNode = toConnector.closest('.flow-step-card');
                const fromNode = this.connectionInfo.fromNode;
                const fromConnector = this.connectionInfo.fromConnector;
                const chat = this.store.get('currentChat');

                if (!chat.flow.connections) chat.flow.connections = [];

                const newConnection = {
                    from: fromNode.dataset.id,
                    to: toNode.dataset.id,
                    outputName: fromConnector.dataset.outputName
                };

                // Prevent duplicate connections from the same output port
                const connectionExists = chat.flow.connections.some(c =>
                    c.from === newConnection.from && c.outputName === newConnection.outputName
                );

                if (!connectionExists) {
                    chat.flow.connections.push(newConnection);
                    this.store.set('currentChat', { ...chat });
                } else {
                    log(2, "Connection from this output port already exists.");
                }
            }
            this.connectionInfo.tempLine.remove();
        } else if (this.panInfo.active) {
            this.canvas.classList.remove('panning');
        }
        this.dragInfo.active = false;
        this.connectionInfo.active = false;
        this.panInfo.active = false;
    }

    handleClick(e) {
        const chat = this.store.get('currentChat');
        let chatModified = false;

        const minimizeBtn = e.target.closest('.minimize-flow-step-btn');
        if (minimizeBtn) {
            const stepId = minimizeBtn.dataset.id;
            const step = chat.flow.steps.find(s => s.id === stepId);
            if (step) {
                step.isMinimized = !step.isMinimized;
                chatModified = true;
            }
        }

        const stepDeleteBtn = e.target.closest('.delete-flow-step-btn');
        if (stepDeleteBtn) {
            const stepId = stepDeleteBtn.dataset.id;
            if (stepId && confirm('Are you sure you want to delete this step?')) {
                chat.flow.steps = chat.flow.steps.filter(s => s.id !== stepId);
                chat.flow.connections = (chat.flow.connections || []).filter(c => c.from !== stepId && c.to !== stepId);
                chatModified = true;
            }
        }

        const connDeleteBtn = e.target.closest('.delete-connection-btn');
        if (connDeleteBtn) {
            const fromId = connDeleteBtn.dataset.from;
            const toId = connDeleteBtn.dataset.to;
            const outputName = connDeleteBtn.dataset.outputName;
            if (fromId && toId) {
                chat.flow.connections = (chat.flow.connections || []).filter(c =>
                    !(c.from === fromId && c.to === toId && (c.outputName || 'default') === outputName)
                );
                chatModified = true;
            }
        }

        if (chatModified) {
            this.store.set('currentChat', { ...chat });
        }
    }

    handleStepChange(e) {
        const id = e.target.dataset.id;
        const chat = this.store.get('currentChat');
        const step = chat.flow.steps.find(s => s.id === id);
        if (!step) return;

        const stepDefinition = stepTypes[step.type];
        if (stepDefinition && stepDefinition.onUpdate) {
            stepDefinition.onUpdate(step, e.target, this.render.bind(this), this.store);
        }

        this.store.set('currentChat', { ...chat });
    }
}

export { FlowCanvas };
