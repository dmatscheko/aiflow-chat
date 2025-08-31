/**
 * @fileoverview Main application class.
 */

'use strict';

import Store from './state/store.js';
import ApiService from './services/api-service.js';
import ChatService from './services/chat-service.js';
import ConfigService from './services/config-service.js';
import SettingsPanel from './components/settings-panel.js';
import ChatListView from './components/chatlist-view.js';
import { ChatUIManager } from './components/chat-ui-manager.js';
import { AIService } from './services/ai-service.js';
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
            chats: [],
            currentChat: null,
            ui: this.ui,
        });

        this.configService = new ConfigService(this.store);
        this.apiService = new ApiService(this.store);
        this.chatService = new ChatService(this.store, this.configService);
        this.aiService = new AIService(this.store, this.configService, this.apiService);
        this.chatUIManager = new ChatUIManager(this.store, this.aiService, agentsPlugin);

        this.settingsPanel = new SettingsPanel({
            configService: this.configService,
            app: this,
        });

        this.chatListView = new ChatListView({
            onChatSelected: (chatId) => this.chatService.switchChat(chatId),
            onChatDeleted: (chatId) => this.chatService.deleteChat(chatId),
            onTitleEdited: (chatId, newTitle) => this.chatService.updateChatTitle(chatId, newTitle),
        });

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
        hooks.onGenerateAIResponse.push((options, chatlog) =>
            this.aiService.generateAIResponse(chatlog || this.chatUIManager.chatlog, this.chatUIManager.chatBox, options)
        );
    }

    /**
     * Initializes the application.
     */
    async init() {
        log(3, 'App: init called');
        this.registerPlugins();
        this.setupGlobalErrorHandlers();

        this.chatUIManager.onUpdate = () => this.chatService.persistChats();

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
        this.chatUIManager.setChatlog(chat?.chatlog || null);
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
            const models = await this.apiService.getModels(endpoint, apiKey);
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
            this.chatUIManager.submitMessage(this.ui.messageEl.value, document.querySelector('input[name="user_role"]:checked').value);
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
                this.chatUIManager.resetEditing();
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

}

export default App;
