/**
 * @fileoverview Plugin for creating title bars and handling file operations.
 * @version 2.0.1
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { importJson, exportJson } from '../utils.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').View} View
 * @typedef {import('./chats-plugin.js').Chat} Chat
 */

/**
 * @typedef {object} TitleBarButton
 * @property {string} id - The button's ID.
 * @property {string} label - The button's text label.
 * @property {string} [className] - Optional CSS class for the button.
 * @property {() => void} onClick - The function to call when the button is clicked.
 * @property {string} [dropdownContent] - Optional HTML content for a dropdown.
 */

/**
 * @typedef {object} TitleBarControl
 * @property {string} id - The control's container ID.
 * @property {string} html - The HTML content of the control.
 * @property {() => void} [onMount] - Function to call after the control is added to the DOM.
 */


/** @type {App | null} */
let appInstance = null;

/**
 * Creates a standardized title bar for a main panel view.
 *
 * @param {string} title - The title to display in the h2 tag.
 * @param {TitleBarControl[]} [controls=[]] - An array of control objects to add to the controls area.
 * @param {TitleBarButton[]} [buttons=[]] - An array of button objects to add to the buttons area.
 * @returns {HTMLElement} The generated title bar element.
 */
export function createTitleBar(title, controls = [], buttons = []) {
    const titleBar = document.createElement('div');
    titleBar.className = 'main-title-bar';

    const titleEl = document.createElement('h2');
    titleEl.className = 'title';
    titleEl.textContent = title;

    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'title-bar-controls';

    controls.forEach(control => {
        const controlWrapper = document.createElement('div');
        controlWrapper.id = control.id;
        controlWrapper.innerHTML = control.html;
        controlsContainer.appendChild(controlWrapper);
        if (control.onMount) {
            // Call onMount in the next tick to ensure the element is in the DOM
            setTimeout(() => control.onMount(controlWrapper), 0);
        }
    });

    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'title-bar-buttons';

    buttons.forEach(buttonInfo => {
        if (buttonInfo.dropdownContent) {
            const dropdownContainer = document.createElement('div');
            dropdownContainer.className = 'dropdown';

            const button = document.createElement('button');
            button.id = buttonInfo.id;
            button.textContent = buttonInfo.label;
            button.className = buttonInfo.className || 'btn-gray';
            dropdownContainer.appendChild(button);

            const dropdownContent = document.createElement('div');
            dropdownContent.className = 'dropdown-content';
            dropdownContent.innerHTML = buttonInfo.dropdownContent;
            dropdownContainer.appendChild(dropdownContent);

            button.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdownContent.classList.toggle('show');
            });

            // Attach listener to dropdown content if needed (e.g., for step selection)
            if (buttonInfo.onClick) {
                dropdownContent.addEventListener('click', (e) => {
                    buttonInfo.onClick(e);
                    dropdownContent.classList.remove('show');
                });
            }

            buttonsContainer.appendChild(dropdownContainer);
        } else {
            const button = document.createElement('button');
            button.id = buttonInfo.id;
            button.textContent = buttonInfo.label;
            button.className = buttonInfo.className || 'btn-gray';
            button.addEventListener('click', buttonInfo.onClick);
            buttonsContainer.appendChild(button);
        }
    });


    titleBar.appendChild(titleEl);
    titleBar.appendChild(controlsContainer);
    titleBar.appendChild(buttonsContainer);

    // Close dropdowns when clicking elsewhere
    window.addEventListener('click', (e) => {
        if (!e.target.matches('.dropdown button')) {
            const dropdowns = document.querySelectorAll('.dropdown-content');
            dropdowns.forEach(d => d.classList.remove('show'));
        }
    });


    return titleBar;
}


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

        if (view.type === 'chat' && chat) {
            // Remove any existing title bar to prevent duplicates on re-renders
            const existingTitleBar = mainPanel.querySelector('.main-title-bar');
            if (existingTitleBar) {
                existingTitleBar.remove();
            }

            const controls = [
                {
                    id: 'agent-selector-container',
                    html: appInstance.agentManager.getAgentSelectorHtml(chat.agent),
                    onMount: (container) => {
                        const agentSelector = container.querySelector('#agent-selector');
                        if (agentSelector) {
                            agentSelector.addEventListener('change', (e) => {
                                const selectedAgentId = e.target.value;
                                chat.agent = selectedAgentId === 'agent-default' ? null : selectedAgentId;
                                appInstance.chatManager.debouncedSave();
                            });
                        }
                    }
                },
                {
                    id: 'flow-runner-container',
                    html: appInstance.flowsManager.getFlowSelectorHtml(chat.flow),
                    onMount: (container) => {
                        const flowSelector = container.querySelector('#flow-selector');
                        if (flowSelector) {
                            flowSelector.addEventListener('change', (e) => {
                                const selectedFlowId = e.target.value;
                                chat.flow = selectedFlowId || null;
                                appInstance.chatManager.debouncedSave();
                            });
                        }
                        const runFlowBtn = container.querySelector('#run-chat-flow-btn');
                        if (runFlowBtn) {
                            runFlowBtn.addEventListener('click', () => {
                                if (flowSelector.value) {
                                    appInstance.flowsManager.startFlow(flowSelector.value);
                                }
                            });
                        }
                    }
                }
            ];

            const buttons = [
                {
                    id: 'load-chat-btn',
                    label: 'Load Chat',
                    className: 'btn-gray',
                    onClick: () => {
                        importJson('.chat', (data) => {
                            appInstance.chatManager.createChatFromData(data);
                        });
                    }
                },
                {
                    id: 'save-chat-btn',
                    label: 'Save Chat',
                    className: 'btn-gray',
                    onClick: () => {
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
                    }
                }
            ];

            const titleBar = createTitleBar(chat.title, controls, buttons);
            mainPanel.prepend(titleBar);
        }
    }
};

pluginManager.register(titleBarPlugin);
