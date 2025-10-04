import re
from playwright.sync_api import Page, expect, sync_playwright


def test_tool_chaining_and_final_response(page: Page):
    """
    Tests the core refactoring:
    1. A user message triggers a tool call.
    2. The tool call is executed, and its response is displayed.
    3. The assistant generates a final response based on the tool's output.
    4. The message chain (user -> assistant (tool_call) -> tool_response -> assistant (final)) is correctly structured.
    """
    # 1. Arrange: Go to the chat application.
    page.goto("http://127.0.0.1:8000")

    # Ensure the default agent is set up to use the MCP tool server.
    # This requires navigating to the agent editor, setting the URL, and saving.

    # Click the "Agents" tab
    page.get_by_role("button", name="Agents").click()

    # Click the "Default Agent"
    page.get_by_role("listitem").filter(has_text="Default Agent").click()

    # Set the API URL
    mcp_url_input = page.get_by_label("API URL")
    mcp_url_input.fill("http://127.0.0.1:1234")

    page.wait_for_timeout(1000)  # Add a small delay to ensure UI is ready
    # Click the "Refresh" button to load the available models
    page.get_by_role("button", name="Refresh").first.click()
    page.wait_for_timeout(1000)  # Add a small delay to ensure UI is ready
    # Open the "Model" dropdown by clicking the dropdown button
    page.locator("button.dropdown-btn").first.click()
    page.wait_for_timeout(500)  # Add a small delay for the dropdown to open
    # Set the model
    page.locator('div.dropdown-item[data-value="qwen/qwen3-30b-a3b-2507"]').click()

    # Set the MCP Server URL
    mcp_url_input = page.get_by_label("MCP Server URL")
    mcp_url_input.fill("http://127.0.0.1:3000/mcp")

    # Click the "Chats" tab to go back to the chat view
    page.get_by_role("button", name="Chats").click()

    # Create a new chat, which makes the main chat view (and input) appear.
    page.get_by_role("button", name="New Chat").click()
    # Add a significant pause to ensure the UI has time to render the new chat view.
    page.wait_for_timeout(1000)  # Add a small delay to ensure UI is ready

    # 2. Act: Send a message that will trigger the 'datetime_get_current_datetime' tool.
    chat_input = page.get_by_placeholder("Type your message...")
    # Wait for the element to be visible before interacting with it.
    expect(chat_input).to_be_visible(timeout=2000)
    page.wait_for_timeout(1000)  # Add a small delay to ensure UI is ready
    chat_input.fill("What's the current date and time?")
    chat_input.press("Enter")

    # 3. Assert: Verify the entire sequence of messages.

    page.wait_for_timeout(1000)  # Add a small delay to ensure UI is ready
    # Expect the initial user message.
    expect(page.locator(".message.role-user .message-content").last).to_have_text("What's the current date and time?")

    page.wait_for_timeout(5000)  # Add a small delay to ensure UI is ready
    # Expect the assistant's tool call message.
    # It should contain the <dma:tool_call> tag.
    assistant_tool_call_message = page.locator(".message.assistant .content").last
    expect(assistant_tool_call_message).to_contain_text('<dma:tool_call name="datetime_get_current_datetime"')

    # Expect the tool response message.
    # The MCP server returns a JSON object, so we check for that structure.
    tool_response_message = page.locator(".message.role-tool .content").last
    expect(tool_response_message).to_contain_text('"text": "2025-')

    # Expect the final assistant response, which should summarize the tool's output.
    final_assistant_response = page.locator(".message.role-assistant .content").last
    # The exact wording can vary, so we check for key phrases.
    expect(final_assistant_response).to_contain_text("The current date and time is")

    # 4. Screenshot: Capture the final state of the chat for visual verification.
    page.screenshot(path="jules-scratch/verification/verification.png")


# Boilerplate to run the test
if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        test_tool_chaining_and_final_response(page)
        browser.close()
    print("Verification script finished and screenshot 'jules-scratch/verification/verification.png' has been generated.")