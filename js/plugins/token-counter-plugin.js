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
                console.log('TokenCounter: onMount triggered');
                const messageInput = document.getElementById('message-input');
                const tokenCounter = container.querySelector('#token-counter');

                if (messageInput && tokenCounter) {
                    console.log('TokenCounter: Found message input and token counter elements.');
                    const updateTokenCount = () => {
                        console.log('TokenCounter: updateTokenCount triggered');
                        const text = messageInput.value;
                        if (text) {
                            const tokens = cl100k_base.encode(text);
                            tokenCounter.textContent = `Tokens: ${tokens.length}`;
                        } else {
                            tokenCounter.textContent = 'Tokens: 0';
                        }
                    };

                    messageInput.addEventListener('input', updateTokenCount);
                    updateTokenCount(); // Initial count
                } else {
                    console.error('TokenCounter: Could not find message input or token counter elements.');
                }
            }
        });
        return controls;
    },

    /**
     * Attaches an event listener to the message input to update the token count.
     * @param {object} view - The current view object.
     */
    onViewRendered(view) {
        if (view.type !== 'chat') {
            return;
        }
    },

    /**
     * Adds a placeholder for the token speed display in AI message bubbles.
     * @param {object} message - The message object being rendered.
     */
    onMessageRendered(message) {
        if (message.value.role === 'assistant') {
            const messageBubble = document.querySelector(`.message-bubble[data-message-id="${message.id}"] .message-title-text`);
            if (messageBubble) {
                const speedSpan = document.createElement('span');
                speedSpan.id = `token-speed-${message.id}`;
                speedSpan.className = 'token-speed-display';
                messageBubble.appendChild(speedSpan);
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
    },

    /**
     * Updates the token count as data is received.
     * @param {object} data - The streaming data.
     */
    onStreamingData({ message, chunk }) {
        if (message.totalTokens !== undefined) {
            const tokens = cl100k_base.encode(chunk);
            message.totalTokens += tokens.length;
        }
    },

    /**
     * Calculates and displays the final tokens/second rate when the stream ends.
     * @param {object} data - The streaming end data.
     */
    onStreamingEnd({ message }) {
        if (message.startTime && message.totalTokens) {
            const endTime = Date.now();
            const durationInSeconds = (endTime - message.startTime) / 1000;
            const tokensPerSecond = message.totalTokens / durationInSeconds;

            const speedSpan = document.getElementById(`token-speed-${message.id}`);
            if (speedSpan) {
                speedSpan.textContent = ` (${tokensPerSecond.toFixed(1)} t/s)`;
            }
        }
    }
};

pluginManager.register(tokenCounterPlugin);