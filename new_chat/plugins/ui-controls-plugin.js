/**
 * @fileoverview A plugin for adding UI controls to messages.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { responseProcessor } from '../plugins/chats-plugin.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../chat-data.js').Message} Message
 */

let appInstance = null;

/**
 * A helper function to create a control button.
 * @param {string} title - The button's title (tooltip).
 * @param {string} svgHTML - The SVG icon for the button.
 * @param {() => void} onClick - The function to call when the button is clicked.
 * @returns {HTMLButtonElement}
 */
function createControlButton(title, svgHTML, onClick) {
    const button = document.createElement('button');
    button.title = title;
    button.innerHTML = svgHTML;
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return button;
}

/**
 * Makes a message's content editable in-place.
 * @param {HTMLElement} contentEl - The content element of the message.
 * @param {Message} message - The message object.
 * @param {(newText: string) => void} onSave - Callback to execute when saving.
 */
function makeEditable(contentEl, message, onSave, onCancel = null) {
    contentEl.style.display = 'none';

    const editorContainer = document.createElement('div');
    editorContainer.className = 'edit-container';

    const textarea = document.createElement('textarea');
    textarea.className = 'edit-in-place';
    textarea.value = message.value.content || '';
    editorContainer.appendChild(textarea);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'edit-buttons';
    editorContainer.appendChild(buttonContainer);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    saveButton.className = 'edit-save-btn';
    buttonContainer.appendChild(saveButton);

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.className = 'edit-cancel-btn';
    buttonContainer.appendChild(cancelButton);

    contentEl.parentElement.insertBefore(editorContainer, contentEl.nextSibling);

    // Use setTimeout to ensure the element is rendered and visible before focusing and resizing.
    // This is crucial for the "New Message Alternative" path, where `makeEditable` is called
    // immediately after a re-render.
    setTimeout(() => {
        textarea.focus();
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    }, 0);

    let isSaving = false;

    const cleanup = () => {
        editorContainer.remove();
        contentEl.style.display = '';
    };

    const save = () => {
        if (isSaving) return;
        isSaving = true;
        onSave(textarea.value);
        cleanup();
    };

    const cancel = () => {
        if (onCancel) {
            onCancel();
        }
        cleanup();
    };

    saveButton.addEventListener('click', save);
    cancelButton.addEventListener('click', cancel);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
        }
    });

    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    });
}


const uiControlsPlugin = {
    name: 'ui-controls',
    /**
     * @param {App} app
     */
    onAppInit(app) {
        appInstance = app;
    },

    /**
     * @param {HTMLElement} el
     * @param {Message} message
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

        // Alternative navigation controls
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

        // Modification controls
        const addBtn = createControlButton('New Message Alternative', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1z" fill="currentColor"/></svg>', () => {
            if (message.value.role === 'assistant') {
                chatLog.addAlternative(message, { role: 'assistant', content: null, agent: message.value.agent });
                responseProcessor.scheduleProcessing(appInstance);
            } else {
                // This flag is used to trigger the edit UI on the new message after the re-render.
                // It's a bit of a hack, but it's the most straightforward way to achieve the desired UX
                // without a major refactor of the rendering logic.
                const newMsg = chatLog.addAlternative(message, { ...message.value });
                appInstance.editingJustAddedMessage = newMsg;
                chatLog.notify();
            }
        });

        const editBtn = createControlButton('Edit Message', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>', () => {
            const contentEl = el.querySelector('.message-content');
            if (contentEl) {
                makeEditable(contentEl, message, (newText) => {
                    message.value.content = newText;
                    chatLog.notify();
                });
            }
        });

        const delBtn = createControlButton('Delete Message', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 17.069 22H6.93a2 2 0 0 1-1.995-1.858L4.07 8H3a1 1 0 0 1 0-2h4V4zm2 2h6V4H9v2zM6.074 8l.857 12H17.07l.857-12H6.074zM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z" fill="currentColor"/></svg>', () => chatLog.deleteMessage(message));

        controlsContainer.appendChild(addBtn);
        controlsContainer.appendChild(editBtn);
        controlsContainer.appendChild(delBtn);

        if (appInstance.editingJustAddedMessage === message) {
            const contentEl = el.querySelector('.message-content');
            if (contentEl) {
                makeEditable(
                    contentEl,
                    message,
                    (newText) => { // onSave
                        message.value.content = newText;
                        chatLog.notify();
                        appInstance.chatManager.handleFormSubmit({ isContinuation: true });
                    },
                    () => { // onCancel
                        chatLog.deleteMessage(message);
                    }
                );
            }
            appInstance.editingJustAddedMessage = null;
        }
    }
};

pluginManager.register(uiControlsPlugin);
