#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Cleanup Function ---
cleanup() {
    echo "Cleaning up background processes..."
    # Kill the processes using their PIDs
    if [ -n "$MOCK_AI_PID" ]; then
        kill "$MOCK_AI_PID" 2>/dev/null
    fi
    if [ -n "$MCP_PID" ]; then
        kill "$MCP_PID" 2>/dev/null
    fi
    # Ensure all child processes of this script are killed
    pkill -P $$
    echo "Cleanup complete."
}

# Trap EXIT signal to run cleanup function
trap cleanup EXIT

# --- Main Script ---
# Create verification directory if it doesn't exist
mkdir -p verification

# Start the Mock AI Server in the background
echo "Starting Mock AI Server..."
python3 testing/mock_ai_server.py &
MOCK_AI_PID=$!
echo "Mock AI Server PID: $MOCK_AI_PID"

# Start the MCP Proxy and the static file server in the background
echo "Starting MCP Proxy and Web Server..."
python3 main.py --load-mcp-server dt &
MCP_PID=$!
echo "MCP Proxy PID: $MCP_PID"

# Wait for the servers to initialize
echo "Waiting for servers to start..."
sleep 5

# Run the Playwright test script
echo "Running Playwright tests..."
python3 testing/test_chat.py
TEST_EXIT_CODE=$?
echo "Playwright tests finished with exit code: $TEST_EXIT_CODE"

# The cleanup function will be called automatically on exit.
# Exit with the test script's exit code.
exit $TEST_EXIT_CODE
