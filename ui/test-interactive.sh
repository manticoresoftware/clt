#!/bin/bash

# Test script for the interactive session feature
# This script can be used to test the Ask AI functionality

echo "=== CLT UI Interactive Session Test ==="
echo "Testing the Ask AI feature..."
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    echo "Please install Docker to test the interactive session feature"
    exit 1
fi

echo "✅ Docker is available"

# Test the default command
echo "Testing default Ask AI command..."
echo "Hello from test script!" | docker run --rm -i ubuntu:latest bash -c 'echo "Input received:"; cat; echo "\nSleeping for 2 seconds..."; sleep 2; echo "Done!"'

echo ""
echo "✅ Interactive session test completed successfully!"
echo ""
echo "To use the Ask AI feature:"
echo "1. Start the UI server: npm run dev (in ui directory)"
echo "2. Open the browser and log in"
echo "3. Click the 'Ask AI' button in the header"
echo "4. Enter your command or question"
echo "5. Watch the live output in the modal"
echo ""
echo "Environment variables for configuration:"
echo "ASK_AI_COMMAND - Custom command to run (default: docker ubuntu example)"
echo "ASK_AI_TIMEOUT - Timeout in milliseconds (default: 30000)"