from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto('http://localhost:8000')

    # Click the Agents tab
    page.get_by_role("tab", name="Agents").click()

    # Wait for the agents pane to be active and the list to be rendered
    agents_pane = page.locator('#agents-pane.active')
    expect(agents_pane).to_be_visible()

    # Click on the Default Agent
    default_agent_item = agents_pane.locator('.list-pane-item', has_text="Default Agent")
    expect(default_agent_item).to_be_visible()
    default_agent_item.click()

    # Wait for the editor to load for that agent
    editor_container = page.locator('#agent-editor-container[data-agent-id="agent-default"]')
    expect(editor_container).to_be_visible()

    # Change the description
    description_textarea = editor_container.locator('#agent-agent-default-description')
    expect(description_textarea).to_be_editable()

    original_description = description_textarea.input_value()
    new_description = "This is the edited description."
    description_textarea.fill(new_description)

    # Wait for the debounce save to complete
    page.wait_for_timeout(1000) # Wait for 1 second

    # Take a screenshot
    page.screenshot(path='jules-scratch/verification/verification.png')

    # Reload and verify
    page.reload()

    # Re-select the agent
    page.get_by_role("tab", name="Agents").click()
    expect(agents_pane).to_be_visible()
    default_agent_item = agents_pane.locator('.list-pane-item', has_text="Default Agent")
    expect(default_agent_item).to_be_visible()
    default_agent_item.click()

    # Verify the change persisted
    editor_container = page.locator('#agent-editor-container[data-agent-id="agent-default"]')
    expect(editor_container).to_be_visible()
    description_textarea = editor_container.locator('#agent-agent-default-description')
    expect(description_textarea).to_have_value(new_description)

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
