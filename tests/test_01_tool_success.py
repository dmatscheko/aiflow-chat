from playwright.sync_api import expect
from test_utils import send_message


def test_tool_success(page):
    message = "What's the current date and time?"
    send_message(page, message)

    # Verify sequence

    # Wait for final assistant response
    final_assistant_response = page.locator(".message.role-assistant .message-content").last
    expect(final_assistant_response).to_contain_text("The current date and time has been provided by the tool.", timeout=5000)

    # Expand tool details for screenshot
    page.locator(".message.role-assistant .message-content .tool-call").last.click()
    page.locator(".message.role-tool .message-content .tool-response").last.click()

    # Verify tool response (JSON content)
    tool_response_message = page.locator(".message.role-tool .message-content").last
    expect(tool_response_message).to_contain_text('"text": "', timeout=3000)

    # Verify assistant's tool call
    assistant_tool_call_message = page.locator(".message.role-assistant .message-content").first
    expect(assistant_tool_call_message).to_contain_text('<dma:tool_call name="get_datetime"', timeout=3000)

    # Verify the initial user message
    expect(page.locator(".message.role-user .message-content").last).to_have_text(message, timeout=3000)

    page.screenshot(path="test-results/verification_tool_success.png")
