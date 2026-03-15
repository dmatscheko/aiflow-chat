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

/** SVG icon for the "Previous Message" button. */
const PREV_SVG = '<svg width="16" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19 7.766c0-1.554-1.696-2.515-3.029-1.715l-7.056 4.234c-1.295.777-1.295 2.653 0 3.43l7.056 4.234c1.333.8 3.029-.16 3.029-1.715V7.766zM9.944 12L17 7.766v8.468L9.944 12zM6 6a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1z" fill="currentColor"/></svg>';
/** SVG icon for the "Next Message" button. */
const NEXT_SVG = '<svg width="16" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 7.766c0-1.554 1.696-2.515 3.029-1.715l7.056 4.234c1.295.777-1.295 2.653 0 3.43L8.03 17.949c-1.333.8-3.029-.16-3.029-1.715V7.766zM14.056 12L7 7.766v8.468L14.056 12zM18 6a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1z" fill="currentColor"/></svg>';
/** SVG icon for the "New Message Alternative" (+) button. */
const ADD_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1z" fill="currentColor"/></svg>';
/** SVG icon for the "Edit Message" button. */
const EDIT_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>';
/** SVG icon for the "Delete Message" button. */
const DELETE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 17.069 22H6.93a2 2 0 0 1-1.995-1.858L4.07 8H3a1 1 0 0 1 0-2h4V4zm2 2h6V4H9v2zM6.074 8l.857 12H17.07l.857-12H6.074zM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z" fill="currentColor"/></svg>';

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

        const alternatives = chatLog.findAlternatives(message);
        const numAlternatives = alternatives ? alternatives.messages.length : 1;

        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'message-controls';
        if (numAlternatives > 1) controlsContainer.classList.add('has-alternatives');
        titleRow.appendChild(controlsContainer);

        // --- Navigation group (prev / counter / next) ---
        // Hidden by default via CSS; shown when .has-alternatives or .editing-alternative.
        const navGroup = document.createElement('span');
        navGroup.className = 'message-nav-group';

        navGroup.appendChild(createControlButton('Previous Message', PREV_SVG,
            () => chatLog.cycleAlternatives(message, 'prev')));

        const status = document.createElement('span');
        status.className = 'message-nav-status';
        if (numAlternatives > 1) {
            status.innerHTML = `&nbsp;${alternatives.activeMessageIndex + 1}/${numAlternatives}&nbsp;`;
        }
        navGroup.appendChild(status);

        navGroup.appendChild(createControlButton('Next Message', NEXT_SVG,
            () => chatLog.cycleAlternatives(message, 'next')));

        controlsContainer.appendChild(navGroup);

        // --- Action buttons (add alternative / edit / delete) ---
        // Hidden via CSS when .editing-alternative is active.
        controlsContainer.appendChild(createControlButton('New Message Alternative', ADD_SVG, () => {
            if (message.value.role === 'assistant') {
                // For AI messages, adding an alternative means regenerating the response.
                const activeAgent = appInstance.chatManager.getActiveChat()?.agent || null;
                chatLog.addAlternative(message, { role: 'assistant', content: null, agent: activeAgent });
                responseProcessor.scheduleProcessing(appInstance, appInstance.chatManager.activeChatId);
            } else {
                // For user and tool messages, enter inline edit mode to compose the alternative.
                _enterVirtualAlternativeMode(el, message, chatLog, numAlternatives);
            }
        }));

        controlsContainer.appendChild(createControlButton('Edit Message', EDIT_SVG, () => {
            const contentEl = el.querySelector('.message-content');
            if (contentEl) {
                makeEditable(contentEl, message.value.content, (newText) => {
                    message.value.content = newText;
                    message.cache = null;
                    chatLog.notify();
                });
            }
        }));

        controlsContainer.appendChild(createControlButton('Delete Message', DELETE_SVG,
            () => chatLog.deleteMessage(message)));
    }
};

/**
 * Enters virtual alternative editing mode for a user or tool message.
 * Toggles the `.editing-alternative` CSS class on the controls container to
 * show the navigation counter (with a virtual "N+1" indicator) and hide the
 * action buttons. Opens an inline editor; on save a real alternative is created,
 * on cancel the class is simply removed to restore the original state.
 *
 * @param {HTMLElement} el - The message wrapper element.
 * @param {Message} message - The message data object.
 * @param {import('../chat-data.js').ChatLog} chatLog - The chat log instance.
 * @param {number} numAlternatives - The current number of real alternatives.
 * @private
 */
function _enterVirtualAlternativeMode(el, message, chatLog, numAlternatives) {
    const controls = el.querySelector('.message-controls');
    const status = controls?.querySelector('.message-nav-status');
    const contentEl = el.querySelector('.message-content');
    if (!controls || !status || !contentEl) return;

    // Save only the status text; all other state is toggled via the CSS class.
    const originalStatusHTML = status.innerHTML;
    const virtualIndex = numAlternatives + 1;

    controls.classList.add('editing-alternative');
    status.innerHTML = `&nbsp;${virtualIndex}/${virtualIndex}&nbsp;`;

    const exitEditMode = () => {
        controls.classList.remove('editing-alternative');
        status.innerHTML = originalStatusHTML;
    };

    makeEditable(
        contentEl,
        message.value.content,
        (newText) => {
            // On save: create the real alternative, select it, and trigger AI response.
            exitEditMode();
            const newMsg = chatLog.addAlternative(message, { ...message.value, content: newText });
            const parentAlternatives = chatLog.findAlternatives(newMsg);
            if (parentAlternatives) {
                parentAlternatives.activeMessageIndex = parentAlternatives.messages.indexOf(newMsg);
            }
            appInstance.chatManager.handleFormSubmit({ isContinuation: true });
        },
        () => {
            // On cancel: remove the CSS class to restore original state.
            exitEditMode();
        }
    );
}

/**
 * Registers the UI Controls Plugin with the application's plugin manager.
 */
pluginManager.register(uiControlsPlugin);
