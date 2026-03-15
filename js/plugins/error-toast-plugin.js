/**
 * @fileoverview A plugin that provides a toast notification area in the top-right
 * of the main content area. Replaces alert() dialogs with non-blocking, auto-dismissing
 * toast messages. Supports error, success, and info types.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {'error' | 'success' | 'info'} ToastType
 */

/** @type {HTMLElement | null} */
let toastContainer = null;

/** Auto-dismiss timeout in ms. */
const TOAST_DURATION = 10000;

/**
 * Ensures the toast container exists in the DOM. It is appended to #main-panel
 * so it is visible regardless of which view/tab is active.
 */
function ensureContainer() {
    if (toastContainer && toastContainer.isConnected) return;

    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.innerHTML = `<button id="toast-close-all" title="Dismiss all">&times;</button>`;
    toastContainer.querySelector('#toast-close-all').addEventListener('click', dismissAll);

    const mainPanel = document.getElementById('main-panel');
    if (mainPanel) {
        mainPanel.appendChild(toastContainer);
    } else {
        document.body.appendChild(toastContainer);
    }
}

/**
 * Shows a toast notification.
 * @param {string} message - The message to display.
 * @param {ToastType} [type='error'] - The type of toast.
 */
function showToast(message, type = 'error') {
    ensureContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // Individual dismiss on click
    toast.addEventListener('click', () => removeToast(toast));

    toastContainer.appendChild(toast);
    updateCloseAllVisibility();

    // Auto-dismiss
    const timeout = setTimeout(() => removeToast(toast), TOAST_DURATION);
    toast.dataset.timeout = timeout;
}

/**
 * Removes a single toast with a fade-out animation.
 * @param {HTMLElement} toast
 */
function removeToast(toast) {
    if (!toast || !toast.isConnected) return;
    clearTimeout(Number(toast.dataset.timeout));
    toast.style.opacity = '0';
    toast.addEventListener('transitionend', () => {
        toast.remove();
        updateCloseAllVisibility();
    }, { once: true });
    // Fallback removal if transitionend doesn't fire
    setTimeout(() => {
        if (toast.isConnected) {
            toast.remove();
            updateCloseAllVisibility();
        }
    }, 400);
}

/**
 * Dismisses all visible toasts.
 */
function dismissAll() {
    if (!toastContainer) return;
    toastContainer.querySelectorAll('.toast').forEach(t => removeToast(t));
}

/**
 * Shows/hides the close-all button based on whether toasts exist.
 */
function updateCloseAllVisibility() {
    if (!toastContainer) return;
    const btn = toastContainer.querySelector('#toast-close-all');
    if (btn) {
        btn.style.display = toastContainer.querySelectorAll('.toast').length > 0 ? '' : 'none';
    }
}

// --- CSS injection (self-contained plugin) ---
const style = document.createElement('style');
style.textContent = `
#toast-container {
    position: absolute;
    top: 52px;
    right: 8px;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 420px;
    pointer-events: none;
}

#toast-container > * {
    pointer-events: auto;
}

#toast-close-all {
    align-self: flex-end;
    background: none;
    border: none;
    color: var(--text-color-secondary, #999);
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    display: none;
}

#toast-close-all:hover {
    color: var(--text-color, #e0e0e0);
}

.toast {
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 0.88rem;
    line-height: 1.35;
    word-break: break-word;
    cursor: pointer;
    opacity: 1;
    transition: opacity 0.3s ease;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}

.toast-error {
    background-color: #5c1a1a;
    border-left: 3px solid #ff4d4d;
    color: #ffbbbb;
}

.toast-success {
    background-color: #1a3a1a;
    border-left: 3px solid #4dff4d;
    color: #bbffbb;
}

.toast-info {
    background-color: #1a2a4a;
    border-left: 3px solid #4d9fff;
    color: #bbddff;
}
`;
document.head.appendChild(style);

// --- Plugin registration ---
const errorToastPlugin = {
    name: 'error-toast',

    onAppInit() {
        ensureContainer();
    },

    /**
     * Hook handler: allows any module to show a toast via
     * `pluginManager.trigger('onShowToast', message, type)`.
     * @param {string} message - The message to display.
     * @param {ToastType} [type='error'] - The type of toast.
     */
    onShowToast(message, type) {
        showToast(message, type);
    },
};

pluginManager.register(errorToastPlugin);
