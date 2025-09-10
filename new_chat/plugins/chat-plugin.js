/**
 * @fileoverview The primary plugin for Core Chat functionality.
 * This plugin manages the chat UI, message processing, and core chat views.
 * @version 1.0.0
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').Chat} Chat
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('./agents-plugin.js').AgentManager} AgentManager
 * @typedef {import('../chat-data.js').ChatLog} ChatLog
 */

/**
 * Manages the rendering of a ChatLog instance into a designated HTML element.
 * It subscribes to a ChatLog and automatically re-renders the UI when the
 * log changes.
 * @class
 */
class ChatUI {
    /**
     * @param {HTMLElement} container - The DOM element to render the chat messages into.
     * @param {AgentManager} agentManager - The agent manager instance for displaying agent names.
     * @throws {Error} If the container element is not provided.
     */
    constructor(container, agentManager) {
        if (!container) {
            throw new Error('ChatUI container element is required.');
        }
        /**
         * The DOM element where chat messages are rendered.
         * @type {HTMLElement}
         */
        this.container = container;
        /**
         * The agent manager instance.
         * @type {AgentManager}
         */
        this.agentManager = agentManager;
        /**
         * The ChatLog instance this UI is currently displaying.
         * @type {ChatLog | null}
         */
        this.chatLog = null;
        /**
         * A pre-bound reference to the update method for event listeners.
         * @type {() => void}
         * @private
         */
        this.boundUpdate = this.update.bind(this);
    }

    /**
     * Connects a ChatLog instance to this UI component.
     * The UI will automatically update when the ChatLog changes.
     * @param {ChatLog} chatLog - The chat log to display.
     */
    setChatLog(chatLog) {
        if (this.chatLog) {
            this.chatLog.unsubscribe(this.boundUpdate);
        }
        this.chatLog = chatLog;
        this.chatLog.subscribe(this.boundUpdate);
        this.update();
    }

    /**
     * Renders the chat log content into the container.
     * This method is typically called automatically when the connected ChatLog is updated.
     */
    update() {
        if (!this.chatLog) {
            this.container.innerHTML = '';
            return;
        }

        const shouldScroll = this.isScrolledToBottom();
        this.container.innerHTML = ''; // Clear previous content

        const fragment = document.createDocumentFragment();
        let current = this.chatLog.rootAlternatives ? this.chatLog.rootAlternatives.getActiveMessage() : null;

        while (current) {
            const messageEl = this.formatMessage(current);
            fragment.appendChild(messageEl);
            current = current.getActiveAnswer();
        }

        this.container.appendChild(fragment);

        if (shouldScroll) {
            this.scrollToBottom();
        }
    }

    /**
     * Creates an HTML element for a single message.
     * It constructs the basic message structure and then allows plugins to
     * modify the content element before it's added to the DOM.
     * @param {Message} message - The message object to format.
     * @returns {HTMLElement} The formatted message element.
     * @private
     */
    formatMessage(message) {
        const el = document.createElement('div');
        el.classList.add('message', `role-${message.value.role}`);

        const roleEl = document.createElement('strong');
        let roleText = message.value.role;

        if (message.value.agent && this.agentManager) {
            const agent = this.agentManager.getAgent(message.value.agent);
            if (agent) {
                roleText += ` (${agent.name})`;
            }
        }
        roleEl.textContent = roleText;

        const contentEl = document.createElement('div');
        contentEl.textContent = message.value.content || '';

        // Allow plugins to modify the content element (e.g., for rich formatting)
        pluginManager.trigger('onFormatMessageContent', contentEl, message);

        el.appendChild(roleEl);
        el.appendChild(contentEl);

        return el;
    }

    /**
     * Checks if the container is scrolled to the bottom.
     * @returns {boolean}
     * @private
     */
    isScrolledToBottom() {
        const { scrollHeight, clientHeight, scrollTop } = this.container;
        // A little buffer of 5px
        return scrollHeight - clientHeight <= scrollTop + 5;
    }

    /**
     * Scrolls the container to the bottom.
     * @private
     */
    scrollToBottom() {
        this.container.scrollTop = this.container.scrollHeight;
    }
}


/**
 * Manages the queue and execution of AI response generation.
 * It scans all chats for "pending" assistant messages (content is null)
 * and processes them one by one, ensuring that only one API call is active
 * at a time.
 * @class
 */
class ResponseProcessor {
    constructor() {
        /**
         * Flag to prevent multiple concurrent processing loops.
         * @type {boolean}
         */
        this.isProcessing = false;
        /**
         * Callbacks to be executed when the entire processing queue is empty.
         * @type {Array<() => void>}
         * @private
         */
        this.completionSubscribers = [];
        /**
         * The main application instance.
         * @type {App | null}
         * @private
         */
        this.app = null;
    }

    /**
     * Schedules a processing check. If not already processing, it starts the loop.
     * @param {App} app - The main application instance.
     */
    scheduleProcessing(app) {
        this.app = app;
        if (!this.isProcessing) {
            this.findAndProcessNext();
        }
    }

    /**
     * Subscribes a callback to be called when the processing queue is empty.
     * Useful for chaining asynchronous operations that depend on AI responses.
     * @param {() => void} callback The function to call on completion.
     */
    subscribeToCompletion(callback) {
        this.completionSubscribers.push(callback);
    }

    /**
     * Notifies all completion subscribers and clears the list.
     * @private
     */
    notifyCompletion() {
        this.completionSubscribers.forEach(cb => cb());
        this.completionSubscribers = []; // Clear subscribers after notification
    }

    /**
     * Finds the next pending message across all chats and processes it.
     * This method forms a loop by calling itself after each message is processed,
     * ensuring sequential execution.
     * If no pending message is found, it stops the loop and notifies completion subscribers.
     * @private
     */
    async findAndProcessNext() {
        this.isProcessing = true;

        let workFound = false;
        if (this.app) {
            for (const chat of this.app.chats) {
                const pendingMessage = chat.log.findNextPendingMessage();
                if (pendingMessage) {
                    // Found a message to process
                    await this.processMessage(chat, pendingMessage);
                    workFound = true;
                    // After processing, immediately look for the next piece of work.
                    // This creates a recursive loop that continues until all work is done.
                    this.findAndProcessNext();
                    return; // Exit the current function call
                }
            }
        }

        if (!workFound) {
            // No pending messages were found in any chat
            this.isProcessing = false;
            this.notifyCompletion();
        }
    }

    /**
     * Processes a single pending assistant message.
     * This involves fetching settings, constructing the API payload, making the
     * API call, and streaming the response back into the message content.
     * @param {Chat} chat - The chat object the message belongs to.
     * @param {Message} assistantMsg - The pending assistant message to fill.
     * @private
     */
    async processMessage(chat, assistantMsg) {
        const app = this.app;
        if (!app) return;

        if (assistantMsg.value.role !== 'assistant' || assistantMsg.value.content !== null) {
            console.warn('Response processor was asked to process an invalid message.', assistantMsg);
            return;
        }

        app.dom.stopButton.style.display = 'block';
        app.abortController = new AbortController();

        try {
            // Get the history leading up to the pending message.
            const messages = chat.log.getHistoryBeforeMessage(assistantMsg);
            if (!messages) {
                console.error("Could not find message history for processing.", assistantMsg);
                assistantMsg.value.content = "Error: Could not reconstruct message history.";
                chat.log.notify();
                return;
            }

            // --- Get effective configuration using the new centralized method ---
            const agentId = assistantMsg.value.agent;
            const effectiveConfig = app.agentManager.getEffectiveApiConfig(agentId);

            // Add the system prompt if it exists in the effective configuration.
            if (effectiveConfig.systemPrompt) {
                messages.unshift({ role: 'system', content: effectiveConfig.systemPrompt });
            }
            // --- End of configuration ---

            let payload = {
                model: effectiveConfig.model,
                messages: messages,
                stream: true,
                temperature: parseFloat(effectiveConfig.temperature),
                top_p: effectiveConfig.top_p ? parseFloat(effectiveConfig.top_p) : undefined,
            };

            // Pass the original agent object and the final effective config to the plugin hook
            const agent = agentId ? app.agentManager.getAgent(agentId) : null;
            payload = await pluginManager.triggerAsync('beforeApiCall', payload, effectiveConfig, agent);

            const reader = await app.apiService.streamChat(
                payload,
                effectiveConfig.apiUrl,
                effectiveConfig.apiKey,
                app.abortController.signal
            );

            assistantMsg.value.content = ''; // Make it empty string to start filling
            chat.log.notify();

            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                const deltas = lines
                    .map(line => line.replace(/^data: /, '').trim())
                    .filter(line => line !== '' && line !== '[DONE]')
                    .map(line => {
                        try {
                            return JSON.parse(line);
                        } catch (e) {
                            console.error("Failed to parse stream chunk:", line, e);
                            return null;
                        }
                    })
                    .filter(Boolean)
                    .map(json => json.choices[0].delta.content)
                    .filter(content => content);

                if (deltas.length > 0) {
                    assistantMsg.value.content += deltas.join('');
                    chat.log.notify();
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                assistantMsg.value.content = `Error: ${error.message}`;
            } else {
                assistantMsg.value.content += '\n\n[Aborted by user]';
            }
            chat.log.notify();
        } finally {
            app.abortController = null;
            app.dom.stopButton.style.display = 'none';
            if (chat.title === 'New Chat') {
                const firstUserMessage = chat.log.getActiveMessageValues().find(m => m.role === 'user');
                if (firstUserMessage) {
                    chat.title = firstUserMessage.content.substring(0, 20) + '...';
                    app.saveChats(); // Save title change
                }
            }
            app.renderChatList();
            await pluginManager.triggerAsync('onResponseComplete', assistantMsg, chat);
        }
    }
}

/**
 * @type {App|null}
 */
let appInstance = null;
/**
 * @type {ChatUI|null}
 */
let chatUI = null;
const responseProcessor = new ResponseProcessor();


/**
 * The main plugin object for Core Chat functionality.
 * @type {import('../plugin-manager.js').Plugin}
 */
const chatPlugin = {
    name: 'Chat',

    /**
     * @param {App} app - The main application instance.
     */
    onAppInit(app) {
        appInstance = app;
        app.responseProcessor = responseProcessor;
        responseProcessor.scheduleProcessing(app);

        // Register the core chat view
        pluginManager.registerView('chat', (chatId) => `
            <div id="chat-container"></div>
            <div id="chat-area-controls"></div>
            <form id="message-form">
                <textarea id="message-input" placeholder="Type your message..." rows="3"></textarea>
                <button type="submit">Send</button>
                <button type="button" id="stop-button" style="display: none;">Stop</button>
            </form>
        `);
    },

    /**
     * @param {import('../main.js').Tab[]} tabs - The array of existing tabs.
     * @returns {import('../main.js').Tab[]} The updated array of tabs.
     */
    onTabsRegistered(tabs) {
        const chatTab = {
            id: 'chats',
            label: 'Chats',
            viewType: 'chat',
            onActivate: () => {
                const contentEl = document.getElementById('chats-pane');
                contentEl.innerHTML = `
                    <div class="list-pane">
                        <ul id="chat-list" class="item-list"></ul>
                        <button id="new-chat-button" class="add-new-button">New Chat</button>
                    </div>
                `;
                appInstance.renderChatList();
                document.getElementById('new-chat-button').addEventListener('click', () => appInstance.createNewChat());
                document.getElementById('chat-list').addEventListener('click', (e) => {
                    const target = e.target;
                    if (target.closest('li')) {
                        appInstance.setView('chat', target.closest('li').dataset.id);
                    }
                    if (target.classList.contains('delete-button')) {
                        e.stopPropagation();
                        appInstance.deleteChat(target.parentElement.dataset.id);
                    }
                });
            }
        };
        // Add the chat tab to the beginning of the array
        tabs.unshift(chatTab);
        return tabs;
    },

    /**
     * @param {import('../main.js').View} view - The rendered view object.
     * @param {Chat} chat
     */
    onViewRendered(view, chat) {
        if (view.type === 'chat') {
            const chatContainer = document.getElementById('chat-container');
            if (!chatContainer) return;

            chatUI = new ChatUI(chatContainer, appInstance.agentManager);
            chatUI.setChatLog(chat.log);

            appInstance.dom.messageForm = document.getElementById('message-form');
            appInstance.dom.messageInput = document.getElementById('message-input');
            appInstance.dom.stopButton = document.getElementById('stop-button');

            // Restore draft message
            appInstance.dom.messageInput.value = chat.draftMessage || '';

            // Save draft message on input
            appInstance.dom.messageInput.addEventListener('input', () => {
                const activeChat = appInstance.getActiveChat();
                if (activeChat) {
                    activeChat.draftMessage = appInstance.dom.messageInput.value;
                    appInstance.debouncedSave();
                }
            });

            appInstance.dom.messageForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleFormSubmit();
            });

            appInstance.dom.stopButton.addEventListener('click', () => {
                if (appInstance.abortController) appInstance.abortController.abort();
            });

            const chatAreaControls = document.getElementById('chat-area-controls');
            if (chatAreaControls) {
                chatAreaControls.innerHTML = pluginManager.trigger('onChatAreaRender', '', chat);
                pluginManager.trigger('onChatSwitched', chat);
            }
        }
    },

    /**
     * Handles the submission of the message form.
     * @param {object} [options={}] - Options for the submission.
     */
    handleFormSubmit(options = {}) {
        const { isContinuation = false, agentId = null } = options;
        const activeChat = appInstance.getActiveChat();
        if (!activeChat) return;

        if (!isContinuation) {
            const userInput = appInstance.dom.messageInput.value.trim();
            if (!userInput) return;
            activeChat.log.addMessage({ role: 'user', content: userInput });
            appInstance.dom.messageInput.value = '';
        }

        const finalAgentId = agentId || activeChat.agent || null;
        activeChat.log.addMessage({ role: 'assistant', content: null, agent: finalAgentId });
        responseProcessor.scheduleProcessing(appInstance);
    }
};

pluginManager.register(chatPlugin);
