import re
from playwright.sync_api import Page, expect, sync_playwright


def test_tool_error_response(page: Page):
    """
    This test verifies that the application correctly handles and displays an error
    response from a tool call.
    It performs the following steps:
    1. Navigates to the application and sets up the Default Agent with the mock backend.
    2. Sends a specific message designed to trigger a tool error in the mock backend.
    3. Verifies that the chat history correctly displays the tool's error message.
    4. Captures a screenshot for visual verification.
    """
    page.goto("http://127.0.0.1:8000")

    # Setup the agent to use the mock backend
    page.get_by_role("button", name="Agents").click()
    page.wait_for_timeout(1000)
    page.get_by_role("listitem").filter(has_text="Default Agent").click()
    page.wait_for_timeout(1000)
    page.get_by_label("API URL").fill("http://127.0.0.1:8080")
    page.get_by_label("Model:").check()
    page.wait_for_timeout(100)
    page.get_by_role("button", name="Refresh").first.click()
    page.wait_for_timeout(1000)
    page.locator("button.dropdown-btn").first.click()
    page.wait_for_selector('div.dropdown-item[data-value="mock-model-1"]')
    page.locator('div.dropdown-item[data-value="mock-model-1"]').click()
    page.get_by_label("MCP Server URL").fill("http://127.0.0.1:3000/mcp")
    page.get_by_role("button", name="Refresh").last.click()
    page.wait_for_timeout(1000)
    page.get_by_label("Allow all available tools").uncheck()
    tool_label_selector = '#agent-agent-default-toolSettings-allowed label:has-text("get_datetime")'
    expect(page.locator(tool_label_selector)).to_be_visible(timeout=10000)
    page.get_by_label("get_datetime").check()

    # Return to chat and start a new one
    page.get_by_role("button", name="Chats").click()
    page.get_by_role("button", name="New Chat").click()

    # Send a message that will trigger a tool error
    chat_input = page.get_by_placeholder("Type your message...")
    expect(chat_input).to_be_visible(timeout=5000)
    chat_input.fill("Trigger a tool error")
    chat_input.press("Enter")

    # Wait for the error message to appear in the tool response
    tool_response_message = page.locator(".message.role-tool .message-content").last
    expect(tool_response_message).to_contain_text('Tool "non_existent_tool" is not enabled.', timeout=5000)

    # Capture a screenshot for visual verification
    page.screenshot(path="test-results/verification_tool_error.png")


# Boilerplate to run the test from the command line.
if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_tool_error_response(page)
            print("Verification script for tool error finished successfully.")
            print("Screenshot saved to 'test-results/verification_tool_error.png'.")
        except Exception as e:
            print(f"An error occurred during the test: {e}")
            page.screenshot(path="test-results/verification_tool_error.png")
        finally:
            browser.close()
