from playwright.sync_api import expect
from test_utils import select_tab, move_step, connect_steps


def test_token_count_flow_step(page):
    """Test that the 'Token Count Branch' flow step UI is correct."""

    # Navigate to the "Flows" tab
    select_tab(page, "flow")

    # Delete any existing flows named "New Flow"
    new_flow_items = page.locator('#flows-pane .list-item:has(span:has-text("New Flow"))')
    count = new_flow_items.count()
    for i in range(count):
        item = new_flow_items.nth(i)
        item.hover()
        delete_button = item.locator(".delete-button")
        expect(delete_button).to_be_visible(timeout=5000)
        page.once("dialog", lambda dialog: dialog.accept())
        delete_button.click()
        # Wait briefly for the list to update
        expect(item).not_to_be_visible(timeout=5000)

    # 1. Create a new flow
    page.get_by_role("button", name="Add New Flow").click()

    # Wait for the editor to appear for the new flow
    expect(page.locator("#flow-editor-container[data-flow-id]")).to_be_visible(timeout=5000)
    expect(page.locator("h2.title span.editable-title-part")).to_contain_text("New Flow", timeout=5000)

    # 2. Test editing the flow's name
    editable_title_span = page.locator("h2.title span.editable-title-part")
    expect(editable_title_span).to_be_visible(timeout=5000)
    editable_title_span.click()

    # Wait until the input field is visible
    title_input = page.locator("h2.title input.edit-in-place-input")
    expect(title_input).to_be_visible(timeout=5000)

    # Edit the name
    title_input.fill("Token Count Test Flow")
    page.keyboard.press("Enter")

    # Verify the name has been updated in the list and the title
    expect(page.locator("#flows-pane .list-item.active:has-text('Token Count Test Flow')")).to_be_visible()
    expect(editable_title_span).to_have_text("Token Count Test Flow")

    # 3. Add a "Token Count Branch" step.
    add_step_button = page.get_by_role("button", name="Add Step")
    add_step_button.click()
    page.locator('a[data-step-type="token-count-branch"]').click()

    # Verify the step card is rendered correctly.
    step_card = page.locator("#flow-node-container .flow-step-card")
    expect(step_card).to_have_count(1, timeout=5000)

    # Check for the title
    expect(step_card.locator("h4")).to_contain_text("Token Count Branch")

    # Check for the number input
    token_count_input = step_card.locator('input[type="number"][data-key="tokenCount"]')
    expect(token_count_input).to_be_visible()
    expect(token_count_input).to_have_value("500")  # Default value

    # 4. Verify the output connectors.
    output_connectors = step_card.locator(".connector-group.labels .connector")
    expect(output_connectors).to_have_count(2)

    over_connector = output_connectors.filter(has_text="Over")
    under_connector = output_connectors.filter(has_text="Under")

    expect(over_connector).to_be_visible()
    expect(under_connector).to_be_visible()

    # 5. Add two "Simple Prompt" steps.
    # Add first step
    add_step_button.click()
    page.locator('a[data-step-type="simple-prompt"]').click()

    # Add second step
    add_step_button.click()
    page.locator('a[data-step-type="simple-prompt"]').click()

    step_cards = page.locator("#flow-node-container .flow-step-card")
    expect(step_cards).to_have_count(3, timeout=5000)

    # Locate steps based on titles
    token_step = step_cards.filter(has=page.locator("h4", has_text="Token Count Branch"))
    expect(token_step).to_be_visible()

    simple_steps = step_cards.filter(has=page.locator("h4", has_text="Simple Prompt"))
    expect(simple_steps).to_have_count(2)

    simple1_step = simple_steps.first
    simple2_step = simple_steps.last

    # Get IDs
    token_id = token_step.get_attribute("data-id")
    simple1_id = simple1_step.get_attribute("data-id")
    simple2_id = simple2_step.get_attribute("data-id")

    # Set distinguishing values
    token_input = token_step.locator('input[type="number"]')
    token_input.fill("520")
    expect(token_input).to_have_value("520")

    simple1_textarea = simple1_step.locator("textarea")
    simple1_textarea.fill("Please write a short poem")
    expect(simple1_textarea).to_have_value("Please write a short poem")

    simple2_textarea = simple2_step.locator("textarea")
    simple2_textarea.fill("Please write another short poem :)")
    expect(simple2_textarea).to_have_value("Please write another short poem :)")

    # Move the topmost step (simple2) to the bottom
    move_step(page, simple2_id, 100, 335)

    # Now move the next topmost step (simple1) to a temporary position to expose the token step
    move_step(page, simple1_id, 100, 200)

    # Now move the token count branch step to the bottom right
    move_step(page, token_id, 500, 360)

    # Now move the step simple1 back to its original position
    move_step(page, simple1_id, 100, 10)

    # Re-locate steps using data-ids to ensure fresh locators after moves
    token_step = page.locator(f'.flow-step-card[data-id="{token_id}"]')
    simple1_step = page.locator(f'.flow-step-card[data-id="{simple1_id}"]')
    simple2_step = page.locator(f'.flow-step-card[data-id="{simple2_id}"]')

    # Add connections
    # From simple1 output to token input
    simple1_output = simple1_step.locator(".connector.bottom")
    token_input = token_step.locator(".connector.top")
    connect_steps(page, simple1_output, token_input)

    # From simple2 output to token input
    simple2_output = simple2_step.locator(".connector.bottom")
    connect_steps(page, simple2_output, token_input)

    # From token under output to simple2 input
    token_under_output = token_step.locator(".connector-group.labels .connector").filter(has_text="Under")
    simple2_input = simple2_step.locator(".connector.top")
    connect_steps(page, token_under_output, simple2_input)

    # Verify connections
    connection_lines = page.locator("#flow-svg-layer line")
    expect(connection_lines).to_have_count(3, timeout=5000)
    delete_buttons = page.locator(".delete-connection-btn")
    expect(delete_buttons).to_have_count(3, timeout=5000)

    # Take a screenshot for visual confirmation.
    page.screenshot(path="test-results/verification_token_count_flow_step.png")
