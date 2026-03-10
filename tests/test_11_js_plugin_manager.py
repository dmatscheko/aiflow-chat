"""Tests for js/plugin-manager.js - PluginManager class."""

from playwright.sync_api import expect


def test_js_plugin_manager(page):
    errors = page.evaluate("""async () => {
        const errors = [];
        function assert(condition, msg) {
            if (!condition) errors.push('FAIL: ' + msg);
        }

        const { pluginManager: pm } = await import('/js/plugin-manager.js');

        // --- Test: registerView and getViewRenderer ---
        const testRenderer = (id) => '<div>test-' + id + '</div>';
        pm.registerView('_test-view-type', testRenderer);
        assert(pm.getViewRenderer('_test-view-type') === testRenderer, 'registerView should store renderer');
        assert(pm.getViewRenderer('nonexistent') === null, 'getViewRenderer returns null for unknown type');

        // --- Test: register and trigger (data transformation hook) ---
        const results = [];
        pm.register({
            _testHookSync: (data) => {
                results.push('plugin1');
                return data + '-modified1';
            }
        });
        pm.register({
            _testHookSync: (data) => {
                results.push('plugin2');
                return data + '-modified2';
            }
        });

        const result = pm.trigger('_testHookSync', 'initial');
        assert(result === 'initial-modified1-modified2', 'trigger should chain data through callbacks, got: ' + result);
        assert(results.length === 2, 'trigger should call all registered callbacks');
        assert(results[0] === 'plugin1' && results[1] === 'plugin2', 'trigger should call in registration order');

        // --- Test: trigger returns first arg when no callbacks ---
        const noHookResult = pm.trigger('_nonExistentHook', 'passthrough');
        assert(noHookResult === 'passthrough', 'trigger with no callbacks returns first arg');

        // --- Test: trigger with undefined return ---
        pm.register({
            _testUndefinedReturn: (data) => {
                // does not return anything (undefined)
            }
        });
        const undefinedResult = pm.trigger('_testUndefinedReturn', 'keep-me');
        assert(undefinedResult === 'keep-me', 'trigger skips undefined returns, got: ' + undefinedResult);

        // --- Test: trigger passes extra args ---
        let extraArgs = null;
        pm.register({
            _testExtraArgs: (data, arg2, arg3) => {
                extraArgs = [arg2, arg3];
                return data;
            }
        });
        pm.trigger('_testExtraArgs', 'data', 'second', 'third');
        assert(extraArgs && extraArgs[0] === 'second' && extraArgs[1] === 'third', 'trigger passes extra args to callbacks');

        // --- Test: register ignores non-own properties ---
        const proto = { _inheritedHook: () => 'should not register' };
        const childPlugin = Object.create(proto);
        childPlugin._ownHook = () => 'registered';
        pm.register(childPlugin);
        assert(!pm.hooks['_inheritedHook'] || pm.hooks['_inheritedHook'].length === 0, 'register ignores inherited properties');

        // --- Test: triggerAsync chains data ---
        pm.register({
            _testAsyncHook: async (data) => {
                await new Promise(r => setTimeout(r, 1));
                return data + '-async1';
            }
        });
        pm.register({
            _testAsyncHook: async (data) => {
                return data + '-async2';
            }
        });

        const asyncResult = await pm.triggerAsync('_testAsyncHook', 'start');
        assert(asyncResult === 'start-async1-async2', 'triggerAsync should chain async results, got: ' + asyncResult);

        // --- Test: triggerAsync with no callbacks ---
        const asyncNoHook = await pm.triggerAsync('_noSuchAsyncHook', 'keep');
        assert(asyncNoHook === 'keep', 'triggerAsync with no callbacks returns first arg');

        // --- Test: triggerSequentially stops on true ---
        const seqCalls = [];
        pm.register({
            _testSeqHook: async () => {
                seqCalls.push('first');
                return true;  // handled
            }
        });
        pm.register({
            _testSeqHook: async () => {
                seqCalls.push('second');
                return false;
            }
        });

        const seqResult = await pm.triggerSequentially('_testSeqHook');
        assert(seqResult === true, 'triggerSequentially returns true when a handler returns true');
        assert(seqCalls.length === 1, 'triggerSequentially stops after first true, got calls: ' + seqCalls.length);

        // --- Test: triggerSequentially returns false when none handle ---
        pm.register({
            _testSeqFalse: async () => false
        });
        const seqFalseResult = await pm.triggerSequentially('_testSeqFalse');
        assert(seqFalseResult === false, 'triggerSequentially returns false when no handler returns true');

        // --- Test: triggerSequentially with no callbacks ---
        const seqNoHook = await pm.triggerSequentially('_noSuchSeqHook');
        assert(seqNoHook === false, 'triggerSequentially with no callbacks returns false');

        // Cleanup test hooks
        delete pm.hooks['_testHookSync'];
        delete pm.hooks['_testUndefinedReturn'];
        delete pm.hooks['_testExtraArgs'];
        delete pm.hooks['_ownHook'];
        delete pm.hooks['_testAsyncHook'];
        delete pm.hooks['_testSeqHook'];
        delete pm.hooks['_testSeqFalse'];
        delete pm.viewRenderers['_test-view-type'];

        return errors;
    }""")

    assert errors == [], f"JS PluginManager tests failed:\\n" + "\\n".join(errors)
