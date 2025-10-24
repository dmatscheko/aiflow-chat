
import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto("http://localhost:8000")

        # Navigate to the flows tab
        await page.click('button[data-tab-id="flows"]')

        # Wait for the flows pane to be active
        flows_pane_selector = '#flows-pane.active'
        await page.wait_for_selector(flows_pane_selector)

        # Add a new flow to ensure a list item exists
        await page.click(f'{flows_pane_selector} .add-new-button')

        # Wait for the new flow item to appear and click it
        new_flow_item = page.locator(f'{flows_pane_selector} .list-item').first
        await new_flow_item.wait_for(state="visible")
        await new_flow_item.click()

        # Add a new "Manual MCP Call" step
        add_step_button = page.get_by_role("button", name="Add Step ▾")
        await add_step_button.click()

        await page.click('a[data-step-type="manual-mcp-call"]')

        # Wait for the new step to be added
        await page.wait_for_selector('.flow-step-manual-mcp-call')

        # Take a screenshot of the new step
        await page.screenshot(path="jules-scratch/verification/verification.png")

        await browser.close()

asyncio.run(main())
