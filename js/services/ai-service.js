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

    /**
     * Generates an AI response.
     * @param {import('../components/chatlog.js').Chatlog} targetChatlog - The chatlog to generate a response for.
     * @param {import('../components/chatbox.js').ChatBox} chatBox - The chatbox instance for hooks.
     * @param {Object} [options={}] - Options for the generation.
     */
    async generateAIResponse(targetChatlog, chatBox, options = {}) {
        log(3, 'AIService: generateAIResponse called');
        if (this.store.get('receiving')) return;

        // 1. Get settings from all scopes
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

        // 2. Merge settings (agent > chat > global > options)
        const mergedSettings = { ...globalSettings, ...chatSettings, ...agentSettings, ...options };

        if (!mergedSettings.model) {
            log(2, 'AIService: No model selected');
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
            payload = hooks.beforeApiCall.reduce((p, fn) => fn(p, chatBox) || p, payload);

            const endpoint = this.configService.getItem('endpoint', defaultEndpoint)
            const apiKey = this.configService.getItem('apiKey', '');
            const abortSignal = this.store.get('controller').signal;
            const reader = await this.apiService.streamAPIResponse(payload, endpoint, apiKey, abortSignal);

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
                log(5, 'AIService: Received chunk', delta);
                hooks.onChunkReceived.forEach(fn => fn(delta));
                targetMessage.appendContent(delta);
                targetChatlog.notify();
            }
        } catch (error) {
            this.store.set('receiving', false); // Ensure receiving is false on error
            if (error.name === 'AbortError') {
                log(3, 'AIService: Response aborted');
                hooks.onCancel.forEach(fn => fn());
                this.store.set('controller', new AbortController());
                const lastMessage = targetChatlog.getLastMessage();
                if (lastMessage && lastMessage.value === null) {
                    const lastAlternatives = targetChatlog.getLastAlternatives();
                    lastAlternatives.messages.pop();
                    lastAlternatives.activeMessageIndex = lastAlternatives.messages.length - 1;
                    targetChatlog.notify();
                } else if (lastMessage) {
                    lastMessage.appendContent('\n\n[Response aborted by user]');
                    lastMessage.cache = null;
                }
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
        } finally {
            // Set receiving to false before calling hooks, in case a hook triggers another generation
            this.store.set('receiving', false);
            const lastMessage = targetChatlog.getLastMessage();

            // Set metadata here so hooks can use it
            if (lastMessage && lastMessage.value !== null) {
                lastMessage.cache = null;
                lastMessage.metadata = { model: mergedSettings.model, temperature: mergedSettings.temperature, top_p: mergedSettings.top_p };
                hooks.onMessageComplete.forEach(fn => fn(lastMessage, targetChatlog, chatBox));
            }
            targetChatlog.notify();
        }
    }
}

export { AIService };
