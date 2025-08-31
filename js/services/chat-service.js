/**
 * @fileoverview Service for managing chat sessions.
 */

'use strict';

import { Chatlog, Alternatives } from '../components/chatlog.js';
import { firstPrompt } from '../config.js';
import { log, triggerError } from '../utils/logger.js';
import { hooks } from '../hooks.js';

/**
 * @class ChatService
 * @classdesc Manages the lifecycle of chat sessions, including creating, switching, loading, and persisting chats.
 */
class ChatService {
    /**
     * @param {import('../state/store.js').default} store - The application's state store.
     * @param {import('./config-service.js').default} configService - The configuration service.
     */
    constructor(store, configService) {
        this.store = store;
        this.configService = configService;
        this.chats = [];
        this.currentChatId = null;
    }

    /**
     * Generates a string with the current date and time prompt.
     * @returns {string} The formatted date and time prompt.
     * @private
     */
    _getDatePrompt() {
        const now = new Date();
        return `\n\nKnowledge cutoff: none\nCurrent date: ${now.toISOString().slice(0, 10)}\nCurrent time: ${now.toTimeString().slice(0, 5)}`;
    }

    /**
     * Initializes the chat service by loading chats from storage or creating a new one if none exist.
     */
    init() {
        this.loadChats();
        const initialId = this.currentChatId || this.chats[0]?.id;
        if (this.chats.length === 0) {
            this.createNewChat();
        } else {
            this.switchChat(initialId);
        }

        this.store.subscribe('currentChat', (chat) => {
            if (chat) {
                const index = this.chats.findIndex(c => c.id === chat.id);
                if (index !== -1) {
                    this.chats[index] = chat;
                    this.persistChats();
                }
            }
        });
    }

    /**
     * Creates a new, empty chat session and switches to it.
     * @returns {Object} The new chat object.
     */
    createNewChat() {
        log(3, 'ChatService: createNewChat called');
        const id = Date.now().toString();
        const title = 'New Chat';
        const chatlog = new Chatlog();
        chatlog.addMessage({ role: 'system', content: firstPrompt + this._getDatePrompt() });
        const newChat = { id, title, chatlog, modelSettings: {}, agents: [], flow: { steps: [], connections: [] } };
        this.chats.push(newChat);
        this.store.set('chats', this.chats);
        this.switchChat(id);
        return newChat;
    }

    /**
     * Switches the active chat session.
     * @param {string} id - The ID of the chat to switch to.
     */
    switchChat(id) {
        log(3, 'ChatService: switchChat called for id', id);
        if (this.currentChatId === id) return;

        this.persistChats();
        this.currentChatId = id;
        const currentChat = this.chats.find(c => c.id === id);
        this.store.set('currentChat', currentChat);
    }

    /**
     * Deletes a chat session by its ID.
     * @param {string} chatId - The ID of the chat to delete.
     */
    deleteChat(chatId) {
        log(4, 'ChatService: deleteChat called for', chatId);
        this.chats = this.chats.filter(c => c.id !== chatId);
        this.store.set('chats', this.chats);

        if (this.currentChatId === chatId) {
            if (this.chats.length > 0) {
                this.switchChat(this.chats[0].id);
            } else {
                this.createNewChat();
            }
        }
        this.persistChats();
    }

    /**
     * Updates the title of a chat session.
     * @param {string} chatId - The ID of the chat to update.
     * @param {string} newTitle - The new title for the chat.
     */
    updateChatTitle(chatId, newTitle) {
        const chat = this.chats.find(c => c.id === chatId);
        if (chat) {
            chat.title = newTitle.trim() || 'Untitled Chat';
            this.persistChats();
            this.store.set('chats', [...this.chats]);
        }
    }

    /**
     * Persists all chat sessions to local storage.
     * @private
     */
    persistChats() {
        log(5, 'ChatService: persistChats called');
        const serializedChats = this.chats.map(c => {
            const chatExport = {
                id: c.id,
                title: c.title,
                data: c.chatlog.toJSON(),
                modelSettings: {},
                agents: (c.agents || []).map(agent => {
                    const agentExport = { ...agent, modelSettings: {} };
                    if (agent.modelSettings) {
                        hooks.onModelSettingsExport.forEach(fn => fn(agentExport.modelSettings, agent.modelSettings));
                    }
                    return agentExport;
                }),
                flow: c.flow || { steps: [], connections: [] },
            };
            if (c.modelSettings) {
                hooks.onModelSettingsExport.forEach(fn => fn(chatExport.modelSettings, c.modelSettings));
            }
            return chatExport;
        });
        this.configService.setItem('chats', JSON.stringify(serializedChats));
        this.configService.setItem('currentChatId', this.currentChatId);
    }

    /**
     * Loads chat sessions from local storage, handling legacy formats.
     * @private
     */
    loadChats() {
        log(3, 'ChatService: loadChats called');
        const storedChats = this.configService.getItem('chats');
        let migrated = false;
        let legacyLoaded = false;
        if (storedChats) {
            const parsed = JSON.parse(storedChats);
            this.chats = parsed.map(chatData => {
                const chatlog = new Chatlog();
                chatlog.load(chatData.data || null);

                const modelSettings = {};
                if (chatData.modelSettings) {
                    hooks.onModelSettingsImport.forEach(fn => fn(chatData.modelSettings, modelSettings));
                }

                const agents = (chatData.agents || []).map(agentData => {
                    const agentModelSettings = {};
                    if (agentData.modelSettings) {
                        hooks.onModelSettingsImport.forEach(fn => fn(agentData.modelSettings, agentModelSettings));
                    }
                    // Ensure useCustomModelSettings is carried over, default to false if not present
                    const useCustom = agentData.useCustomModelSettings || false;
                    return { ...agentData, modelSettings: agentModelSettings, useCustomModelSettings: useCustom };
                });

                const first = chatlog.getFirstMessage();
                if (!first || first.value.role !== 'system') {
                    log(4, 'ChatService: Adding missing system prompt in loadChats');
                    const oldRoot = chatlog.rootAlternatives;
                    chatlog.rootAlternatives = new Alternatives();
                    const sysMsg = chatlog.rootAlternatives.addMessage({ role: 'system', content: firstPrompt + this._getDatePrompt() });
                    sysMsg.answerAlternatives = oldRoot;
                }
                const flow = chatData.flow || { steps: [], connections: [] };
                if (!flow.connections) flow.connections = [];
                return { id: chatData.id, title: chatData.title, chatlog, modelSettings, agents, flow };
            });
        } else {
            const oldChatlog = this.configService.getItem('chatlog');
            if (oldChatlog) {
                log(3, 'ChatService: Loading legacy chatlog');
                const parsed = JSON.parse(oldChatlog);
                let rootData;
                if (parsed.rootAlternatives) {
                    rootData = parsed.rootAlternatives;
                } else {
                    const tempLog = new Chatlog();
                    parsed.forEach(msg => tempLog.addMessage(msg));
                    rootData = tempLog.toJSON();
                }
                const chatlog = new Chatlog();
                chatlog.load(rootData);
                this.chats = [{ id: Date.now().toString(), title: 'Legacy Chat', chatlog }];
                this.configService.removeItem('chatlog');
                legacyLoaded = true;
            } else {
                this.chats = [];
            }
        }
        if (migrated || legacyLoaded) {
            log(3, 'ChatService: Persisting migrated/legacy chats');
            this.persistChats();
        }
        this.currentChatId = this.configService.getItem('currentChatId');
        // Set 'currentChat' in store if currentChatId is valid, to select the first chat on page load if available
        let currentChat = null;
        if (this.currentChatId) {
            currentChat = this.chats.find(c => c.id === this.currentChatId);
        }
        if (currentChat) {
            this.store.set('currentChat', currentChat);
        } else {
            // Invalid ID; clear it so init() can fall back to first chat
            this.currentChatId = null;
        }
        this.store.set('chats', this.chats);
    }

    /**
     * Imports a chat from a JSON string.
     * @param {string} fileContent - The JSON string content of the chat to import.
     */
    importChat(fileContent) {
        try {
            let loaded = JSON.parse(fileContent);
            let data = loaded.data;
            if (!data && loaded.rootAlternatives) {
                data = loaded.rootAlternatives;
            } else if (!data && typeof loaded === 'object') {
                data = loaded;
            }
            const chatlog = new Chatlog();
            chatlog.load(data);
            const id = Date.now().toString();
            const title = loaded.title || 'Imported Chat';

            const modelSettings = {};
            if (loaded.modelSettings) {
                hooks.onModelSettingsImport.forEach(fn => fn(loaded.modelSettings, modelSettings));
            }

            const agents = (loaded.agents || []).map(agentData => {
                const agentModelSettings = {};
                if (agentData.modelSettings) {
                    hooks.onModelSettingsImport.forEach(fn => fn(agentData.modelSettings, agentModelSettings));
                }
                const useCustom = agentData.useCustomModelSettings || false;
                return { ...agentData, modelSettings: agentModelSettings, useCustomModelSettings: useCustom };
            });

            const flow = loaded.flow || { steps: [], connections: [] };
            if (!flow.connections) flow.connections = [];
            this.chats.push({ id, title, chatlog, modelSettings, agents, flow });
            this.store.set('chats', this.chats);
            this.switchChat(id);
            this.persistChats();
        } catch (error) {
            log(1, 'ChatService: Invalid chatlog file', error);
            triggerError('Invalid chatlog file. Failed to parse loaded chatlog:', error);
        }
    }
}

export default ChatService;
