'use strict';

import { pluginManager } from '../plugin-manager.js';

class TokenCounterPlugin {
    constructor() {
        this.name = 'TokenCounter';
        this.app = null;
    }

    onAppInit(app) {
        this.app = app;
    }

    onTitleBarControlsRegistered(controls, chat) {
        const tokenCounterControl = {
            id: 'token-counter-container',
            html: `<span id="token-counter" title="Context + Message Tokens">0 tokens</span>`,
            onMount: (container) => {
                // The element is now in the DOM, we can safely attach listeners
                const messageInput = document.getElementById('message-input');
                if (messageInput) {
                    const tokenCountEl = container.querySelector('#token-counter');
                    const updateTokenCount = () => {
                         const messageText = messageInput.value;
                        let totalTokens = 0;

                        try {
                            // gpt-tokenizer is loaded globally from CDN
                            if (window.gptTokenizer) {
                                const tokenizer = window.gptTokenizer;
                                // Calculate context tokens
                                const messages = chat.log.getMessages();
                                const contextContent = messages.map(m => {
                                    if (typeof m.content === 'string') {
                                        return m.content;
                                    }
                                    return JSON.stringify(m.content);
                                }).join('\n');

                                if (contextContent) {
                                    totalTokens += tokenizer.encode(contextContent).length;
                                }

                                // Calculate message tokens
                                if (messageText) {
                                    totalTokens += tokenizer.encode(messageText).length;
                                }
                            }

                            tokenCountEl.textContent = `${totalTokens} tokens`;
                        } catch (e) {
                            console.error("Error calculating tokens:", e);
                            tokenCountEl.textContent = 'Token err';
                        }
                    };
                    messageInput.addEventListener('input', updateTokenCount);
                    document.addEventListener('chatHistoryUpdated', updateTokenCount);
                    updateTokenCount(); // Initial count
                }
            }
        };
        // Add our control to the list
        controls.push(tokenCounterControl);
        return controls;
    }

    onMessageRendered(message, messageDiv) {
        if (message.value.role !== 'assistant') {
            return;
        }

        const titleText = messageDiv.querySelector('.message-title-text');
        if (!titleText) return;

        let tokenDisplay = messageDiv.querySelector('.token-display');
        if (!tokenDisplay) {
            tokenDisplay = document.createElement('span');
            tokenDisplay.className = 'token-display';
            tokenDisplay.style.cssText = 'color: var(--text-color-secondary); font-weight: normal; margin-left: 8px;';
            titleText.appendChild(tokenDisplay);
        }

        let displayText = '';
        const isStreaming = this.app.abortController && message.value.content !== null && !message.value.usage;

        if (isStreaming) {
            const tokens = message.value.streamedTokens || 0;
            const tps = message.value.tokensPerSecond || '0.0';
            displayText = `(${tokens} tokens, ${tps} t/s)`;
        } else if (message.value.usage) {
            const finalTokens = message.value.usage.completion_tokens || message.value.streamedTokens || 0;
            displayText = `(${finalTokens} tokens)`;
        } else if (message.value.streamedTokens > 0) {
            // Case for when streaming ends but usage stats might not have arrived yet
            displayText = `(${message.value.streamedTokens} tokens)`;
        }

        tokenDisplay.textContent = displayText;
    }
}

pluginManager.register(new TokenCounterPlugin());