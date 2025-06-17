# CLT MCP Server

A Model Context Protocol (MCP) server that exposes CLT (Command Line Tester) functionality for automated testing of command-line applications. This server provides structured access to CLT's powerful testing capabilities through a standardized MCP interface.

## Features

- **Full MCP Protocol Compliance**: JSON-RPC 2.0 over stdin/stdout
- **Nine Comprehensive Tools**: Run tests, match patterns, refine outputs, get help, manage patterns, read/write/update/append structured tests
- **Pattern Matching**: Support for CLT's pattern syntax including `%{PATTERN}` and `#!/regex/!#`
- **Block Support**: Full support for reusable test blocks (`.recb` files) with relative paths
- **Docker Integration**: Execute tests in isolated Docker containers
- **Intelligent Error Reporting**: Detailed mismatch analysis and pattern suggestions
- **Structured Test Format**: AI-friendly JSON format for reading and writing test files

## Available Tools

The MCP server provides 9 comprehensive tools for CLT testing:

1. **run_test** - Execute CLT test files in Docker containers
2. **refine_output** - Suggest patterns for handling dynamic content
3. **test_match** - Compare expected vs actual output with pattern matching
4. **clt_help** - Get comprehensive CLT documentation and examples
5. **get_patterns** - Retrieve all available patterns for the current project
6. **read_test** - Convert .rec files to structured JSON format
7. **write_test** - Create .rec files from structured JSON format
8. **update_test** - Replace specific test steps in existing files
9. **append_test** - Add new test steps to existing files

## Installation and Building

```bash
# Clone the repository and navigate to the mcp directory
git clone https://github.com/manticoresoftware/clt.git
cd clt/mcp

# Build the MCP server
cargo build --release

# The binary will be available at: target/release/clt-mcp
```

## Usage

Start the MCP server with a Docker image:

```bash
# Auto-discover CLT in PATH
./target/release/clt-mcp --docker-image ghcr.io/manticoresoftware/manticore:test-kit-latest

# Use specific CLT binary path
./target/release/clt-mcp --docker-image ghcr.io/manticoresoftware/manticore:test-kit-latest --bin /path/to/clt

# Get help and see all options
./target/release/clt-mcp --help

# Check version
./target/release/clt-mcp --version
```

The `--docker-image` parameter sets the **default** Docker image that will be used for all test executions. However, this can be overridden on a per-test basis by specifying the `docker_image` parameter when calling the `run_test` tool.

### Command Line Arguments

- `--docker-image <IMAGE>` (required) - Docker image to use for test execution (e.g., ubuntu:20.04)
- `--bin <PATH>` (optional) - Path to CLT binary. If not provided, CLT will be auto-discovered in PATH
- `--help` - Show help information and usage
- `--version` - Show version information

The server reads JSON-RPC 2.0 messages from stdin and writes responses to stdout.

### Docker Image Configuration

The MCP server supports flexible Docker image configuration:

1. **Default Image**: Set with `--docker-image` when starting the server
2. **Per-Test Override**: Specify `docker_image` parameter in individual `run_test` calls

**Examples:**

```json
// Use default image (set at server startup)
{
  "name": "run_test",
  "arguments": {
    "test_file": "/path/to/test.rec"
  }
}

// Override with specific image for this test
{
  "name": "run_test", 
  "arguments": {
    "test_file": "/path/to/test.rec",
    "docker_image": "ubuntu:22.04"
  }
}
```

## MCP Protocol Implementation

### Initialize

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "client", "version": "1.0"}
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {"tools": {}},
    "serverInfo": {"name": "CLT MCP Server", "version": "0.1.0"}
  }
}
```

### Tools List

**Request:**
```json
{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "run_test",
        "description": "Execute a CLT test file and return results with error details. The docker_image parameter is optional and defaults to the image configured when starting the MCP server.",
        "input_schema": {
          "type": "object",
          "properties": {
            "test_file": {
              "type": "string",
              "description": "Path to the .rec test file"
            },
            "docker_image": {
              "type": "string",
              "description": "Docker image to use for test execution (optional, defaults to server startup image)"
            }
          },
          "required": ["test_file"]
        }
      },
      {
        "name": "refine_output",
        "description": "Suggest regex patterns to handle dynamic content in test outputs",
        "input_schema": {
          "type": "object",
          "properties": {
            "expected": {
              "type": "string",
              "description": "Expected output (may already contain regex patterns)"
            },
            "actual": {
              "type": "string",
              "description": "Actual output from test run"
            }
          },
          "required": ["expected", "actual"]
        }
      },
      {
        "name": "test_match",
        "description": "Compare expected vs actual output using CLT pattern matching",
        "input_schema": {
          "type": "object",
          "properties": {
            "expected": {
              "type": "string",
              "description": "Expected output with potential regex patterns"
            },
            "actual": {
              "type": "string",
              "description": "Actual output to compare"
            }
          },
          "required": ["expected", "actual"]
        }
      }
    ]
  }
}
```

## Tools

### 1. run_test

Executes a CLT test file and returns detailed results with comprehensive context.

**Input:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "run_test",
    "arguments": {
      "test_file": "/absolute/path/to/test.rec",
      "docker_image": "ubuntu:20.04"
    }
  }
}
```

**Note:** The `docker_image` parameter is optional. If not provided, it defaults to the image specified when starting the MCP server with `--docker-image`.

**Input (using default image):**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "run_test",
    "arguments": {
      "test_file": "/absolute/path/to/test.rec"
    }
  }
}
```

**Enhanced Output:**
```json
{
  "tool": "run_test",
  "description": "CLT test execution results",
  "test_file": "/path/to/test.rec",
  "docker_image": "ubuntu:20.04",
  "result": {
    "success": true,
    "errors": [],
    "summary": "Test passed successfully"
  },
  "help": {
    "success_meaning": "true = test passed, all commands executed and outputs matched expectations",
    "errors_meaning": "Array of specific mismatches between expected and actual outputs",
    "next_steps": "If test failed, use 'refine_output' tool to suggest patterns for dynamic content",
    "docker_image_info": "Test executed in Docker image: ubuntu:20.04 (default: ubuntu:18.04)"
  }
}
```

### 2. refine_output

Suggests regex patterns to handle dynamic content in test outputs with comprehensive examples.

**Enhanced Output:**
```json
{
  "tool": "refine_output",
  "description": "Pattern suggestions for handling dynamic content in test outputs",
  "result": {
    "refined_output": "Version: %{SEMVER}",
    "patterns_applied": [...],
    "suggestions": [...]
  },
  "help": {
    "pattern_types": {
      "named_patterns": "Use %{PATTERN_NAME} syntax. Available: SEMVER, IPADDR, DATE, TIME, NUMBER, PATH",
      "regex_patterns": "Use #!/regex/!# syntax. Example: #!/[0-9]+/!# for any number",
      "examples": {
        "version": "Replace '1.2.3' with '%{SEMVER}' or '#!/[0-9]+\\.[0-9]+\\.[0-9]+/!#'",
        "timestamp": "Replace '2023-12-25 14:30:22' with '%{DATE} %{TIME}' or '#!/[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/!#'",
        "process_id": "Replace 'PID: 1234' with 'PID: %{NUMBER}' or 'PID: #!/[0-9]+/!#'"
      }
    },
    "usage": "Copy the 'refined_output' and use it as the expected output in your .rec test file"
  }
}
```

### 3. test_match

Compares expected vs actual output using CLT's pattern matching with detailed context.

**Enhanced Output:**
```json
{
  "tool": "test_match",
  "description": "Pattern matching results using CLT's intelligent comparison engine",
  "comparison": {
    "expected": "Hello World",
    "actual": "Hello Universe"
  },
  "result": {
    "matches": false,
    "mismatches": [...],
    "summary": "Output does not match. Found 1 mismatch(es)"
  },
  "help": {
    "matches_meaning": "true = strings match (considering patterns), false = mismatch found",
    "mismatches_details": "Character-by-character differences with position and context",
    "pattern_support": "Understands %{PATTERN} and #!/regex/!# syntax for dynamic content",
    "next_steps": "If match fails, check mismatches array for specific differences, then use 'refine_output' to suggest patterns"
  }
}
```

### 4. clt_help

Comprehensive documentation about CLT concepts, file formats, and usage patterns.

**Input:**
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "clt_help",
    "arguments": {
      "topic": "overview"
    }
  }
}
```

**Available Topics:**
- `overview` - CLT introduction and key concepts
- `test_format` - Structured test format guide (AI-friendly JSON)
- `patterns` - Pattern syntax guide with examples
- `blocks` - Reusable test blocks (.recb files)
- `workflow` - Step-by-step testing workflow
- `examples` - Practical examples and use cases
- `troubleshooting` - Common issues and solutions
- `structured_tests` - AI-friendly JSON format for test creation

**Output Example:**
```json
{
  "topic": "CLT Overview",
  "description": "CLT (Command Line Tester) is a testing framework for command-line applications",
  "content": {
    "what_is_clt": "CLT allows you to record interactive command sessions...",
    "key_features": [...],
    "typical_workflow": [...],
    "file_types": {...}
  }
}
```

### 5. get_patterns

Retrieve all available patterns for the current CLT project.

**Input:**
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "get_patterns",
    "arguments": {}
  }
}
```

### 6. read_test

Read a CLT test file and return its structured representation as JSON.

**Input:**
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "read_test",
    "arguments": {
      "test_file": "/path/to/test.rec"
    }
  }
}
```

### 7. write_test

Write a CLT test file from structured JSON format.

**Input:**
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "write_test",
    "arguments": {
      "test_file": "/path/to/new_test.rec",
      "test_structure": {
        "description": "Simple hello world test",
        "steps": [
          {
            "type": "input",
            "args": [],
            "content": "echo 'Hello World'"
          },
          {
            "type": "output",
            "args": [],
            "content": "Hello World"
          }
        ]
      }
    }
  }
}
```
### 8. update_test

Replace specific test steps in an existing CLT test file.

**Input:**
```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "tools/call",
  "params": {
    "name": "update_test",
    "arguments": {
      "test_file": "/path/to/existing_test.rec",
      "old_test_structure": {
        "steps": [
          {
            "type": "input",
            "args": [],
            "content": "echo 'old command'"
          },
          {
            "type": "output",
            "args": [],
            "content": "old command"
          }
        ]
      },
      "new_test_structure": {
        "steps": [
          {
            "type": "input",
            "args": [],
            "content": "echo 'new command'"
          },
          {
            "type": "output",
            "args": [],
            "content": "new command"
          }
        ]
      }
    }
  }
}
```

### 9. append_test

Append new test steps to an existing CLT test file.

**Input:**
```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "method": "tools/call",
  "params": {
    "name": "append_test",
    "arguments": {
      "test_file": "/path/to/existing_test.rec",
      "test_structure": {
        "steps": [
          {
            "type": "comment",
            "args": [],
            "content": "Additional test steps"
          },
          {
            "type": "input",
            "args": [],
            "content": "echo 'appended command'"
          },
          {
            "type": "output",
            "args": [],
            "content": "appended command"
          }
        ]
      }
    }
  }
}
```
## Pattern Support

The MCP server supports CLT's pattern matching system:

### Named Patterns
Uses patterns defined in `.clt/patterns` file:
- `%{SEMVER}` - Semantic version numbers (e.g., 1.2.3)
- `%{IPADDR}` - IP addresses (e.g., 192.168.1.1)
- `%{DATE}` - Date format (e.g., 2023-12-25)
- `%{TIME}` - Time format (e.g., 14:30:22)
- `%{NUMBER}` - Any number
- `%{PATH}` - File paths

### Regex Patterns
Custom regex patterns using CLT syntax:
- `#!/[0-9]+/!#` - Any number
- `#!/[0-9]{4}-[0-9]{2}-[0-9]{2}/!#` - Date format
- `#!/[a-f0-9]{40}/!#` - SHA1 hash

## Error Handling

The server provides structured error responses:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid parameters: missing required field"
  }
}
```

Common error codes:
- `-32601` - Method not found
- `-32602` - Invalid parameters
- `-32603` - Internal error

## Architecture

The MCP server is implemented as a standalone Rust crate that reuses existing CLT components:

- **parser** crate - For parsing .rec files and compiling blocks
- **cmp** crate - For pattern matching and output comparison
- **similar** crate - For diff detection and pattern suggestions

### Code Reuse Strategy

1. **CLT Execution**: Uses `which` to find CLT executable in PATH
2. **Pattern Matching**: Imports and uses `cmp::PatternMatcher` directly
3. **File Parsing**: Uses `parser::compile()` and `parser::parse_statement()`
4. **No Duplication**: Extracts functions from existing crates without copy-paste

## Requirements

- Rust 1.70+ for building
- CLT executable in PATH
- Docker for running tests (when using run_test tool)
- `.clt/patterns` file for named pattern support (optional)

## Testing

The server can be tested using standard JSON-RPC 2.0 messages:

```bash
# Test initialize
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}}' | ./target/release/clt-mcp --docker-image test-image

# Test with custom CLT binary
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}}' | ./target/release/clt-mcp --docker-image test-image --bin /path/to/clt

# Test tools list
echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}' | ./target/release/clt-mcp --docker-image test-image

# Test pattern matching
echo '{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "test_match", "arguments": {"expected": "Hello", "actual": "Hello"}}}' | ./target/release/clt-mcp --docker-image test-image
```

## Integration

The CLT MCP Server can be integrated with any MCP-compatible client or IDE that supports the Model Context Protocol. It provides a standardized interface for CLT's testing capabilities while maintaining full compatibility with existing CLT workflows and pattern systems.