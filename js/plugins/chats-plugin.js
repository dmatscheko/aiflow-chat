/**
 * @fileoverview Plugin for core chat functionality, including chat management,
 * UI rendering, and message handling.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { ChatLog } from '../chat-data.js';
import { debounce, importJson, exportJson } from '../utils.js';
import { responseProcessor } from '../response-processor.js';
import { DataManager } from '../data-manager.js';

/**
 * @typedef {import('../main.js').App} App
 * @typedef {import('../main.js').View} View
 * @typedef {import('../chat-data.js').Message} Message
 */

/**
 * Represents a single chat session.
 * @typedef {object} Chat
 * @property {string} id - The unique identifier for the chat.
 * @property {string} title - The display title of the chat.
 * @property {ChatLog} log - The `ChatLog` instance containing the message history for the chat.
 * @property {string} draftMessage - The current text in the message input box for this chat.
 * @property {string | null} agent - The ID of the agent currently active for this chat.
 * @property {string | null} flow - The ID of the flow currently active for this chat.
 */

/**
 * The singleton instance of the main App class.
 * @type {App | null}
 */
let appInstance = null;

/**
 * Manages the lifecycle, storage, and UI of all chat sessions.
 * @class
 */
class ChatManager {
    /**
     * Creates an instance of ChatManager.
     * @constructor
     * @param {App} app The main application instance.
     */
    constructor(app) {
        this.app = app;
        this.listPane = null;
        this.dataManager = new DataManager('core_chat_logs', 'chat', (loadedData) => {
            return loadedData.map(chatData => this._hydrateChat(chatData));
        });

        this.chats = this.dataManager.getAll();
        this.activeChatId = null;
        this.chatUI = null;
        this.debouncedSave = debounce(() => {
            const activeChat = this.getActiveChat();
            if (activeChat && this.app.dom.messageInput) {
                activeChat.draftMessage = this.app.dom.messageInput.value;
            }
            this.dataManager.save();
        }, 500);
    }

    /**
     * Hydrates a chat object from raw data, ensuring the chat log is a `ChatLog` instance.
     * @param {object} chatData - The raw chat data.
     * @returns {Chat} The hydrated chat object.
     * @private
     */
    _hydrateChat(chatData) {
        // If the log is already a ChatLog instance, don't re-hydrate.
        const log = chatData.log instanceof ChatLog ? chatData.log : ChatLog.fromJSON(chatData.log);
        const chat = {
            id: chatData.id,
            title: chatData.title,
            log: log,
            draftMessage: chatData.draftMessage || '',
            agent: chatData.agent || null,
            flow: chatData.flow || null,
        };
        // Avoid duplicate subscriptions
        chat.log.unsubscribe(() => this.dataManager.save());
        chat.log.subscribe(() => this.dataManager.save());
        return chat;
    }

    /**
     * Initializes the chat manager, creating a new chat if none exist.
     */
    init() {
        if (this.chats.length === 0) {
            this.createNewChat();
        }
        this.activeChatId = localStorage.getItem('core_active_chat_id') || this.chats[0].id;
        this.app.activeView.id = this.activeChatId;
    }

    /**
     * Saves the active chat ID to local storage.
     */
    saveActiveChatId() {
        localStorage.setItem('core_active_chat_id', this.activeChatId);
    }

    /**
     * Creates a new, empty chat session.
     * @returns {Chat} The newly created chat.
     */
    createNewChat() {
        const newChatData = {
            title: 'New Chat',
            log: new ChatLog(),
            draftMessage: '',
            agent: null,
            flow: null,
        };

        const addedItem = this.dataManager.add(newChatData);
        const index = this.chats.findIndex(c => c.id === addedItem.id);
        if (index !== -1) {
            this.chats[index] = this._hydrateChat(this.chats[index]);
        }
        this.renderChatList();
        appInstance.setView('chat', addedItem.id);
        return this.chats[index];
    }

    /**
     * Creates a new chat from imported data.
     * @param {object} chatData The chat data to import.
     */
    createChatFromData(chatData) {
        const addedItem = this.dataManager.addFromData(chatData);
        const index = this.chats.findIndex(c => c.id === addedItem.id);
        if (index !== -1) {
            this.chats[index] = this._hydrateChat(this.chats[index]);
        }
        this.app.setView('chat', addedItem.id);
    }

    /**
     * Updates the active chat in the list pane.
     */
    updateActiveChatInList() {
        if (this.listPane) {
            this.listPane.updateActiveItem();
        }
    }

    /**
     * Renders the chat list in the list pane.
     */
    renderChatList() {
        if (this.listPane) {
            this.listPane.renderList();
        }
    }

    /**
     * Retrieves the currently active chat object.
     * @returns {Chat | undefined} The active chat object, or undefined if not found.
     */
    getActiveChat() {
        return this.chats.find(c => c.id === this.activeChatId);
    }

    /**
     * Initializes the chat view, including the message display area and input form listeners.
     * @param {string} chatId - The ID of the chat to initialize the view for.
     */
    initChatView(chatId) {
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) return;
        this.chatUI = new ChatUI(document.getElementById('chat-container'), this.app.agentManager);
        this.chatUI.setChatLog(chat.log);
        this.app.dom.messageForm = document.getElementById('message-form');
        this.app.dom.messageInput = document.getElementById('message-input');
        this.app.dom.stopButton = document.getElementById('stop-button');

        this.app.dom.messageInput.value = chat.draftMessage || '';

        this.app.dom.messageInput.addEventListener('input', () => {
            const activeChat = this.getActiveChat();
            if (activeChat) {
                activeChat.draftMessage = this.app.dom.messageInput.value;
                this.debouncedSave();
            }
        });

        this.app.dom.messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFormSubmit();
        });
        this.app.dom.stopButton.addEventListener('click', () => this.stopChatFlow());

        this.app.dom.messageInput.addEventListener('keydown', (e) => {
            // If an edit-in-place textarea is active, don't do anything.
            // This prevents conflicts with the edit-in-place keyboard shortcuts.
            if (document.querySelector('.edit-in-place')) {
                return;
            }

            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                this.handleFormSubmit();
            }
        });
    }

    /**
     * Handles the submission of the message form. It adds the user's message to the
     * log (unless it's a continuation), then queues a pending assistant message
     * to trigger the response generation process.
     * @param {object} [options={}] - Options for the submission.
     * @param {boolean} [options.isContinuation=false] - If true, a user message is not added, and the assistant just continues.
     * @param {string|null} [options.agentId=null] - The ID of an agent to use for this specific turn.
     * @async
     */
    async handleFormSubmit(options = {}) {
        const { isContinuation = false, agentId = null } = options;
        const activeChat = this.getActiveChat();
        if (!activeChat) return;

        if (!isContinuation) {
            const userInput = this.app.dom.messageInput.value.trim();
            if (!userInput) return;
            activeChat.log.addMessage({ role: 'user', content: userInput }, {});
            this.app.dom.messageInput.value = '';
            activeChat.draftMessage = '';
            this.dataManager.save();
            pluginManager.trigger('onMessageFormSubmit');
        }

        const finalAgentId = agentId || activeChat.agent;
        activeChat.log.addMessage({ role: 'assistant', content: null, agent: finalAgentId }, {});
        responseProcessor.scheduleProcessing(this.app);
    }

    /**
     * Stops any ongoing chat response generation or flow execution.
     */
    stopChatFlow() {
        if (this.app.flowManager && this.app.flowManager.activeFlowRunner) {
            this.app.flowManager.activeFlowRunner.stop('Flow stopped by user.');
        }
        if (this.app.abortController) {
            this.app.abortController.abort();
        }
    }
}


/**
 * Manages the rendering of a `ChatLog` instance into a designated HTML element.
 * It subscribes to a `ChatLog` and automatically re-renders the UI whenever the
 * log changes, ensuring the view is always synchronized with the data model.
 * @class
 */
class ChatUI {
    /**
     * Creates an instance of ChatUI.
     * @param {HTMLElement} container - The DOM element to render the chat messages into.
     * @param {import('./agents-plugin.js').AgentManager} agentManager - The agent manager instance for resolving agent names.
     * @throws {Error} If the container element is not provided.
     */
    constructor(container, agentManager) {
        if (!container) {
            throw new Error('ChatUI container element is required.');
        }
        /**
         * The DOM element where chat messages are rendered.
         * @type {HTMLElement}
         * @private
         */
        this.container = container;
        /**
         * The agent manager instance, used to look up agent details for display.
         * @type {import('./agents-plugin.js').AgentManager}
         * @private
         */
        this.agentManager = agentManager;
        /**
         * The ChatLog instance this UI is currently displaying.
         * @type {ChatLog | null}
         * @private
         */
        this.chatLog = null;
        /**
         * A pre-bound reference to the update method, used for subscribing and unsubscribing.
         * @type {() => void}
         * @private
         */
        this.boundUpdate = this.update.bind(this);
    }

    /**
     * Connects a `ChatLog` instance to this UI component. The UI will now subscribe
     * to the log and automatically update whenever the log changes.
     * @param {ChatLog} chatLog - The chat log to display and subscribe to.
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
     * Renders the entire chat log content into the container element.
     * This method is typically called automatically when the connected `ChatLog` is updated.
     */
    update() {
        if (!this.chatLog) {
            this.container.innerHTML = '';
            return;
        }

        const shouldScroll = this.isScrolledToBottom();
        this.container.innerHTML = ''; // Clear previous content

        const fragment = document.createDocumentFragment();
        const messages = this.chatLog.getActiveMessages();

        messages.forEach(message => {
            const messageEl = pluginManager.trigger('onFormatMessage', message);
            fragment.appendChild(messageEl);
        });

        this.container.appendChild(fragment);

        if (shouldScroll) {
            this.scrollToBottom();
        }
    }

    /**
     * Checks if the chat container is scrolled to the bottom.
     * @returns {boolean} `true` if the container is scrolled to the bottom, otherwise `false`.
     * @private
     */
    isScrolledToBottom() {
        const { scrollHeight, clientHeight, scrollTop } = this.container;
        // A small buffer of 5px helps account for rounding errors.
        return scrollHeight - clientHeight <= scrollTop + 5;
    }

    /**
     * Scrolls the chat container to the bottom.
     * @private
     */
    scrollToBottom() {
        this.container.scrollTop = this.container.scrollHeight;
    }
}

// Initialize ChatManager and register the view on app init
pluginManager.register({
    name: 'Chats',
    onAppInit(app) {
        appInstance = app;
        app.chatManager = new ChatManager(app);
        pluginManager.registerView('chat', (chatId) => `
            <div id="chat-container"></div>
            <form id="message-form">
                <textarea id="message-input" placeholder="Type your message..." rows="3"></textarea>
                <button type="submit">Send</button>
                <button type="button" id="stop-button" style="display: none;">Stop</button>
            </form>
        `);
    },

    onViewRendered(view, chat) {
        if (view.type === 'chat') {
            appInstance.chatManager.activeChatId = view.id;
            appInstance.chatManager.saveActiveChatId();
            appInstance.chatManager.initChatView(view.id);
            if (appInstance.chatManager.listPane) {
                appInstance.chatManager.listPane.updateActiveItem();
                appInstance.chatManager.listPane.renderActions(); // Update actions based on active chat
            }
        }
    },

    onRightPanelRegister(rightPanelManager) {
        rightPanelManager.registerTab({
            id: 'chats',
            label: 'Chats',
            viewType: 'chat',
            addAtStart: true,
            listPane: {
                dataManager: appInstance.chatManager.dataManager,
                viewType: 'chat',
                addNewButtonLabel: 'Add New Chat',
                onAddNew: () => appInstance.chatManager.createNewChat(),
                getItemName: (item) => item.title,
                onDelete: (itemId, itemName) => {
                    return confirm(`Are you sure you want to delete chat "${itemName}"?`);
                },
                actions: () => {
                    const activeChat = appInstance.chatManager.getActiveChat();
                    const actions = [{
                        id: 'load-chat-btn',
                        label: 'Load Chat',
                        className: 'btn-gray',
                        onClick: () => importJson('.chat', (data) => appInstance.chatManager.createChatFromData(data)),
                    }];

                    if (activeChat) {
                        actions.push({
                            id: 'save-chat-btn',
                            label: 'Save Chat',
                            className: 'btn-gray',
                            onClick: () => {
                                const chatToSave = {
                                    title: activeChat.title,
                                    log: activeChat.log.toJSON(),
                                    draftMessage: activeChat.draftMessage,
                                    agent: activeChat.agent,
                                    flow: activeChat.flow,
                                };
                                exportJson(chatToSave, activeChat.title.replace(/[^a-z0-9]/gi, '_').toLowerCase(), 'chat');
                            },
                        });
                    }
                    return actions;
                },
            },
        });
    },

    onTitleBarRegister(config, view, app) {
        if (view.type !== 'chat') {
            return config;
        }

        const chat = app.chatManager.getActiveChat();
        if (!chat) return config;

        config.titleParts = [{
            text: chat.title,
            onSave: (newTitle) => {
                chat.title = newTitle;
                app.chatManager.dataManager.save();
                if (app.chatManager.listPane) {
                    app.chatManager.listPane.renderList();
                }
                app.topPanelManager.render();
            },
        }];

        const agentOptions = app.agentManager.agents.map(a => ({ value: a.id, label: a.name }));
        const flowOptions = app.flowManager.flows.map(f => ({ value: f.id, label: f.name }));

        config.controls = [
            {
                id: 'agent-selector-wrapper',
                html: `<label for="agent-selector">Agent:</label><select id="agent-selector"></select>`,
                onMount: (container) => {
                    const selector = container.querySelector('#agent-selector');
                    if (selector) {
                        selector.innerHTML = agentOptions.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
                        selector.value = chat.agent || 'agent-default';
                        selector.addEventListener('change', (e) => {
                            chat.agent = e.target.value === 'agent-default' ? null : e.target.value;
                            app.chatManager.debouncedSave();
                        });
                    }
                }
            },
            {
                id: 'flow-selector-wrapper',
                html: `<div class="flow-selector-inner-wrapper"><label for="flow-selector">Flow:</label><select id="flow-selector"><option value="">None</option></select><button id="run-chat-flow-btn" class="btn-gray">Run</button></div>`,
                onMount: (container) => {
                    const selector = container.querySelector('#flow-selector');
                    if (selector) {
                        selector.innerHTML += flowOptions.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
                        selector.value = chat.flow || '';
                        selector.addEventListener('change', (e) => {
                            chat.flow = e.target.value || null;
                            app.chatManager.debouncedSave();
                        });
                    }
                    const runBtn = container.querySelector('#run-chat-flow-btn');
                    if (runBtn) {
                        runBtn.addEventListener('click', () => {
                            if (chat.flow) {
                                app.flowManager.startFlow(chat.flow);
                            }
                        });
                    }
                }
            }
        ];

        return config;
    }
});
