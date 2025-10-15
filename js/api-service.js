/**
 * @fileoverview Service for handling all interactions with an OpenAI-compatible API.
 * This class abstracts the details of making `fetch` calls to an AI backend,
 * handling authentication, endpoint resolution, and error handling for both
 * standard and streaming API requests. It is self-contained and has no
 * external application dependencies.
 */

'use strict';

import { pluginManager } from './plugin-manager.js';

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
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
            const response = await fetch(modelsUrl, { headers });
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
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        try {
            const response = await fetch(chatUrl, {
                method: 'POST',
                headers,
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
     * @param {object} config - The API configuration { apiUrl, apiKey }.
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
                temperature: config.use_temperature && config.temperature !== undefined ? parseFloat(config.temperature) : undefined,
                top_p: config.use_top_p && config.top_p !== undefined ? parseFloat(config.top_p) : undefined,
                top_k: config.use_top_k && config.top_k !== undefined ? parseInt(config.top_k, 10) : undefined,
                max_tokens: config.use_max_tokens && config.max_tokens !== undefined ? parseInt(config.max_tokens, 10) : undefined,
                stop: config.use_stop && config.stop ? config.stop.split(',').map(s => s.trim()) : undefined,
                presence_penalty: config.use_presence_penalty && config.presence_penalty !== undefined ? parseFloat(config.presence_penalty) : undefined,
                frequency_penalty: config.use_frequency_penalty && config.frequency_penalty !== undefined ? parseFloat(config.frequency_penalty) : undefined,
                repeat_penalty: config.use_repeat_penalty && config.repeat_penalty !== undefined ? parseFloat(config.repeat_penalty) : undefined,
                seed: config.use_seed && config.seed !== undefined ? parseInt(config.seed, 10) : undefined,
            };

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
            notifyUpdate();

            pluginManager.trigger('onStreamingStart', { message });

            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);

                pluginManager.trigger('onStreamingData', { message, chunk });

                const lines = chunk.split('\n');
                const deltas = lines
                    .map(line => line.replace(/^data: /, '').trim())
                    .filter(line => line !== '' && line !== '[DONE]')
                    .map(line => {
                        try {
                            return JSON.parse(line);
                        } catch (e) {
                            console.error("Failed to parse stream chunk:", line, e);
                            return null;
                        }
                    })
                    .filter(Boolean)
                    .map(json => json.choices[0].delta.content)
                    .filter(content => content);

                if (deltas.length > 0) {
                    message.value.content += deltas.join('');
                    notifyUpdate();
                }
            }
            pluginManager.trigger('onStreamingEnd', { message });
        } catch (error) {
            if (error.name === 'AbortError') {
                message.value.content += '\n\n[Aborted by user]';
            } else {
                // Prepend error for tool calls, otherwise set as content
                const errorMessage = `<error>An error occurred: ${error.message}</error>`;
                if (message.value.role === 'tool') {
                    message.value.content = errorMessage + message.value.content;
                } else {
                    message.value.content = `Error: ${error.message}`;
                }
            }
            notifyUpdate(); // Notify one last time for error/abort messages
        }
    }

    /**
     * Prepares and executes a streaming agent call, handling the entire lifecycle.
     * @param {object} app - The main application instance.
     * @param {object} chat - The chat context.
     * @param {object} messageToUpdate - The message object to be populated with the response.
     * @param {Array<object>} messages - The message history to be sent to the API.
     * @param {string} agentId - The ID of the agent to be called.
     * @returns {Promise<void>}
     */
    async executeStreamingAgentCall(app, chat, messageToUpdate, messages, agentId) {
        app.dom.stopButton.style.display = 'block';
        app.abortController = new AbortController();

        try {
            const effectiveConfig = app.agentManager.getEffectiveApiConfig(agentId);
            const finalSystemPrompt = await app.agentManager.constructSystemPrompt(agentId);

            if (finalSystemPrompt) {
                messages.unshift({ role: 'system', content: finalSystemPrompt });
            }

            const payload = { messages };
            messageToUpdate.value.model = effectiveConfig.model;

            await this.streamAndProcessResponse(
                payload,
                effectiveConfig,
                messageToUpdate,
                () => chat.log.notify(),
                app.abortController.signal
            );

        } catch (error) {
            if (error.name !== 'AbortError') {
                const errorMessage = messageToUpdate.value.role === 'tool'
                    ? `<error>An error occurred while calling the agent: ${error.message}</error>`
                    : `Error: ${error.message}`;
                messageToUpdate.value.content = errorMessage;
            }
            chat.log.notify();
        } finally {
            app.abortController = null;
            app.dom.stopButton.style.display = 'none';
        }
    }
}
