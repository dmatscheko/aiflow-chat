"""Playwright test for the /api/config endpoint."""

from playwright.sync_api import expect
import json


def test_api_config(page):
    # Fetch /api/config and verify it returns valid JSON with mcp_endpoint
    result = page.evaluate("""async () => {
        const response = await fetch('/api/config');
        const data = await response.json();
        return data;
    }""")

    assert "mcp_endpoint" in result, f"/api/config should contain mcp_endpoint, got: {result}"
    assert result["mcp_endpoint"].startswith("http://"), f"mcp_endpoint should be an HTTP URL, got: {result['mcp_endpoint']}"
    assert "/mcp" in result["mcp_endpoint"], f"mcp_endpoint should end with /mcp, got: {result['mcp_endpoint']}"

    page.screenshot(path="test-results/verification_api_config.png")
