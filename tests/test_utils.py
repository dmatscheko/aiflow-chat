from playwright.sync_api import Page, expect


def configure_agent(page: Page):
    """Configure the Default Agent with mock AI backend and local MCP server."""
    # Navigate to Agents tab
    select_tab(page, "agent")

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
    expect(page.locator('#agent-agent-default-toolSettings-allowed label:has-text("dt_get_datetime")')).to_be_visible(timeout=10000)
    page.get_by_label("dt_get_datetime").check()

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


def select_tab(page: Page, tab_name: str):
    """Click on a tab in the right panel."""
    page.get_by_role("button", name=tab_name.capitalize() + "s").click()
    pane_locator = page.locator(f"#{tab_name}s-pane.active")
    expect(pane_locator).to_be_visible(timeout=5000)
    expect(pane_locator.locator(".list-pane-footer button:has-text('Add New " + tab_name.capitalize() + "')")).to_be_visible(timeout=5000)


# ------------ Flow helper functions ------------:


# A function for moving steps
def move_step(page, step_id, target_left, target_top):
    step = page.locator(f'#flow-node-container .flow-step-card[data-id="{step_id}"]')
    # Use low-level mouse API for dragging the step, as drag_to may not trigger due to event handling or sub-element interference
    box = step.bounding_box()
    # Drag from near the top-center to avoid potential inputs/buttons in the card body
    start_x = box["x"] + box["width"] / 2
    start_y = box["y"] + 10  # Offset from top to likely hit a draggable area
    current_left = step.evaluate("el => el.offsetLeft")
    current_top = step.evaluate("el => el.offsetTop")
    target_mouse_x = start_x + (target_left - current_left)
    target_mouse_y = start_y + (target_top - current_top)

    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(target_mouse_x, target_mouse_y)
    page.mouse.up()


# A function for connecting steps
def connect_steps(page, output_element, input_element):
    """Helper function to connect two steps by simulating drag from output to input connector."""
    connection_line_locator = page.locator("#flow-svg-layer line")
    current_count = connection_line_locator.count()

    output_box = output_element.bounding_box()
    input_box = input_element.bounding_box()
    output_center_x = output_box["x"] + output_box["width"] / 2
    output_center_y = output_box["y"] + output_box["height"] / 2
    input_center_x = input_box["x"] + input_box["width"] / 2
    input_center_y = input_box["y"] + input_box["height"] / 2

    # Optional: Move mouse to output for hover effect
    page.mouse.move(output_center_x, output_center_y)

    # Dispatch mousedown on output connector
    output_element.dispatch_event("mousedown", {"bubbles": True, "clientX": output_center_x, "clientY": output_center_y, "button": 0})

    # Wait for the temporary line to appear
    expect(connection_line_locator).to_have_count(current_count + 1, timeout=1000)

    # Dispatch mouseup on input connector
    input_element.dispatch_event("mouseup", {"bubbles": True, "clientX": input_center_x, "clientY": input_center_y, "button": 0})

    # Verify the connection was added (count remains increased by 1, as temp becomes permanent)
    expect(connection_line_locator).to_have_count(current_count + 1, timeout=5000)
