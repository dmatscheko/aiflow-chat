from playwright.sync_api import sync_playwright, expect

def run_verification(page):
    """
    Verifies the 'New Message Alternative' feature.
    """
    # 1. Navigate to the application and create a user message.
    page.goto("http://localhost:8000")
    page.locator('#message-input').fill("Hello, this is a test message.")
    page.locator('button[type="submit"]').click()

    # 2. Click the "New Message Alternative" button on the first user message.
    add_button = page.locator('.message.role-user .message-controls button[title="New Message Alternative"]')
    add_button.click()

    # 3. Verify that the message becomes editable and the controls show "2/2".
    expect(page.locator('.message.role-user .edit-in-place')).to_be_visible()
    expect(page.locator('.message.role-user .message-controls span').first).to_have_text(" 2/2 ")

    # 4. Take a screenshot of the editing state.
    page.screenshot(path="jules-scratch/verification/verification_editing.png")

    # 5. Type in the new message and click "Save".
    page.wait_for_selector('.edit-in-place textarea', state='visible')
    page.locator('.edit-in-place textarea').fill("This is a new alternative message.")
    page.locator('.edit-in-place button[title="Save"]').click()

    # 6. Verify that the new message is added and an assistant response is being generated.
    expect(page.locator('*:has-text("This is a new alternative message.")')).to_be_visible()
    expect(page.locator('.message.role-assistant .message-content:has-text("...")')).to_be_visible()

    # 7. Take a final screenshot.
    page.screenshot(path="jules-scratch/verification/verification_saved.png")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            run_verification(page)
            print("Verification script ran successfully.")
        except Exception as e:
            print(f"Verification script failed: {e}")
            page.screenshot(path="jules-scratch/verification/verification_error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    main()