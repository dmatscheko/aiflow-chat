import json
from playwright.sync_api import expect


def test_simple_flow(page):
    # Flow creation (programmatic)
    flow_data = {
        "name": "Test Flow",
        "steps": [
            {"id": "step-1", "type": "simple-prompt", "x": 50, "y": 50, "isMinimized": False, "data": {"prompt": "What's the current date and time?"}},
            {"id": "step-2", "type": "simple-prompt", "x": 50, "y": 250, "isMinimized": False, "data": {"prompt": "Flow continued."}},
        ],
        "connections": [{"from": "step-1", "to": "step-2", "outputName": "default"}],
    }
    flow_id = page.evaluate(f"window.app.flowManager.addFlowFromData({json.dumps(flow_data)}).id")

    # Execution
    page.evaluate(f"window.app.flowManager.startFlow('{flow_id}')")

    # Assertions
    expect(page.locator(".message.role-user .message-content").first).to_have_text("What's the current date and time?", timeout=5000)
    expect(page.locator(".message.role-assistant .message-content").last).to_contain_text(
        "The current date and time has been provided by the tool.", timeout=10000
    )
    expect(page.locator(".message.role-user .message-content").last).to_have_text("Flow continued.", timeout=5000)

    page.screenshot(path="test-results/verification_simple_flow.png")
