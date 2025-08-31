/**
 * @fileoverview Service for handling AI communication.
 */

'use strict';

import { log, triggerError } from '../utils/logger.js';
import { defaultEndpoint } from '../config.js';

/**
 * @class AIService
 * @classdesc A service dedicated to handling all communication with the AI model.
 * It prepares the data, sends it to the API, and streams the response back.
 */
class AIService {
    /**
     * @param {import('../state/store.js').default} store - The application's state store.
     * @param {import('./config-service.js').default} configService - The configuration service.
     * @param {import('./api-service.js').default} apiService - The API service.
 * @param {Object} hooks - The application's hooks object.
     */
constructor(store, configService, apiService, hooks) {
        this.store = store;
        this.configService = configService;
        this.apiService = apiService;
    this.hooks = hooks;
    }

    /**
     * Merges settings from global, chat, and agent scopes with per-call options.
     * @param {Object} options - Per-call options for the AI response.
     * @returns {Object} The merged settings object.
     * @private
     */
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

    /**
     * Prepares the payload for the API call.
     * @param {import('../components/chatlog.js').Chatlog} targetChatlog - The chatlog to generate a response for.
     * @param {Object} mergedSettings - The merged settings for the call.
     * @param {import('../components/chatbox.js').ChatBox} chatBox - The chatbox instance for hooks.
     * @returns {Object | null} The prepared payload object, or null if no request should be sent.
     * @private
     */
    _preparePayload(targetChatlog, mergedSettings, chatBox) {
        let payload = {
            messages: targetChatlog.getActiveMessageValues().filter(m => m.content !== null),
            stream: true
        };

        this.hooks.onModelSettings.forEach(fn => fn(payload, mergedSettings));

        if (payload.messages.length === 0 || (payload.messages.length === 1 && payload.messages[0]?.role === 'system')) {
            return null;
        }

        const systemMessage = targetChatlog.getFirstMessage();
        if (systemMessage && systemMessage.value.role === 'system') {
            let newContent = systemMessage.value.content;
            for (const fn of this.hooks.onModifySystemPrompt) {
                newContent = fn(newContent) || newContent;
            }
            if (newContent !== systemMessage.value.content) {
                systemMessage.setContent(newContent);
            }
        }

        return this.hooks.beforeApiCall.reduce((p, fn) => fn(p, chatBox) || p, payload);
    }

    /**
     * Generates an AI response and streams the output via an async generator.
     * @param {import('../components/chatlog.js').Chatlog} targetChatlog - The chatlog to generate a response for.
     * @param {import('../components/chatbox.js').ChatBox} chatBox - The chatbox instance for hooks.
     * @param {Object} [options={}] - Options for the generation.
     * @yields {{type: string, delta?: string, error?: Error, metadata?: object}} The events from the response stream.
     */
    async * generateAIResponse(targetChatlog, chatBox, options = {}) {
        log(3, 'AIService: generateAIResponse called');
        if (this.store.get('receiving')) return;

        const mergedSettings = this._mergeSettings(options);
        if (!mergedSettings.model) {
            triggerError('Please select a model.');
            return;
        }

        this.store.set('receiving', true);

        try {
            const payload = this._preparePayload(targetChatlog, mergedSettings, chatBox);
            if (!payload) {
                this.store.set('receiving', false);
                return;
            }

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
                    this.hooks.onChunkReceived.forEach(fn => fn(delta));
                    yield { type: 'chunk', delta: delta };
                }
            }
        } catch (error) {
            yield { type: 'error', error: error };
        } finally {
            if (this.store.get('receiving')) { // Only finalize if not handled by an error event
                this.store.set('receiving', false);
                const metadata = { model: mergedSettings.model, temperature: mergedSettings.temperature, top_p: mergedSettings.top_p };
                yield { type: 'done', metadata: metadata };
            }
        }
    }
}

export { AIService };
