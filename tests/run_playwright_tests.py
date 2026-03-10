from playwright.sync_api import sync_playwright
from test_utils import configure_agent, start_new_chat
from test_01_tool_success import test_tool_success
from test_02_tool_error import test_tool_error
from test_03_simple_flow import test_simple_flow
from test_04_agent_management import test_agent_management
from test_05_flow_ui import test_flow_ui
from test_06_token_count_flow_step import test_token_count_flow_step
from test_07_js_chat_data import test_js_chat_data
from test_08_js_tool_parser import test_js_tool_parser
from test_09_js_utils import test_js_utils
from test_10_api_config import test_api_config
from test_11_js_plugin_manager import test_js_plugin_manager
from test_12_js_data_manager import test_js_data_manager
from test_13_js_response_processor import test_js_response_processor
from test_14_js_api_service import test_js_api_service
from test_15_js_flow_runner import test_js_flow_runner
from test_16_js_settings_manager import test_js_settings_manager
from test_17_js_step_definitions import test_js_step_definitions

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

            # Test 4
            test_agent_management(page)
            print("test_agent_management passed.")

            # Test 5
            test_flow_ui(page)
            print("test_flow_ui passed.")

            # Test 6
            test_token_count_flow_step(page)
            print("test_token_count_flow_step passed.")

            # Test 7: JS ChatLog unit tests
            test_js_chat_data(page)
            print("test_js_chat_data passed.")

            # Test 8: JS parseToolCalls unit tests
            test_js_tool_parser(page)
            print("test_js_tool_parser passed.")

            # Test 9: JS utils & settings-manager unit tests
            test_js_utils(page)
            print("test_js_utils passed.")

            # Test 10: /api/config endpoint
            test_api_config(page)
            print("test_api_config passed.")

            # Test 11: JS PluginManager unit tests
            test_js_plugin_manager(page)
            print("test_js_plugin_manager passed.")

            # Test 12: JS DataManager unit tests
            test_js_data_manager(page)
            print("test_js_data_manager passed.")

            # Test 13: JS ResponseProcessor unit tests
            test_js_response_processor(page)
            print("test_js_response_processor passed.")

            # Test 14: JS ApiService unit tests
            test_js_api_service(page)
            print("test_js_api_service passed.")

            # Test 15: JS FlowRunner unit tests
            test_js_flow_runner(page)
            print("test_js_flow_runner passed.")

            # Test 16: JS SettingsManager unit tests
            test_js_settings_manager(page)
            print("test_js_settings_manager passed.")

            # Test 17: JS Step Definitions unit tests
            test_js_step_definitions(page)
            print("test_js_step_definitions passed.")

            print("All tests finished successfully.")
        except Exception as e:
            print(f"Error in tests: {e}")
            page.screenshot(path="test-results/verification_error.png")
            # raise
        finally:
            input("Press Enter to close the browser...")  # Keeps window open. For debug
            browser.close()
