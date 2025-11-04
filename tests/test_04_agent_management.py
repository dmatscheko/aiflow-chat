from playwright.sync_api import expect
from test_utils import select_tab


def test_agent_management(page):
    """
    Test suite for agent management.
    """
    select_tab(page, "agent")

    # 1. Test creating a new agent
    page.click("#agents-pane .list-pane-footer button:has-text('Add New Agent')")
    expect(page.locator("#agents-pane .list-item:has-text('New Agent')")).to_be_visible()

    # 2. Test editing the agent's name
    editable_title_span = page.locator("h2.title span.editable-title-part")
    expect(editable_title_span).to_be_visible(timeout=5000)
    editable_title_span.click()

    # Wait until the input field is visible
    title_input = page.locator("h2.title input.edit-in-place-input")
    expect(title_input).to_be_visible(timeout=5000)

    # Edit the name
    title_input.fill("My Test Agent")
    page.keyboard.press("Enter")

    # Verify the name has been updated in the list and the title
    expect(page.locator("#agents-pane .list-item.active:has-text('My Test Agent')")).to_be_visible()
    expect(editable_title_span).to_have_text("My Test Agent")

    # 3. Edit the agent's system prompt
    system_prompt_input = page.get_by_label("System Prompt:")
    expect(system_prompt_input).to_be_visible()
    system_prompt_input.fill("You are a test agent.")

    # To ensure the debounced save has completed, navigate away and back
    select_tab(page, "chat")
    select_tab(page, "agent")

    # Re-select the agent to verify its content is saved
    page.locator("#agents-pane .list-item", has_text="My Test Agent").click()

    # Verify the prompt was saved
    expect(system_prompt_input).to_have_value("You are a test agent.")

    page.screenshot(path="test-results/verification_agent_management_a.png")

    # 3. Test deleting the agent
    active_item = page.locator("#agents-pane .list-item.active")
    active_item.hover()
    delete_button = active_item.locator(".delete-button")
    expect(delete_button).to_be_visible(timeout=5000)
    page.once("dialog", lambda dialog: dialog.accept())

    # Click the delete button within the list item
    delete_button.click()

    # Verify the agent is no longer in the list
    expect(page.locator("#agents-pane .list-item:has-text('My Test Agent')")).not_to_be_visible()

    page.screenshot(path="test-results/verification_agent_management_b.png")
