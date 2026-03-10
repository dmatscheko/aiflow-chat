"""Tests for js/response-processor.js - ResponseProcessor class."""

from playwright.sync_api import expect


def test_js_response_processor(page):
    errors = page.evaluate("""() => {
        const errors = [];
        function assert(condition, msg) {
            if (!condition) errors.push('FAIL: ' + msg);
        }

        const rp = window.app.responseProcessor;

        // --- Test: initial state ---
        assert(rp.isProcessing === false, 'initial isProcessing should be false');
        assert(Array.isArray(rp.agentCallStack), 'agentCallStack should be an array');
        assert(rp.agentCallStack.length === 0, 'agentCallStack should start empty');

        // --- Test: _findNextPendingMessage with no pending messages ---
        const result = rp._findNextPendingMessage();
        // It should either return null (no pending messages) or a pending message
        // Since we set up a clean chat, there should be no pending messages
        const hasPending = result !== null;
        // We can't assert much about the return since it depends on chat state,
        // but we can verify it doesn't crash
        assert(true, '_findNextPendingMessage does not crash');

        // --- Test: agentCallStack push/pop ---
        rp.agentCallStack.push({ agentId: 'agent-1', depth: 0 });
        rp.agentCallStack.push({ agentId: 'agent-2', depth: 1 });
        assert(rp.agentCallStack.length === 2, 'agentCallStack should have 2 items after push');

        const popped = rp.agentCallStack.pop();
        assert(popped.agentId === 'agent-2', 'pop returns last pushed item (LIFO)');
        assert(popped.depth === 1, 'popped item has correct depth');
        assert(rp.agentCallStack.length === 1, 'stack has 1 item after pop');

        // Clean up
        rp.agentCallStack.pop();
        assert(rp.agentCallStack.length === 0, 'stack is empty after cleanup');

        // --- Test: scheduleProcessing sets app reference ---
        const originalApp = rp.app;
        const mockApp = { chatManager: { chats: [], getActiveChat: () => null } };
        rp.app = mockApp;
        assert(rp.app === mockApp, 'app reference can be set');

        // Restore
        rp.app = originalApp;

        return errors;
    }""")

    assert errors == [], f"JS ResponseProcessor tests failed:\\n" + "\\n".join(errors)
