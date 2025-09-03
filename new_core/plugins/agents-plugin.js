/**
 * @fileoverview Plugin for managing and using Agents.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

class AgentManager {
    constructor() {
        this.agents = this.loadAgents();
        this.chatAgentMap = this.loadChatAgentMap();
    }

    loadAgents() {
        return JSON.parse(localStorage.getItem('core_agents')) || [];
    }

    saveAgents() {
        localStorage.setItem('core_agents', JSON.stringify(this.agents));
    }

    loadChatAgentMap() {
        return JSON.parse(localStorage.getItem('core_chat_agent_map')) || {};
    }

    saveChatAgentMap() {
        localStorage.setItem('core_chat_agent_map', JSON.stringify(this.chatAgentMap));
    }

    getAgent(id) {
        return this.agents.find(a => a.id === id);
    }

    addAgent(agentData) {
        this.agents.push(agentData);
        this.saveAgents();
    }

    updateAgent(agentData) {
        const index = this.agents.findIndex(a => a.id === agentData.id);
        if (index !== -1) {
            this.agents[index] = agentData;
            this.saveAgents();
        }
    }

    deleteAgent(id) {
        this.agents = this.agents.filter(a => a.id !== id);
        this.saveAgents();
        // Also remove from any chat mappings
        for (const chatId in this.chatAgentMap) {
            if (this.chatAgentMap[chatId] === id) {
                delete this.chatAgentMap[chatId];
            }
        }
        this.saveChatAgentMap();
    }

    getActiveAgentForChat(chatId) {
        return this.chatAgentMap[chatId] || null;
    }

    setActiveAgentForChat(chatId, agentId) {
        if (agentId) {
            this.chatAgentMap[chatId] = agentId;
        } else {
            delete this.chatAgentMap[chatId];
        }
        this.saveChatAgentMap();
    }
}

const agentManager = new AgentManager();
let appInstance = null; // To store the app instance

const agentsPlugin = {
    onAppInit(app) {
        appInstance = app;
    },

    onTabsRegistered(tabs) {
        tabs.push({
            id: 'agents',
            label: 'Agents',
            render: () => `
                <div id="agents-pane" class="tab-pane">
                    <div id="agent-list-container">
                        <h3>Agents</h3>
                        <ul id="agent-list"></ul>
                        <button id="add-agent-btn">Add New Agent</button>
                    </div>
                    <div id="agent-form-container" style="display: none;">
                        <h3>Agent Editor</h3>
                        <form id="agent-form">
                            <input type="hidden" id="agent-id">
                            <div class="setting">
                                <label for="agent-name">Name</label>
                                <input type="text" id="agent-name" required>
                            </div>
                            <div class="setting">
                                <label for="agent-system-prompt">System Prompt</label>
                                <textarea id="agent-system-prompt" rows="6"></textarea>
                            </div>
                            <button type="submit">Save Agent</button>
                            <button type="button" id="cancel-agent-edit">Cancel</button>
                        </form>
                    </div>
                </div>
            `
        });
        return tabs;
    },

    onChatAreaRender(currentHtml) {
        const agentSelectorHtml = `
            <div id="agent-selector-container">
                <label for="agent-selector">Active Agent:</label>
                <select id="agent-selector">
                    <option value="">None (Default)</option>
                </select>
            </div>
        `;
        return currentHtml + agentSelectorHtml;
    },

    onChatSwitched(chat) {
        const agentSelector = document.getElementById('agent-selector');
        if (agentSelector) {
            const activeAgentId = agentManager.getActiveAgentForChat(chat.id);
            agentSelector.value = activeAgentId || '';
        }
    },

    beforeApiCall(payload, settings) {
        if (!appInstance) return payload;

        const activeChatId = appInstance.activeChatId;
        const activeAgentId = agentManager.getActiveAgentForChat(activeChatId);

        if (activeAgentId) {
            const agent = agentManager.getAgent(activeAgentId);
            if (agent) {
                // Find system message and replace its content. If not found, add one.
                let systemMessage = payload.messages.find(m => m.role === 'system');
                if (systemMessage) {
                    systemMessage.content = agent.systemPrompt;
                } else {
                    payload.messages.unshift({ role: 'system', content: agent.systemPrompt });
                }
            }
        }
        return payload;
    }
};

pluginManager.register(agentsPlugin);

// --- Agent Logic ---

function renderAgentList() {
    const agentList = document.getElementById('agent-list');
    if (!agentList) return;
    agentList.innerHTML = '';
    agentManager.agents.forEach(agent => {
        const li = document.createElement('li');
        li.textContent = agent.name;
        li.dataset.id = agent.id;

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.classList.add('edit-agent-btn');
        li.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.classList.add('delete-agent-btn');
        li.appendChild(deleteBtn);

        agentList.appendChild(li);
    });
}

function showAgentForm(agent = null) {
    const formContainer = document.getElementById('agent-form-container');
    const agentIdInput = document.getElementById('agent-id');
    const agentNameInput = document.getElementById('agent-name');
    const agentSystemPromptInput = document.getElementById('agent-system-prompt');

    if (agent) {
        agentIdInput.value = agent.id;
        agentNameInput.value = agent.name;
        agentSystemPromptInput.value = agent.systemPrompt;
    } else {
        agentIdInput.value = '';
        agentNameInput.value = '';
        agentSystemPromptInput.value = '';
    }
    formContainer.style.display = 'block';
}

function hideAgentForm() {
    document.getElementById('agent-form-container').style.display = 'none';
}

function populateAgentSelector() {
    const selector = document.getElementById('agent-selector');
    if (!selector) return;

    const currentValue = selector.value;
    selector.innerHTML = '<option value="">None (Default)</option>';
    agentManager.agents.forEach(agent => {
        const option = document.createElement('option');
        option.value = agent.id;
        option.textContent = agent.name;
        selector.appendChild(option);
    });
    selector.value = currentValue;
}

// Attach event listeners after the main app is initialized and UI is rendered
document.addEventListener('DOMContentLoaded', () => {
    // We need to wait for the app to be fully initialized before we can use appInstance
    setTimeout(() => {
        if (!appInstance) return;

        document.body.addEventListener('click', e => {
            if (e.target.id === 'tab-btn-agents') {
                renderAgentList();
            }
            if (e.target.id === 'add-agent-btn') {
                showAgentForm();
            }
            if (e.target.id === 'cancel-agent-edit') {
                hideAgentForm();
            }
            if (e.target.classList.contains('edit-agent-btn')) {
                const agentId = e.target.parentElement.dataset.id;
                const agent = agentManager.getAgent(agentId);
                showAgentForm(agent);
            }
            if (e.target.classList.contains('delete-agent-btn')) {
                const agentId = e.target.parentElement.dataset.id;
                if (confirm('Are you sure you want to delete this agent?')) {
                    agentManager.deleteAgent(agentId);
                    renderAgentList();
                    populateAgentSelector();
                }
            }
        });

        document.body.addEventListener('submit', e => {
            if (e.target.id === 'agent-form') {
                e.preventDefault();
                const agentId = document.getElementById('agent-id').value;
                const agentData = {
                    id: agentId || `agent-${Date.now()}`,
                    name: document.getElementById('agent-name').value,
                    systemPrompt: document.getElementById('agent-system-prompt').value,
                };
                if (agentId) {
                    agentManager.updateAgent(agentData);
                } else {
                    agentManager.addAgent(agentData);
                }
                renderAgentList();
                populateAgentSelector();
                hideAgentForm();
            }
        });

        const agentSelector = document.getElementById('agent-selector');
        if (agentSelector) {
            agentSelector.addEventListener('change', (e) => {
                if (appInstance.activeChatId) {
                    agentManager.setActiveAgentForChat(appInstance.activeChatId, e.target.value);
                }
            });
        }

        // Initial population
        populateAgentSelector();
        // Set initial value for current chat
        if (appInstance.activeChatId) {
            const activeAgentId = agentManager.getActiveAgentForChat(appInstance.activeChatId);
            agentSelector.value = activeAgentId || '';
        }

    }, 100); // A small timeout to ensure the App class is instantiated
});
