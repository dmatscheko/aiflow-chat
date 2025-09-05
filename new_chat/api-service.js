/**
 * @fileoverview Service for handling all interactions with an OpenAI-compatible API.
 * This file is self-contained and has no external dependencies.
 */

'use strict';

/**
 * @typedef {object} ApiModel
 * @property {string} id - The unique identifier of the model.
 */

/**
 * Handles all interactions with an OpenAI-compatible API.
 * @class
 */
export class ApiService {
    /**
     * Fetches the list of available models from the API.
     * @param {string} apiUrl - The base URL of the API (e.g., "https://api.openai.com/").
     * @param {string} apiKey - The user's API key.
     * @returns {Promise<ApiModel[]>} A promise that resolves to an array of model objects, sorted by ID.
     * @throws {Error} If the API request fails.
     */
    async getModels(apiUrl, apiKey) {
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
}
