"""Tests for js/api-service.js - ApiService payload construction and config handling."""

from playwright.sync_api import expect


def test_js_api_service(page):
    errors = page.evaluate("""() => {
        const errors = [];
        function assert(condition, msg) {
            if (!condition) errors.push('FAIL: ' + msg);
        }

        const apiService = window.app.apiService;

        // --- Test: _buildHeaders with API key ---
        const headersWithKey = apiService._buildHeaders('test-key-123');
        assert(headersWithKey['Content-Type'] === 'application/json', 'headers include Content-Type');
        assert(headersWithKey['Authorization'] === 'Bearer test-key-123', 'headers include Authorization with key');

        // --- Test: _buildHeaders without API key ---
        const headersNoKey = apiService._buildHeaders('');
        assert(headersNoKey['Content-Type'] === 'application/json', 'headers include Content-Type without key');
        assert(headersNoKey['Authorization'] === undefined, 'no Authorization header when key is empty');

        const headersNullKey = apiService._buildHeaders(null);
        assert(headersNullKey['Authorization'] === undefined, 'no Authorization header when key is null');

        // --- Test: streamAndProcessResponse config-to-payload mapping ---
        // We can't fully test streaming without a server, but we can test the payload construction
        // by checking what happens with various config shapes

        // Test that streamAndProcessResponse validates URL
        let caughtError = null;
        const dummyMessage = { value: { content: null, role: 'assistant' }, cache: null };

        // Create a promise we can test (will fail because no valid server, but we check the error)
        try {
            // Synchronous part: URL validation happens before fetch
            const config = {
                apiUrl: '',
                apiKey: 'test',
                use_stream: true, stream: true,
                use_model: true, model: 'test-model',
            };
            // We can test the URL validation by trying with empty URL
            // This is async, so we handle it differently
        } catch (e) {
            caughtError = e;
        }

        // --- Test: URL validation in streamAndProcessResponse ---
        // Test with empty API URL
        const testUrlValidation = async (url, expectError) => {
            const msg = { value: { content: null, role: 'assistant' }, cache: null };
            const config = { apiUrl: url, apiKey: 'k' };
            const notifyFn = () => {};
            const abortCtrl = new AbortController();
            abortCtrl.abort(); // Abort immediately so we don't actually fetch

            await apiService.streamAndProcessResponse(
                { messages: [] }, config, msg, notifyFn, abortCtrl.signal
            );

            if (expectError) {
                return msg.value.content && msg.value.content.includes('Error');
            }
            return true;
        };

        // Test empty URL triggers error in message content
        const emptyUrlMsg = { value: { content: null, role: 'assistant' }, cache: null };
        const emptyUrlConfig = { apiUrl: '', apiKey: 'k' };

        return errors;
    }""")

    assert errors == [], f"JS ApiService tests failed:\\n" + "\\n".join(errors)

    # Test async behaviors
    async_errors = page.evaluate("""async () => {
        const errors = [];
        function assert(condition, msg) {
            if (!condition) errors.push('FAIL: ' + msg);
        }

        const apiService = window.app.apiService;

        // --- Test: streamAndProcessResponse with empty apiUrl ---
        const msg1 = { value: { content: null, role: 'assistant' }, cache: null };
        const config1 = { apiUrl: '', apiKey: 'key' };
        await apiService.streamAndProcessResponse(
            { messages: [] }, config1, msg1, () => {}, new AbortController().signal
        );
        assert(msg1.value.content.includes('Invalid API URL'), 'empty apiUrl should produce error, got: ' + msg1.value.content);

        // --- Test: streamAndProcessResponse with invalid apiUrl ---
        const msg2 = { value: { content: null, role: 'assistant' }, cache: null };
        const config2 = { apiUrl: 'not-a-url', apiKey: 'key' };
        await apiService.streamAndProcessResponse(
            { messages: [] }, config2, msg2, () => {}, new AbortController().signal
        );
        assert(msg2.value.content.includes('Invalid API URL') || msg2.value.content.includes('Error'),
            'invalid apiUrl should produce error, got: ' + msg2.value.content);

        // --- Test: streamAndProcessResponse with aborted signal ---
        const msg3 = { value: { content: null, role: 'assistant' }, cache: null };
        const config3 = { apiUrl: 'http://127.0.0.1:9999', apiKey: 'key' };
        const ctrl = new AbortController();
        ctrl.abort(); // Pre-abort
        await apiService.streamAndProcessResponse(
            { messages: [] }, config3, msg3, () => {}, ctrl.signal
        );
        assert(msg3.value.content.includes('[Aborted by user]'), 'aborted request should show abort message, got: ' + msg3.value.content);

        // --- Test: streamAndProcessResponse config parameter mapping ---
        // We test by capturing what streamChat receives via monkey-patching
        let capturedPayload = null;
        const originalStreamChat = apiService.streamChat.bind(apiService);
        apiService.streamChat = async (payload) => {
            capturedPayload = payload;
            throw new Error('test-stop');  // Stop after capturing
        };

        const msg4 = { value: { content: null, role: 'assistant' }, cache: null };
        const config4 = {
            apiUrl: 'http://localhost:9999',
            apiKey: 'key',
            use_stream: true, stream: true,
            use_model: true, model: 'gpt-4',
            use_temperature: true, temperature: '0.7',
            use_top_p: true, top_p: '0.9',
            use_top_k: false, top_k: '40',
            use_max_tokens: true, max_tokens: '1024',
            use_stop: false, stop: 'END',
            use_seed: true, seed: '42',
            use_presence_penalty: false,
            use_frequency_penalty: false,
            use_repeat_penalty: false,
        };

        await apiService.streamAndProcessResponse(
            { messages: [{ role: 'user', content: 'test' }] },
            config4, msg4, () => {}, new AbortController().signal
        );

        // Restore original
        apiService.streamChat = originalStreamChat;

        if (capturedPayload) {
            assert(capturedPayload.stream === true, 'stream should be true');
            assert(capturedPayload.model === 'gpt-4', 'model should be gpt-4');
            assert(capturedPayload.temperature === 0.7, 'temperature should be parsed as float 0.7, got: ' + capturedPayload.temperature);
            assert(capturedPayload.top_p === 0.9, 'top_p should be parsed as float 0.9');
            assert(capturedPayload.top_k === undefined, 'top_k should be undefined when use_top_k is false');
            assert(capturedPayload.max_tokens === 1024, 'max_tokens should be parsed as int 1024');
            assert(capturedPayload.stop === undefined, 'stop should be undefined when use_stop is false');
            assert(capturedPayload.seed === 42, 'seed should be parsed as int 42');
            assert(capturedPayload.presence_penalty === undefined, 'presence_penalty should be undefined when disabled');
            assert(capturedPayload.messages.length === 1, 'messages should be passed through');
        } else {
            errors.push('FAIL: capturedPayload was null - streamChat was not called');
        }

        // --- Test: executeStreamingAgentCall does not mutate input messages array ---
        let capturedMessages = null;
        apiService.streamChat = async (payload) => {
            capturedMessages = payload.messages;
            throw new Error('test-stop');
        };

        const originalMessages = [{ role: 'user', content: 'hello' }];
        const originalLength = originalMessages.length;

        const mockChat = {
            id: 'mock-chat-id',
            log: { notify: () => {} }
        };
        const mockApp = {
            dom: { stopButton: { style: { display: '' } } },
            abortControllers: new Map(),
            activeView: { id: 'mock-chat-id' },
            agentManager: {
                getEffectiveApiConfig: () => ({
                    apiUrl: 'http://localhost:9999',
                    apiKey: 'key',
                    model: 'test',
                }),
                constructSystemPrompt: async () => 'You are helpful.',
            },
        };

        await apiService.executeStreamingAgentCall(
            mockApp, mockChat,
            { value: { content: null, role: 'assistant', model: null } },
            originalMessages,
            'agent-default'
        );

        apiService.streamChat = originalStreamChat;

        assert(originalMessages.length === originalLength,
            'executeStreamingAgentCall should not mutate input messages array, length was ' + originalMessages.length + ' expected ' + originalLength);

        if (capturedMessages) {
            assert(capturedMessages.length === originalLength + 1,
                'system prompt should be prepended in final payload, got length ' + capturedMessages.length);
            assert(capturedMessages[0].role === 'system', 'first message should be system prompt');
        }

        return errors;
    }""")

    assert async_errors == [], f"JS ApiService async tests failed:\\n" + "\\n".join(async_errors)
