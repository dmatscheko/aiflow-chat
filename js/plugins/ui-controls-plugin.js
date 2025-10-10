/**
 * @fileoverview A plugin for adding interactive UI controls (e.g., edit, delete)
 * to chat messages.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { responseProcessor } from '../response-processor.js';
import { makeEditable } from '../utils.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 */

/**
 * The singleton instance of the main App class.
 * @type {App | null}
 */
let appInstance = null;

/**
 * A helper function to create a standard control button for the message UI.
 * @param {string} title - The button's title attribute (tooltip).
 * @param {string} svgHTML - The inner HTML (typically an SVG icon) for the button.
 * @param {() => void} onClick - The callback function to execute on click.
 * @returns {HTMLButtonElement} The created button element.
 */
function createControlButton(title, svgHTML, onClick) {
    const button = document.createElement('button');
    button.title = title;
    button.innerHTML = svgHTML;
    button.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent the click from propagating to parent elements.
        onClick();
    });
    return button;
}

/**
 * The plugin object for message UI controls.
 * @type {import('../plugin-manager.js').Plugin}
 */
const uiControlsPlugin = {
    name: 'ui-controls',
    /**
     * Stores a reference to the main app instance.
     * @param {App} app - The main application instance.
     */
    onAppInit(app) {
        appInstance = app;
    },

    /**
     * The `onMessageRendered` hook, called after a message element is created.
     * This function injects the UI controls (e.g., edit, delete, navigate alternatives)
     * into the message's title bar.
     * @param {HTMLElement} el - The message's root HTML element.
     * @param {Message} message - The message data object corresponding to the element.
     */
    onMessageRendered(el, message) {
        const chatLog = appInstance.chatManager.getActiveChat()?.log;
        if (!chatLog) return;

        const titleRow = el.querySelector('.message-title');
        if (!titleRow) return;

        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'message-controls';
        titleRow.appendChild(controlsContainer);

        const alternatives = chatLog.findAlternatives(message);

        // Add alternative navigation controls if applicable.
        if (alternatives && alternatives.messages.length > 1) {
            const prevBtn = createControlButton('Previous Message', '<svg width="16" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19 7.766c0-1.554-1.696-2.515-3.029-1.715l-7.056 4.234c-1.295.777-1.295 2.653 0 3.43l7.056 4.234c1.333.8 3.029-.16 3.029-1.715V7.766zM9.944 12L17 7.766v8.468L9.944 12zM6 6a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1z" fill="currentColor"/></svg>', () => chatLog.cycleAlternatives(message, 'prev'));
            const nextBtn = createControlButton('Next Message', '<svg width="16" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 7.766c0-1.554 1.696-2.515 3.029-1.715l7.056 4.234c1.295.777-1.295 2.653 0 3.43L8.03 17.949c-1.333.8-3.029-.16-3.029-1.715V7.766zM14.056 12L7 7.766v8.468L14.056 12zM18 6a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1z" fill="currentColor"/></svg>', () => chatLog.cycleAlternatives(message, 'next'));
            const status = document.createElement('span');
            status.innerHTML = `&nbsp;${alternatives.activeMessageIndex + 1}/${alternatives.messages.length}&nbsp;`;
            controlsContainer.appendChild(prevBtn);
            controlsContainer.appendChild(status);
            controlsContainer.appendChild(nextBtn);
        }

        // Spacer
        const spacer = document.createElement('span');
        spacer.innerHTML = `&nbsp;&nbsp;&nbsp;`;
        controlsContainer.appendChild(spacer);

        // Add message modification controls.
        const addBtn = createControlButton('New Message Alternative', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1z" fill="currentColor"/></svg>', () => {
            if (message.value.role === 'assistant') {
                // For AI messages, adding an alternative means regenerating the response.
                chatLog.addAlternative(message, { role: 'assistant', content: null, agent: message.agent });
                responseProcessor.scheduleProcessing(appInstance);
            } else {
                // For user messages, adding an alternative means creating an editable copy.
                // A special flag is used to trigger the edit UI on the new message after the re-render.
                const newMsg = chatLog.addAlternative(message, { ...message.value });
                appInstance.editingJustAddedMessage = newMsg;
                chatLog.notify();
            }
        });

        const editBtn = createControlButton('Edit Message', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>', () => {
            const contentEl = el.querySelector('.message-content');
            if (contentEl) {
                makeEditable(contentEl, message.value.content, (newText) => {
                    message.value.content = newText;
                    chatLog.notify();
                });
            }
        });

        const delBtn = createControlButton('Delete Message', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 17.069 22H6.93a2 2 0 0 1-1.995-1.858L4.07 8H3a1 1 0 0 1 0-2h4V4zm2 2h6V4H9v2zM6.074 8l.857 12H17.07l.857-12H6.074zM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z" fill="currentColor"/></svg>', () => chatLog.deleteMessage(message));

        controlsContainer.appendChild(addBtn);
        controlsContainer.appendChild(editBtn);
        controlsContainer.appendChild(delBtn);

        // This special case handles the UX flow where adding a new user alternative
        // immediately puts it into edit mode.
        if (appInstance.editingJustAddedMessage === message) {
            const contentEl = el.querySelector('.message-content');
            if (contentEl) {
                makeEditable(
                    contentEl,
                    message.value.content,
                    (newText) => { // onSave
                        message.value.content = newText;
                        chatLog.notify();
                        // After saving, automatically submit to get the AI's response to the new message.
                        appInstance.chatManager.handleFormSubmit({ isContinuation: true });
                    },
                    () => { // onCancel
                        // If the user cancels editing the new alternative, delete it.
                        chatLog.deleteMessage(message);
                    }
                );
            }
            // Reset the flag.
            appInstance.editingJustAddedMessage = null;
        }
    }
};

/**
 * Registers the UI Controls Plugin with the application's plugin manager.
 */
pluginManager.register(uiControlsPlugin);
