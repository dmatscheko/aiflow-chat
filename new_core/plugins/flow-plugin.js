/**
 * @fileoverview Plugin for creating and running simple, linear flows.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

class FlowManager {
    constructor() {
        this.flows = this.loadFlows();
        this.runningFlowState = null; // { flowId, nextPromptIndex, chatId }
    }

    loadFlows() {
        return JSON.parse(localStorage.getItem('core_flows')) || [];
    }

    saveFlows() {
        localStorage.setItem('core_flows', JSON.stringify(this.flows));
    }

    getFlow(id) {
        return this.flows.find(f => f.id === id);
    }

    addFlow(flowData) {
        this.flows.push(flowData);
        this.saveFlows();
    }

    updateFlow(flowData) {
        const index = this.flows.findIndex(f => f.id === flowData.id);
        if (index !== -1) {
            this.flows[index] = flowData;
            this.saveFlows();
        }
    }

    deleteFlow(id) {
        this.flows = this.flows.filter(f => f.id !== id);
        this.saveFlows();
    }

    startFlow(flowId, chatId) {
        this.runningFlowState = { flowId, nextPromptIndex: 0, chatId };
    }

    stopFlow() {
        this.runningFlowState = null;
    }

    getRunningFlow() {
        return this.runningFlowState;
    }

    advanceFlow() {
        if (this.runningFlowState) {
            this.runningFlowState.nextPromptIndex++;
        }
    }
}

const flowManager = new FlowManager();
let appInstance = null;

const flowPlugin = {
    onAppInit(app) {
        appInstance = app;
    },

    onTabsRegistered(tabs) {
        tabs.push({
            id: 'flows',
            label: 'Flows',
            render: () => `
                <div id="flows-pane" class="tab-pane">
                    <div id="flow-list-container">
                        <h3>Flows</h3>
                        <ul id="flow-list"></ul>
                        <button id="add-flow-btn">Add New Flow</button>
                    </div>
                    <div id="flow-form-container" style="display: none;">
                        <h3>Flow Editor</h3>
                        <form id="flow-form">
                            <input type="hidden" id="flow-id">
                            <div class="setting">
                                <label for="flow-name">Name</label>
                                <input type="text" id="flow-name" required>
                            </div>
                            <div class="setting">
                                <label for="flow-prompts">Prompts (one per line)</label>
                                <textarea id="flow-prompts" rows="10"></textarea>
                            </div>
                            <button type="submit">Save Flow</button>
                            <button type="button" id="cancel-flow-edit">Cancel</button>
                        </form>
                    </div>
                </div>
            `
        });
        return tabs;
    },

    onChatAreaRender(currentHtml) {
        const flowSelectorHtml = `
            <div id="flow-runner-container">
                <label for="flow-selector">Flow:</label>
                <select id="flow-selector">
                    <option value="">Select a flow</option>
                </select>
                <button id="run-flow-btn">Run</button>
                <button id="stop-flow-btn" style="display:none;">Stop</button>
            </div>
        `;
        return currentHtml + flowSelectorHtml;
    },

    onResponseComplete(assistantMsg, chat) {
        const runningFlow = flowManager.getRunningFlow();
        if (!runningFlow || runningFlow.chatId !== chat.id) {
            return;
        }

        const flow = flowManager.getFlow(runningFlow.flowId);
        if (!flow) {
            flowManager.stopFlow();
            return;
        }

        if (runningFlow.nextPromptIndex < flow.prompts.length) {
            const nextPrompt = flow.prompts[runningFlow.nextPromptIndex];
            flowManager.advanceFlow();
            // Use a timeout to avoid race conditions with other event listeners
            setTimeout(() => {
                appInstance.dom.messageInput.value = nextPrompt;
                appInstance.handleFormSubmit();
            }, 100);
        } else {
            // Flow finished
            flowManager.stopFlow();
            document.getElementById('run-flow-btn').style.display = 'inline-block';
            document.getElementById('stop-flow-btn').style.display = 'none';
        }
    }
};

pluginManager.register(flowPlugin);

// --- Flow Logic ---

function renderFlowList() {
    const flowList = document.getElementById('flow-list');
    if (!flowList) return;
    flowList.innerHTML = '';
    flowManager.flows.forEach(flow => {
        const li = document.createElement('li');
        li.textContent = flow.name;
        li.dataset.id = flow.id;

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.classList.add('edit-flow-btn');
        li.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.classList.add('delete-flow-btn');
        li.appendChild(deleteBtn);

        flowList.appendChild(li);
    });
}

function showFlowForm(flow = null) {
    const formContainer = document.getElementById('flow-form-container');
    const flowIdInput = document.getElementById('flow-id');
    const flowNameInput = document.getElementById('flow-name');
    const flowPromptsInput = document.getElementById('flow-prompts');

    if (flow) {
        flowIdInput.value = flow.id;
        flowNameInput.value = flow.name;
        flowPromptsInput.value = flow.prompts.join('\n');
    } else {
        flowIdInput.value = '';
        flowNameInput.value = '';
        flowPromptsInput.value = '';
    }
    formContainer.style.display = 'block';
}

function hideFlowForm() {
    document.getElementById('flow-form-container').style.display = 'none';
}

function populateFlowSelector() {
    const selector = document.getElementById('flow-selector');
    if (!selector) return;

    selector.innerHTML = '<option value="">Select a flow</option>';
    flowManager.flows.forEach(flow => {
        const option = document.createElement('option');
        option.value = flow.id;
        option.textContent = flow.name;
        selector.appendChild(option);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('click', e => {
        if (e.target.id === 'tab-btn-flows') {
            renderFlowList();
        }
        if (e.target.id === 'add-flow-btn') {
            showFlowForm();
        }
        if (e.target.id === 'cancel-flow-edit') {
            hideFlowForm();
        }
        if (e.target.classList.contains('edit-flow-btn')) {
            const flowId = e.target.parentElement.dataset.id;
            const flow = flowManager.getFlow(flowId);
            showFlowForm(flow);
        }
        if (e.target.classList.contains('delete-flow-btn')) {
            const flowId = e.target.parentElement.dataset.id;
            if (confirm('Are you sure you want to delete this flow?')) {
                flowManager.deleteFlow(flowId);
                renderFlowList();
                populateFlowSelector();
            }
        }
        if (e.target.id === 'run-flow-btn') {
            const selector = document.getElementById('flow-selector');
            const flowId = selector.value;
            if (flowId && appInstance) {
                const flow = flowManager.getFlow(flowId);
                if (flow && flow.prompts.length > 0) {
                    flowManager.startFlow(flowId, appInstance.activeChatId);
                    appInstance.dom.messageInput.value = flow.prompts[0];
                    appInstance.handleFormSubmit();
                    flowManager.advanceFlow();
                    e.target.style.display = 'none';
                    document.getElementById('stop-flow-btn').style.display = 'inline-block';
                }
            }
        }
        if (e.target.id === 'stop-flow-btn') {
            flowManager.stopFlow();
            e.target.style.display = 'none';
            document.getElementById('run-flow-btn').style.display = 'inline-block';
        }
    });

    document.body.addEventListener('submit', e => {
        if (e.target.id === 'flow-form') {
            e.preventDefault();
            const flowId = document.getElementById('flow-id').value;
            const flowData = {
                id: flowId || `flow-${Date.now()}`,
                name: document.getElementById('flow-name').value,
                prompts: document.getElementById('flow-prompts').value.split('\n').filter(p => p.trim() !== ''),
            };
            if (flowId) {
                flowManager.updateFlow(flowData);
            } else {
                flowManager.addFlow(flowData);
            }
            renderFlowList();
            populateFlowSelector();
            hideFlowForm();
        }
    });

    populateFlowSelector();
});
