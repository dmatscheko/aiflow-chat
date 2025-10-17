from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:8000")

    # Verify that the right panel and its tabs are rendered
    expect(page.locator("#panel-tabs")).to_be_visible()
    expect(page.locator("#chats-tab")).to_be_visible()
    expect(page.locator("#agents-tab")).to_be_visible()
    expect(page.locator("#flows-tab")).to_be_visible()

    # Verify that the top panel is rendered
    expect(page.locator(".main-title-bar")).to_be_visible()

    page.screenshot(path="jules-scratch/verification/01-refactor-initial-view.png")

    browser.close()