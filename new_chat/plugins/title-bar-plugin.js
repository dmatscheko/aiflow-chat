/**
 * @fileoverview Plugin for creating title bars and handling file operations.
 * @version 1.0.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { importJson, exportJson } from '../utils.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').View} View
 * @typedef {import('./chats-plugin.js').Chat} Chat
 */

/** @type {App | null} */
let appInstance = null;

const titleBarPlugin = {
    name: 'TitleBar',

    /**
     * @param {App} app
     */
    onAppInit(app) {
        appInstance = app;
    },

    /**
     * @param {View} view - The rendered view object.
     * @param {Chat} chat
     */
    onViewRendered(view, chat) {
        if (!appInstance) return;

        const mainPanel = document.getElementById('main-panel');
        if (!mainPanel) return;

        // Remove any existing title bar
        const existingTitleBar = mainPanel.querySelector('.main-title-bar');
        if (existingTitleBar) {
            existingTitleBar.remove();
        }

        if (view.type === 'chat' && chat) {
            const titleBar = document.createElement('div');
            titleBar.className = 'main-title-bar';

            const agentSelectorHtml = appInstance.agentManager.getAgentSelectorHtml(chat.agent);
            const flowSelectorHtml = appInstance.flowsManager.getFlowSelectorHtml(chat.flow);

            titleBar.innerHTML = `
                <h2 class="chat-title">${chat.title}</h2>
                <div id="chat-title-bar-controls">
                    ${agentSelectorHtml}
                    ${flowSelectorHtml}
                </div>
                <div class="title-bar-buttons">
                    <button id="load-chat-btn" class="btn-gray">Load Chat</button>
                    <button id="save-chat-btn" class="btn-gray">Save Chat</button>
                </div>
            `;

            mainPanel.prepend(titleBar);

            // Re-attach event listeners
            const agentSelector = titleBar.querySelector('#agent-selector');
            if (agentSelector) {
                agentSelector.addEventListener('change', (e) => {
                    const selectedAgentId = e.target.value;
                    chat.agent = selectedAgentId === 'agent-default' ? null : selectedAgentId;
                    appInstance.chatManager.debouncedSave();
                });
            }

            const flowSelector = titleBar.querySelector('#flow-selector');
            if (flowSelector) {
                flowSelector.addEventListener('change', (e) => {
                    const selectedFlowId = e.target.value;
                    chat.flow = selectedFlowId || null;
                    appInstance.chatManager.debouncedSave();
                });
            }

            const runFlowBtn = titleBar.querySelector('#run-chat-flow-btn');
            if (runFlowBtn) {
                runFlowBtn.addEventListener('click', () => {
                    const flowId = flowSelector.value;
                    if (flowId) {
                        appInstance.flowsManager.startFlow(flowId);
                    }
                });
            }

            const loadChatBtn = titleBar.querySelector('#load-chat-btn');
            if (loadChatBtn) {
                loadChatBtn.addEventListener('click', () => {
                    importJson('.chat', (data) => {
                        appInstance.chatManager.createChatFromData(data);
                    });
                });
            }

            const saveChatBtn = titleBar.querySelector('#save-chat-btn');
            if (saveChatBtn) {
                saveChatBtn.addEventListener('click', () => {
                    const activeChat = appInstance.chatManager.getActiveChat();
                    if (activeChat) {
                        const chatToSave = {
                            title: activeChat.title,
                            log: activeChat.log.toJSON(),
                            draftMessage: activeChat.draftMessage,
                            agent: activeChat.agent,
                            flow: activeChat.flow,
                        };
                        exportJson(chatToSave, activeChat.title.replace(/[^a-z0-9]/gi, '_').toLowerCase(), 'chat');
                    }
                });
            }
        } else if (view.type === 'flow-editor') {
            const flow = appInstance.flowsManager.getFlow(view.id);
            const titleBar = document.createElement('div');
            titleBar.className = 'main-title-bar';

            titleBar.innerHTML = `
                <h2 class="flow-editor-title">${flow ? flow.name : 'Flow Editor'}</h2>
                <div class="title-bar-buttons">
                    <button id="load-flow-btn" class="btn-gray">Load Flow</button>
                    <button id="save-flow-btn" class="btn-gray">Save Flow</button>
                </div>
            `;

            mainPanel.prepend(titleBar);

            const loadFlowBtn = titleBar.querySelector('#load-flow-btn');
            if (loadFlowBtn) {
                loadFlowBtn.addEventListener('click', () => {
                    importJson('.flow', (data) => {
                        const newFlow = appInstance.flowsManager.addFlowFromData(data);
                        appInstance.setView('flow-editor', newFlow.id);
                    });
                });
            }

            const saveFlowBtn = titleBar.querySelector('#save-flow-btn');
            if (saveFlowBtn) {
                saveFlowBtn.addEventListener('click', () => {
                    const flowToSave = appInstance.flowsManager.getFlow(view.id);
                    if (flowToSave) {
                        exportJson(flowToSave, flowToSave.name.replace(/[^a-z0-9]/gi, '_').toLowerCase(), 'flow');
                    }
                });
            }
        }
    }
};

pluginManager.register(titleBarPlugin);
