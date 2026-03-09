"""Playwright tests for js/utils.js and js/settings-manager.js pure functions."""

from playwright.sync_api import expect


def test_js_utils(page):
    errors = page.evaluate("""async () => {
        const {
            generateUniqueId, ensureUniqueId, generateUniqueName, decodeHTMLEntities
        } = await import('/js/utils.js');
        const {
            getPropertyByPath, setPropertyByPath
        } = await import('/js/settings-manager.js');

        const errors = [];
        function assert(cond, msg) { if (!cond) errors.push(msg); }

        // --- generateUniqueId ---
        {
            const id = generateUniqueId('chat', new Set());
            assert(id.startsWith('chat-'), 'generateUniqueId: prefix');
        }
        {
            const existing = new Set(['chat-123']);
            const id = generateUniqueId('chat', existing);
            assert(!existing.has(id), 'generateUniqueId: avoids collision');
        }

        // --- ensureUniqueId ---
        {
            assert(ensureUniqueId('my-id', 'chat', new Set()) === 'my-id', 'ensureUniqueId: returns proposed if unique');
        }
        {
            const id = ensureUniqueId(null, 'chat', new Set());
            assert(id.startsWith('chat-'), 'ensureUniqueId: generates for null');
        }
        {
            const existing = new Set(['existing-id']);
            const id = ensureUniqueId('existing-id', 'chat', existing);
            assert(id !== 'existing-id', 'ensureUniqueId: new id on conflict');
            assert(id.startsWith('chat-'), 'ensureUniqueId: prefix on conflict');
        }
        {
            const id = ensureUniqueId('', 'agent', new Set());
            assert(id.startsWith('agent-'), 'ensureUniqueId: generates for empty string');
        }

        // --- generateUniqueName ---
        {
            assert(generateUniqueName('New Flow', []) === 'New Flow', 'uniqueName: base available');
            assert(generateUniqueName('New Flow', ['New Flow']) === 'New Flow 2', 'uniqueName: append 2');
            assert(generateUniqueName('Chat', ['Chat', 'Chat 2', 'Chat 3']) === 'Chat 4', 'uniqueName: increment');
            assert(generateUniqueName('X', ['X', 'X 3']) === 'X 2', 'uniqueName: fills gap');
        }

        // --- decodeHTMLEntities ---
        {
            assert(decodeHTMLEntities('&amp;') === '&', 'decode &amp;');
            assert(decodeHTMLEntities('&lt;div&gt;') === '<div>', 'decode &lt;&gt;');
            assert(decodeHTMLEntities('&quot;hello&quot;') === '"hello"', 'decode &quot;');
            assert(decodeHTMLEntities("it&apos;s") === "it's", 'decode &apos;');
            assert(decodeHTMLEntities("it&#39;s") === "it's", 'decode &#39;');
            assert(decodeHTMLEntities('a&nbsp;b') === 'a b', 'decode &nbsp;');
            assert(decodeHTMLEntities('&#x27;') === "'", 'decode &#x27;');
            assert(decodeHTMLEntities('&#x2F;') === '/', 'decode &#x2F;');
            assert(decodeHTMLEntities('&unknown;') === '&unknown;', 'unknown entity unchanged');
            assert(decodeHTMLEntities('&lt;a href=&quot;/&quot;&gt;') === '<a href="/">', 'multiple entities');
            assert(decodeHTMLEntities('plain text') === 'plain text', 'no entities');
        }

        // --- getPropertyByPath ---
        {
            assert(getPropertyByPath({ a: { b: { c: 42 } } }, 'a.b.c') === 42, 'getPath: nested');
            assert(getPropertyByPath({ a: 1 }, 'b.c') === undefined, 'getPath: missing');
            assert(getPropertyByPath({ a: 1 }, '') === undefined, 'getPath: empty');
            assert(getPropertyByPath({ name: 'test' }, 'name') === 'test', 'getPath: top-level');
            assert(getPropertyByPath({ a: null }, 'a.b') === null, 'getPath: null in chain');
        }

        // --- setPropertyByPath ---
        {
            const obj1 = {};
            setPropertyByPath(obj1, 'a.b.c', 42);
            assert(obj1.a.b.c === 42, 'setPath: nested create');
        }
        {
            const obj2 = { x: { y: 'old' } };
            setPropertyByPath(obj2, 'x.y', 'new');
            assert(obj2.x.y === 'new', 'setPath: overwrite');
        }
        {
            const obj3 = {};
            setPropertyByPath(obj3, 'name', 'hello');
            assert(obj3.name === 'hello', 'setPath: top-level');
        }
        {
            const obj4 = {};
            setPropertyByPath(obj4, 'deep.nested.value', true);
            assert(obj4.deep.nested.value === true, 'setPath: create intermediates');
        }
        {
            const obj5 = { a: 'string' };
            setPropertyByPath(obj5, 'a.b', 1);
            assert(obj5.a.b === 1, 'setPath: overwrite non-object intermediate');
        }

        return errors;
    }""")

    assert errors == [], f"JS utils tests failed:\n" + "\n".join(errors)

    page.screenshot(path="test-results/verification_js_utils.png")
