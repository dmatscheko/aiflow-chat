/**
 * @fileoverview UI rendering functions for the agents plugin.
 */

'use strict';

import { log, triggerError } from '../../utils/logger.js';
import { hooks } from '../../hooks.js';
import { stepTypes } from './agent-step-definitions.js';
import { createControlButton } from '../../utils/ui.js';

export function renderAgentList(store) {
    const agentList = document.getElementById('agent-list');
    agentList.innerHTML = '';
    const chat = store.get('currentChat');
    if (!chat || !chat.agents) return;
    chat.agents.forEach(agent => {
        const card = document.createElement('div');
        const isActive = agent.id === chat.activeAgentId;
        card.className = `agent-card ${isActive ? 'active' : ''}`;
        card.innerHTML = `
            <h3>${agent.name}</h3><p>${agent.description}</p>
            <div class="agent-card-buttons">
                <button class="agents-flow-btn activate-agent-btn" data-id="${agent.id}">${isActive ? 'Deactivate' : 'Activate'}</button>
                <button class="agents-flow-btn edit-agent-btn" data-id="${agent.id}">Edit</button>
                <button class="agents-flow-btn delete-agent-btn" data-id="${agent.id}">Delete</button>
            </div>`;
        agentList.appendChild(card);
    });
}

export function showAgentForm(agent, store) {
    const formContainer = document.getElementById('agent-form-container');
    const form = document.getElementById('agent-form');
    form.reset();
    document.getElementById('agent-id').value = agent ? agent.id : '';

    const modelSettingsEl = document.getElementById('agent-model-settings');
    const useCustomSettingsCheckbox = document.getElementById('agent-use-custom-settings');

    modelSettingsEl.innerHTML = ''; // Clear previous settings

    if (agent) {
        document.getElementById('agent-name').value = agent.name;
        document.getElementById('agent-description').value = agent.description;
        document.getElementById('agent-system-prompt').value = agent.systemPrompt;
        document.getElementById('agent-available-as-tool').checked = agent.availableAsTool;
        useCustomSettingsCheckbox.checked = agent.useCustomModelSettings || false;

        modelSettingsEl.style.display = useCustomSettingsCheckbox.checked ? 'block' : 'none';

        const chat = store.get('currentChat');
        if (useCustomSettingsCheckbox.checked) {
            if (!agent.modelSettings) agent.modelSettings = {};
            hooks.onModelSettingsRender.forEach(fn => fn(modelSettingsEl, agent.modelSettings, chat.id, agent.id));
        }
    } else {
        useCustomSettingsCheckbox.checked = false;
        modelSettingsEl.style.display = 'none';
    }

    // Use a fresh listener to avoid duplicates
    const newCheckbox = useCustomSettingsCheckbox.cloneNode(true);
    useCustomSettingsCheckbox.parentNode.replaceChild(newCheckbox, useCustomSettingsCheckbox);
    newCheckbox.addEventListener('change', (e) => {
        modelSettingsEl.style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked && agent) {
             const chat = store.get('currentChat');
             if (!agent.modelSettings) agent.modelSettings = {};
             hooks.onModelSettingsRender.forEach(fn => fn(modelSettingsEl, agent.modelSettings, chat.id, agent.id));
        }
    });
    formContainer.style.display = 'block';
}

export function hideAgentForm() {
    document.getElementById('agent-form-container').style.display = 'none';
}

export function renderFlow(store) {
    const chat = store.get('currentChat');
    const nodeContainer = document.getElementById('flow-node-container');
    const svgLayer = document.getElementById('flow-svg-layer');
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
