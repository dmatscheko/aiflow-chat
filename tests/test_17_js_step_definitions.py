"""Tests for js/plugins/flows-plugin-step-definitions.js - step helper functions."""

from playwright.sync_api import expect


def test_js_step_definitions(page):
    errors = page.evaluate("""() => {
        const errors = [];
        function assert(condition, msg) {
            if (!condition) errors.push('FAIL: ' + msg);
        }

        const fm = window.app.flowManager;

        // --- Test: All expected step types are registered ---
        const expectedTypes = [
            'simple-prompt', 'multi-prompt', 'consolidator', 'echo-answer',
            'clear-history', 'branch', 'token-count-branch', 'conditional-stop',
            'agent-call-from-answer', 'manual-mcp-call', 'pop-from-stack'
        ];

        expectedTypes.forEach(type => {
            assert(fm.stepTypes[type], 'step type "' + type + '" should be registered');
        });

        // --- Test: Each step type has required properties ---
        Object.entries(fm.stepTypes).forEach(([type, def]) => {
            assert(typeof def.label === 'string' && def.label.length > 0,
                type + ' should have a non-empty label');
            assert(typeof def.getDefaults === 'function',
                type + ' should have a getDefaults function');
            assert(typeof def.render === 'function',
                type + ' should have a render function');
            assert(typeof def.execute === 'function',
                type + ' should have an execute function');
        });

        // --- Test: getDefaults returns valid objects ---
        const simpleDefaults = fm.stepTypes['simple-prompt'].getDefaults();
        assert(typeof simpleDefaults === 'object', 'simple-prompt getDefaults returns object');
        assert(typeof simpleDefaults.prompt === 'string', 'simple-prompt default has string prompt');

        const multiDefaults = fm.stepTypes['multi-prompt'].getDefaults();
        assert(typeof multiDefaults.prompt === 'string', 'multi-prompt default has prompt');
        assert(typeof multiDefaults.count === 'number', 'multi-prompt default has count');
        assert(multiDefaults.count >= 1, 'multi-prompt default count >= 1');

        const branchDefaults = fm.stepTypes['branch'].getDefaults();
        assert(typeof branchDefaults.conditionType === 'string', 'branch default has conditionType');
        assert(typeof branchDefaults.condition === 'string', 'branch default has condition');

        const tokenDefaults = fm.stepTypes['token-count-branch'].getDefaults();
        assert(typeof tokenDefaults.tokenCount === 'number', 'token-count-branch default has tokenCount');

        const clearDefaults = fm.stepTypes['clear-history'].getDefaults();
        assert(typeof clearDefaults === 'object', 'clear-history getDefaults returns object');

        const echoDefaults = fm.stepTypes['echo-answer'].getDefaults();
        assert(typeof echoDefaults === 'object', 'echo-answer getDefaults returns object');

        const consolidatorDefaults = fm.stepTypes['consolidator'].getDefaults();
        assert(typeof consolidatorDefaults.prePrompt === 'string', 'consolidator default has prePrompt');
        assert(typeof consolidatorDefaults.postPrompt === 'string', 'consolidator default has postPrompt');

        const condStopDefaults = fm.stepTypes['conditional-stop'].getDefaults();
        assert(typeof condStopDefaults.conditionType === 'string', 'conditional-stop default has conditionType');

        const agentCallDefaults = fm.stepTypes['agent-call-from-answer'].getDefaults();
        assert(typeof agentCallDefaults.prePrompt === 'string', 'agent-call-from-answer default has prePrompt');
        assert(typeof agentCallDefaults.fullContext === 'boolean', 'agent-call-from-answer default has fullContext');

        // --- Test: render functions produce HTML strings ---
        const testStep = {
            id: 'test-step-1',
            type: 'simple-prompt',
            data: fm.stepTypes['simple-prompt'].getDefaults(),
        };
        const agentOptions = '<option value="agent-default">Default Agent</option>';
        const rendered = fm.stepTypes['simple-prompt'].render(testStep, agentOptions);
        assert(typeof rendered === 'string', 'render returns a string');
        assert(rendered.includes('test-step-1'), 'rendered HTML includes step id');
        assert(rendered.includes('Simple Prompt') || rendered.includes('h4'), 'rendered HTML includes title');

        // --- Test: branch step has named output connectors ---
        const branchStep = {
            id: 'test-branch-1',
            type: 'branch',
            data: branchDefaults,
        };
        const branchDef = fm.stepTypes['branch'];
        if (branchDef.renderOutputConnectors) {
            const connectorHtml = branchDef.renderOutputConnectors(branchStep);
            assert(connectorHtml.includes('pass'), 'branch output connectors include "pass"');
            assert(connectorHtml.includes('fail'), 'branch output connectors include "fail"');
        }

        // --- Test: token-count-branch step has named output connectors ---
        const tokenStep = {
            id: 'test-token-1',
            type: 'token-count-branch',
            data: tokenDefaults,
        };
        const tokenDef = fm.stepTypes['token-count-branch'];
        if (tokenDef.renderOutputConnectors) {
            const tokenConnectorHtml = tokenDef.renderOutputConnectors(tokenStep);
            assert(tokenConnectorHtml.includes('pass'), 'token-count-branch output connectors include "pass"');
            assert(tokenConnectorHtml.includes('fail'), 'token-count-branch output connectors include "fail"');
        }

        // --- Test: step types with icons ---
        const stepsWithIcons = ['simple-prompt', 'multi-prompt', 'branch', 'token-count-branch',
            'clear-history', 'echo-answer', 'consolidator', 'conditional-stop'];
        stepsWithIcons.forEach(type => {
            const def = fm.stepTypes[type];
            assert(def.icon && def.icon.includes('<svg'), type + ' should have an SVG icon');
        });

        // --- Test: step types with colors ---
        Object.entries(fm.stepTypes).forEach(([type, def]) => {
            if (def.color) {
                assert(def.color.includes('hsl'), type + ' color should be HSL format, got: ' + def.color);
            }
        });

        return errors;
    }""")

    assert errors == [], f"JS StepDefinitions tests failed:\\n" + "\\n".join(errors)
