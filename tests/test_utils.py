from playwright.sync_api import Page, expect


def configure_agent(page: Page):
    """Configure the Default Agent with mock AI backend and local MCP server."""
    # Navigate to Agents tab
    page.get_by_role("button", name="Agents").click()
    expect(page.locator("#agents-pane.active")).to_be_visible(timeout=5000)

    # Select Default Agent
    page.get_by_role("listitem").filter(has_text="Default Agent").click()
    expect(page.locator("#agent-editor-container")).to_be_visible(timeout=5000)

    # Set API URL
    page.get_by_label("API URL").fill("http://127.0.0.1:8080")

    # Enable and refresh models
    page.get_by_label("Model:").check()
    refresh_button = page.get_by_role("button", name="Refresh").first
    expect(refresh_button).to_be_enabled(timeout=5000)
    refresh_button.click()

    # Select model from dropdown
    page.locator("button.dropdown-btn").first.click()
    model_locator = page.locator('div.dropdown-item[data-value="mock-model-1"]')
    expect(model_locator).to_be_visible(timeout=5000)
    model_locator.click()

    # For debugging: Screenshot after model selection
    # page.screenshot(path="test-results/debug_model.png")

    # Set MCP Server URL and refresh tools
    page.get_by_label("MCP Server URL").fill("http://127.0.0.1:3000/mcp")
    page.get_by_role("button", name="Refresh").last.click()

    # Configure tools: Uncheck 'Allow all' and enable specific tool
    page.get_by_label("Allow all available tools").uncheck()
    expect(page.locator('#agent-agent-default-toolSettings-allowed label:has-text("get_datetime")')).to_be_visible(timeout=10000)
    page.get_by_label("get_datetime").check()

    # For debugging: Screenshot after tool configuration
    # page.screenshot(path="test-results/debug_tools.png")


def start_new_chat(page: Page):
    """Switch to Chats tab and start a new conversation."""
    page.get_by_role("button", name="Chats").click()
    expect(page.get_by_role("button", name="New Chat")).to_be_visible(timeout=5000)
    page.get_by_role("button", name="New Chat").click()


def send_message(page: Page, message: str):
    """Send a message in the chat."""
    chat_input = page.get_by_placeholder("Type your message...")
    expect(chat_input).to_be_visible(timeout=5000)
    chat_input.fill(message)
    chat_input.press("Enter")
