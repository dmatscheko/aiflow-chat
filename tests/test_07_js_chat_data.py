"""Playwright tests for js/chat-data.js: ChatLog, Message, Alternatives."""

from playwright.sync_api import expect


def test_js_chat_data(page):
    errors = page.evaluate("""async () => {
        const { ChatLog } = await import('/js/chat-data.js');
        const errors = [];
        function assert(cond, msg) { if (!cond) errors.push(msg); }

        // --- addMessage / getLastMessage ---
        {
            const log = new ChatLog();
            const msg = log.addMessage({ role: 'user', content: 'Hello' });
            assert(msg.value.role === 'user', 'addMessage: role should be user');
            assert(msg.value.content === 'Hello', 'addMessage: content should be Hello');
            assert(log.getLastMessage() === msg, 'getLastMessage should return the added msg');
        }
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'Hi' });
            const reply = log.addMessage({ role: 'assistant', content: 'Hello!' });
            assert(log.getLastMessage() === reply, 'getLastMessage should return last added');
        }
        {
            const log = new ChatLog();
            assert(log.getLastMessage() === null, 'empty log getLastMessage should be null');
        }

        // --- getActiveMessages ---
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'Q1' });
            log.addMessage({ role: 'assistant', content: 'A1' });
            log.addMessage({ role: 'user', content: 'Q2' });
            const msgs = log.getActiveMessages();
            assert(msgs.length === 3, 'getActiveMessages: should have 3 msgs');
            assert(msgs[0].value.content === 'Q1', 'getActiveMessages[0] content');
            assert(msgs[1].value.content === 'A1', 'getActiveMessages[1] content');
            assert(msgs[2].value.content === 'Q2', 'getActiveMessages[2] content');
        }
        {
            const log = new ChatLog();
            assert(log.getActiveMessages().length === 0, 'empty log getActiveMessages');
        }

        // --- depth handling ---
        {
            const log = new ChatLog();
            const msg = log.addMessage({ role: 'user', content: 'test' });
            assert(msg.depth === 0, 'user msg default depth should be 0');
        }
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'test' });
            const reply = log.addMessage({ role: 'assistant', content: 'reply' });
            assert(reply.depth === 0, 'assistant inherits user depth 0');
        }
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'test' });
            const nested = log.addMessage({ role: 'assistant', content: 'nested' }, { depth: 2 });
            assert(nested.depth === 2, 'explicit depth should be respected');
        }

        // --- agent metadata ---
        {
            const log = new ChatLog();
            const msg = log.addMessage({ role: 'assistant', content: 'hi', agent: 'agent-1' });
            assert(msg.agent === 'agent-1', 'agent should be extracted');
            assert(msg.value.agent === undefined, 'agent should not be in value');
        }
        {
            const log = new ChatLog();
            const msg = log.addMessage({ role: 'tool', content: 'result', agent: 'a1', is_full_context_call: false });
            assert(msg.is_full_context_call === false, 'is_full_context_call extracted');
            assert(msg.agent === 'a1', 'agent extracted for tool msg');
        }

        // --- findNextPendingMessage ---
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'question' });
            log.addMessage({ role: 'assistant', content: null });
            const pending = log.findNextPendingMessage();
            assert(pending !== null, 'should find pending msg');
            assert(pending.value.role === 'assistant', 'pending role is assistant');
            assert(pending.value.content === null, 'pending content is null');
        }
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'hi' });
            log.addMessage({ role: 'assistant', content: 'hello' });
            assert(log.findNextPendingMessage() === null, 'no pending when all filled');
        }
        {
            const log = new ChatLog();
            assert(log.findNextPendingMessage() === null, 'empty log: no pending');
        }
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: null });
            assert(log.findNextPendingMessage() === null, 'user null content is not pending');
        }

        // --- alternatives and branching ---
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'hi' });
            const reply1 = log.addMessage({ role: 'assistant', content: 'response 1' });
            const reply2 = log.addAlternative(reply1, { role: 'assistant', content: 'response 2' });
            assert(reply2 !== null, 'addAlternative should return new msg');
            assert(reply2.value.content === 'response 2', 'alternative content');
        }
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'hi' });
            const reply1 = log.addMessage({ role: 'assistant', content: 'response 1' });
            log.addAlternative(reply1, { role: 'assistant', content: 'response 2' });
            assert(log.getLastMessage().value.content === 'response 2', 'new alt is active');
        }
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'hi' });
            const reply1 = log.addMessage({ role: 'assistant', content: 'A' });
            log.addAlternative(reply1, { role: 'assistant', content: 'B' });
            log.cycleAlternatives(log.getLastMessage(), 'prev');
            assert(log.getLastMessage().value.content === 'A', 'cycle prev to A');
            log.cycleAlternatives(log.getLastMessage(), 'next');
            assert(log.getLastMessage().value.content === 'B', 'cycle next to B');
        }

        // --- deleteMessage ---
        {
            const log = new ChatLog();
            const msg1 = log.addMessage({ role: 'user', content: 'first' });
            log.addAlternative(msg1, { role: 'user', content: 'second' });
            log.deleteMessage(msg1);
            assert(log.getActiveMessages()[0].value.content === 'second', 'after delete, second is active');
        }

        // --- getMessagesBefore ---
        {
            const log = new ChatLog();
            const m1 = log.addMessage({ role: 'user', content: 'q1' });
            const m2 = log.addMessage({ role: 'assistant', content: 'a1' });
            const m3 = log.addMessage({ role: 'user', content: 'q2' });
            const before = log.getMessagesBefore(m3);
            assert(before.length === 2, 'getMessagesBefore: 2 msgs before m3');
            assert(before[0] === m1, 'first msg is m1');
            assert(before[1] === m2, 'second msg is m2');
        }
        {
            const log = new ChatLog();
            const m1 = log.addMessage({ role: 'user', content: 'first' });
            const before = log.getMessagesBefore(m1);
            assert(before.length === 0, 'first msg has empty history');
        }

        // --- serialization ---
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'hi' });
            log.addMessage({ role: 'assistant', content: 'hello', agent: 'agent-1' });
            log.addMessage({ role: 'user', content: 'follow up' });
            const json = JSON.parse(JSON.stringify(log));
            const restored = ChatLog.fromJSON(json);
            const msgs = restored.getActiveMessages();
            assert(msgs.length === 3, 'serialization: 3 msgs');
            assert(msgs[0].value.content === 'hi', 'serialization: msg 0');
            assert(msgs[1].value.content === 'hello', 'serialization: msg 1');
            assert(msgs[1].agent === 'agent-1', 'serialization: agent preserved');
            assert(msgs[2].value.content === 'follow up', 'serialization: msg 2');
        }
        {
            const log = new ChatLog();
            const json = JSON.parse(JSON.stringify(log));
            assert(json === null, 'empty log serializes to null');
            const restored = ChatLog.fromJSON(json);
            assert(restored.getActiveMessages().length === 0, 'null deserializes to empty');
        }
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'q' });
            const a1 = log.addMessage({ role: 'assistant', content: 'answer A' });
            log.addAlternative(a1, { role: 'assistant', content: 'answer B' });
            const json = JSON.parse(JSON.stringify(log));
            const restored = ChatLog.fromJSON(json);
            assert(restored.getLastMessage().value.content === 'answer B', 'alts preserved');
            const first = restored.getActiveMessages()[0];
            assert(first.answerAlternatives.messages.length === 2, '2 alternatives');
        }
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'q' });
            log.addMessage({ role: 'assistant', content: 'nested' }, { depth: 3 });
            const json = JSON.parse(JSON.stringify(log));
            const restored = ChatLog.fromJSON(json);
            assert(restored.getActiveMessages()[1].depth === 3, 'depth preserved');
        }

        // --- subscribe / notify ---
        {
            const log = new ChatLog();
            let called = 0;
            log.subscribe(() => { called++; });
            log.addMessage({ role: 'user', content: 'hi' });
            assert(called === 1, 'subscriber called on addMessage');
        }
        {
            const log = new ChatLog();
            let called = 0;
            const cb = () => { called++; };
            log.subscribe(cb);
            log.addMessage({ role: 'user', content: 'a' });
            assert(called === 1, 'subscribe: called once');
            log.unsubscribe(cb);
            log.addMessage({ role: 'assistant', content: 'b' });
            assert(called === 1, 'unsubscribe: not called again');
        }

        // --- getHistoryForAgentCall ---
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'hi' });
            const target = log.addMessage({ role: 'assistant', content: null });
            const history = log.getHistoryForAgentCall(target, false);
            assert(history.length === 0, 'fullContext=false returns empty');
        }
        {
            const log = new ChatLog();
            log.addMessage({ role: 'user', content: 'q1' });
            log.addMessage({ role: 'assistant', content: 'a1' });
            const target = log.addMessage({ role: 'user', content: 'q2' });
            const history = log.getHistoryForAgentCall(target, true);
            assert(history.length === 2, 'fullContext=true returns history');
            assert(history[0].content === 'q1', 'history[0] is q1');
        }

        return errors;
    }""")

    assert errors == [], f"JS ChatLog tests failed:\n" + "\n".join(errors)

    page.screenshot(path="test-results/verification_js_chat_data.png")
