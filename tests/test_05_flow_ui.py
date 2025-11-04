from playwright.sync_api import expect
from test_utils import select_tab


def test_flow_ui(page):
    """Test flow UI creation and deletion"""

    # 1. Navigate to the "Flows" tab and create a new flow.
    select_tab(page, "flow")
    page.get_by_role("button", name="Add New Flow").click()

    # Wait for the editor to appear for the new flow
    expect(page.locator("#flow-editor-container[data-flow-id]")).to_be_visible(timeout=5000)
    expect(page.locator("h2.title span.editable-title-part")).to_contain_text("New Flow", timeout=5000)

    # 2. Add two "Simple Prompt" steps.
    add_step_button = page.get_by_role("button", name="Add Step")

    # Add first step
    add_step_button.click()
    page.locator('a[data-step-type="simple-prompt"]').click()

    # Add second step
    add_step_button.click()
    page.locator('a[data-step-type="simple-prompt"]').click()

    step_cards = page.locator("#flow-node-container .flow-step-card")
    expect(step_cards).to_have_count(2, timeout=5000)

    # Position the second step to make connecting easier
    second_step = step_cards.last

    # Use low-level mouse API for dragging the step, as drag_to may not trigger due to event handling or sub-element interference
    second_box = second_step.bounding_box()
    # Drag from near the top-center to avoid potential inputs/buttons in the card body
    start_x = second_box["x"] + second_box["width"] / 2
    start_y = second_box["y"] + 10  # Offset from top to likely hit a draggable area
    current_left = second_step.evaluate("el => el.offsetLeft")
    current_top = second_step.evaluate("el => el.offsetTop")
    target_left = 400
    target_top = 300
    target_mouse_x = start_x + (target_left - current_left)
    target_mouse_y = start_y + (target_top - current_top)

    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(target_mouse_x, target_mouse_y)
    page.mouse.up()

    # 3. Connect the two steps.
    first_step_output = step_cards.first.locator(".connector.bottom")
    second_step_input = second_step.locator(".connector.top")

    expect(first_step_output).to_be_visible(timeout=5000)
    expect(second_step_input).to_be_visible(timeout=5000)

    # Use dispatch_event for precise event targeting to ensure correct e.target
    output_box = first_step_output.bounding_box()
    input_box = second_step_input.bounding_box()
    output_center_x = output_box["x"] + output_box["width"] / 2
    output_center_y = output_box["y"] + output_box["height"] / 2
    input_center_x = input_box["x"] + input_box["width"] / 2
    input_center_y = input_box["y"] + input_box["height"] / 2

    # Optional: Move mouse to output for hover effect
    page.mouse.move(output_center_x, output_center_y)

    # Dispatch mousedown on output connector
    first_step_output.dispatch_event("mousedown", {"bubbles": True, "clientX": output_center_x, "clientY": output_center_y, "button": 0})

    # Wait for the temporary line to appear
    temp_line_locator = page.locator("#flow-svg-layer line")
    expect(temp_line_locator).to_have_count(1, timeout=1000)

    # Dispatch mouseup on input connector
    second_step_input.dispatch_event("mouseup", {"bubbles": True, "clientX": input_center_x, "clientY": input_center_y, "button": 0})

    # 4. Verify the connection was made.
    connection_line = page.locator("#flow-svg-layer line")
    delete_connection_button = page.locator(".delete-connection-btn")
    expect(connection_line).to_have_count(1, timeout=5000)
    expect(delete_connection_button).to_be_visible(timeout=5000)

    page.screenshot(path="test-results/verification_flow_ui.png")

    # 5. Delete the connection.
    delete_connection_button.click()
    expect(connection_line).to_have_count(0, timeout=5000)
    expect(delete_connection_button).not_to_be_visible(timeout=5000)

    # 6. Delete a step.
    # Re-locate step cards after potential re-renders
    step_cards = page.locator("#flow-node-container .flow-step-card")
    first_step_delete_button = step_cards.first.locator(".delete-flow-step-btn")
    expect(first_step_delete_button).to_be_visible(timeout=3000)
    first_step_delete_button.click(force=True, timeout=3000)
    expect(step_cards).to_have_count(1, timeout=5000)
