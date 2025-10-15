from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:8000")

        # Wait for the main UI to settle
        expect(page.locator("#message-input")).to_be_visible()

        page.fill("#message-input", "Hello, world!")

        # For debugging, let's see the page state
        page.screenshot(path="jules-scratch/verification/debug_screenshot.png")

        # Now wait for the token counter to appear and have updated text
        token_counter_locator = page.locator("#token-counter")
        expect(token_counter_locator).to_be_visible()

        # The count should update from the initial state
        expect(token_counter_locator).not_to_have_text("0 tokens", timeout=5000)

        # Final screenshot
        page.screenshot(path="jules-scratch/verification/token-counter.png")

        browser.close()

if __name__ == "__main__":
    run()