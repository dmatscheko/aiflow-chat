/**
 * @fileoverview Main application class.
 */

'use strict';

import Store from './state/store.js';
import NetworkService from './services/network-service.js';
import ChatService from './services/chat-service.js';
import ConfigService from './services/config-service.js';
import SettingsPanel from './components/settings-panel.js';
import UIManager from './managers/ui-manager.js';
import ChatListView from './components/chatlist-view.js';
import { log, triggerError } from './utils/logger.js';
import { showLogin, showLogout } from './utils/ui.js';
import { exportJson, importJson } from './utils/shared.js';
import { hooks, registerPlugin } from './hooks.js';
import { formattingPlugins } from './plugins/formatting.js';
import { alternativeNavigationPlugin, messageModificationPlugin } from './plugins/ui-controls.js';
import { agentsPlugin } from './plugins/agents/agents.js';
import { avatarsPlugin } from './plugins/avatars.js';
import { mcpPlugin } from './plugins/mcp.js';
import { errorBubblePlugin } from './plugins/error-bubble.js';
import { modelParamsPlugin } from './plugins/model-params.js';
import { maximizePlugin } from './plugins/maximize-view.js';
import { startMessage, messageSubmit, messageStop, defaultEndpoint } from './config.js';

/**
 * @class App
 * Main application orchestrator.
 */
class App {
    constructor() {
        log(5, 'App: Constructor called');
        this.ui = {
            messageEl: document.getElementById('messageInput'),
            submitButton: document.getElementById('submitButton'),
            newChatButton: document.getElementById('newChatButton'),
            saveChatButton: document.getElementById('saveChatButton'),
            loadChatButton: document.getElementById('loadChatButton'),
        };
        this.store = new Store({
            receiving: false,
            regenerateLastAnswer: false,
            controller: new AbortController(),
            editingPos: null,
            chats: [],
            currentChat: null,
            ui: this.ui,
        });

        this.configService = new ConfigService(this.store);
        this.networkService = new NetworkService(this.store);
        this.chatService = new ChatService(this.store, this.configService);

        this.settingsPanel = new SettingsPanel({
            configService: this.configService,
            app: this,
        });

        this.chatListView = new ChatListView({
            onChatSelected: (chatId) => this.chatService.switchChat(chatId),
            onChatDeleted: (chatId) => this.chatService.deleteChat(chatId),
            onTitleEdited: (chatId, newTitle) => this.chatService.updateChatTitle(chatId, newTitle),
        });

        this.uiManager = new UIManager(this.store);

        this.store.subscribe('receiving', (val) => {
            this.ui.submitButton.innerHTML = val ? messageStop : messageSubmit;
        });
        this.store.subscribe('chats', (chats) => this.chatListView.render(chats, this.store.get('currentChat')));
        this.store.subscribe('currentChat', (chat) => {
            this.onChatSwitched(chat);
            this.chatListView.render(this.store.get('chats'), chat);
        });

        if (window.innerWidth <= 1037) {
            document.getElementById('chatListContainer').classList.add('hidden');
        }
        hooks.onGenerateAIResponse.push((options, chatlog) => this.generateAIResponse(options, chatlog));
    }

    /**
     * Initializes the application.
     */
    async init() {
        log(3, 'App: init called');
        this.registerPlugins();
        this.setupGlobalErrorHandlers();

        this.uiManager.onUpdate = () => this.chatService.persistChats();

        this.chatService.init();

        this.settingsPanel.setApiKey(this.configService.getItem('apiKey', ''));
        this.settingsPanel.setEndpoint(this.configService.getItem('endpoint', defaultEndpoint));

        await this.handleLogin();

        hooks.onSettingsRender.forEach(fn => fn(this.settingsPanel.ui.settingsEl));

        this.setUpEventListeners();
    }

    /**
     * Registers all the plugins.
     */
    registerPlugins() {
        registerPlugin(agentsPlugin, this);
        registerPlugin(mcpPlugin, this);
        formattingPlugins.forEach(plugin => registerPlugin(plugin, this));
        registerPlugin(alternativeNavigationPlugin, this);
        registerPlugin(messageModificationPlugin, this);
        registerPlugin(avatarsPlugin, this);
        registerPlugin(errorBubblePlugin, this);
        registerPlugin(modelParamsPlugin, this);
        registerPlugin(maximizePlugin, this);
    }

    /**
     * Sets up global error handlers.
     */
    setupGlobalErrorHandlers() {
        window.addEventListener('error', (event) => {
            log(1, 'Global error', event.error || event.message);
            triggerError(event.error || new Error(event.message));
            event.preventDefault();
        });
        window.addEventListener('unhandledrejection', (event) => {
            log(1, 'Global unhandled rejection', event.reason);
            triggerError(event.reason);
            event.preventDefault();
        });
    }

    /**
     * Handles the login process.
     */
    async handleLogin() {
        let success = this.configService.getItem('endpoint', '') !== '';
        if (success) {
            success = await this.loadModels();
            if (success) {
                success = this.configService.getItem('model', '') !== '';
                if (success) {
                    showLogout();
                    this.settingsPanel.toggle('close');
                } else {
                    triggerError('Please select a model.');
                    showLogout();
                    this.settingsPanel.toggle('open');
                }
            } else {
                triggerError('Models could not be loaded. Is the API endpoint correct?');
                showLogin();
                this.settingsPanel.toggle('open');
            }
        } else {
            triggerError('Please log in.');
            showLogin();
            // Pass empty array to clear models if login fails
            this.configService.setItem('models', '[]');
            this.settingsPanel.toggle('open');
        }
    }

    /**
     * Handles chat switching.
     * @param {Object} chat - The chat to switch to.
     */
    onChatSwitched(chat) {
        log(3, 'App: onChatSwitched called for chat', chat?.id);
        this.uiManager.setChatlog(chat ? chat.chatlog : null);
        if (window.innerWidth <= 1037) {
            document.getElementById('chatListContainer').classList.add('hidden');
        }
    }

    /**
     * Fetches models from the API.
     * @returns {Promise<boolean>} True if models were loaded successfully.
     */
    async loadModels() {
        log(3, 'App: loadModels called');
        const endpoint = this.configService.getItem('endpoint', defaultEndpoint);
        const apiKey = this.configService.getItem('apiKey', '');
        if (!endpoint) {
            return false;
        }
        try {
            const models = await this.networkService.getModels(endpoint, apiKey);
            this.configService.setItem('models', JSON.stringify(models));

            if (models && models.length > 0) {
                const currentModel = this.configService.getItem('model');
                if (currentModel) {
                    if (!models.some(model => model.id === currentModel)) {
                        this.configService.removeItem('model');
                    }
                }
            } else {
                this.configService.removeItem('model');
                triggerError('API endpoint does not provide any AI models. Please configure AI models there.');
            }

            // The settings panel will now re-render with the new models
            // when it is opened. We could trigger a re-render here if needed.
            return true;
        } catch (err) {
            log(1, 'App: Failed to load models', err);
            triggerError('Failed to load models:', err);
            if (this.configService.getItem('apiKey') !== null) {
                this.configService.removeItem('apiKey');
                this.configService.removeItem('models');
                showLogin();
                triggerError('Session invalid, logged out.');
            }
            return false;
        }
    }

    /**
     * Sets up the main event listeners.
     */
    setUpEventListeners() {
        log(3, 'App: setUpEventListeners called');
        this.ui.submitButton.addEventListener('click', () => {
            log(4, 'App: Submit button clicked, receiving:', this.store.get('receiving'));
            if (this.store.get('receiving')) {
                this.store.get('controller').abort();
                return;
            }
            this.submitUserMessage(this.ui.messageEl.value, document.querySelector('input[name="user_role"]:checked').value);
            document.getElementById('user').checked = true;
            this.ui.messageEl.value = '';
            this.ui.messageEl.style.height = 'auto';
        });
        this.ui.messageEl.addEventListener('keydown', event => {
            if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey || event.altKey)) {
                event.preventDefault();
                this.ui.submitButton.click();
            }
        });
        this.ui.messageEl.addEventListener('input', function () {
            this.style.height = 'auto';
            let height = this.scrollHeight - parseInt(getComputedStyle(this).paddingTop) - parseInt(getComputedStyle(this).paddingBottom);
            if (height > window.innerHeight / 2) {
                height = window.innerHeight / 2;
                this.style.overflowY = 'scroll';
            } else {
                this.style.overflowY = 'hidden';
            }
            if (height > this.clientHeight) this.style.height = `${height}px`;
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                this.store.get('controller').abort();
                this.uiManager.resetEditing();
            }
        });
        this.ui.newChatButton.addEventListener('click', () => {
            log(4, 'App: New chat button clicked');
            if (this.store.get('receiving')) this.store.get('controller').abort();
            this.ui.messageEl.value = startMessage;
            this.ui.messageEl.style.height = 'auto';
            this.chatService.createNewChat();
        });
        this.ui.saveChatButton.addEventListener('click', () => {
            log(4, 'App: Save chat button clicked');
            const current = this.store.get('currentChat');
            if (!current) return;

            const chatData = {
                title: current.title,
                data: current.chatlog.toJSON(),
                agents: current.agents || [],
                flow: current.flow || { steps: [], connections: [] }
            };
            const filenameBase = current.title.replace(/\s/g, '_');
            exportJson(chatData, filenameBase);
        });
        this.ui.loadChatButton.addEventListener('click', () => {
            log(4, 'App: Load chat button clicked');
            importJson('application/json', (jsonContent) => {
                this.chatService.importChat(JSON.stringify(jsonContent));
            });
        });

        document.getElementById('toggleChatList').addEventListener('click', () => {
            log(5, 'App: Toggle chat list clicked');
            document.getElementById('chatListContainer').classList.toggle('hidden');
        });
    }

    /**
     * Merges model settings from different sources.
     * The order of precedence is: options > agent > chat > global.
     * @param {Object} [options={}] - The options for the generation.
     * @returns {Object} The merged model settings.
     * @private
     */
    _getMergedModelSettings(options = {}) {
        const globalSettings = this.configService.getModelSettings();
        const currentChat = this.store.get('currentChat');
        const chatSettings = currentChat?.modelSettings || {};

        let agentSettings = {};
        const activeAgentId = currentChat?.activeAgentId;
        if (activeAgentId) {
            const agent = currentChat.agents.find(a => a.id === activeAgentId);
            if (agent && agent.useCustomModelSettings) {
                agentSettings = agent.modelSettings || {};
            }
        }

        return { ...globalSettings, ...chatSettings, ...agentSettings, ...options };
    }

    /**
     * Processes the streamed response from the AI backend.
     * @param {ReadableStreamDefaultReader} reader - The stream reader.
     * @param {Message} targetMessage - The message to append the content to.
     * @param {Chatlog} targetChatlog - The chatlog to notify of changes.
     * @private
     */
    async _processStreamedResponse(reader, targetMessage, targetChatlog) {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const valueStr = new TextDecoder().decode(value);
            if (valueStr.startsWith('{')) {
                const data = JSON.parse(valueStr);
                if (data.error) throw new Error(data.error.message);
            }
            const chunks = valueStr.split('\n');
            let delta = '';
            chunks.forEach(chunk => {
                if (!chunk.startsWith('data: ')) return;
                chunk = chunk.substring(6);
                if (chunk === '' || chunk === '[DONE]') return;
                const data = JSON.parse(chunk);
                if (data.error) throw new Error(data.error.message);
                delta += data.choices[0].delta.content || '';
            });
            if (delta === '') continue;
            log(5, 'App: Received chunk', delta);
            hooks.onChunkReceived.forEach(fn => fn(delta));
            targetMessage.appendContent(delta);
            targetChatlog.notify();
        }
    }

    /**
     * Generates an AI response.
     * @param {Object} [options={}] - Options for the generation.
     * @param {Chatlog} [targetChatlog=this.chatlog] - The chatlog to generate a response for.
     */
    async generateAIResponse(options = {}, targetChatlog = this.uiManager.chatlog) {
        log(3, 'App: generateAIResponse called');
        if (this.store.get('receiving')) return;

        const mergedSettings = this._getMergedModelSettings(options);

        if (!mergedSettings.model) {
            log(2, 'App: No model selected');
            triggerError('Please select a model.');
            return;
        }

        this.store.set('receiving', true);
        const targetMessage = targetChatlog.getLastMessage();
        try {
            let payload = {
                messages: targetChatlog.getActiveMessageValues().filter(m => m.content !== null),
                stream: true
            };

            // 3. Apply settings to payload via hook
            hooks.onModelSettings.forEach(fn => fn(payload, mergedSettings));

            // Don't send a request if there are no messages or only a system prompt.
            if (payload.messages.length === 0) return;
            if (payload.messages.length === 1 && payload.messages[0]?.role === 'system') return;

            const systemMessage = targetChatlog.getFirstMessage();
            if (systemMessage && systemMessage.value.role === 'system') {
                let newContent = systemMessage.value.content;
                for (const fn of hooks.onModifySystemPrompt) {
                    newContent = fn(newContent) || newContent;
                }

                if (newContent !== systemMessage.value.content) {
                    systemMessage.setContent(newContent);
                }
            }
            payload = hooks.beforeApiCall.reduce((p, fn) => fn(p, this.uiManager) || p, payload);

            const endpoint = this.configService.getItem('endpoint', defaultEndpoint)
            const apiKey = this.configService.getItem('apiKey', '');
            const abortSignal = this.store.get('controller').signal;
            const reader = await this.networkService.streamAPIResponse(payload, endpoint, apiKey, abortSignal);

            await this._processStreamedResponse(reader, targetMessage, targetChatlog);
        } catch (error) {
            this.store.set('receiving', false); // Ensure receiving is false on error
            if (error.name === 'AbortError') {
                log(3, 'App: Response aborted');
                hooks.onCancel.forEach(fn => fn());
                this.store.set('controller', new AbortController());
                const lastMessage = targetChatlog.getLastMessage();
                if (lastMessage && lastMessage.value === null) {
                    targetChatlog.deleteMessage(lastMessage);
                } else if (lastMessage) {
                    lastMessage.appendContent('\n\n[Response aborted by user]');
                }
                return;
            }
            log(1, 'App: generateAIResponse error', error);
            triggerError(error.message);
            const lastMessage = targetChatlog.getLastMessage();
            if (lastMessage.value === null) {
                lastMessage.value = { role: 'assistant', content: `[Error: ${error.message}. Retry or check connection.]` };
                hooks.afterMessageAdd.forEach(fn => fn(lastMessage));
            } else {
                lastMessage.appendContent(`\n\n[Error: ${error.message}. Retry or check connection.]`);
            }
        } finally {
            // Set receiving to false before calling hooks, in case a hook triggers another generation
            this.store.set('receiving', false);
            const lastMessage = targetChatlog.getLastMessage();

            // Set metadata here so hooks can use it
            if (lastMessage && lastMessage.value !== null) {
                lastMessage.cache = null;
                lastMessage.metadata = { model: mergedSettings.model, temperature: mergedSettings.temperature, top_p: mergedSettings.top_p };
                hooks.onMessageComplete.forEach(fn => fn(lastMessage, targetChatlog, this.uiManager));
            }
            targetChatlog.notify();
            this.chatService.persistChats();
        }
    }

    /**
     * Submits a user message.
     * @param {string} message - The message to submit.
     * @param {string} userRole - The role of the user.
     */
    async submitUserMessage(message, userRole) {
        log(3, 'App: submitUserMessage called with role', userRole);
        const currentChatlog = this.uiManager.chatlog;
        if (!currentChatlog) return;

        const editedPos = this.store.get('editingPos');
        if (editedPos !== null) {
            this._handleEditMessage(editedPos, message, userRole, currentChatlog);
        } else {
            this._handleNewMessage(message, userRole, currentChatlog);
        }
    }

    /**
     * Handles editing an existing message.
     * @param {number} editedPos - The position of the message to edit.
     * @param {string} message - The new message content.
     * @param {string} userRole - The new role of the message.
     * @param {Chatlog} currentChatlog - The current chatlog.
     * @private
     */
    async _handleEditMessage(editedPos, message, userRole, currentChatlog) {
        log(4, 'App: Editing message at pos', editedPos);
        const msg = currentChatlog.getNthMessage(editedPos);
        if (msg) {
            msg.value.role = userRole;
            msg.setContent(message.trim());
        }
        this.store.set('editingPos', null);
        document.getElementById('user').checked = true;
        const editedMsg = currentChatlog.getNthMessage(editedPos);
        if (editedMsg.value.role !== 'assistant' && editedMsg.answerAlternatives === null && currentChatlog.getFirstMessage() !== editedMsg) {
            currentChatlog.addMessage({ role: 'assistant', content: null });
            await this.generateAIResponse({}, currentChatlog);
        }
    }

    /**
     * Handles submitting a new message.
     * @param {string} message - The message content.
     * @param {string} userRole - The role of the user.
     * @param {Chatlog} currentChatlog - The current chatlog.
     * @private
     */
    async _handleNewMessage(message, userRole, currentChatlog) {
        if (!this.store.get('regenerateLastAnswer') && !message) return;
        if (this.store.get('receiving') && !agentsPlugin.flowRunning) return;

        if (userRole === 'assistant') {
            let modifiedContent = message;
            for (let fn of hooks.beforeUserMessageAdd) {
                const result = fn(modifiedContent, userRole);
                if (result === false) return;
                if (typeof result === 'string') modifiedContent = result;
            }
            const newMessage = currentChatlog.addMessage({ role: userRole, content: modifiedContent });
            hooks.afterMessageAdd.forEach(fn => fn(newMessage));
            return;
        }

        if (!this.store.get('regenerateLastAnswer')) {
            message = message.trim();
            let modifiedContent = message;
            for (let fn of hooks.beforeUserMessageAdd) {
                const result = fn(modifiedContent, userRole);
                if (result === false) return;
                if (typeof result === 'string') modifiedContent = result;
            }
            const newMessage = currentChatlog.addMessage({ role: userRole, content: modifiedContent });
            hooks.afterMessageAdd.forEach(fn => fn(newMessage));
            currentChatlog.addMessage(null);
        }

        this.store.set('regenerateLastAnswer', false);
        await this.generateAIResponse({}, currentChatlog);
    }
}

export default App;
