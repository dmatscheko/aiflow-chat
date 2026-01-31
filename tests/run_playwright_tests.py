from playwright.sync_api import sync_playwright
from test_utils import configure_agent, start_new_chat
from test_01_tool_success import test_tool_success
from test_02_tool_error import test_tool_error
from test_03_simple_flow import test_simple_flow
from test_04_agent_management import test_agent_management
from test_05_flow_ui import test_flow_ui
from test_06_token_count_flow_step import test_token_count_flow_step

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
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

            # Test 4
            test_agent_management(page)
            print("test_agent_management passed.")

            # Test 5
            test_flow_ui(page)
            print("test_flow_ui passed.")

            # Test 6
            test_token_count_flow_step(page)
            print("test_token_count_flow_step passed.")

            print("All tests finished successfully.")
        except Exception as e:
            print(f"Error in tests: {e}")
            page.screenshot(path="test-results/verification_error.png")
            raise
        finally:
            browser.close()
