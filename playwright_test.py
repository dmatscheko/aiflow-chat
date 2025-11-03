
import re
from playwright.sync_api import Page, expect, sync_playwright

def test_tool_chaining_and_final_response(page: Page):
    """
    This test verifies the full tool-chaining process in the chat application.
    It performs the following steps:
    1. Navigates to the application.
    2. Configures the "Default Agent" to use the mock AI backend and the local MCP server.
    3. Switches back to the chat view and starts a new conversation.
    4. Sends a message that is expected to trigger a tool call ('datetime_get_current_datetime').
    5. Verifies that the chat history correctly displays:
        a. The initial user message.
        b. The assistant's tool call request.
        c. The tool's JSON response.
        d. The final assistant message summarizing the tool's output.
    6. Captures a screenshot of the final state for visual verification.
    """
    # 1. Arrange: Go to the chat application.
    page.goto("http://127.0.0.1:8000")

    # Click the "Agents" tab in the right panel.
    page.get_by_role("button", name="Agents").click()

    # Click the "Default Agent" to open its editor.
    page.get_by_role("listitem").filter(has_text="Default Agent").click()

    # Wait for the agent editor to fully load.
    page.wait_for_timeout(1000)

    # Fill in the API URL for the mock AI backend.
    page.get_by_label("API URL").fill("http://127.0.0.1:8080")

    # Check the "Model" checkbox to enable the refresh button
    page.get_by_label("Model:").check()

    # Click the "Refresh" button to load the models from the mock backend.
    page.get_by_role("button", name="Refresh").first.click()

    # Open the "Model" dropdown.
    page.locator("button.dropdown-btn").first.click()

    # Wait for the model list to be populated and visible.
    page.wait_for_selector('div.dropdown-item[data-value="qwen/qwen3-30b-a3b-2507"]')

    # Select the desired model from the dropdown.
    page.locator('div.dropdown-item[data-value="qwen/qwen3-30b-a3b-2507"]').click()

    # Fill in the MCP Server URL.
    page.get_by_label("MCP Server URL").fill("http://127.0.0.1:3000/mcp")

    # CRITICAL: Click the second "Refresh" button to load the tool definitions from the MCP server.
    page.get_by_role("button", name="Refresh").last.click()

    # Wait for the tool list to be populated by looking for the specific tool label within its container.
    tool_label_selector = '#agent-agent-default-toolSettings-allowed label:has-text("dt_get_datetime")'
    expect(page.locator(tool_label_selector)).to_be_visible(timeout=10000)
    page.screenshot(path="verification_debug_tools.png") # For verification

    # Click the "Chats" tab to return to the main chat view.
    page.get_by_role("button", name="Chats").click()

    # Start a new chat to ensure a clean state.
    page.get_by_role("button", name="New Chat").click()

    # 2. Act: Send a message to trigger the datetime tool.
    chat_input = page.get_by_placeholder("Type your message...")
    expect(chat_input).to_be_visible(timeout=5000)
    chat_input.fill("What's the current date and time?")
    chat_input.press("Enter")

    # 3. Assert: Verify the sequence of messages in the chat history.
    # The mock backend is very fast, so we wait for the final message and then verify the sequence.

    # Wait for the final assistant text response to ensure the entire sequence is complete.
    final_assistant_response = page.locator(".message.role-assistant .content").last
    expect(final_assistant_response).to_contain_text("The current date and time has been provided by the tool.", timeout=10000)

    # Verify the tool's JSON response (second-to-last message).
    tool_response_message = page.locator(".message.role-tool .content").last
    expect(tool_response_message).to_contain_text('"text": "', timeout=5000)

    # Verify the assistant's tool call message (the first assistant message).
    assistant_tool_call_message = page.locator(".message.role-assistant .content").first
    expect(assistant_tool_call_message).to_contain_text('<dma:tool_call name="dt_get_datetime"', timeout=10000)

    # Verify the initial user message.
    expect(page.locator(".message.role-user .message-content").last).to_have_text("What's the current date and time?", timeout=5000)

    # 4. Screenshot: Capture the final state for visual verification.
    page.screenshot(path="verification.png")

# Boilerplate to run the test from the command line.
if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_tool_chaining_and_final_response(page)
            print("Verification script finished successfully.")
            print("Screenshot saved to 'verification.png'.")
        except Exception as e:
            print(f"An error occurred during the test: {e}")
            page.screenshot(path="verification_error.png")
            print("Error screenshot saved to 'verification_error.png'.")
        finally:
            browser.close()
