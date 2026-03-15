/**
 * @fileoverview Service for handling all interactions with an OpenAI-compatible API.
 * This class abstracts the details of making `fetch` calls to an AI backend,
 * handling authentication, endpoint resolution, and error handling for both
 * standard and streaming API requests. It is self-contained and has no
 * external application dependencies.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';
import { coerceValue } from './utils.js';

/**
 * Defines the mapping between API parameter keys and their expected types.
 * Used to build the defaults object from agent configuration in a data-driven way.
 * @const {Array<{key: string, type: string}>}
 */
const API_PARAM_DEFS = [
    { key: 'temperature', type: 'number' },
    { key: 'top_p', type: 'number' },
    { key: 'top_k', type: 'integer' },
    { key: 'max_tokens', type: 'integer' },
    { key: 'presence_penalty', type: 'number' },
    { key: 'frequency_penalty', type: 'number' },
    { key: 'repeat_penalty', type: 'number' },
    { key: 'seed', type: 'integer' },
];

/**
 * Represents a single AI model available from the API.
 * @typedef {object} ApiModel
 * @property {string} id - The unique identifier of the model (e.g., "gpt-4").
 */

/**
 * Handles all interactions with an OpenAI-compatible API, providing methods
 * for fetching models and streaming chat completions.
 * @class
 */
export class ApiService {
    /**
     * Applies an error to a message object, converting error-only messages to 'log' role
     * so they display as informational text and are excluded from AI context.
     * Messages with existing content get the error prepended instead.
     * @param {object} message - The message object to update.
     * @param {Error} error - The error to apply.
     * @private
     */
    _applyErrorToMessage(message, error) {
        if (error.name === 'AbortError') {
            message.value.content += '\n\n[Aborted by user]';
        } else {
            const hasContent = message.value.content?.trim().length > 0;
            if (hasContent) {
                message.value.content = `<error>An error occurred: ${error.message}</error>\n\n` + message.value.content;
            } else {
                message.value.role = 'log';
                message.value.content = `Error: ${error.message}`;
            }
        }
        message.cache = null;
    }

    /**
     * Builds the standard HTTP headers for an API request.
     * @param {string} apiKey - The API key for Bearer authentication. May be empty/null.
     * @returns {Object<string, string>} The headers object.
     * @private
     */
    _buildHeaders(apiKey) {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        return headers;
    }

    /**
     * Fetches the list of available AI models from the API.
     * @param {string} apiUrl - The base URL of the API (e.g., "https://api.openai.com/").
     * @param {string} apiKey - The user's API key for authentication.
     * @returns {Promise<ApiModel[]>} A promise that resolves to an array of model objects, sorted alphabetically by ID.
     * @throws {Error} Throws an error if the API request fails or returns a non-ok status.
     */
    async getModels(apiUrl, apiKey) {
        console.log('Fetching models ...');
        // The models endpoint is usually at /v1/models
        const modelsUrl = new URL('/v1/models', apiUrl).href;
        try {
            const response = await fetch(modelsUrl, { headers: this._buildHeaders(apiKey) });
            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            return (data.data || []).sort((a, b) => a.id.localeCompare(b.id));
        } catch (error) {
            console.error('Failed to fetch models:', error);
            throw error;
        }
    }

    /**
     * Initiates a streaming chat completions request to the API.
     * @param {object} payload - The payload to send to the API (e.g., { model, messages, stream: true }).
     * @param {string} apiUrl - The base URL of the API.
     * @param {string} apiKey - The user's API key.
     * @param {AbortSignal} abortSignal - The abort signal to cancel the request.
     * @returns {Promise<ReadableStreamDefaultReader<Uint8Array>>} A promise that resolves to a `ReadableStreamDefaultReader` for consuming the response stream.
     * @throws {Error} If the API request fails, the response body is null, or the request is aborted.
     */
    async streamChat(payload, apiUrl, apiKey, abortSignal) {
        console.log('Streaming chat ...');
        // The chat completions endpoint is usually at /v1/chat/completions
        const chatUrl = new URL('/v1/chat/completions', apiUrl).href;

        try {
            const response = await fetch(chatUrl, {
                method: 'POST',
                headers: this._buildHeaders(apiKey),
                body: JSON.stringify(payload),
                signal: abortSignal,
            });

            if (!response.ok) {
                const errorBody = await response.text();
                let errorMessage = `API error: ${response.statusText} (${response.status})`;
                try {
                    const errorJson = JSON.parse(errorBody);
                    if (errorJson.error && errorJson.error.message) {
                        errorMessage = errorJson.error.message;
                    }
                } catch (e) {
                    // Not a JSON error, use the raw text
                    if (errorBody) errorMessage = errorBody;
                }
                throw new Error(errorMessage);
            }

            if (!response.body) {
                throw new Error('Response body is null');
            }

            return response.body.getReader();
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('API request aborted.');
            } else {
                console.error('Failed to stream chat:', error);
            }
            throw error;
        }
    }

    /**
     * A unified method to handle the entire lifecycle of a streaming API call.
     * It initiates the request, processes the stream, updates the message object
     * in real-time, and handles errors and finalization.
     * @param {object} payload - The request payload for the API.
     * @param {object} config - The API configuration object. See the agent settings for details.
     * @param {string} config.apiUrl - The base URL for the API.
     * @param {string} config.apiKey - The API key for authentication.
     * @param {object} message - The message object to be updated with the streamed content.
     * @param {function} notifyUpdate - A callback function to signal that the message has been updated.
     * @param {AbortSignal} abortSignal - The signal to abort the fetch request.
     * @returns {Promise<void>} A promise that resolves when the stream is fully processed.
     */
    async streamAndProcessResponse(payload, config, message, notifyUpdate, abortSignal) {
        try {
            const defaults = {
                stream: config.use_stream && config.stream !== undefined ? config.stream : true,
                model: config.use_model && config.model ? config.model : undefined,
                stop: config.use_stop && config.stop ? config.stop.split(',').map(s => s.trim()) : undefined,
            };

            // Build numeric/typed parameters from the data-driven definitions.
            for (const { key, type } of API_PARAM_DEFS) {
                if (config[`use_${key}`] && config[key] !== undefined) {
                    defaults[key] = coerceValue(config[key], type);
                }
            }

            const noApiUrlError = new Error("Invalid API URL. Set a valid API URL in the Default Agent Settings.");
            if (!config.apiUrl) {
                throw noApiUrlError;
            }
            try {
                new URL('/v1/chat/completions', config.apiUrl);
            } catch {
                throw noApiUrlError;
            }

            if (config.use_logit_bias && config.logit_bias) {
                try {
                    defaults.logit_bias = JSON.parse(config.logit_bias);
                } catch (e) {
                    console.error("Invalid JSON in logit_bias:", e);
                }
            }

            // Filter out any undefined values to keep the payload clean
            const cleanedDefaults = Object.fromEntries(Object.entries(defaults).filter(([_, v]) => v !== undefined));

            const combinedPayload = { ...cleanedDefaults, ...payload };

            const reader = await this.streamChat(
                combinedPayload,
                config.apiUrl,
                config.apiKey,
                abortSignal
            );

            message.value.content = ''; // Initialize content
            message.cache = null;
            notifyUpdate();

            pluginManager.trigger('onStreamingStart', { message });

            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                // Keep the last (potentially incomplete) line in the buffer
                buffer = lines.pop();
                const deltas = lines
                    .filter(line => {
                        const trimmed = line.trim();
                        if (trimmed === '' || trimmed === 'data: [DONE]') return false;
                        if (trimmed.startsWith('data: ') || trimmed.startsWith('data:')) return true;
                        // Log non-data SSE fields for debugging (event:, id:, retry:, etc.)
                        if (trimmed.includes(':')) {
                            console.debug('SSE non-data field:', trimmed);
                        } else {
                            console.warn('Unexpected SSE line (no field prefix):', trimmed);
                        }
                        return false;
                    })
                    .map(line => line.replace(/^data: ?/, '').trim())
                    .filter(line => line !== '')
                    .map(line => {
                        try {
                            return JSON.parse(line);
                        } catch (e) {
                            console.error('Failed to parse stream chunk as JSON:', line, e);
                            return null;
                        }
                    })
                    .filter(Boolean)
                    .map(json => json.choices?.[0]?.delta?.content)
                    .filter(content => content);

                if (deltas.length > 0) {
                    pluginManager.trigger('onStreamingData', { message, deltas, notifyUpdate });
                    message.value.content += deltas.join('');
                    message.cache = null;
                    notifyUpdate();
                }
            }
            pluginManager.trigger('onStreamingEnd', { message, notifyUpdate });
        } catch (error) {
            this._applyErrorToMessage(message, error);
            notifyUpdate();
        }
    }

    /**
     * Prepares and executes a streaming agent call, handling the entire lifecycle.
     * It sets up the abort controller, gets the agent's configuration, constructs
     * the final system prompt, and then calls `streamAndProcessResponse`.
     * @param {object} app - The main application instance, providing access to the agent manager and DOM.
     * @param {object} chat - The chat instance, used to notify the UI of updates.
     * @param {object} messageToUpdate - The message object to be populated with the agent's response.
     * @param {Array<object>} messages - The message history to be sent to the API.
     * @param {string} agentId - The ID of the agent being called.
     * @returns {Promise<void>} A promise that resolves when the agent call is complete.
     */
    async executeStreamingAgentCall(app, chat, messageToUpdate, messages, agentId) {
        const chatId = chat.id;
        const abortController = new AbortController();
        app.abortControllers.set(chatId, abortController);

        // Show stop button only if this is the currently viewed chat
        if (app.dom.stopButton && app.activeView.id === chatId) {
            app.dom.stopButton.style.display = 'block';
        }

        try {
            const effectiveConfig = app.agentManager.getEffectiveApiConfig(agentId);
            const finalSystemPrompt = await app.agentManager.constructSystemPrompt(agentId);

            const finalMessages = finalSystemPrompt
                ? [{ role: 'system', content: finalSystemPrompt }, ...messages]
                : messages;

            const payload = { messages: finalMessages };
            messageToUpdate.value.model = effectiveConfig.model;

            await this.streamAndProcessResponse(
                payload,
                effectiveConfig,
                messageToUpdate,
                () => chat.log.notify(),
                abortController.signal
            );

        } catch (error) {
            // Only apply non-abort errors here. Abort errors from streaming are
            // already handled inside streamAndProcessResponse; this catch guards
            // against failures in config/prompt construction.
            if (error.name !== 'AbortError') {
                this._applyErrorToMessage(messageToUpdate, error);
            }
            chat.log.notify();
        } finally {
            app.abortControllers.delete(chatId);
            // Hide stop button only if this is the currently viewed chat
            if (app.dom.stopButton && app.activeView.id === chatId) {
                app.dom.stopButton.style.display = 'none';
            }
        }
    }
}
