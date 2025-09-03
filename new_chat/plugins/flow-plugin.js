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
        pluginManager.registerView('flow-editor', renderFlowEditor);
    },

    onTabsRegistered(tabs) {
        tabs.push({
            id: 'flows',
            label: 'Flows',
            onActivate: () => {
                const contentEl = document.getElementById('flows-pane');
                contentEl.innerHTML = `
                    <h3>Flows</h3>
                    <ul id="flow-list"></ul>
                    <button id="add-flow-btn">Add New Flow</button>
                `;
                renderFlowList();

                document.getElementById('add-flow-btn').addEventListener('click', () => {
                    appInstance.setView('flow-editor', null);
                });
                document.getElementById('flow-list').addEventListener('click', (e) => {
                    if (e.target.classList.contains('edit-flow-btn')) {
                        const flowId = e.target.parentElement.dataset.id;
                        appInstance.setView('flow-editor', flowId);
                    }
                    if (e.target.classList.contains('delete-flow-btn')) {
                        const flowId = e.target.parentElement.dataset.id;
                        if (confirm('Are you sure you want to delete this flow?')) {
                            flowManager.deleteFlow(flowId);
                            renderFlowList();
                            populateFlowSelector();
                        }
                    }
                });
            }
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

    onChatSwitched(chat) {
        populateFlowSelector();
        const runBtn = document.getElementById('run-flow-btn');
        const stopBtn = document.getElementById('stop-flow-btn');
        const runningFlow = flowManager.getRunningFlow();
        if (runningFlow && runningFlow.chatId === chat.id) {
            runBtn.style.display = 'none';
            stopBtn.style.display = 'inline-block';
        } else {
            runBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
        }
    },

    onViewRendered(view) {
        if (view.type === 'flow-editor') {
            attachFlowFormListeners();
        } else if (view.type === 'chat') {
            // Re-attach listeners for chat controls
            const runBtn = document.getElementById('run-flow-btn');
            const stopBtn = document.getElementById('stop-flow-btn');
            if (runBtn) {
                runBtn.addEventListener('click', handleRunFlowClick);
            }
            if (stopBtn) {
                stopBtn.addEventListener('click', handleStopFlowClick);
            }
        }
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
            setTimeout(() => {
                appInstance.dom.messageInput.value = nextPrompt;
                appInstance.handleFormSubmit();
            }, 100);
        } else {
            flowManager.stopFlow();
            document.getElementById('run-flow-btn').style.display = 'inline-block';
            document.getElementById('stop-flow-btn').style.display = 'none';
        }
    }
};

pluginManager.register(flowPlugin);

// --- Flow Logic & Renderers ---

function renderFlowList() {
    const flowList = document.getElementById('flow-list');
    if (!flowList) return;
    flowList.innerHTML = '';
    flowManager.flows.forEach(flow => {
        const li = document.createElement('li');
        li.dataset.id = flow.id;

        const span = document.createElement('span');
        span.textContent = flow.name;
        li.appendChild(span);

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

function renderFlowEditor(flowId) {
    const flow = flowId ? flowManager.getFlow(flowId) : null;
    const name = flow ? flow.name : '';
    const prompts = flow ? flow.prompts.join('\n') : '';
    const id = flow ? flow.id : '';

    return `
        <div id="flow-editor-view">
            <h2>${flowId ? 'Edit' : 'Create'} Flow</h2>
            <form id="flow-form">
                <input type="hidden" id="flow-id" value="${id}">
                <div class="setting">
                    <label for="flow-name">Name</label>
                    <input type="text" id="flow-name" required value="${name}">
                </div>
                <div class="setting">
                    <label for="flow-prompts">Prompts (one per line)</label>
                    <textarea id="flow-prompts" rows="15">${prompts}</textarea>
                </div>
                <button type="submit">Save Flow</button>
                <button type="button" id="cancel-flow-edit">Cancel</button>
            </form>
        </div>
    `;
}

function attachFlowFormListeners() {
    const form = document.getElementById('flow-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
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
        populateFlowSelector();
        appInstance.setView('chat', appInstance.activeChatId);
    });

    document.getElementById('cancel-flow-edit').addEventListener('click', () => {
        appInstance.setView('chat', appInstance.activeChatId);
    });
}

function handleRunFlowClick() {
    const selector = document.getElementById('flow-selector');
    const flowId = selector.value;
    if (flowId && appInstance) {
        const flow = flowManager.getFlow(flowId);
        if (flow && flow.prompts.length > 0) {
            flowManager.startFlow(flowId, appInstance.activeChatId);
            appInstance.dom.messageInput.value = flow.prompts[0];
            appInstance.handleFormSubmit();
            flowManager.advanceFlow();
            document.getElementById('run-flow-btn').style.display = 'none';
            document.getElementById('stop-flow-btn').style.display = 'inline-block';
        }
    }
}

function handleStopFlowClick() {
    flowManager.stopFlow();
    document.getElementById('stop-flow-btn').style.display = 'none';
    document.getElementById('run-flow-btn').style.display = 'inline-block';
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
