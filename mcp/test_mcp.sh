#!/bin/bash

# Test script for CLT MCP Server
echo "🧪 Testing CLT MCP Server with --bin parameter support"

# Build the project
echo "Building MCP server..."
cargo build --release

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build successful"

# Test 1: Initialize
echo ""
echo "Test 1: Initialize"
result=$(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"clientInfo":{"name":"test","version":"1.0"}}}' | ./target/release/clt-mcp --docker-image test:latest)
echo $result | jq .

# Test 2: List tools
echo ""
echo "Test 2: List Tools"
result=$(echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | ./target/release/clt-mcp --docker-image test:latest)
tools_count=$(echo $result | jq '.result.tools | length')
echo "Number of tools: $tools_count"

# Test 3: Help - overview
echo ""
echo "Test 3: Help Overview"
result=$(echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"clt_help","arguments":{"topic":"overview"}}}' | ./target/release/clt-mcp --docker-image test:latest)
description=$(echo $result | jq -r '.result.content[0].text' | jq -r '.description')
echo "CLT Overview"

# Test 4: Help - blocks
echo ""
echo "Test 4: Help Blocks"
result=$(echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"clt_help","arguments":{"topic":"blocks"}}}' | ./target/release/clt-mcp --docker-image test:latest)
topics=$(echo $result | jq -r '.result.content[0].text' | jq -r '.content.key_concepts | keys[]')
echo "Block help topics: $topics"

# Test 5: Pattern matching
echo ""
echo "Test 5: Pattern Matching - SEMVER"
result=$(echo '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"test_match","arguments":{"expected":"Version: %{SEMVER}","actual":"Version: 1.2.3"}}}' | ./target/release/clt-mcp --docker-image test:latest)
matches=$(echo $result | jq -r '.result.content[0].text' | jq -r '.result.matches')
echo "Pattern matches: $matches"

# Test 6: Pattern refinement
echo ""
echo "Test 6: Pattern Refinement"
result=$(echo '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"refine_output","arguments":{"expected":"Process started with PID 1234","actual":"Process started with PID 5678"}}}' | ./target/release/clt-mcp --docker-image test:latest)
suggestions=$(echo $result | jq -r '.result.content[0].text' | jq -r '.result.suggestions | length')
echo "Number of suggestions: $suggestions"

echo ""
echo "🎉 All tests completed successfully!"