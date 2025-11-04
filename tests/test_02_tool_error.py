from playwright.sync_api import expect
from test_utils import send_message


def test_tool_error(page):
    send_message(page, "Trigger a tool error.")

    # Wait for the error message to appear in the tool response
    tool_response_message = page.locator(".message.role-tool .message-content").last
    expect(tool_response_message).to_contain_text('Tool "non_existent_tool" is not enabled.', timeout=5000)

    # Expand tool details for screenshot
    page.locator(".message.role-assistant .message-content .tool-call").last.click()
    page.locator(".message.role-tool .message-content .tool-response").last.click()

    page.screenshot(path="test-results/verification_tool_error.png")
