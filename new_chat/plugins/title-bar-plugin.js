/**
 * @fileoverview Plugin for creating title bars and handling file operations.
 * @version 1.0.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { getAgentSelectorHtml } from './agents-plugin.js';
import { getFlowSelectorHtml, flowManager, startFlow } from './flows-plugin.js';
import { importJson, exportJson } from '../utils.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').View} View
 * @typedef {import('../main.js').Chat} Chat
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

            const agentSelectorHtml = getAgentSelectorHtml(chat.agent);
            const flowSelectorHtml = getFlowSelectorHtml(chat.flow);

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
                    appInstance.debouncedSave();
                });
            }

            const flowSelector = titleBar.querySelector('#flow-selector');
            if (flowSelector) {
                flowSelector.addEventListener('change', (e) => {
                    const selectedFlowId = e.target.value;
                    chat.flow = selectedFlowId || null;
                    appInstance.debouncedSave();
                });
            }

            const runFlowBtn = titleBar.querySelector('#run-chat-flow-btn');
            if (runFlowBtn) {
                runFlowBtn.addEventListener('click', () => {
                    const flowId = flowSelector.value;
                    if (flowId) {
                        startFlow(flowId);
                    }
                });
            }

            const loadChatBtn = titleBar.querySelector('#load-chat-btn');
            if (loadChatBtn) {
                loadChatBtn.addEventListener('click', () => {
                    importJson('.chat', (data) => {
                        appInstance.createChatFromData(data);
                    });
                });
            }

            const saveChatBtn = titleBar.querySelector('#save-chat-btn');
            if (saveChatBtn) {
                saveChatBtn.addEventListener('click', () => {
                    const activeChat = appInstance.getActiveChat();
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
        }
    }
};

pluginManager.register(titleBarPlugin);
