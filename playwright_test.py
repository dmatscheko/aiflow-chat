
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

    # Wait for and verify the initial user message.
    expect(page.locator(".message.role-user .message-content").last).to_have_text("What's the current date and time?", timeout=5000)

    # Wait for and verify the assistant's tool call message.
    assistant_tool_call_message = page.locator(".message.assistant .content").last
    expect(assistant_tool_call_message).to_contain_text('<dma:tool_call name="get_datetime"', timeout=10000)

    # Wait for and verify the tool's response message.
    tool_response_message = page.locator(".message.role-tool .content").last
    expect(tool_response_message).to_contain_text('"text": "', timeout=5000) # Check for the JSON structure.

    # Wait for and verify the final assistant response.
    final_assistant_response = page.locator(".message.role-assistant .content").last
    # The mock response is now specific, so we check for its signature text.
    expect(final_assistant_response).to_contain_text("The current date and time has been provided by the tool.", timeout=10000)

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
