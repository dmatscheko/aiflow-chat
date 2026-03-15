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
import { formatMessage, updateContentElement, addClipBadge } from '../ui/message-formatter.js';
import { STORAGE_KEYS, DEFAULT_AGENT_ID } from '../constants.js';

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
        /** @type {Function} Bound save callback for ChatLog subscriptions, enabling proper unsubscribe. */
        this._boundSaveCallback = () => this.dataManager.save();
        this.dataManager = new DataManager(STORAGE_KEYS.CHAT_LOGS, 'chat', (loadedData) => {
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
        // Use the same bound callback for subscribe/unsubscribe so unsubscribe can match
        chat.log.unsubscribe(this._boundSaveCallback);
        chat.log.subscribe(this._boundSaveCallback);
        return chat;
    }

    /**
     * Initializes the chat manager, creating a new chat if none exist.
     */
    init() {
        if (this.chats.length === 0) {
            this.createNewChat();
        }
        this.activeChatId = localStorage.getItem(STORAGE_KEYS.ACTIVE_CHAT_ID) || this.chats[0].id;
        this.app.activeView.id = this.activeChatId;
    }

    /**
     * Saves the active chat ID to local storage.
     */
    saveActiveChatId() {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_CHAT_ID, this.activeChatId);
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

        // Abort previous listeners to prevent accumulation across view switches
        if (this._chatViewAbortController) {
            this._chatViewAbortController.abort();
        }
        this._chatViewAbortController = new AbortController();
        const signal = this._chatViewAbortController.signal;

        // Disconnect the previous ChatUI from the log to prevent stale subscribers
        // from setting message.cache on detached DOM elements during streaming.
        if (this.chatUI) {
            this.chatUI.disconnect();
        }
        this.chatUI = new ChatUI(document.getElementById('chat-container'), this.app.agentManager);
        this.chatUI.setChatLog(chat.log);
        this.app.dom.messageForm = document.getElementById('message-form');
        this.app.dom.messageInput = document.getElementById('message-input');
        this.app.dom.stopButton = document.getElementById('stop-button');

        // Show stop button if this chat is currently processing (e.g., user switched back to it)
        if (this.app.dom.stopButton) {
            this.app.dom.stopButton.style.display =
                this.app.abortControllers.has(chatId) ? 'block' : 'none';
        }

        this.app.dom.messageInput.value = chat.draftMessage || '';

        this.app.dom.messageInput.addEventListener('input', () => {
            const activeChat = this.getActiveChat();
            if (activeChat) {
                activeChat.draftMessage = this.app.dom.messageInput.value;
                this.debouncedSave();
            }
        }, { signal });

        this.app.dom.messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFormSubmit();
        }, { signal });
        this.app.dom.stopButton.addEventListener('click', () => this.stopChatFlow(), { signal });

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
        }, { signal });
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
        responseProcessor.scheduleProcessing(this.app, activeChat.id);
    }

    /**
     * Programmatically sends a message to a specific chat without touching the DOM.
     * This is used by flows and other automated systems to submit prompts to any chat,
     * not just the currently active/visible one.
     * @param {string} chatId - The ID of the target chat.
     * @param {string} content - The user message content to send.
     * @param {string} [agentId=null] - Optional agent ID to use for the response.
     */
    sendMessage(chatId, content, agentId = null) {
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) return;

        chat.log.addMessage({ role: 'user', content }, {});
        const finalAgentId = agentId || chat.agent;
        chat.log.addMessage({ role: 'assistant', content: null, agent: finalAgentId }, {});
        this.dataManager.save();
        responseProcessor.scheduleProcessing(this.app, chatId);
    }

    /**
     * Stops any ongoing chat response generation or flow execution for the active chat.
     * Only affects the currently active chat, leaving other chats' processing untouched.
     */
    stopChatFlow() {
        const chatId = this.activeChatId;
        if (!chatId) return;

        if (this.app.flowManager) {
            const runner = this.app.flowManager.activeFlowRunners.get(chatId);
            if (runner) {
                runner.stop('Flow stopped by user.');
            }
        }
        // Signal the processing loop to exit for this chat only.
        responseProcessor.stop(chatId);
        const abortController = this.app.abortControllers.get(chatId);
        if (abortController) {
            abortController.abort();
        }
    }
}


/**
 * Manages the rendering of a `ChatLog` instance into a designated HTML element.
 * It subscribes to a `ChatLog` and automatically re-renders the UI whenever the
 * log changes, ensuring the view is always synchronized with the data model.
 *
 * Optimizations:
 * - Differential DOM updates: only the last message is updated during streaming;
 *   previous messages are left untouched to preserve text selection.
 * - Block-level incremental content: within the streaming message, only changed
 *   or new block elements are touched.
 * - Smart auto-scroll: pauses when the user manually scrolls up and resumes
 *   when the user scrolls back to the bottom.
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
        /** @type {HTMLElement} @private */
        this.container = container;
        /** @type {import('./agents-plugin.js').AgentManager} @private */
        this.agentManager = agentManager;
        /** @type {ChatLog | null} @private */
        this.chatLog = null;
        /** @type {() => void} @private */
        this.boundUpdate = this.update.bind(this);

        // --- Differential update state ---
        /** @type {Message[]} Previously rendered message list (by reference). @private */
        this._renderedMessages = [];
        /** @type {Map<Message, HTMLElement>} Maps Message instances to their wrapper DOM elements. @private */
        this._messageElements = new Map();

        // --- Smart scroll state ---
        /** @type {boolean} True when the user has manually scrolled away from the bottom. @private */
        this._userScrolledAway = false;
        /** @type {boolean} Set during programmatic scrolls to suppress scroll-event handling. @private */
        this._programmaticScroll = false;

        this.container.addEventListener('scroll', () => {
            if (this._programmaticScroll) return;
            this._userScrolledAway = !this._isNearBottom();
        }, { passive: true });
    }

    /**
     * Disconnects this ChatUI from its current ChatLog by unsubscribing. This prevents
     * a stale ChatUI from receiving updates and setting message.cache on detached DOM
     * elements, which would block the new ChatUI from performing incremental updates.
     */
    disconnect() {
        if (this.chatLog) {
            this.chatLog.unsubscribe(this.boundUpdate);
            this.chatLog = null;
        }
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
        this._renderedMessages = [];
        this._messageElements = new Map();
        this._userScrolledAway = false;
        this.chatLog.subscribe(this.boundUpdate);
        this.update();
    }

    /**
     * Renders or incrementally updates the chat UI.
     *
     * Fast path (same message list, only content changed):
     *   - Only messages whose cache has been invalidated are updated in-place.
     *   - The message wrapper/title/controls are kept; only `.message-content` is patched.
     *
     * Full path (message list changed):
     *   - The container is rebuilt from scratch.
     */
    update() {
        if (!this.chatLog) {
            this.container.innerHTML = '';
            this._renderedMessages = [];
            this._messageElements = new Map();
            return;
        }

        const messages = this.chatLog.getActiveMessages();

        if (this._canIncrementalUpdate(messages)) {
            if (!this._incrementalUpdate(messages)) {
                this._fullUpdate(messages);
            }
        } else {
            this._fullUpdate(messages);
        }

        this._renderedMessages = messages;

        if (!this._userScrolledAway) {
            this.scrollToBottom();
        }
    }

    /**
     * Checks whether the new message list matches the previously rendered one
     * (same references, same order) so that we can use the fast incremental path.
     * @param {Message[]} messages
     * @returns {boolean}
     * @private
     */
    _canIncrementalUpdate(messages) {
        if (messages.length !== this._renderedMessages.length) return false;
        for (let i = 0; i < messages.length; i++) {
            if (messages[i] !== this._renderedMessages[i]) return false;
        }
        return true;
    }

    /**
     * Fast path: update only messages whose content has changed (cache === null).
     * Leaves all other DOM nodes untouched.
     * @param {Message[]} messages
     * @returns {boolean} `true` if the incremental update succeeded, `false` if a
     *   full rebuild is needed (e.g., a message role changed and the wrapper structure
     *   no longer matches).
     * @private
     */
    _incrementalUpdate(messages) {
        for (const message of messages) {
            if (message.cache != null) continue; // content unchanged

            const wrapper = this._messageElements.get(message);
            if (!wrapper) return false; // safety: missing element → full rebuild

            const bubble = wrapper.querySelector('.message');
            const existingContent = bubble?.querySelector('.message-content');
            if (!existingContent) return false; // structural mismatch → full rebuild

            // Block-level diff: only touch changed/new block elements.
            updateContentElement(existingContent, message);

            // Re-apply clip badges since content changed.
            this._refreshClipBadge(bubble, message);
        }
        return true;
    }

    /**
     * Full path: clear the container and rebuild all message elements.
     * @param {Message[]} messages
     * @private
     */
    _fullUpdate(messages) {
        this.container.innerHTML = '';
        this._messageElements = new Map();

        const fragment = document.createDocumentFragment();

        for (const message of messages) {
            const messageEl = formatMessage(message);
            this._messageElements.set(message, messageEl);
            fragment.appendChild(messageEl);
        }

        this.container.appendChild(fragment);
    }

    /**
     * Re-applies copy-to-clipboard badges on a message bubble after its content changed.
     * Removes stale badges first to avoid duplicates.
     * @param {HTMLElement} bubble - The `.message` element.
     * @param {Message} message
     * @private
     */
    _refreshClipBadge(bubble, message) {
        bubble.querySelectorAll('.clip-badge').forEach(b => b.remove());
        bubble.querySelectorAll('.clip-badge-pre').forEach(el => el.classList.remove('clip-badge-pre'));
        addClipBadge(bubble, message);
    }

    /**
     * Checks if the chat container is scrolled near the bottom.
     * @returns {boolean}
     * @private
     */
    _isNearBottom() {
        const { scrollHeight, clientHeight, scrollTop } = this.container;
        return scrollHeight - clientHeight <= scrollTop + 5;
    }

    /**
     * Scrolls the chat container to the bottom, suppressing the scroll listener.
     */
    scrollToBottom() {
        this._programmaticScroll = true;
        this.container.scrollTop = this.container.scrollHeight;
        // Clear the flag after the browser has processed the scroll.
        requestAnimationFrame(() => { this._programmaticScroll = false; });
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
                manager: appInstance.chatManager,
                dataManager: appInstance.chatManager.dataManager,
                viewType: 'chat',
                addNewButtonLabel: 'Add New Chat',
                onAddNew: () => appInstance.chatManager.createNewChat(),
                getItemName: (item) => item.title,
                onDelete: () => true,
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
                        agentOptions.forEach(opt => {
                            const option = document.createElement('option');
                            option.value = opt.value;
                            option.textContent = opt.label;
                            selector.appendChild(option);
                        });
                        selector.value = chat.agent || DEFAULT_AGENT_ID;
                        selector.addEventListener('change', (e) => {
                            chat.agent = e.target.value === DEFAULT_AGENT_ID ? null : e.target.value;
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
                        flowOptions.forEach(opt => {
                            const option = document.createElement('option');
                            option.value = opt.value;
                            option.textContent = opt.label;
                            selector.appendChild(option);
                        });
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
                                app.flowManager.startFlow(chat.flow, chat.id);
                            }
                        });
                    }
                }
            }
        ];

        return config;
    }
});
