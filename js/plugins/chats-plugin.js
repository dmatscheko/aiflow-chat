/**
 * @fileoverview Plugin for core chat functionality.
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
 * @typedef {object} Chat
 * @property {string} id - The unique identifier for the chat.
 * @property {string} title - The title of the chat.
 * @property {ChatLog} log - The ChatLog instance for the chat.
 * @property {string} draftMessage - The current draft message.
 * @property {string | null} agent - The ID of the active agent.
 * @property {string | null} flow - The ID of the active flow.
 */

let appInstance = null;

/**
 * Manages the lifecycle and storage of chats.
 * @class
 */
class ChatManager {
    /**
     * @param {App} app
     */
    constructor(app) {
        /** @type {App} */
        this.app = app;
        /** @type {Chat[]} */
        this.chats = [];
        /** @type {string | null} */
        this.activeChatId = null;
        /** @type {ChatUI | null} */
        this.chatUI = null;

        this.debouncedSave = debounce(() => this.saveChats(), 500);
    }

    init() {
        this.loadChats();
        this.app.activeView.id = this.activeChatId;
    }

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

    updateActiveChatInList() {
        const chatListEl = document.getElementById('chat-list');
        if (!chatListEl) return;
        chatListEl.querySelectorAll('li').forEach(item => {
            item.classList.toggle('active', item.dataset.id === this.activeChatId);
        });
    }

    getActiveChat() {
        return this.chats.find(c => c.id === this.activeChatId);
    }

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

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleFormSubmit();
            }
        });
        const chatAreaControls = document.getElementById('chat-area-controls');
        if (chatAreaControls) {
            chatAreaControls.innerHTML = pluginManager.trigger('onChatAreaRender', '', chat);
            pluginManager.trigger('onChatSwitched', chat);
        }
    }

    async handleFormSubmit(options = {}) {
        const { isContinuation = false, agentId = null } = options;
        const activeChat = this.getActiveChat();
        if (!activeChat) return;
        if (!isContinuation) {
            const userInput = this.app.dom.messageInput.value.trim();
            if (!userInput) return;
            activeChat.log.addMessage({ role: 'user', content: userInput });
            this.app.dom.messageInput.value = '';
            activeChat.draftMessage = '';
            this.saveChats();
        }
        const finalAgentId = agentId || activeChat.agent || null;
        activeChat.log.addMessage({ role: 'assistant', content: null, agent: finalAgentId });
        responseProcessor.scheduleProcessing(this.app);
    }

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
 * Manages the rendering of a ChatLog instance into a designated HTML element.
 * It subscribes to a ChatLog and automatically re-renders the UI when the
 * log changes.
 * @class
 */
class ChatUI {
    /**
     * @param {HTMLElement} container - The DOM element to render the chat messages into.
     * @param {import('./agents-plugin.js').AgentManager} agentManager - The agent manager instance for displaying agent names.
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
         * @type {import('./agents-plugin.js').AgentManager}
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

        const titleRow = document.createElement('div');
        titleRow.className = 'message-title';

        const titleTextEl = document.createElement('div');
        titleTextEl.className = 'message-title-text';

        const roleEl = document.createElement('strong');
        roleEl.textContent = message.value.role;
        titleTextEl.appendChild(roleEl);

        if (message.value.role === 'assistant') {
            const details = [];
        
            if (message.value.agent && this.agentManager) {
                const agent = this.agentManager.getAgent(message.value.agent);
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

        // Allow plugins to modify the content element (e.g., for rich formatting)
        pluginManager.trigger('onFormatMessageContent', contentEl, message);

        el.appendChild(titleRow);
        el.appendChild(contentEl);

        // Hook for adding controls after the message element is fully constructed.
        pluginManager.trigger('onMessageRendered', el, message);

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


const chatPlugin = {
    name: 'Chat',

    /**
     * @param {App} app
     */
    onAppInit(app) {
        appInstance = app;
        app.chatManager = new ChatManager(app);

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
     * @param {import('../main.js').Tab[]} tabs
     * @returns {import('../main.js').Tab[]}
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

    onViewRendered(view, chat) {
        if (view.type === 'chat') {
            appInstance.chatManager.initChatView(view.id);
        }
    }
};

pluginManager.register(chatPlugin);
