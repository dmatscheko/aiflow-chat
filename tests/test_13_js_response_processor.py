"""Tests for js/response-processor.js - ResponseProcessor class."""

from playwright.sync_api import expect


def test_js_response_processor(page):
    errors = page.evaluate("""() => {
        const errors = [];
        function assert(condition, msg) {
            if (!condition) errors.push('FAIL: ' + msg);
        }

        const rp = window.app.responseProcessor;

        // --- Test: initial state (per-chat processing) ---
        // No chats should be processing initially
        assert(typeof rp.isChatProcessing === 'function', 'isChatProcessing should be a function');
        assert(typeof rp.isChatStopped === 'function', 'isChatStopped should be a function');
        assert(typeof rp.getAgentCallStack === 'function', 'getAgentCallStack should be a function');

        // Test with a dummy chat id
        assert(rp.isChatProcessing('test-chat') === false, 'no chat should be processing initially');
        assert(rp.isChatStopped('test-chat') === false, 'no chat should be stopped initially');

        // --- Test: getAgentCallStack returns an array per chat ---
        const stack = rp.getAgentCallStack('test-chat');
        assert(Array.isArray(stack), 'getAgentCallStack should return an array');
        assert(stack.length === 0, 'agent call stack should start empty');

        // --- Test: agentCallStack push/pop ---
        stack.push({ agentId: 'agent-1', depth: 0 });
        stack.push({ agentId: 'agent-2', depth: 1 });
        assert(stack.length === 2, 'agentCallStack should have 2 items after push');

        const popped = stack.pop();
        assert(popped.agentId === 'agent-2', 'pop returns last pushed item (LIFO)');
        assert(popped.depth === 1, 'popped item has correct depth');
        assert(stack.length === 1, 'stack has 1 item after pop');

        // Same chat returns same stack
        const sameStack = rp.getAgentCallStack('test-chat');
        assert(sameStack === stack, 'getAgentCallStack returns same array for same chatId');
        assert(sameStack.length === 1, 'same stack retains items');

        // Different chat gets different stack
        const otherStack = rp.getAgentCallStack('other-chat');
        assert(otherStack !== stack, 'different chatId gets a different stack');
        assert(otherStack.length === 0, 'other chat stack starts empty');

        // Clean up
        stack.pop();
        assert(stack.length === 0, 'stack is empty after cleanup');

        // --- Test: stop marks chat as stopped ---
        rp.stop('test-chat');
        assert(rp.isChatStopped('test-chat') === true, 'chat should be stopped after stop()');
        assert(rp.isChatStopped('other-chat') === false, 'other chat should not be stopped');

        // --- Test: scheduleProcessing clears stopped state ---
        const originalApp = rp.app;
        rp.app = window.app;
        rp.scheduleProcessing(window.app, 'test-chat');
        assert(rp.isChatStopped('test-chat') === false, 'scheduleProcessing should clear stopped state');

        // Restore
        rp.app = originalApp;

        // Clean up internal state
        rp._agentCallStacks.delete('test-chat');
        rp._agentCallStacks.delete('other-chat');

        return errors;
    }""")

    assert errors == [], f"JS ResponseProcessor tests failed:\n" + "\n".join(errors)
