/**
 * @fileoverview A plugin that provides a factory function for creating
 * standardized, dynamic title bars and uses it to add a feature-rich
 * title bar to the main chat view.
 * @version 2.0.1
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { importJson, exportJson, makeSingleLineEditable } from '../utils.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').View} View
 * @typedef {import('./chats-plugin.js').Chat} Chat
 */

/**
 * Defines the configuration for a button in the title bar.
 * @typedef {object} TitleBarButton
 * @property {string} id - The unique ID for the button element.
 * @property {string} label - The text label displayed on the button.
 * @property {string} [className] - An optional CSS class to apply to the button for styling.
 * @property {() => void} onClick - The callback function to execute when the button is clicked.
 * @property {string} [dropdownContent] - If provided, the button will act as a dropdown trigger, and this HTML string will be the content of the dropdown menu.
 */

/**
 * Defines a custom control to be inserted into the title bar.
 * @typedef {object} TitleBarControl
 * @property {string} id - The unique ID for the control's container element.
 * @property {string} html - The raw HTML string for the control.
 * @property {(container: HTMLElement) => void} [onMount] - An optional callback function that is executed after the control's HTML has been added to the DOM, allowing for event listener attachment.
 */

/**
 * The singleton instance of the main App class.
 * @type {App | null}
 */
let appInstance = null;

/**
 * A factory function that creates a standardized title bar element for a main panel view.
 * It supports editable title segments, custom controls, and buttons with optional dropdowns.
 *
 * @param {Array<string|{text: string, onSave: (newText: string) => void}>} titleParts - An array of strings or objects for the title.
 *        If an object, it creates an editable title segment with a save callback.
 * @param {TitleBarControl[]} [controls=[]] - An array of custom control definitions to be placed in the center of the title bar.
 * @param {TitleBarButton[]} [buttons=[]] - An array of button definitions to be placed on the right side of the title bar.
 * @returns {HTMLElement} The fully constructed title bar `<div>` element.
 */
export function createTitleBar(titleParts, controls = [], buttons = []) {
    const titleBar = document.createElement('div');
    titleBar.className = 'main-title-bar';

    const titleEl = document.createElement('h2');
    titleEl.className = 'title';

    titleParts.forEach(part => {
        if (typeof part === 'string') {
            titleEl.appendChild(document.createTextNode(part));
        } else {
            const span = document.createElement('span');
            span.className = 'editable-title-part';
            span.textContent = part.text;

            const editBtn = document.createElement('button');
            editBtn.className = 'inline-edit-btn';
            editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>';

            const triggerEdit = () => {
                const newSpan = titleEl.querySelector(`.editable-title-part[data-original-text="${part.text}"]`);
                makeSingleLineEditable(newSpan, part.text, part.onSave);
            };

            span.dataset.originalText = part.text; // Add a marker to re-find the element
            span.addEventListener('click', triggerEdit);
            editBtn.addEventListener('click', triggerEdit);

            titleEl.appendChild(span);
            titleEl.appendChild(editBtn);
        }
    });

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


/**
 * The plugin object for the Title Bar feature.
 * @type {import('../plugin-manager.js').Plugin}
 */
const titleBarPlugin = {
    name: 'TitleBar',

    /**
     * The `onAppInit` hook, called when the application starts.
     * It simply stores a reference to the main app instance for later use.
     * @param {App} app - The main application instance.
     */
    onAppInit(app) {
        appInstance = app;
    },

    /**
     * The `onViewRendered` hook. If the rendered view is a 'chat', this function
     * uses the `createTitleBar` factory to construct a title bar with an editable
     * chat title, agent and flow selectors, and load/save buttons.
     * @param {View} view - The view object that was just rendered.
     * @param {Chat} chat - The active chat instance, which is non-null if the view is 'chat'.
     */
    onViewRendered(view, chat) {
        if (!appInstance) return;
        const mainPanel = document.getElementById('main-panel');
        if (!mainPanel) return;

        if (view.type === 'chat' && chat) {
            // Remove any existing title bar to prevent duplicates on re-renders.
            const existingTitleBar = mainPanel.querySelector('.main-title-bar');
            if (existingTitleBar) {
                existingTitleBar.remove();
            }

            const titleParts = [
                {
                    text: chat.title,
                    onSave: (newTitle) => {
                        chat.title = newTitle;
                        appInstance.chatManager.dataManager.save();
                        appInstance.chatManager.listPane.renderList();
                        appInstance.renderMainView(); // Re-render to update title bar
                    }
                }
            ];

            let controls = [
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
                                appInstance.renderMainView(); // Re-render to update title
                            });
                        }
                    }
                },
                {
                    id: 'flow-runner-container',
                    html: appInstance.flowManager.getFlowSelectorHtml(chat.flow),
                    onMount: (container) => {
                        const flowSelector = container.querySelector('#flow-selector');
                        if (flowSelector) {
                            flowSelector.addEventListener('change', (e) => {
                                const selectedFlowId = e.target.value;
                                chat.flow = selectedFlowId || null;
                                appInstance.chatManager.debouncedSave();
                                appInstance.renderMainView(); // Re-render to update title
                            });
                        }
                        const runFlowBtn = container.querySelector('#run-chat-flow-btn');
                        if (runFlowBtn) {
                            runFlowBtn.addEventListener('click', () => {
                                if (flowSelector.value) {
                                    appInstance.flowManager.startFlow(flowSelector.value);
                                }
                            });
                        }
                    }
                }
            ];

            // Allow plugins to add their own controls
            controls = pluginManager.trigger('onTitleBarControlsRegistered', controls);

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

            const titleBar = createTitleBar(titleParts, controls, buttons);
            mainPanel.prepend(titleBar);
        }
    }
};

/**
 * Registers the Title Bar Plugin with the application's plugin manager.
 */
pluginManager.register(titleBarPlugin);
