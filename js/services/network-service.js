/**
 * @fileoverview Handles all network communication with the AI backend.
 */

'use strict';

import { log, triggerError } from '../utils/logger.js';

class NetworkService {
    constructor(store) {
        this.store = store;
    }

    /**
     * Fetches the list of available models from the API.
     * @param {string} endpoint - The API endpoint URL.
     * @param {string} apiKey - The user's API key.
     * @returns {Promise<Array<Object>>} A promise that resolves to an array of model objects.
     */
    async getModels(endpoint, apiKey) {
        log(3, 'NetworkService: getModels called');
        const modelsUrl = endpoint.replace(/\/chat\/completions$/, '/models');
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
            const models = (data.data || []).sort((a, b) => a.id.localeCompare(b.id));
            return models;
        } catch (err) {
            log(1, 'NetworkService: Failed to load models', err);
            triggerError(`Failed to load models: ${err.message}`);
            throw err;
        }
    }

    /**
     * Streams the API response for a given payload.
     * @param {Object} payload - The payload to send to the API.
     * @param {string} endpoint - The API endpoint URL.
     * @param {string} apiKey - The user's API key.
     * @param {AbortSignal} abortSignal - The abort signal to cancel the request.
     * @returns {Promise<ReadableStreamDefaultReader>} A promise that resolves to a stream reader.
     */
    async streamAPIResponse(payload, endpoint, apiKey, abortSignal) {
        log(4, 'NetworkService: streamAPIResponse called with payload model', payload.model);
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
            log(1, 'NetworkService: API response not ok', response.status, response.statusText);
            const errorBody = await response.text();
            let errorMessage = `API error: ${response.statusText} (${response.status})`;
            if (errorBody) {
                try {
                    const errorJson = JSON.parse(errorBody);
                    if (errorJson.error && errorJson.error.message) {
                        errorMessage = errorJson.error.message;
                    }
                } catch (e) {
                    // Not a json error, just use the text
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

export default NetworkService;
