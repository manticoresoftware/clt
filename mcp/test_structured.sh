#!/bin/bash

# Test script for new MCP structured test tools

echo "🧪 Testing CLT MCP Server with new structured test tools..."

# Start the MCP server in the background
cd /Users/dk/Work/dev/manticore/clt/mcp
./target/debug/clt-mcp --docker-image ubuntu:22.04 &
MCP_PID=$!

# Give it a moment to start
sleep 2

# Test get_patterns tool
echo "📋 Testing get_patterns tool..."
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_patterns","arguments":{}}}' | nc -l 8080 &

# Test the tools list to see if our new tools are registered
echo "📋 Testing tools list..."
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' 

# Clean up
kill $MCP_PID 2>/dev/null

echo "✅ Test completed"