from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True, args=['--no-sandbox'])
    context = browser.new_context()
    page = context.new_page()

    # Intercept network requests
    page.route('**/v1/models', lambda route: route.fulfill(
        status=200,
        content_type='application/json',
        body='{"data": [{"id": "mock-model-1"}, {"id": "mock-model-2"}]}'
    ))

    page.route('**/v1/chat/completions', lambda route: route.fulfill(
        status=200,
        content_type='text/event-stream',
        body='data: {"id": "chatcmpl-mock", "object": "chat.completion.chunk", "created": 123, "model": "mock-model-1", "choices": [{"delta": {"content": "This is a mock response."}, "index": 0, "finish_reason": null}]}\n\ndata: [DONE]\n\n'
    ))

    page.goto('http://localhost:8000')

    page.wait_for_selector('#message-input')

    page.fill('#message-input', 'Test message')
    page.click('button[type="submit"]')

    page.pause()

    page.wait_for_selector('.message.user')

    page.click('.message.user .message-controls .new-alternative-button')
    page.wait_for_selector('.message.user .edit-mode')

    page.fill('.message.user .edit-mode textarea', 'New alternative message')
    page.click('.message.user .edit-mode .save-button')

    page.wait_for_function("() => document.querySelector('.message.user .content').innerText.includes('New alternative message')")

    page.screenshot(path='jules-scratch/verification/verification.png')

    browser.close()

with sync_playwright() as playwright:
    run(playwright)