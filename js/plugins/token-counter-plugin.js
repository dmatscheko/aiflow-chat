/**
 * @fileoverview A plugin to display token counts and generation speed.
 * This plugin adds two main features:
 * 1. A token counter in the title bar that shows the token count of the user's input.
 * 2. A tokens/second display in the message bubble of AI-generated responses.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

const tokenCounterPlugin = {
    name: 'TokenCounter',

    /**
     * Adds the token counter control to the title bar.
     * @param {Array<object>} controls - The array of existing title bar controls.
     * @returns {Array<object>} The modified array of controls.
     */
    onTitleBarControlsRegistered(controls) {
        controls.push({
            id: 'token-counter-container',
            html: '<div id="token-counter" class="title-bar-control">Tokens: 0</div>',
            onMount: (container) => {
                const messageInput = document.getElementById('message-input');
                const tokenCounter = container.querySelector('#token-counter');

                if (messageInput && tokenCounter) {
                    const updateTokenCount = () => {
                        if (typeof GPTTokenizer_cl100k_base === 'undefined') return;
                        const text = messageInput.value;
                        if (text) {
                            const tokens = GPTTokenizer_cl100k_base.encode(text);
                            tokenCounter.textContent = `Tokens: ${tokens.length}`;
                        } else {
                            tokenCounter.textContent = 'Tokens: 0';
                        }
                    };

                    messageInput.addEventListener('input', updateTokenCount);
                    updateTokenCount(); // Initial count
                }
            }
        });
        return controls;
    },

    /**
     * Adds a placeholder for the token speed display in AI message bubbles.
     * @param {HTMLElement} el - The message bubble element.
     * @param {object} message - The message object being rendered.
     */
    onMessageRendered(el, message) {
        if (message.value.role === 'assistant') {
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
    }
};

pluginManager.register(tokenCounterPlugin);