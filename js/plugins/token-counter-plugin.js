/**
 * @fileoverview A plugin to display token counts and generation speed.
 * This plugin adds two main features:
 * 1. A token counter in the title bar that shows the token count of the user's input.
 * 2. A tokens/second display in the message bubble of AI-generated responses.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

let appInstance = null;
let currentChatLog = null;

const tokenCounterPlugin = {
    name: 'TokenCounter',

    /**
     * Stores a reference to the main app instance.
     * @param {import('../main.js').App} app - The main application instance.
     */
    onAppInit(app) {
        appInstance = app;
    },

    /**
     * Registers the token counter UI in the title bar.
     * @param {object} config - The title bar configuration object.
     * @param {import('../main.js').View} view - The active view.
     * @returns {object} The modified configuration object.
     */
    onTitleBarRegister(config, view, app) {
        if (view.type !== 'chat') {
            return config;
        }

        config.controls.push({
            id: 'token-counter-container',
            html: `
                <div class="token-counter-group">
                    <span id="title-token-counter">Token</span>
                    <span class="token-counter-inner-group">
                        <span id="context-token-counter">Context: 0</span>
                        <span id="prompt-token-counter">Prompt: 0</span>
                    </span>
                </div>
            `,
            onMount: (container) => {
                const messageInput = document.getElementById('message-input');
                if (messageInput) {
                    messageInput.addEventListener('input', updateAllTokenCounts);
                }
                updateAllTokenCounts();
            }
        });

        return config;
    },

    /**
     * Subscribes to chat log updates to keep the token count current.
     */
    onViewRendered() {
        if (!appInstance) return;

        const activeChat = appInstance.chatManager.getActiveChat();
        if (activeChat && activeChat.log !== currentChatLog) {
            if (currentChatLog) {
                currentChatLog.unsubscribe(updateAllTokenCounts);
            }
            currentChatLog = activeChat.log;
            currentChatLog.subscribe(updateAllTokenCounts);
        }
        updateAllTokenCounts();
    },

    /**
     * Adds a placeholder for the token speed display in AI message bubbles.
     * @param {HTMLElement} el - The message bubble element.
     * @param {object} message - The message object being rendered.
     */
    onMessageRendered(el, message) {
        if (message.value.role === 'assistant' || message.value.role === 'tool') {
            const titleText = el.querySelector('.message-title-text');
            if (titleText) {
                let speedSpan = titleText.querySelector('.token-speed-display');
                if (!speedSpan) {
                    speedSpan = document.createElement('span');
                    speedSpan.className = 'token-speed-display';
                    titleText.appendChild(speedSpan);
                }

                const speed = message.liveSpeed || message.value.tokensPerSecond;
                if (speed) {
                    speedSpan.textContent = ` (${speed.toFixed(1)} t/s)`;
                } else {
                    speedSpan.textContent = '';
                }
            }
        }
    },

    /**
     * Starts the timer when a new AI stream begins.
     * @param {object} data - The streaming start data.
     */
    onStreamingStart({ message }) {
        message.startTime = Date.now();
        message.totalTokens = 0;
        message.liveSpeed = 0;
    },

    /**
     * Updates the token count as data is received.
     * @param {object} data - The streaming data.
     */
    onStreamingData({ message, deltas, notifyUpdate }) {
        if (typeof GPTTokenizer_cl100k_base === 'undefined') return;
        if (message.totalTokens !== undefined) {
            const text = deltas.join('');
            const tokens = GPTTokenizer_cl100k_base.encode(text);
            message.totalTokens += tokens.length;

            const elapsedTime = (Date.now() - message.startTime) / 1000;
            if (elapsedTime > 0) {
                message.liveSpeed = message.totalTokens / elapsedTime;
            }
            notifyUpdate();
        }
    },

    /**
     * Calculates and displays the final tokens/second rate when the stream ends.
     * @param {object} data - The streaming end data.
     */
    onStreamingEnd({ message, notifyUpdate }) {
        if (message.startTime && message.totalTokens) {
            const endTime = Date.now();
            const durationInSeconds = (endTime - message.startTime) / 1000;
            if (durationInSeconds > 0) {
                message.value.tokensPerSecond = message.totalTokens / durationInSeconds;
            } else {
                message.value.tokensPerSecond = 0;
            }
            delete message.liveSpeed;
            notifyUpdate();
        }
    },

    /**
     * Resets the token counter when the message form is submitted.
     */
    onMessageFormSubmit() {
        updateAllTokenCounts();
    }
};

function updateAllTokenCounts() {
    if (typeof GPTTokenizer_cl100k_base === 'undefined' || !appInstance) {
        return;
    }

    const contextTokenCounter = document.getElementById('context-token-counter');
    const promptTokenCounter = document.getElementById('prompt-token-counter');
    const messageInput = document.getElementById('message-input');

    if (!contextTokenCounter || !promptTokenCounter || !messageInput) {
        return;
    }

    // Calculate and display prompt tokens
    const promptText = messageInput.value;
    const promptTokens = promptText ? GPTTokenizer_cl100k_base.encode(promptText).length : 0;
    promptTokenCounter.textContent = `Prompt: ${promptTokens}`;

    // Calculate and display context tokens
    const activeChat = appInstance.chatManager.getActiveChat();
    let contextTokens = 0;
    if (activeChat) {
        const messages = activeChat.log.getActiveMessages();
        const historyText = messages.map(m => m.value.content).join('\n');
        contextTokens = GPTTokenizer_cl100k_base.encode(historyText).length;
    }
    contextTokenCounter.textContent = `Context: ${contextTokens}`;
}

pluginManager.register(tokenCounterPlugin);