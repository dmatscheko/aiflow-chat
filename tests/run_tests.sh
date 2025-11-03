#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Change to the project root directory
cd "$(dirname "$0")/.."

# Define a cleanup function to be called on exit
cleanup() {
    echo "Cleaning up..."
    # Kill servers by process name, which is more robust
    pkill -f "python tests/mock_ai_backend.py" || true
    pkill -f "uv run main.py" || true

    # Remove the temporary test configuration file
    if [ -f "test-results/mcp_config.test.json" ]; then
        rm test-results/mcp_config.test.json
    fi
    echo "Cleanup complete."
}

# Ensure servers from previous runs are stopped
pkill -f "python tests/mock_ai_backend.py" || true
pkill -f "uv run main.py" || true
# Add a small delay to allow ports to be released
sleep 1

# Register the cleanup function to be called on script exit or interruption
trap cleanup EXIT

# Create the test-results directory if it doesn't exist
mkdir -p test-results

# 1. Create a temporary MCP config file with only the datetime tool
echo '{"dt": {"command": "uvx", "args": ["fastmcp", "run", "./_mcp_servers/datetime-mcp/datetime-mcp.py"]}}' > test-results/mcp_config.test.json

# 2. Start the mock AI backend in the background
echo "Starting mock AI backend..."
python tests/mock_ai_backend.py > test-results/mock_backend.log 2>&1 &
MOCK_PID=$!
echo "Mock AI backend started with PID: $MOCK_PID"

# 3. Start the main application server with the test MCP config using 'uv run'
echo "Starting main application server..."
MCP_CONFIG=test-results/mcp_config.test.json uv run main.py > test-results/main_server.log 2>&1 &
MAIN_PID=$!
echo "Main server started with PID: $MAIN_PID"

# Wait for a few seconds to ensure both servers are up and running
echo "Waiting for servers to initialize..."
sleep 3

# 4. Run the Playwright test script
echo "Running Playwright test..."
python tests/playwright_test.py || (cat test-results/mock_backend.log && exit 1)


# The script will exit here, and the 'trap' will call the cleanup function.
echo "Test script finished."
