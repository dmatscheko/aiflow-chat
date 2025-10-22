
from playwright.sync_api import Page, expect

def verify_ui_centralization(page: Page):
    """
    This test verifies that the UI management has been centralized.
    It checks for the existence of the new UI manager elements and takes a screenshot.
    """
    # 1. Arrange: Go to the application's homepage.
    page.goto("http://localhost:8000")

    # 2. Assert: Check for the existence of the new UI manager elements.
    # Wait for the title bar inside the top panel to be rendered, which indicates async setup is complete.
    expect(page.locator("#top-panel .title-bar")).to_be_visible()

    # Now check the main panels
    expect(page.locator("#right-panel")).to_be_visible()
    expect(page.locator("#top-panel")).to_be_visible()

    # Check that the tabs are rendered
    expect(page.locator("#tab-list")).to_contain_text("Chats")
    expect(page.locator("#tab-list")).to_contain_text("Agents")
    expect(page.locator("#tab-list")).to_contain_text("Flows")

    # 3. Screenshot: Capture the final result for visual verification.
    page.screenshot(path="jules-scratch/verification/verification.png")

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    verify_ui_centralization(page)
    browser.close()
