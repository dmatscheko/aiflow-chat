from playwright.sync_api import sync_playwright, Page, expect

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:8000")

    # Wait for the main chat container to be visible before proceeding
    expect(page.locator("#chat-container")).to_be_visible()

    # Click the Agents tab
    agents_tab = page.get_by_role("button", name="Agents")
    expect(agents_tab).to_be_visible()
    agents_tab.click()

    # Wait for the agent editor to appear
    expect(page.locator("#agent-editor-container")).to_be_visible()

    # Check for the placeholder text
    placeholder = page.locator('textarea[placeholder="A brief description of the agent\'s purpose and capabilities."]')
    expect(placeholder).to_be_visible()
    page.screenshot(path="jules-scratch/verification/01_placeholder_visible.png")

    # Click the refresh button and handle the alert
    page.on("dialog", lambda dialog: dialog.accept())
    refresh_button = page.get_by_role("button", name="Refresh")
    refresh_button.click()
    page.screenshot(path="jules-scratch/verification/02_alert_works.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
