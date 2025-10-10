import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Construct the file path to index.html
        file_path = "file://" + os.path.abspath("index.html")
        await page.goto(file_path)

        # Wait for the chat container to be populated
        await page.wait_for_selector(".message-content")

        # Give it a moment to render KaTeX
        await asyncio.sleep(1)

        # Take a screenshot
        await page.screenshot(path="jules-scratch/verification/verification.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())