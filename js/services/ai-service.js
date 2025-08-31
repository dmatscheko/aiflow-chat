/**
 * @fileoverview Service for handling AI communication.
 */

'use strict';

import { log, triggerError } from '../utils/logger.js';
import { hooks } from '../hooks.js';
import { defaultEndpoint } from '../config.js';

/**
 * @class AIService
 * Handles the logic for generating AI responses.
 */
class AIService {
    /**
     * @param {import('../state/store.js').default} store - The application's state store.
     * @param {import('./config-service.js').default} configService - The configuration service.
     * @param {import('./api-service.js').default} apiService - The API service.
     */
    constructor(store, configService, apiService) {
        this.store = store;
        this.configService = configService;
        this.apiService = apiService;
    }

    _mergeSettings(options) {
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

    _preparePayload(targetChatlog, mergedSettings, chatBox) {
        let payload = {
            messages: targetChatlog.getActiveMessageValues().filter(m => m.content !== null),
            stream: true
        };

        hooks.onModelSettings.forEach(fn => fn(payload, mergedSettings));

        if (payload.messages.length === 0 || (payload.messages.length === 1 && payload.messages[0]?.role === 'system')) {
            return null;
        }

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

        return hooks.beforeApiCall.reduce((p, fn) => fn(p, chatBox) || p, payload);
    }

    async _streamResponse(payload, targetMessage, targetChatlog) {
        const endpoint = this.configService.getItem('endpoint', defaultEndpoint);
        const apiKey = this.configService.getItem('apiKey', '');
        const abortSignal = this.store.get('controller').signal;
        const reader = await this.apiService.streamAPIResponse(payload, endpoint, apiKey, abortSignal);

        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            if (chunk.startsWith('{')) {
                const data = JSON.parse(chunk);
                if (data.error) throw new Error(data.error.message);
            }

            const lines = chunk.split('\n');
            let delta = '';
            lines.forEach(line => {
                if (!line.startsWith('data: ')) return;
                const dataStr = line.substring(6);
                if (dataStr.trim() === '' || dataStr.trim() === '[DONE]') return;
                try {
                    const data = JSON.parse(dataStr);
                    if (data.error) throw new Error(data.error.message);
                    delta += data.choices[0].delta.content || '';
                } catch (e) {
                    log(2, 'Error parsing stream chunk', e);
                }
            });

            if (delta) {
                log(5, 'AIService: Received chunk', delta);
                hooks.onChunkReceived.forEach(fn => fn(delta));
                targetMessage.appendContent(delta);
                targetChatlog.notify();
            }
        }
    }

    _handleError(error, targetChatlog) {
        this.store.set('receiving', false);
        if (error.name === 'AbortError') {
            log(3, 'AIService: Response aborted');
            hooks.onCancel.forEach(fn => fn());
            this.store.set('controller', new AbortController());
            const lastMessage = targetChatlog.getLastMessage();
            if (lastMessage && lastMessage.value === null) {
                const lastAlternatives = targetChatlog.getLastAlternatives();
                lastAlternatives.messages.pop();
                lastAlternatives.activeMessageIndex = lastAlternatives.messages.length - 1;
            } else if (lastMessage) {
                lastMessage.appendContent('\n\n[Response aborted by user]');
            }
            if(lastMessage) lastMessage.cache = null;
            targetChatlog.notify();
            return;
        }

        log(1, 'AIService: generateAIResponse error', error);
        triggerError(error.message);
        const lastMessage = targetChatlog.getLastMessage();
        if (lastMessage.value === null) {
            lastMessage.value = { role: 'assistant', content: `[Error: ${error.message}. Retry or check connection.]` };
            hooks.afterMessageAdd.forEach(fn => fn(lastMessage));
        } else {
            lastMessage.appendContent(`\n\n[Error: ${error.message}. Retry or check connection.]`);
        }
        lastMessage.cache = null;
    }

    _finalizeResponse(targetChatlog, mergedSettings, chatBox) {
        this.store.set('receiving', false);
        const lastMessage = targetChatlog.getLastMessage();
        if (lastMessage && lastMessage.value !== null) {
            lastMessage.cache = null;
            lastMessage.metadata = { model: mergedSettings.model, temperature: mergedSettings.temperature, top_p: mergedSettings.top_p };
            hooks.onMessageComplete.forEach(fn => fn(lastMessage, targetChatlog, chatBox));
        }
        targetChatlog.notify();
    }

    /**
     * Generates an AI response.
     * @param {import('../components/chatlog.js').Chatlog} targetChatlog - The chatlog to generate a response for.
     * @param {import('../components/chatbox.js').ChatBox} chatBox - The chatbox instance for hooks.
     * @param {Object} [options={}] - Options for the generation.
     */
    async generateAIResponse(targetChatlog, chatBox, options = {}) {
        log(3, 'AIService: generateAIResponse called');
        if (this.store.get('receiving')) return;

        const mergedSettings = this._mergeSettings(options);
        if (!mergedSettings.model) {
            log(2, 'AIService: No model selected');
            triggerError('Please select a model.');
            return;
        }

        this.store.set('receiving', true);
        const targetMessage = targetChatlog.getLastMessage();

        try {
            const payload = this._preparePayload(targetChatlog, mergedSettings, chatBox);
            if (!payload) {
                this.store.set('receiving', false);
                return;
            }
            await this._streamResponse(payload, targetMessage, targetChatlog);
        } catch (error) {
            this._handleError(error, targetChatlog);
        } finally {
            if (this.store.get('receiving')) { // Only finalize if not handled by error
                this._finalizeResponse(targetChatlog, mergedSettings, chatBox);
            }
        }
    }
}

export { AIService };
