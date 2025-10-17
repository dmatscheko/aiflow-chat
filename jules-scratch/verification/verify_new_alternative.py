from playwright.sync_api import Page, expect, sync_playwright
import logging

logging.basicConfig(level=logging.INFO)
print("Starting verification script...")

def test_new_message_alternative(page: Page):
    """
    This test verifies that the "New Message Alternative" button
    correctly puts the message into edit mode and updates the
    alternative counter.
    """
    # Listen for console events and log them
    page.on("console", lambda msg: logging.info(f"CONSOLE: {msg.text}"))

    try:
        # 1. Arrange: Go to the application homepage.
        logging.info("Navigating to http://localhost:8000")
        page.goto("http://localhost:8000")
        logging.info("Navigation successful.")

        # 2. Act: Add a user message directly to the chat log and trigger a re-render.
        logging.info("Waiting for app to be initialized.")
        page.wait_for_function("window.app && window.app.chatManager")
        logging.info("Adding a user message to the chat log.")
        page.evaluate("""
            const chat = window.app.chatManager.getActiveChat();
            chat.log.addMessage({ role: 'user', content: 'Hello, world!' });
        """)
        logging.info("User message added.")

        # 3. Act: Wait for the user's message to appear in the main chat area, then click its "New Message Alternative" button.
        logging.info("Waiting for the user message to render in the main chat area.")
        user_message = page.locator("#chat-container .message.user")
        user_message.wait_for(state="visible")

        logging.info("Found user message. Clicking 'New Message Alternative'.")
        add_button = user_message.get_by_title("New Message Alternative")
        add_button.wait_for(state="visible")
        add_button.click()

        # 4. Assert: Confirm the message is in edit mode and the counter is updated.
        logging.info("Waiting for the message controls to update for virtual alternative.")
        status_span = user_message.locator(".message-controls span")
        expect(status_span).to_have_text(" 2/2 ")
        logging.info("Assertion successful.")

        # 5. Screenshot: Capture the final result for visual verification.
        screenshot_path = "jules-scratch/verification/verification.png"
        logging.info(f"Taking screenshot at {screenshot_path}")
        page.screenshot(path=screenshot_path)
        logging.info("Screenshot taken.")
        print("Verification script finished successfully.")

    except Exception as e:
        logging.error(f"An error occurred: {e}")
        # Take a screenshot even on failure to help debug
        page.screenshot(path="jules-scratch/verification/error.png")
        print("Verification script failed.")
        raise

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    test_new_message_alternative(page)
    browser.close()