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
let appInstance = null;

const agentsPlugin = {
    onAppInit(app) {
        appInstance = app;
        pluginManager.registerView('agent-editor', renderAgentEditor);
    },

    onTabsRegistered(tabs) {
        tabs.push({
            id: 'agents',
            label: 'Agents',
            onActivate: () => {
                const contentEl = document.getElementById('agents-pane');
                contentEl.innerHTML = `
                    <h3>Agents</h3>
                    <ul id="agent-list"></ul>
                    <button id="add-agent-btn">Add New Agent</button>
                `;
                renderAgentList();

                document.getElementById('add-agent-btn').addEventListener('click', () => {
                    appInstance.setView('agent-editor', null);
                });
                document.getElementById('agent-list').addEventListener('click', (e) => {
                    if (e.target.classList.contains('edit-agent-btn')) {
                        const agentId = e.target.parentElement.dataset.id;
                        appInstance.setView('agent-editor', agentId);
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
            }
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
        populateAgentSelector();
        const agentSelector = document.getElementById('agent-selector');
        if (agentSelector) {
            const activeAgentId = agentManager.getActiveAgentForChat(chat.id);
            agentSelector.value = activeAgentId || '';

            // Re-attach listener to avoid duplicates
            const newSelector = agentSelector.cloneNode(true);
            agentSelector.parentNode.replaceChild(newSelector, agentSelector);
            newSelector.addEventListener('change', (e) => {
                if (appInstance.activeChatId) {
                    agentManager.setActiveAgentForChat(appInstance.activeChatId, e.target.value);
                }
            });
        }
    },

    onViewRendered(view) {
        if (view.type === 'agent-editor') {
            attachAgentFormListeners();
        }
    },

    beforeApiCall(payload, settings) {
        if (!appInstance) return payload;
        const activeChatId = appInstance.activeView.type === 'chat' ? appInstance.activeView.id : null;
        if (!activeChatId) return payload;

        const activeAgentId = agentManager.getActiveAgentForChat(activeChatId);

        if (activeAgentId) {
            const agent = agentManager.getAgent(activeAgentId);
            if (agent) {
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

// --- Agent Logic & Renderers ---

function renderAgentList() {
    const agentList = document.getElementById('agent-list');
    if (!agentList) return;
    agentList.innerHTML = '';
    agentManager.agents.forEach(agent => {
        const li = document.createElement('li');
        li.dataset.id = agent.id;

        const span = document.createElement('span');
        span.textContent = agent.name;
        li.appendChild(span);

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

function renderAgentEditor(agentId) {
    const agent = agentId ? agentManager.getAgent(agentId) : null;
    const name = agent ? agent.name : '';
    const systemPrompt = agent ? agent.systemPrompt : '';
    const id = agent ? agent.id : '';

    return `
        <div id="agent-editor-view">
            <h2>${agentId ? 'Edit' : 'Create'} Agent</h2>
            <form id="agent-form">
                <input type="hidden" id="agent-id" value="${id}">
                <div class="setting">
                    <label for="agent-name">Name</label>
                    <input type="text" id="agent-name" required value="${name}">
                </div>
                <div class="setting">
                    <label for="agent-system-prompt">System Prompt</label>
                    <textarea id="agent-system-prompt" rows="10">${systemPrompt}</textarea>
                </div>
                <button type="submit">Save Agent</button>
                <button type="button" id="cancel-agent-edit">Cancel</button>
            </form>
        </div>
    `;
}

function attachAgentFormListeners() {
    const form = document.getElementById('agent-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
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
        populateAgentSelector();
        appInstance.setView('chat', appInstance.activeChatId); // Go back to chat view
    });

    document.getElementById('cancel-agent-edit').addEventListener('click', () => {
        appInstance.setView('chat', appInstance.activeChatId);
    });
}

function populateAgentSelector() {
    const selector = document.getElementById('agent-selector');
    if (!selector) return;

    selector.innerHTML = '<option value="">None (Default)</option>';
    agentManager.agents.forEach(agent => {
        const option = document.createElement('option');
        option.value = agent.id;
        option.textContent = agent.name;
        selector.appendChild(option);
    });
}
