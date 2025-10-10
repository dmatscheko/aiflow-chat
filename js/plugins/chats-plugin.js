/**
 * @fileoverview Plugin for core chat functionality, including chat management,
 * UI rendering, and message handling.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { ChatLog } from '../chat-data.js';
import { debounce, generateUniqueId, ensureUniqueId } from '../utils.js';
import { responseProcessor } from '../response-processor.js';

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
     * Initializes the ChatManager.
     * @param {App} app - The main application instance.
     */
    constructor(app) {
        /**
         * The main application instance.
         * @type {App}
         */
        this.app = app;
        /**
         * An array holding all chat objects.
         * @type {Chat[]}
         */
        this.chats = [];
        /**
         * The ID of the currently active chat.
         * @type {string | null}
         */
        this.activeChatId = null;
        /**
         * The UI instance for the currently active chat.
         * @type {ChatUI | null}
         */
        this.chatUI = null;

        /**
         * A debounced version of `saveChats` to prevent excessive writes to local storage.
         * @type {() => void}
         */
        this.debouncedSave = debounce(() => this.saveChats(), 500);
    }

    /**
     * Initializes the chat manager by loading chats from storage and setting the active view.
     */
    init() {
        this.loadChats();
        this.app.activeView.id = this.activeChatId;
    }

    /**
     * Loads all chats from local storage. If no chats are found, creates a new one.
     */
    loadChats() {
        const savedChats = JSON.parse(localStorage.getItem('core_chat_logs'));
        if (savedChats && savedChats.length > 0) {
            this.chats = savedChats.map(chatData => {
                const chat = {
                    id: chatData.id,
                    title: chatData.title,
                    log: ChatLog.fromJSON(chatData.log),
                    draftMessage: chatData.draftMessage || '',
                    agent: chatData.agent || null,
                    flow: chatData.flow || null,
                };
                chat.log.subscribe(this.debouncedSave);
                return chat;
            });
            this.activeChatId = localStorage.getItem('core_active_chat_id') || this.chats[0].id;
            this.renderChatList();
        } else {
            this.createNewChat();
        }
    }

    /**
     * Saves all current chat data to local storage.
     */
    saveChats() {
        const chatsToSave = this.chats.map(chat => ({
            id: chat.id,
            title: chat.title,
            log: chat.log.toJSON(),
            draftMessage: chat.draftMessage,
            agent: chat.agent,
            flow: chat.flow,
        }));
        localStorage.setItem('core_chat_logs', JSON.stringify(chatsToSave));
        localStorage.setItem('core_active_chat_id', this.activeChatId);
    }

    /**
     * Creates a new, empty chat, adds it to the list, and makes it the active chat.
     */
    createNewChat() {
        const existingIds = new Set(this.chats.map(c => c.id));
        const newChat = {
            id: generateUniqueId('chat', existingIds),
            title: 'New Chat',
            log: new ChatLog(),
            draftMessage: '',
            agent: null,
            flow: null,
        };
        newChat.log.subscribe(this.debouncedSave);
        this.chats.push(newChat);
        this.renderChatList();
        this.app.setView('chat', newChat.id);
        this.saveChats();
    }

    /**
     * Creates a new chat from imported data, ensuring its ID is unique.
     * @param {object} chatData - The partial chat data object to import.
     */
    createChatFromData(chatData) {
        const existingIds = new Set(this.chats.map(c => c.id));
        const finalId = ensureUniqueId(chatData.id, 'chat', existingIds);

        const newChat = {
            id: finalId,
            title: chatData.title || 'Imported Chat',
            log: ChatLog.fromJSON(chatData.log),
            draftMessage: chatData.draftMessage || '',
            agent: chatData.agent || null,
            flow: chatData.flow || null,
        };
        newChat.log.subscribe(this.debouncedSave);
        this.chats.push(newChat);
        this.renderChatList();
        this.app.setView('chat', newChat.id);
        this.saveChats();
    }

    /**
     * Deletes a chat by its ID. If the deleted chat was active, it activates another chat.
     * @param {string} chatId - The ID of the chat to delete.
     */
    deleteChat(chatId) {
        this.chats = this.chats.filter(c => c.id !== chatId);
        if (this.activeChatId === chatId) {
            const newActiveChat = this.chats.length > 0 ? this.chats[0] : null;
            if (newActiveChat) {
                this.app.setView('chat', newActiveChat.id);
            } else {
                this.createNewChat();
                return;
            }
        }
        this.renderChatList();
        this.saveChats();
    }

    /**
     * Renders the list of chats in the sidebar.
     */
    renderChatList() {
        const chatListEl = document.getElementById('chat-list');
        if (!chatListEl) return;
        chatListEl.innerHTML = '';
        this.chats.forEach(chat => {
            const li = document.createElement('li');
            li.className = 'list-item';
            li.dataset.id = chat.id;
            li.innerHTML = `<span>${chat.title}</span><button class="delete-button">X</button>`;
            chatListEl.appendChild(li);
        });
        this.updateActiveChatInList();
    }

    /**
     * Updates the chat list UI to highlight the currently active chat.
     */
    updateActiveChatInList() {
        const chatListEl = document.getElementById('chat-list');
        if (!chatListEl) return;
        chatListEl.querySelectorAll('li').forEach(item => {
            item.classList.toggle('active', item.dataset.id === this.activeChatId);
        });
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
            this.saveChats();
        }

        const finalAgentId = agentId || activeChat.agent;
        activeChat.log.addMessage({ role: 'assistant', content: null, agent: finalAgentId }, {});
        responseProcessor.scheduleProcessing(this.app);
    }

    /**
     * Stops any ongoing chat response generation or flow execution.
     */
    stopChatFlow() {
        if (this.app.flowsManager && this.app.flowsManager.activeFlowRunner) {
            this.app.flowsManager.activeFlowRunner.stop('Flow stopped by user.');
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
            const messageEl = this.formatMessage(message);
            fragment.appendChild(messageEl);
        });

        this.container.appendChild(fragment);

        if (shouldScroll) {
            this.scrollToBottom();
        }
    }

    /**
     * Creates and formats an HTML element for a single message, including its
     * role, content, and depth visualization for nested agent calls.
     * @param {Message} message - The message object to format.
     * @returns {HTMLElement} The formatted message element, wrapped with depth lines if necessary.
     * @private
     */
    formatMessage(message) {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';

        const depth = message.value.role !== 'user' ? message.depth : 0;

        // Add vertical lines for depth visualization.
        if (depth > 0) {
            const linesContainer = document.createElement('div');
            linesContainer.className = 'depth-lines';
            for (let i = 0; i < depth; i++) {
                const line = document.createElement('div');
                line.className = 'depth-line';
                // Offset each line so they appear as parallel lines.
                line.style.left = `${i * 20 + 10}px`;
                linesContainer.appendChild(line);
            }
            wrapper.appendChild(linesContainer);
        }

        const el = document.createElement('div');
        el.classList.add('message', `role-${message.value.role}`);

        if (depth > 0) {
            // Indent the message bubble to make space for the depth lines.
            el.style.marginLeft = `${depth * 20}px`;
        }

        const titleRow = document.createElement('div');
        titleRow.className = 'message-title';

        const titleTextEl = document.createElement('div');
        titleTextEl.className = 'message-title-text';

        const roleEl = document.createElement('strong');
        roleEl.textContent = message.value.role;
        titleTextEl.appendChild(roleEl);

        // Display agent and model details for assistant/tool messages.
        if (message.value.role === 'assistant' || message.value.role === 'tool') {
            const details = [];
        
            if (message.agent && this.agentManager) {
                const agent = this.agentManager.getAgent(message.agent);
                if (agent?.name) details.push(agent.name);
            }
            
            if (message.value.model) details.push(message.value.model);
            
            if (details.length > 0) {
                const detailsEl = document.createElement('span');
                detailsEl.className = 'message-details';
                detailsEl.textContent = details.join(' - ');
                titleTextEl.appendChild(detailsEl);
            }
        }

        titleRow.appendChild(titleTextEl);

        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        contentEl.textContent = message.value.content || '';

        // Allow plugins to modify the content element (e.g., for Markdown formatting).
        pluginManager.trigger('onFormatMessageContent', contentEl, message);

        el.appendChild(titleRow);
        el.appendChild(contentEl);

        // Hook for adding controls (e.g., edit/delete buttons) after the message is rendered.
        pluginManager.trigger('onMessageRendered', el, message);

        wrapper.appendChild(el);
        return wrapper;
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

/**
 * The plugin object for core chat functionality.
 * @type {object}
 */
const chatPlugin = {
    name: 'Chat',

    /**
     * Initializes the chat manager and registers the 'chat' view.
     * @param {App} app - The main application instance.
     */
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

    /**
     * Adds the 'Chats' tab to the sidebar.
     * @param {import('../main.js').Tab[]} tabs - The current array of tabs.
     * @returns {import('../main.js').Tab[]} The updated array of tabs.
     */
    onTabsRegistered(tabs) {
        const chatManager = appInstance.chatManager;
        const newTabs = [...tabs];
        newTabs.unshift({
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
                chatManager.renderChatList();
                document.getElementById('new-chat-button').addEventListener('click', () => chatManager.createNewChat());
                document.getElementById('chat-list').addEventListener('click', (e) => {
                    const target = e.target;
                    if (target.closest('li')) {
                        appInstance.setView('chat', target.closest('li').dataset.id);
                    }
                    if (target.classList.contains('delete-button')) {
                        e.stopPropagation();
                        chatManager.deleteChat(target.parentElement.dataset.id);
                    }
                });
            }
        });
        return newTabs;
    },

    /**
     * Initializes the chat view when it's rendered.
     * @param {View} view - The view that was rendered.
     */
    onViewRendered(view, chat) {
        if (view.type === 'chat') {
            appInstance.chatManager.initChatView(view.id);
        }
    }
};

/**
 * Registers the Chat Plugin with the application's plugin manager.
 */
pluginManager.register(chatPlugin);
