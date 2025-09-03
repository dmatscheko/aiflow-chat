/**
 * @fileoverview Main application logic for the Core Chat client.
 * @licence MIT
 */

'use strict';

import { ApiService } from './api.js';
import { Chatlog } from './data.js';
import { ChatUI } from './ui.js';

// --- Configuration ---
const API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';
const API_KEY_STORAGE_KEY = 'core-chat-api-key';

/**
 * The main application class.
 */
class CoreChatApp {
    constructor() {
        // Get references to DOM elements
        const chatContainer = document.getElementById('chat-container');
        const messageInput = document.getElementById('message-input');
        const submitButton = document.getElementById('submit-button');

        if (!chatContainer || !messageInput || !submitButton) {
            throw new Error('Required DOM elements not found.');
        }

        /** @type {string} */
        this.apiKey = '';
        /** @type {HTMLTextAreaElement} */
        this.messageInput = (messageInput);
        /** @type {HTMLButtonElement} */
        this.submitButton = (submitButton);

        /** @type {ApiService} */
        this.api = new ApiService();
        /** @type {Chatlog} */
        this.chatlog = new Chatlog();
        /** @type {ChatUI} */
        this.ui = new ChatUI(chatContainer, this.chatlog);

        /** @type {AbortController | null} */
        this.controller = null;
    }

    /**
     * Initializes the application by setting up event listeners.
     */
    init() {
        this.loadApiKey();
        this.submitButton.addEventListener('click', () => this.submitMessage());
        this.messageInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                this.submitMessage();
            }
        });
    }

    /**
     * Loads the API key from session storage or prompts the user for it.
     */
    loadApiKey() {
        let key = sessionStorage.getItem(API_KEY_STORAGE_KEY);
        if (!key) {
            key = prompt('Please enter your OpenAI API key:');
            if (key) {
                sessionStorage.setItem(API_KEY_STORAGE_KEY, key);
            }
        }
        if (!key) {
            throw new Error('API key is required to run the application.');
        }
        this.apiKey = key;
    }

    /**
     * Handles the submission of a user message.
     */
    submitMessage() {
        const content = this.messageInput.value.trim();
        if (!content) {
            return;
        }

        // Add user message to the chatlog
        this.chatlog.addMessage({ role: 'user', content });
        this.messageInput.value = '';

        // Add a placeholder for the assistant's response
        this.chatlog.addMessage({ role: 'assistant', content: '' });

        // Trigger the AI response generation
        this.generateAIResponse();
    }

    /**
     * Generates and streams an AI response from the API.
     */
    async generateAIResponse() {
        this.controller = new AbortController();
        const signal = this.controller.signal;

        // Get the current conversation history
        const messages = this.chatlog.getActiveMessageValues();
        // The last message is the empty assistant message, which we will populate
        const assistantMessage = this.chatlog.getLastMessage();

        if (!assistantMessage) return;

        try {
            const payload = {
                model: MODEL,
                messages: messages,
                stream: true,
            };

            const reader = await this.api.streamAPIResponse(payload, API_ENDPOINT, this.apiKey, signal);

            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6);
                        if (dataStr === '[DONE]') break;

                        try {
                            const data = JSON.parse(dataStr);
                            const delta = data.choices[0]?.delta?.content || '';
                            if (delta) {
                                // Append content and notify UI to re-render
                                assistantMessage.appendContent(delta);
                                this.chatlog.notify();
                            }
                        } catch (e) {
                            console.error('Error parsing stream data:', e);
                        }
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Stream aborted by user.');
                assistantMessage.appendContent('\\n[Response aborted]');
            } else {
                console.error('Error fetching stream:', error);
                assistantMessage.appendContent(`\\n[Error: ${error.message}]`);
            }
            this.chatlog.notify(); // Re-render to show the error
        } finally {
            this.controller = null;
        }
    }
}

// Wait for the DOM to be fully loaded before initializing the app
document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new CoreChatApp();
        app.init();
    } catch (e) {
        document.body.innerHTML = `<div style="color: red; padding: 20px;">Error initializing app: ${e.message}</div>`;
        console.error(e);
    }
});
