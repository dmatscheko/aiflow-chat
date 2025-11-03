#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Define a cleanup function to be called on exit
cleanup() {
    echo "Cleaning up..."
    # Kill the background processes using their PIDs
    if [ -n "$MOCK_PID" ]; then
        kill $MOCK_PID
    fi
    if [ -n "$MAIN_PID" ]; then
        kill $MAIN_PID
    fi
    # Remove the temporary test configuration file
    if [ -f "mcp_config.test.json" ]; then
        rm mcp_config.test.json
    fi
    echo "Cleanup complete."
}

# Register the cleanup function to be called on script exit or interruption
trap cleanup EXIT

# 1. Create a temporary MCP config file with only the datetime tool
echo '{"dt": {"command": "uvx", "args": ["fastmcp", "run", "./_mcp_servers/datetime-mcp/datetime-mcp.py"]}}' > mcp_config.test.json

# 2. Start the mock AI backend in the background
echo "Starting mock AI backend..."
python mock_ai_backend.py > mock_backend.log 2>&1 &
MOCK_PID=$!
echo "Mock AI backend started with PID: $MOCK_PID"

# 3. Start the main application server with the test MCP config using 'uv run'
echo "Starting main application server..."
MCP_CONFIG=mcp_config.test.json uv run main.py > main_server.log 2>&1 &
MAIN_PID=$!
echo "Main server started with PID: $MAIN_PID"

# Wait for a few seconds to ensure both servers are up and running
echo "Waiting for servers to initialize..."
sleep 5

# 4. Run the Playwright test script
echo "Running Playwright test..."
python playwright_test.py

# The script will exit here, and the 'trap' will call the cleanup function.
echo "Test script finished."
