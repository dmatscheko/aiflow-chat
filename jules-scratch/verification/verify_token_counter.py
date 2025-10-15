from playwright.sync_api import sync_playwright, expect
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        page.goto("http://localhost:8000")

        # Wait for the main panel to be visible
        expect(page.locator("#main-panel")).to_be_visible()

        # Give a moment for all scripts to load and execute
        time.sleep(1)

        # Check for the initial token count
        token_counter = page.locator("#token-counter")
        expect(token_counter).to_have_text("Tokens: 0")

        # Type into the message input and check the token count
        message_input = page.locator("#message-input")
        message_input.type("Hello, world!")
        message_input.evaluate("() => { this.dispatchEvent(new Event('input', { bubbles: true })) }")

        # Give a moment for the input event to be processed
        time.sleep(1)

        expect(token_counter).to_have_text("Tokens: 3")

        # Click the send button
        send_button = page.locator("#send-button")
        send_button.click()

        # Wait for the AI response to appear
        assistant_message = page.locator(".message-bubble[data-message-id*='assistant']")
        expect(assistant_message).to_be_visible(timeout=10000)

        # Wait for the token speed display to appear
        token_speed_display = assistant_message.locator(".token-speed-display")
        expect(token_speed_display).not_to_be_empty(timeout=10000)

        # Take a screenshot
        page.screenshot(path="jules-scratch/verification/verification.png")

    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)