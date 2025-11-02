
from playwright.sync_api import Page, expect, sync_playwright
import time

def test_tool_chaining_and_final_response(page: Page):
    """
    Tests the full chat interaction sequence by bypassing the UI for agent setup.
    1. Injects configuration directly into the application's JavaScript.
    2. Sends a message that requires a tool call ("What's the current datetime?").
    3. Verifies the complete user-assistant-tool-assistant message chain.
    """
    # 1. Arrange: Go to the chat application.
    page.goto("http://127.0.0.1:8000")

    # Use page.evaluate to directly manipulate the application's data manager.
    # This bypasses the complex UI interactions that were causing timeouts.
    page.evaluate("""() => {
        const agentManager = window.app.agentManager;
        const agentId = 'agent-default';
        agentManager.updateAgentProperty(agentId, 'modelSettings.apiUrl', 'http://127.0.0.1:8080/v1/chat/completions');
        agentManager.updateAgentProperty(agentId, 'modelSettings.model', 'mock-model');
        agentManager.updateAgentProperty(agentId, 'toolSettings.mcpServer', 'http://127.0.0.1:3000/mcp');
        console.log('Agent settings injected via page.evaluate');
    }""")

    # Navigate to the chat view and create a new chat to ensure the UI is ready.
    page.get_by_role("button", name="Chats").click()
    page.get_by_role("button", name="New Chat").click()

    # 2. Act: Send a message that will trigger the 'datetime' tool.
    chat_input = page.get_by_placeholder("Type your message...")
    expect(chat_input).to_be_visible(timeout=5000)
    chat_input.fill("What's the current datetime?")
    chat_input.press("Enter")

    # 3. Assert: Verify the entire sequence of messages.

    def expect_with_retry(locator, assertion, timeout=15000):
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                assertion(locator)
                return
            except AssertionError:
                time.sleep(0.5)
        assertion(locator) # Final attempt

    # Expect the initial user message.
    user_message_locator = page.locator(".message.role-user .message-content").last
    expect_with_retry(user_message_locator, lambda l: expect(l).to_have_text("What's the current datetime?"))

    # Expect the assistant's tool call message.
    assistant_tool_call_locator = page.locator(".message.assistant .content").last
    expect_with_retry(assistant_tool_call_locator, lambda l: expect(l).to_contain_text('<dma:tool_call name="dt_get_current_datetime"'))

    # Expect the tool response message.
    tool_response_locator = page.locator(".message.role-tool .content").last
    expect_with_retry(tool_response_locator, lambda l: expect(l).to_contain_text('"text": "202')) # Check for the start of a year

    # Expect the final assistant response.
    final_assistant_response_locator = page.locator(".message.role-assistant .content").last
    expect_with_retry(final_assistant_response_locator, lambda l: expect(l).to_contain_text("AI response to request:"))

    # 4. Screenshot: Capture the final state for visual verification.
    page.screenshot(path="verification/verification.png")
    print("Verification screenshot 'verification/verification.png' has been generated.")


# Boilerplate to run the test
if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_tool_chaining_and_final_response(page)
            print("✅ Playwright test passed!")
        except Exception as e:
            print(f"❌ Playwright test failed: {e}")
            page.screenshot(path="verification/verification_error.png")
            print("Error screenshot 'verification/verification_error.png' has been generated.")
            raise
        finally:
            browser.close()
