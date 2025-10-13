from playwright.sync_api import sync_playwright, expect, TimeoutError

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    try:
        page.goto("http://localhost:8000")
        page.click("text=Agents")

        # Use the data-id selector for the default agent
        default_agent_selector = '[data-id="agent-default"]'

        # Wait for the element to be visible
        page.wait_for_selector(default_agent_selector, timeout=10000)

        # Click it
        page.click(default_agent_selector)

        # Wait for the agent editor to be visible before taking the screenshot.
        agent_editor = page.locator("#agent-editor-container")
        expect(agent_editor).to_be_visible()

        page.screenshot(path="jules-scratch/verification/agent_settings.png")
    except TimeoutError:
        print("TimeoutError waiting for agent list to populate. The UI may not have rendered as expected.")
    finally:
        browser.close()