from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    page.goto("http://localhost:8000")

    # Wait for a specific element that appears late in the loading process
    page.wait_for_selector("button:has-text('New Chat')")

    # Open the flows tab
    page.click("text=Flows")

    # Add a new flow
    page.click("button:has-text('Add New')")

    # Add a consolidator step
    page.wait_for_selector("button:has-text('Add Step')")
    page.click("button:has-text('Add Step')")
    page.click("text=Alt. Consolidator")

    # Take a screenshot of the consolidator step
    page.screenshot(path="jules-scratch/verification/consolidator_step.png")

    # Enable history clearing
    page.check("input[data-key='clearHistory']")

    # Take a screenshot of the consolidator step with history clearing enabled
    page.screenshot(path="jules-scratch/verification/consolidator_step_with_history_clearing.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)