from playwright.sync_api import sync_playwright, expect
import os
import time

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()

    # Get the absolute path to index.html
    html_file_path = os.path.abspath('index.html')

    page.goto(f'file://{html_file_path}')

    # Give the UI time to load
    time.sleep(2)

    # Click the "Chats" tab
    try:
        chats_tab = page.locator('button#tab-btn-chats')
        chats_tab.click()
    except Exception as e:
        print(f"Error clicking chats tab: {e}")
        # try again after a delay
        time.sleep(5)
        chats_tab.click()


    # Wait for the chat container to be visible
    chat_container = page.locator("#chat-container")
    expect(chat_container).to_be_visible()

    # Inject content to test formatting
    page.evaluate('''() => {
        const chatlog = document.getElementById('chat-container');
        const message = document.createElement('div');
        message.className = 'message assistant';
        const content = document.createElement('div');
        content.className = 'message-content';
        content.innerHTML = `
<p>Here is an SVG:</p>
<pre class="hljs language-svg" data-plaintext="&lt;svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;100&quot; height=&quot;100&quot;&gt;&lt;circle cx=&quot;50&quot; cy=&quot;50&quot; r=&quot;40&quot; stroke=&quot;black&quot; stroke-width=&quot;3&quot; fill=&quot;red&quot; /&gt;&lt;/svg&gt;"><code>&lt;svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"&gt;
  &lt;circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red" /&gt;
&lt;/svg&gt;
</code></pre>
<p>Here is a LaTeX formula:</p>
<div class="hljs language-latex" data-plaintext="E = mc^2"><span class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span class="strut" style="height:0.6833em;"></span><span class="mord mathnormal">E</span><span class="mspace" style="margin-right:0.2778em;"></span><span class="mrel">=</span><span class="mspace" style="margin-right:0.2778em;"></span></span><span class="base"><span class="strut" style="height:0.7278em;vertical-align:-0.0833em;"></span><span class="mord mathnormal">m</span><span class="mord"><span class="mord mathnormal">c</span><span class="msupsub"><span class="vlist-t"><span class="vlist-r"><span class="vlist" style="height:0.7278em;"><span style="top:-3.063em;margin-right:0.05em;"><span class="pstrut" style="height:2.7em;"></span><span class="sizing reset-size6 size3 mtight"><span class="mord mtight">2</span></span></span></span></span></span></span></span></span></span></span></span></div>
        `;
        message.appendChild(content);
        chatlog.appendChild(message);
    }''')

    page.screenshot(path='jules-scratch/verification/verification.png')
    browser.close()

with sync_playwright() as playwright:
    run(playwright)