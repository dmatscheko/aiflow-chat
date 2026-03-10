"""Tests for js/plugins/flows-plugin.js - FlowRunner and FlowManager logic."""

from playwright.sync_api import expect


def test_js_flow_runner(page):
    errors = page.evaluate("""async () => {
        const errors = [];
        function assert(condition, msg) {
            if (!condition) errors.push('FAIL: ' + msg);
        }

        const fm = window.app.flowManager;

        // --- Test: stepTypes are registered ---
        assert(Object.keys(fm.stepTypes).length > 0, 'stepTypes should have entries');
        assert(fm.stepTypes['simple-prompt'], 'simple-prompt step type should exist');
        assert(fm.stepTypes['multi-prompt'], 'multi-prompt step type should exist');
        assert(fm.stepTypes['branch'], 'branch step type should exist');
        assert(fm.stepTypes['token-count-branch'], 'token-count-branch step type should exist');
        assert(fm.stepTypes['clear-history'], 'clear-history step type should exist');
        assert(fm.stepTypes['echo-answer'], 'echo-answer step type should exist');
        assert(fm.stepTypes['consolidator'], 'consolidator step type should exist');
        assert(fm.stepTypes['conditional-stop'], 'conditional-stop step type should exist');

        // --- Test: triggersAIResponse property on step types ---
        assert(fm.stepTypes['simple-prompt'].triggersAIResponse === true,
            'simple-prompt should have triggersAIResponse=true');
        assert(fm.stepTypes['multi-prompt'].triggersAIResponse === true,
            'multi-prompt should have triggersAIResponse=true');
        assert(fm.stepTypes['consolidator'].triggersAIResponse === true,
            'consolidator should have triggersAIResponse=true');
        assert(fm.stepTypes['echo-answer'].triggersAIResponse === true,
            'echo-answer should have triggersAIResponse=true');
        assert(!fm.stepTypes['branch'].triggersAIResponse,
            'branch should NOT have triggersAIResponse');
        assert(!fm.stepTypes['clear-history'].triggersAIResponse,
            'clear-history should NOT have triggersAIResponse');
        assert(!fm.stepTypes['token-count-branch'].triggersAIResponse,
            'token-count-branch should NOT have triggersAIResponse');

        // --- Test: step getDefaults ---
        const simpleDefaults = fm.stepTypes['simple-prompt'].getDefaults();
        assert(simpleDefaults.prompt === 'Hello, world!', 'simple-prompt defaults has prompt');

        const branchDefaults = fm.stepTypes['branch'].getDefaults();
        assert(branchDefaults.conditionType !== undefined, 'branch defaults has conditionType');
        assert(branchDefaults.condition !== undefined, 'branch defaults has condition');

        const tokenDefaults = fm.stepTypes['token-count-branch'].getDefaults();
        assert(tokenDefaults.tokenCount === 500, 'token-count-branch defaults has tokenCount 500');

        // --- Test: FlowManager CRUD ---
        const initialCount = fm.flows.length;

        // Add a flow
        const testFlow = fm.addFlow({ name: 'Test Runner Flow', steps: [], connections: [] });
        assert(testFlow.id, 'addFlow returns flow with id');
        assert(testFlow.name === 'Test Runner Flow', 'addFlow preserves name');
        assert(fm.flows.length === initialCount + 1, 'flow count increased');

        // Get flow
        const retrieved = fm.getFlow(testFlow.id);
        assert(retrieved, 'getFlow returns the flow');
        assert(retrieved.name === 'Test Runner Flow', 'getFlow returns correct flow');

        // Update flow
        testFlow.name = 'Updated Flow';
        fm.updateFlow(testFlow);
        assert(fm.getFlow(testFlow.id).name === 'Updated Flow', 'updateFlow persists name change');

        // --- Test: FlowRunner.getNextStep ---
        const flow = {
            steps: [
                { id: 's1', type: 'simple-prompt', data: { prompt: 'test' } },
                { id: 's2', type: 'simple-prompt', data: { prompt: 'test2' } },
                { id: 's3', type: 'simple-prompt', data: { prompt: 'test3' } },
            ],
            connections: [
                { from: 's1', to: 's2', outputName: 'default' },
                { from: 's2', to: 's3', outputName: 'default' },
            ],
        };

        // Access FlowRunner via creating one
        const FlowRunnerClass = fm.activeFlowRunner?.constructor ||
            (() => {
                fm.activeFlowRunner = null;
                // Create a temporary runner
                const tmpFlow = { steps: [], connections: [] };
                const runner = new (function() {
                    // We need to get the class - let's construct one
                    fm.startFlow(testFlow.id);
                    const cls = fm.activeFlowRunner?.constructor;
                    if (fm.activeFlowRunner) {
                        fm.activeFlowRunner.stop('test cleanup');
                    }
                    return cls;
                }())();
            })();

        // Create a runner manually for testing
        // Since FlowRunner is not exported, we get its class from a temporary instantiation
        let RunnerClass = null;
        testFlow.steps = flow.steps;
        testFlow.connections = flow.connections;
        fm.updateFlow(testFlow);

        // Use startFlow to create a runner, then stop it to test the class
        fm.startFlow(testFlow.id);
        if (fm.activeFlowRunner) {
            RunnerClass = fm.activeFlowRunner.constructor;
            fm.activeFlowRunner.stop('test setup');
        }

        if (RunnerClass) {
            const runner = new RunnerClass(flow, window.app, fm);

            // Test getNextStep
            const next1 = runner.getNextStep('s1');
            assert(next1 && next1.id === 's2', 'getNextStep from s1 should return s2');

            const next2 = runner.getNextStep('s2');
            assert(next2 && next2.id === 's3', 'getNextStep from s2 should return s3');

            const next3 = runner.getNextStep('s3');
            assert(next3 === undefined, 'getNextStep from s3 (no connection) should return undefined');

            // Test getNextStep with named outputs
            const branchFlow = {
                steps: [
                    { id: 'b1', type: 'branch', data: {} },
                    { id: 'b2', type: 'simple-prompt', data: { prompt: 'yes' } },
                    { id: 'b3', type: 'simple-prompt', data: { prompt: 'no' } },
                ],
                connections: [
                    { from: 'b1', to: 'b2', outputName: 'pass' },
                    { from: 'b1', to: 'b3', outputName: 'fail' },
                ],
            };

            const branchRunner = new RunnerClass(branchFlow, window.app, fm);
            const passNext = branchRunner.getNextStep('b1', 'pass');
            assert(passNext && passNext.id === 'b2', 'getNextStep with pass output returns b2');

            const failNext = branchRunner.getNextStep('b1', 'fail');
            assert(failNext && failNext.id === 'b3', 'getNextStep with fail output returns b3');

            const defaultNext = branchRunner.getNextStep('b1', 'default');
            assert(defaultNext === undefined, 'getNextStep with unconnected output returns undefined');

            // Test runner state
            assert(runner.isRunning === false, 'new runner is not running');
            assert(runner.currentStepId === null, 'new runner has no current step');
            assert(runner.isExecutingStep === false, 'new runner is not executing');

            // Test stop
            runner.isRunning = true;
            runner.currentStepId = 's1';
            runner.stop('test stop');
            assert(runner.isRunning === false, 'stop sets isRunning to false');
            assert(runner.currentStepId === null, 'stop clears currentStepId');

            // Test continue when not running returns false
            const continueResult = await runner.continue(null, {});
            assert(continueResult === false, 'continue when not running returns false');
        } else {
            errors.push('FAIL: Could not get FlowRunner class');
        }

        // Cleanup: delete test flow
        fm.deleteFlow(testFlow.id);
        assert(fm.flows.length === initialCount, 'flow count restored after delete');

        return errors;
    }""")

    assert errors == [], f"JS FlowRunner tests failed:\\n" + "\\n".join(errors)
