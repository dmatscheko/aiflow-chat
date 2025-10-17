from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()

    # Capture console logs
    page.on("console", lambda msg: print(f"CONSOLE: {msg}"))

    # Go to the app
    page.goto("http://localhost:8000")

    try:
        # Wait for the tabs to be loaded
        page.wait_for_selector("#sidebar-tabs", timeout=10000)

        # Screenshot of the Chats pane
        page.screenshot(path="jules-scratch/verification/chats-pane.png")

        # Click on the Agents tab and take a screenshot
        page.get_by_role("tab", name="Agents").click()
        page.screenshot(path="jules-scratch/verification/agents-pane.png")

        # Click on the Flows tab and take a screenshot
        page.get_by_role("tab", name="Flows").click()
        page.screenshot(path="jules-scratch/verification/flows-pane.png")

    except Exception as e:
        print(f"Error: {e}")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)