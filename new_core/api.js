/**
 * @fileoverview Handles communication with an OpenAI-compatible API.
 * @licence MIT
 */

'use strict';

/**
 * Handles all interactions with the OpenAI-compatible API.
 */
export class ApiService {
    /**
     * Fetches the list of available models from the API.
     * @param {string} endpoint - The API endpoint URL for chat completions.
     * @param {string} apiKey - The user's API key.
     * @returns {Promise<Array<Object>>} A promise that resolves to an array of model objects.
     */
    async getModels(endpoint, apiKey) {
        const modelsUrl = endpoint.replace(/\\/chat\\/completions$/, '/models');
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
            const resp = await fetch(modelsUrl, {
                method: 'GET',
                headers
            });
            if (!resp.ok) {
                throw new Error(`Failed to fetch models: ${resp.statusText} (${resp.status})`);
            }
            const data = await resp.json();
            return (data.data || []).sort((a, b) => a.id.localeCompare(b.id));
        } catch (err) {
            console.error('Failed to load models:', err);
            throw err;
        }
    }

    /**
     * Streams the API response for a given payload.
     * @param {Object} payload - The payload to send to the API.
     * @param {string} endpoint - The API endpoint URL.
     * @param {string} apiKey - The user's API key.
     * @param {AbortSignal} abortSignal - The abort signal to cancel the request.
     * @returns {Promise<ReadableStreamDefaultReader<Uint8Array>>} A promise that resolves to a stream reader.
     */
    async streamAPIResponse(payload, endpoint, apiKey, abortSignal) {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(endpoint, {
            signal: abortSignal,
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            let errorMessage = `API error: ${response.statusText} (${response.status})`;
            if (errorBody) {
                try {
                    const errorJson = JSON.parse(errorBody);
                    if (errorJson.error && errorJson.error.message) {
                        errorMessage = errorJson.error.message;
                    }
                } catch (e) {
                    errorMessage = errorBody;
                }
            }
            if (response.status === 401) {
                errorMessage = 'Invalid API key. Please check your settings.';
            }
            throw new Error(errorMessage);
        }

        return response.body.getReader();
    }
}
