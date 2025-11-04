from playwright.sync_api import sync_playwright
from test_utils import configure_agent, start_new_chat
from test_01_tool_success import test_tool_success
from test_02_tool_error import test_tool_error
from test_03_simple_flow import test_simple_flow

if __name__ == "__main__":
    with sync_playwright() as p:
        # browser = p.chromium.launch(channel="chrome", headless=False, args=["--disable-ipv6"])  # Could help with MacOS errors
        browser = p.chromium.launch(headless=False)  # For debug
        # browser = p.chromium.launch(headless=True)  # Normal test operation
        page = browser.new_page()
        page.goto("http://127.0.0.1:8000")
        configure_agent(page)  # Run once

        try:
            # Test 1
            start_new_chat(page)
            test_tool_success(page)
            print("test_tool_success passed.")

            # Test 2
            start_new_chat(page)
            test_tool_error(page)
            print("test_tool_error passed.")

            # Test 3
            start_new_chat(page)
            test_simple_flow(page)
            print("test_simple_flow passed.")

            print("All tests finished successfully.")
        except Exception as e:
            print(f"Error in tests: {e}")
        finally:
            input("Press Enter to close the browser...")  # Keeps window open
            browser.close()
