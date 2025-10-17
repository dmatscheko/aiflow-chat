/**
 * @fileoverview Manages the top panel, which includes the main title bar.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { createButton } from './ui-elements.js';
import { makeSingleLineEditable } from '../utils.js';

let appInstance = null;

class TopPanelManager {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('main-panel');
    }

    render() {
        const existingTitleBar = this.container.querySelector('.main-title-bar');
        if (existingTitleBar) {
            existingTitleBar.remove();
        }

        const titleBarConfig = pluginManager.trigger('onTitleBarRegister', {
            title: 'AIFlow',
            controls: [],
            buttons: []
        });

        const titleBar = this.createTitleBar(titleBarConfig);
        this.container.prepend(titleBar);
    }

    createTitleBar({ title, controls, buttons }) {
        const titleBar = document.createElement('div');
        titleBar.className = 'main-title-bar';

        const titleEl = document.createElement('h2');
        titleEl.className = 'title';

        if (typeof title === 'string') {
            titleEl.appendChild(document.createTextNode(title));
        } else {
            const span = document.createElement('span');
            span.className = 'editable-title-part';
            span.textContent = title.text;

            const editBtn = createButton({
                id: 'edit-title-btn',
                label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>',
                className: 'inline-edit-btn',
                onClick: () => makeSingleLineEditable(span, title.text, title.onSave)
            });

            span.addEventListener('click', () => makeSingleLineEditable(span, title.text, title.onSave));
            titleEl.appendChild(span);
            titleEl.appendChild(editBtn);
        }

        const controlsContainer = document.createElement('div');
        controlsContainer.id = 'title-bar-controls';
        controls.forEach(control => {
            const controlWrapper = document.createElement('div');
            controlWrapper.id = control.id;
            controlWrapper.innerHTML = control.html;
            controlsContainer.appendChild(controlWrapper);
            if (control.onMount) {
                setTimeout(() => control.onMount(controlWrapper), 0);
            }
        });

        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'title-bar-buttons';
        buttons.forEach(buttonInfo => {
            const button = createButton(buttonInfo);
            buttonsContainer.appendChild(button);
        });

        titleBar.appendChild(titleEl);
        titleBar.appendChild(controlsContainer);
        titleBar.appendChild(buttonsContainer);

        return titleBar;
    }
}

pluginManager.register({
    name: 'TopPanelManagerInitializer',
    onAppInit(app) {
        appInstance = app;
        app.topPanelManager = new TopPanelManager(app);
    },
    onViewRendered() {
        if (appInstance.topPanelManager) {
            appInstance.topPanelManager.render();
        }
    }
});