import json
from playwright.sync_api import expect

def test_loop_flow(page):
    """Test a flow with a loop to ensure it doesn't cause infinite recursion."""
    # Flow creation (programmatic)

    flow_data = {
        "name": "Loop Test Flow",
        "steps": [
            {"id": "start", "type": "simple-prompt", "x": 50, "y": 0, "isMinimized": False, "data": {"prompt": "Start"}},
            {"id": "step-1", "type": "simple-prompt", "x": 50, "y": 150, "isMinimized": False, "data": {"prompt": "Iteration"}},
            {"id": "step-2", "type": "token-count-branch", "x": 50, "y": 300, "isMinimized": False, "data": {"tokenCount": 100000}}, # High threshold
        ],
        "connections": [
            {"from": "start", "to": "step-1", "outputName": "default"},
            {"from": "step-1", "to": "step-2", "outputName": "default"},
            {"from": "step-2", "to": "step-1", "outputName": "fail"}, # Under threshold, go back
        ],
    }
    flow_id = page.evaluate(f"window.app.flowManager.addFlowFromData({json.dumps(flow_data)}).id")

    # Execution
    page.evaluate(f"window.app.flowManager.startFlow('{flow_id}')")

    # We expect "Start" then "Iteration", "Iteration", ...
    expect(page.locator(".message.role-user .message-content").nth(0)).to_have_text("Start", timeout=10000)

    # Wait for at least 2 iterations (so 3 user messages total: Start, Iteration, Iteration)
    expect(page.locator(".message.role-user .message-content").nth(1)).to_have_text("Iteration", timeout=10000)
    expect(page.locator(".message.role-user .message-content").nth(2)).to_have_text("Iteration", timeout=10000)

    # If we reached here, it means we looped correctly without flooding.

    count = page.locator(".message").count()
    print(f"Message count: {count}")
    assert count < 50 # Buggy version would be much higher

    page.screenshot(path="test-results/verification_loop_flow.png")
