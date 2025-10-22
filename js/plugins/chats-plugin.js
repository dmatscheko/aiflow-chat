
import { ChatLog } from '../chat-data.js';
import { DataManager } from '../data-manager.js';
import { UIElementCreator } from '../ui/ui-elements.js';

class ChatsPlugin {
    constructor(pluginManager) {
        this.pluginManager = pluginManager;
        this.dataManager = new DataManager('chats', {});
        this.activeChat = null;

        this.pluginManager.registerView('chat', (id) => {
            const chatData = this.dataManager.get(id);
            const chatLog = ChatLog.fromJSON(chatData);
            return this.renderChatView(chatLog);
        });
        this.pluginManager.registerHook('onStart', this.onStart.bind(this));
        this.pluginManager.registerHook('onTitleChanged', this.onTitleChanged.bind(this));
    }

    onStart() {
        this.app = this.pluginManager.app;
        this.app.rightPanelManager.registerTab({
            id: 'chats',
            label: 'Chats',
            onCreate: this.createChatListPane.bind(this),
        });

        const chats = this.dataManager.getAll();
        const chatIds = Object.keys(chats);
        if (chatIds.length > 0) {
            this.app.setView('chat', chatIds[0]);
        } else {
            const newChat = this.createNewChat();
            this.app.setView('chat', newChat.id);
        }
    }

    onTitleChanged(data) {
        if (this.activeChat) {
            this.activeChat.title = data.title;
            this.dataManager.update(this.activeChat.id, this.activeChat);
            this.renderChatList();
        }
    }

    createChatListPane() {
        const container = UIElementCreator.createDiv({ id: 'chats-pane' });

        this.listContainer = UIElementCreator.createDiv();
        container.appendChild(this.listContainer);

        const newButton = UIElementCreator.createButton('New Chat', {
            events: { click: () => this.createNewChat() },
        });
        container.appendChild(newButton);

        this.renderChatList();
        return container;
    }

    renderChatList() {
        this.listContainer.innerHTML = '';
        const chats = this.dataManager.getAll();
        Object.values(chats).forEach(chatData => {
            const chatLog = ChatLog.fromJSON(chatData);
            const chatItem = UIElementCreator.createDiv({
                className: 'list-item',
                textContent: chatLog.title || `Chat ${chatLog.id}`,
                events: { click: () => this.setActiveChat(chatLog.id) },
            });
             if (this.activeChat && this.activeChat.id === chatLog.id) {
                chatItem.classList.add('active');
            }
            this.listContainer.appendChild(chatItem);
        });
    }

    setActiveChat(id) {
        const chatData = this.dataManager.get(id);
        this.activeChat = ChatLog.fromJSON(chatData);
        this.app.chatLog = this.activeChat;
        this.pluginManager.trigger('onChatSwitched', this.activeChat);
        this.renderChatList();
        this.app.setView('chat', id);
        this.updateTitleBar(this.activeChat);
    }

    createNewChat() {
        const newChat = new ChatLog();
        newChat.addNewMessage('user', '');
        const newChatData = newChat.toJSON();
        this.dataManager.add(newChatData.id, newChatData);
        this.setActiveChat(newChatData.id);
    }

    renderChatView(chatLog) {
        const chatContainer = UIElementCreator.createDiv({ id: 'chat-container' });

        const messagesContainer = UIElementCreator.createDiv({ id: 'messages-container' });
        chatContainer.appendChild(messagesContainer);

        chatLog.getMessages().forEach(message => {
            const messageEl = this.createMessageElement(message);
            messagesContainer.appendChild(messageEl);
        });
        
        this.pluginManager.trigger('onChatViewRendered', chatLog);
        return chatContainer;
    }

    createMessageElement(message) {
        const messageDiv = UIElementCreator.createDiv({ className: `message ${message.role}` });
        const contentDiv = UIElementCreator.createDiv({
            className: 'message-content',
            textContent: message.content,
        });
        messageDiv.appendChild(contentDiv);
        this.pluginManager.trigger('onMessageRendered', { element: messageDiv, message: message });
        return messageDiv;
    }

    updateTitleBar(chatLog) {
        this.app.topPanelManager.update({
            title: chatLog.title || `Chat`,
            isEditable: true,
        });
    }
}

export { ChatsPlugin };
