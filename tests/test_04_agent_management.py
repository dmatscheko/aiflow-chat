from playwright.sync_api import expect
from test_utils import select_tab


def test_agent_management_suite(page):
    """
    Test suite for agent management.
    """
    # 1. Test creating a new agent
    select_tab(page, "agents")
    page.click("#agents-pane .list-pane-footer button:has-text('Add New Agent')")
    expect(page.locator("#agents-pane .list-item:has-text('New Agent')")).to_be_visible()

    # 2. Test editing the agent's name
    editable_title_span = page.locator("h2.title span.editable-title-part")
    expect(editable_title_span).to_be_visible(timeout=5000)
    editable_title_span.click()

    title_input = page.locator("h2.title input")
    expect(title_input).to_be_visible(timeout=5000)
    title_input.fill("My Test Agent")
    page.keyboard.press("Enter")
    expect(page.locator("#agents-pane .list-item.active:has-text('My Test Agent')")).to_be_visible()

    # 3. Test deleting the agent
    active_item = page.locator("#agents-pane .list-item.active")
    active_item.hover()
    delete_button = active_item.locator(".delete-button")
    expect(delete_button).to_be_visible(timeout=5000)
    page.once("dialog", lambda dialog: dialog.accept())
    delete_button.click()
    expect(page.locator("#agents-pane .list-item:has-text('My Test Agent')")).not_to_be_visible()
