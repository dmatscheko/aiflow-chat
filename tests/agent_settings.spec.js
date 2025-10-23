const { test, expect } = require('@playwright/test');

test.describe('Agent Settings Auto-Save', () => {
  test('should auto-save agent settings on input', async ({ page }) => {
    await page.goto('http://localhost:8000');

    // Click the Agents tab
    await page.click('#panel-tabs >> text=Agents');

    // Click on the Default Agent
    await page.click('.list-pane-item:has-text("Default Agent")');

    // Change the description
    const descriptionTextarea = page.locator('#agent-agent-default-description');
    const originalDescription = await descriptionTextarea.inputValue();
    const newDescription = originalDescription + ' - edited';
    await descriptionTextarea.fill(newDescription);

    // Wait for the debounce save to complete
    await page.waitForTimeout(1000); // Wait for 1 second

    // Reload the page
    await page.reload();

    // Re-select the agent and verify the change
    await page.click('#panel-tabs >> text=Agents');
    await page.click('.list-pane-item:has-text("Default Agent")');
    const savedDescription = await page.locator('#agent-agent-default-description').inputValue();
    expect(savedDescription).toBe(newDescription);
  });
});
