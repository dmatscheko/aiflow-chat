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
    # # Log console messages from the page
    # page.on("console", lambda msg: print(f"Console: {msg.text} ({msg.type})"))

    # # Log page errors
    # page.on("pageerror", lambda err: print(f"Page error: {err}"))

    # # Log network requests/responses (useful if a resource is failing)
    # page.on("requestfailed", lambda req: print(f"Request failed: {req.url}"))
    # page.on("request", lambda req: print(f"Request started: {req.url} {req.method}"))
    # page.on("response", lambda res: print(f"Response: {res.url} {res.status} {res.ok}"))

    # Then do the goto
    page.goto("http://127.0.0.1:8000")

    # 1. Arrange: Go to the chat application.
    # page.goto("http://127.0.0.1:8000", wait_until="domcontentloaded", timeout=5000)

    # Click the "Agents" tab in the right panel.
    page.get_by_role("button", name="Agents").click()

    # Wait for the agent editor to fully load.
    page.wait_for_timeout(1000)

    # Click the "Default Agent" to open its editor.
    page.get_by_role("listitem").filter(has_text="Default Agent").click()

    # Wait for the Default Agent to fully load.
    page.wait_for_timeout(1000)

    # Fill in the API URL for the mock AI backend.
    page.get_by_label("API URL").fill("http://127.0.0.1:8080")

    # Check the "Model" checkbox to enable the refresh button
    page.get_by_label("Model:").check()

    # Wait for the Model dropdown to fully load.
    page.wait_for_timeout(100)

    # Click the "Refresh" button to load the models from the mock backend.
    page.get_by_role("button", name="Refresh").first.click()

    # Wait for the models to fully load.
    page.wait_for_timeout(1000)

    # Open the "Model" dropdown.
    page.locator("button.dropdown-btn").first.click()

    # Wait for the model list to be populated and visible.
    page.wait_for_selector('div.dropdown-item[data-value="qwen/qwen3-30b-a3b-2507"]')

    # Select the desired model from the dropdown.
    page.locator('div.dropdown-item[data-value="mock-model-1"]').click()

    # Fill in the MCP Server URL.
    page.get_by_label("MCP Server URL").fill("http://127.0.0.1:3000/mcp")

    # CRITICAL: Click the second "Refresh" button to load the tool definitions from the MCP server.
    page.get_by_role("button", name="Refresh").last.click()

    # Wait for the tools to fully load.
    page.wait_for_timeout(1000)

    # Uncheck allow all tools to show single tools
    page.get_by_label("Allow all available tools").uncheck()

    # Wait for the tool list to be populated by looking for the specific tool label within its container.
    tool_label_selector = '#agent-agent-default-toolSettings-allowed label:has-text("get_datetime")'
    expect(page.locator(tool_label_selector)).to_be_visible(timeout=10000)

    # Allow get_datetime
    page.get_by_label("get_datetime").check()

    page.screenshot(path="test-results/verification_debug_tools.png")  # For verification

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
    final_assistant_response = page.locator(".message.role-assistant .message-content").last
    expect(final_assistant_response).to_contain_text("The current date and time has been provided by the tool.", timeout=5000)

    # Open the tool call and response detail tags
    page.locator(".message.role-assistant .message-content .tool-call").last.click()
    page.locator(".message.role-tool .message-content .tool-response").last.click()

    # Verify the tool's JSON response (second-to-last message).
    tool_response_message = page.locator(".message.role-tool .message-content").last
    expect(tool_response_message).to_contain_text('"text": "', timeout=3000)

    # Verify the assistant's tool call message (the first assistant message).
    assistant_tool_call_message = page.locator(".message.role-assistant .message-content").first
    expect(assistant_tool_call_message).to_contain_text('<dma:tool_call name="get_datetime"', timeout=3000)

    # Verify the initial user message.
    expect(page.locator(".message.role-user .message-content").last).to_have_text("What's the current date and time?", timeout=3000)

    # 4. Screenshot: Capture the final state for visual verification.
    page.screenshot(path="test-results/verification.png")


# Boilerplate to run the test from the command line.
if __name__ == "__main__":
    with sync_playwright() as p:
        # browser = p.chromium.launch(channel="chrome", headless=False, args=["--disable-ipv6"])
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_tool_chaining_and_final_response(page)
            print("Verification script finished successfully.")
            print("Screenshot saved to 'test-results/verification.png'.")
        except Exception as e:
            print(f"An error occurred during the test: {e}")
            page.screenshot(path="test-results/verification_error.png")
            print("Error screenshot saved to 'test-results/verification_error.png'.")
            # input("Press Enter to close the browser...")  # Keeps window open
        finally:
            browser.close()
