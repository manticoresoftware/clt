mod mcp_protocol;
mod pattern_refiner;
mod test_runner;

use crate::mcp_protocol::*;
use parser::{TestStep, TestStructure};
use pattern_refiner::PatternRefiner;
use test_runner::TestRunner;

use anyhow::Result;
use clap::Parser;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader as AsyncBufReader};

/// CLT MCP Server - Model Context Protocol server for Command Line Tester
#[derive(Parser, Debug)]
#[command(
    name = "clt-mcp",
    version = "0.1.0",
    about = "MCP server for CLT (Command Line Tester) integration",
    long_about = "A Model Context Protocol server that provides tools for automated testing \
                  of CLI applications in Docker containers with pattern matching support."
)]
struct Args {
    /// Docker image to use for test execution
    #[arg(
        long = "docker-image",
        help = "Docker image to use for test execution (e.g., ubuntu:20.04)",
        value_name = "IMAGE"
    )]
    docker_image: String,

    /// Path to CLT binary (optional, auto-discovered if not provided)
    #[arg(
        long = "bin",
        help = "Path to CLT binary. If not provided, CLT will be auto-discovered in PATH",
        value_name = "PATH"
    )]
    clt_binary_path: Option<String>,

    /// Working directory path for test resolution (defaults to current directory)
    #[arg(
        long = "workdir-path",
        help = "Working directory path for test file resolution. If not specified, uses current working directory",
        value_name = "PATH"
    )]
    workdir_path: Option<String>,
}

#[derive(Debug)]
struct McpServer {
    #[allow(dead_code)]
    docker_image: String,
    clt_binary_path: Option<String>,
    workdir_path: String,
    test_runner: TestRunner,
    pattern_refiner: PatternRefiner,
}

impl McpServer {
    fn new(
        docker_image: String,
        clt_binary_path: Option<String>,
        workdir_path: Option<String>,
    ) -> Result<Self> {
        // Resolve working directory - use provided path or current directory
        let workdir_path = match workdir_path {
            Some(path) => {
                let path_buf = std::path::PathBuf::from(&path);
                if !path_buf.exists() {
                    return Err(anyhow::anyhow!(
                        "Working directory does not exist: {}",
                        path
                    ));
                }
                if !path_buf.is_dir() {
                    return Err(anyhow::anyhow!(
                        "Working directory path is not a directory: {}",
                        path
                    ));
                }
                // Convert to absolute path
                std::fs::canonicalize(path_buf)
                    .map_err(|e| {
                        anyhow::anyhow!("Failed to resolve working directory path: {}", e)
                    })?
                    .to_string_lossy()
                    .to_string()
            }
            None => {
                // Use current working directory
                std::env::current_dir()
                    .map_err(|e| anyhow::anyhow!("Failed to get current working directory: {}", e))?
                    .to_string_lossy()
                    .to_string()
            }
        };

        let test_runner = TestRunner::new(
            docker_image.clone(),
            clt_binary_path.clone(),
            workdir_path.clone(),
        )?;
        let pattern_refiner = PatternRefiner::new()?;

        Ok(Self {
            docker_image,
            clt_binary_path,
            workdir_path,
            test_runner,
            pattern_refiner,
        })
    }

    async fn run(&mut self) -> Result<()> {
        let stdin = tokio::io::stdin();
        let mut reader = AsyncBufReader::new(stdin);
        let mut stdout = tokio::io::stdout();

        let mut line = String::new();
        loop {
            line.clear();

            // Handle EOF or read errors gracefully
            let bytes_read = match reader.read_line(&mut line).await {
                Ok(0) => break, // EOF - client disconnected
                Ok(n) => n,
                Err(e) => {
                    // Check if it's a broken pipe or connection reset
                    if e.kind() == std::io::ErrorKind::BrokenPipe
                        || e.kind() == std::io::ErrorKind::ConnectionReset
                        || e.kind() == std::io::ErrorKind::ConnectionAborted
                    {
                        // Client disconnected - exit gracefully
                        break;
                    }
                    // For other errors, continue trying
                    continue;
                }
            };

            if bytes_read == 0 {
                break; // EOF
            }

            // Parse JSON and handle errors properly
            let response = match serde_json::from_str::<McpRequest>(line.trim()) {
                Ok(request) => self.handle_request(request).await,
                Err(_) => {
                    // Send error response for malformed JSON
                    McpResponse::error(None, -32700, "Parse error: Invalid JSON".to_string())
                }
            };

            // Send response with proper error handling
            if let Err(e) = self.send_response(&mut stdout, &response).await {
                // Check if it's a broken pipe or connection issue
                if e.kind() == std::io::ErrorKind::BrokenPipe
                    || e.kind() == std::io::ErrorKind::ConnectionReset
                    || e.kind() == std::io::ErrorKind::ConnectionAborted
                {
                    // Client disconnected - exit gracefully
                    break;
                }
                // For other errors, continue trying
                continue;
            }
        }

        Ok(())
    }

    async fn send_response(
        &self,
        stdout: &mut tokio::io::Stdout,
        response: &McpResponse,
    ) -> std::io::Result<()> {
        let response_json = serde_json::to_string(response)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        stdout.write_all(response_json.as_bytes()).await?;
        stdout.write_all(b"\n").await?;
        stdout.flush().await?;

        Ok(())
    }

    async fn handle_request(&mut self, request: McpRequest) -> McpResponse {
        match request.method.as_str() {
            "initialize" => self.handle_initialize(request.id, request.params),
            "tools/list" => self.handle_tools_list(request.id),
            "tools/call" => self.handle_tools_call(request.id, request.params).await,
            _ => McpResponse::error(
                request.id,
                -32601,
                format!("Method not found: {}", request.method),
            ),
        }
    }

    fn handle_initialize(&self, id: Option<Value>, _params: Option<Value>) -> McpResponse {
        let result = InitializeResult {
            protocol_version: "2024-11-05".to_string(),
            capabilities: ServerCapabilities {
                tools: Some(HashMap::new()),
            },
            server_info: ServerInfo {
                name: "CLT MCP Server".to_string(),
                version: "0.1.0 - Command Line Tester integration for automated testing of CLI applications in Docker containers with pattern matching support".to_string(),
            },
        };

        McpResponse::success(id, json!(result))
    }

    fn handle_tools_list(&self, id: Option<Value>) -> McpResponse {
        let tools = vec![
            McpTool {
                name: "run_test".to_string(),
                description: format!("Execute a CLT test file in a Docker container and return the results. Compares actual output with expected output and reports success/failure. The docker_image parameter is optional and defaults to '{}' (configured when the MCP server was started).", self.docker_image),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "test_file": {
                            "type": "string",
                            "description": "Path to the test file to execute"
                        },
                        "docker_image": {
                            "type": "string",
                            "description": format!("Docker image to use for test execution. Optional - defaults to '{}' if not specified.", self.docker_image),
                            "default": self.docker_image
                        }
                    },
                    "required": ["test_file"],
                    "additionalProperties": false
                }),
            },
            McpTool {
                name: "refine_output".to_string(),
                description: "Analyze differences between expected and actual command outputs, then suggest patterns to handle dynamic content. This tool uses diff analysis to identify parts that change between test runs (like timestamps, PIDs, version numbers) and suggests compatible patterns to make tests more robust. Use this when test outputs contain dynamic data that changes between runs.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "expected": {
                            "type": "string",
                            "description": "The expected output string from your test. This can already contain patterns for dynamic content. Example: 'Process started with PID 1234'"
                        },
                        "actual": {
                            "type": "string",
                            "description": "The actual output string that was produced during test execution. This is what you want to compare against the expected output. Example: 'Process started with PID 5678'"
                        }
                    },
                    "required": ["expected", "actual"],
                    "additionalProperties": false
                }),
            },
            McpTool {
                name: "test_match".to_string(),
                description: "Compare expected vs actual output strings using pattern matching. This tool understands pattern syntax and performs intelligent matching that can handle dynamic content. It returns a clear line-by-line diff showing exactly what differs between expected and actual output, similar to git diff format. Use this to validate if test outputs match expectations, especially when they contain patterns for dynamic data.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "expected": {
                            "type": "string",
                            "description": "Expected output string with optional patterns. Patterns can match dynamic content like version numbers, IP addresses, dates, times, and custom regex patterns. Example: 'Server started on %{IPADDR} at %{TIME}'"
                        },
                        "actual": {
                            "type": "string",
                            "description": "Actual output string to compare against the expected pattern. This should be the literal text output from your command or application. Example: 'Server started on 192.168.1.100 at 14:30:22'"
                        }
                    },
                    "required": ["expected", "actual"],
                    "additionalProperties": false
                }),
            },
            McpTool {
                name: "clt_help".to_string(),
                description: "Get comprehensive documentation about CLT (Command Line Tester) concepts, testing workflows, pattern syntax, and examples. This tool provides detailed explanations of how CLT works and step-by-step examples for common testing scenarios. Use this to understand CLT concepts before using other tools.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "topic": {
                            "type": "string",
                            "description": "Help topic to explain. Options: 'overview' (CLT introduction), 'test_format' (structured test format guide), 'patterns' (pattern syntax guide), 'blocks' (reusable test blocks), 'workflow' (testing workflow), 'examples' (practical examples), 'troubleshooting' (common issues), 'structured_tests' (AI-friendly JSON format)",
                            "enum": ["overview", "test_format", "patterns", "blocks", "workflow", "examples", "troubleshooting", "structured_tests"]
                        }
                    },
                    "required": ["topic"],
                    "additionalProperties": false
                }),
            },
            McpTool {
                name: "get_patterns".to_string(),
                description: "Get all available patterns for the current CLT project. Returns predefined patterns that can be used in test outputs for dynamic content matching.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }),
            },
            McpTool {
                name: "read_test".to_string(),
                description: "Read a CLT test file and return its structured representation. The test is returned as a sequence of steps including commands, expected outputs, comments, and reusable blocks.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "test_file": {
                            "type": "string",
                            "description": "Path to the test file to read"
                        }
                    },
                    "required": ["test_file"],
                    "additionalProperties": false
                }),
            },
            McpTool {
                name: "write_test".to_string(),
                description: "Write a CLT test file from structured format. Creates a test file that can be executed with run_test. Supports commands, expected outputs, comments, and reusable blocks.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "test_file": {
                            "type": "string",
                            "description": "Path where the test file should be written"
                        },
                        "test_structure": {
                            "type": "object",
                            "description": "Structured test definition",
                            "properties": {
                                "description": {
                                    "type": "string",
                                    "description": "Optional description text that appears at the beginning of the test file. Can be multiline."
                                },
                                "steps": {
                                    "type": "array",
                                    "description": "Sequence of test steps",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "type": {
                                                "type": "string",
                                                "enum": ["input", "output", "comment", "block"],
                                                "description": "Type of step: input (command to execute), output (expected result), comment (documentation), block (reusable test sequence)"
                                            },
                                            "args": {
                                                "type": "array",
                                                "items": {"type": "string"},
                                                "description": "Arguments for the statement. For output: optional custom checker name. For block: relative path to block file."
                                            },
                                            "content": {
                                                "type": ["string", "null"],
                                                "description": "Content of the step. Command text for input, expected output for output, comment text for comment, null for block."
                                            },
                                            "steps": {
                                                "type": "array",
                                                "description": "Nested steps for block types (resolved block content)"
                                            }
                                        },
                                        "required": ["type", "args"]
                                    }
                                }
                            },
                            "required": ["steps"]
                        }
                    },
                    "required": ["test_file", "test_structure"],
                    "additionalProperties": false
                }),
            },
            McpTool {
                name: "update_test".to_string(),
                description: "Replace specific test steps in an existing CLT test file. Finds the old test structure and replaces it with the new test structure. Returns error if old structure is not found or matches multiple locations.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "test_file": {
                            "type": "string",
                            "description": "Path to the test file to modify"
                        },
                        "old_test_structure": {
                            "type": "object",
                            "description": "Test structure to find and replace. Must match exactly in the original file.",
                            "properties": {
                                "description": {
                                    "type": "string",
                                    "description": "Optional description text (not used for matching, only for context)"
                                },
                                "steps": {
                                    "type": "array",
                                    "description": "Sequence of test steps to find and replace. Must match exactly.",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "type": {
                                                "type": "string",
                                                "enum": ["input", "output", "comment", "block"],
                                                "description": "Type of step"
                                            },
                                            "args": {
                                                "type": "array",
                                                "items": {"type": "string"},
                                                "description": "Arguments for the step"
                                            },
                                            "content": {
                                                "type": ["string", "null"],
                                                "description": "Content of the step"
                                            },
                                            "steps": {
                                                "type": "array",
                                                "description": "Nested steps for block types"
                                            }
                                        },
                                        "required": ["type", "args"]
                                    }
                                }
                            },
                            "required": ["steps"]
                        },
                        "new_test_structure": {
                            "type": "object",
                            "description": "Test structure to replace the old structure with",
                            "properties": {
                                "description": {
                                    "type": "string",
                                    "description": "Optional description text. If provided, will replace the file's description."
                                },
                                "steps": {
                                    "type": "array",
                                    "description": "New sequence of test steps",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "type": {
                                                "type": "string",
                                                "enum": ["input", "output", "comment", "block"],
                                                "description": "Type of step"
                                            },
                                            "args": {
                                                "type": "array",
                                                "items": {"type": "string"},
                                                "description": "Arguments for the step"
                                            },
                                            "content": {
                                                "type": ["string", "null"],
                                                "description": "Content of the step"
                                            },
                                            "steps": {
                                                "type": "array",
                                                "description": "Nested steps for block types"
                                            }
                                        },
                                        "required": ["type", "args"]
                                    }
                                }
                            },
                            "required": ["steps"]
                        }
                    },
                    "required": ["test_file", "old_test_structure", "new_test_structure"],
                    "additionalProperties": false
                }),
            },
            McpTool {
                name: "append_test".to_string(),
                description: "Append new test steps to an existing CLT test file. Adds the new steps to the end of the existing test file while preserving the original content.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "test_file": {
                            "type": "string",
                            "description": "Path to the test file to modify"
                        },
                        "test_structure": {
                            "type": "object",
                            "description": "Test structure to append to the existing file",
                            "properties": {
                                "description": {
                                    "type": "string",
                                    "description": "Optional description text. Only used if the original file has no description."
                                },
                                "steps": {
                                    "type": "array",
                                    "description": "Sequence of test steps to append",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "type": {
                                                "type": "string",
                                                "enum": ["input", "output", "comment", "block"],
                                                "description": "Type of step"
                                            },
                                            "args": {
                                                "type": "array",
                                                "items": {"type": "string"},
                                                "description": "Arguments for the step"
                                            },
                                            "content": {
                                                "type": ["string", "null"],
                                                "description": "Content of the step"
                                            },
                                            "steps": {
                                                "type": "array",
                                                "description": "Nested steps for block types"
                                            }
                                        },
                                        "required": ["type", "args"]
                                    }
                                }
                            },
                            "required": ["steps"]
                        }
                    },
                    "required": ["test_file", "test_structure"],
                    "additionalProperties": false
                }),
            },
        ];

        let result = json!({
            "tools": tools
        });

        McpResponse::success(id, result)
    }

    async fn handle_tools_call(&mut self, id: Option<Value>, params: Option<Value>) -> McpResponse {
        let params = match params {
            Some(p) => p,
            None => return McpResponse::error(id, -32602, "Missing parameters".to_string()),
        };

        let tool_call: ToolCallParams = match serde_json::from_value(params) {
            Ok(tc) => tc,
            Err(e) => return McpResponse::error(id, -32602, format!("Invalid parameters: {}", e)),
        };

        let result = match self
            .execute_tool(&tool_call.name, tool_call.arguments)
            .await
        {
            Ok(content) => ToolCallResult {
                content: vec![ToolContent {
                    content_type: "text".to_string(),
                    text: content,
                }],
                is_error: None,
            },
            Err(e) => ToolCallResult {
                content: vec![ToolContent {
                    content_type: "text".to_string(),
                    text: format!("Error: {}", e),
                }],
                is_error: Some(true),
            },
        };

        McpResponse::success(id, json!(result))
    }

    async fn execute_tool(&mut self, tool_name: &str, arguments: Option<Value>) -> Result<String> {
        // Wrap the entire tool execution in a comprehensive error handler
        let result = match tool_name {
            "run_test" => {
                let input: RunTestInput = serde_json::from_value(
                    arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
                )?;

                // Safely resolve test path with proper error handling
                let resolved_test_path = match self.resolve_test_path(&input.test_file) {
                    Ok(path) => path,
                    Err(e) => {
                        // Return a structured error response instead of crashing
                        let error_output = json!({
                            "tool": "run_test",
                            "description": "CLT test execution failed during path resolution",
                            "test_file": input.test_file,
                            "result": {
                                "success": false,
                                "errors": [{
                                    "command": "path_resolution",
                                    "expected": "Valid test file path",
                                    "actual": format!("Path resolution failed: {}", e),
                                    "step": 0
                                }],
                                "summary": format!("Path resolution error: {}", e)
                            },
                            "help": {
                                "error_type": "path_resolution",
                                "suggestion": "Check that the test file path is correct and accessible",
                                "working_directory": self.workdir_path
                            }
                        });
                        return Ok(serde_json::to_string_pretty(&error_output)?);
                    }
                };

                // Safely execute test with proper error handling
                let output = match self
                    .test_runner
                    .run_test(&resolved_test_path, input.docker_image.as_deref())
                {
                    Ok(result) => result,
                    Err(e) => {
                        // Convert test runner errors to structured output
                        let error_output = json!({
                            "tool": "run_test",
                            "description": "CLT test execution failed",
                            "test_file": input.test_file,
                            "result": {
                                "success": false,
                                "errors": [{
                                    "command": "test_execution",
                                    "expected": "Successful test execution",
                                    "actual": format!("Test execution failed: {}", e),
                                    "step": 0
                                }],
                                "summary": format!("Test execution error: {}", e)
                            },
                            "help": {
                                "error_type": "test_execution",
                                "suggestion": "Check CLT binary path, Docker availability, and test file format",
                                "working_directory": self.workdir_path
                            }
                        });
                        return Ok(serde_json::to_string_pretty(&error_output)?);
                    }
                };

                // Add helpful context to the output
                let docker_image_used = input.docker_image.as_deref().unwrap_or(&self.docker_image);
                let enhanced_output = json!({
                    "tool": "run_test",
                    "description": "CLT test execution results",
                    "test_file": input.test_file,
                    "docker_image": docker_image_used,
                    "result": output,
                    "help": {
                        "success_meaning": "true = test passed, all commands executed and outputs matched expectations",
                        "errors_meaning": "Array of specific mismatches between expected and actual outputs. step refers to the position in the test steps array (0-based)",
                        "next_steps": "If test failed, use 'refine_output' tool to suggest patterns for dynamic content",
                        "docker_image_info": format!("Test executed in Docker image: {} (default: {})", docker_image_used, self.docker_image)
                    }
                });

                Ok(serde_json::to_string_pretty(&enhanced_output)?)
            }
            "refine_output" => {
                let input: RefineOutputInput = serde_json::from_value(
                    arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
                )?;
                let output = self
                    .pattern_refiner
                    .refine_output(&input.expected, &input.actual)?;

                // Add helpful context and examples
                let enhanced_output = json!({
                    "tool": "refine_output",
                    "description": "Pattern suggestions for handling dynamic content in test outputs",
                    "result": output,
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
                });

                Ok(serde_json::to_string_pretty(&enhanced_output)?)
            }
            "test_match" => {
                let input: TestMatchInput = serde_json::from_value(
                    arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
                )?;
                let output = self.execute_test_match(&input.expected, &input.actual)?;

                // Add helpful context
                let enhanced_output = json!({
                    "tool": "test_match",
                    "description": "Pattern matching results using CLT's intelligent comparison engine",
                    "comparison": {
                        "expected": input.expected,
                        "actual": input.actual
                    },
                    "result": output,
                    "help": {
                        "matches_meaning": "true = strings match (considering patterns), false = mismatch found",
                        "diff_lines_details": "Git-style diff showing line-by-line differences between expected and actual output",
                        "pattern_support": "Understands %{PATTERN} and #!/regex/!# syntax for dynamic content",
                        "next_steps": "If match fails, check diff_lines array for specific differences, then use 'refine_output' to suggest patterns"
                    }
                });

                Ok(serde_json::to_string_pretty(&enhanced_output)?)
            }
            "clt_help" => {
                #[derive(Deserialize)]
                struct HelpInput {
                    topic: String,
                }

                let input: HelpInput = serde_json::from_value(
                    arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
                )?;

                let help_content = self.get_help_content(&input.topic);
                Ok(serde_json::to_string_pretty(&help_content)?)
            }
            "get_patterns" => {
                let patterns = parser::get_patterns(self.clt_binary_path.as_deref())?;

                let enhanced_output = json!({
                    "tool": "get_patterns",
                    "description": "Available patterns for CLT tests",
                    "patterns": patterns,
                    "help": {
                        "usage": "Use these patterns in test outputs like %{PATTERN_NAME}",
                        "example": "Replace '1.2.3' with '%{SEMVER}' to match any semantic version"
                    }
                });

                Ok(serde_json::to_string_pretty(&enhanced_output)?)
            }
            "read_test" => {
                let input: mcp_protocol::ReadTestInput = serde_json::from_value(
                    arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
                )?;

                let test_structure =
                    parser::read_test_file(&self.resolve_test_path(&input.test_file)?)?;

                let enhanced_output = json!({
                    "tool": "read_test",
                    "description": "Structured representation of CLT test file",
                    "test_file": input.test_file,
                    "result": test_structure,
                    "help": {
                        "structure": "JSON format with 'steps' array containing test steps",
                        "step_types": "input (commands), output (expected results), comment (documentation), block (reusable components)",
                        "nested_blocks": "Block steps contain resolved content in 'steps' field",
                        "usage": "Modify this structure and use 'write_test' to save changes"
                    }
                });

                Ok(serde_json::to_string_pretty(&enhanced_output)?)
            }
            "write_test" => {
                let input: mcp_protocol::WriteTestInputWithWarning = serde_json::from_value(
                    arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
                )?;

                // Check if we need to add a warning about string parsing
                let mut warnings = Vec::new();
                if input.test_structure.was_string {
                    warnings.push("test_structure was provided as a JSON string instead of an object. While this works, it's recommended to pass it as a direct JSON object for better performance and clarity.".to_string());
                }

                // Safely resolve test path with proper error handling
                let resolved_test_path = match self.resolve_test_path(&input.test_file) {
                    Ok(path) => path,
                    Err(e) => {
                        let mut error_output = json!({
                            "tool": "write_test",
                            "description": "CLT test file write failed during path resolution",
                            "test_file": input.test_file,
                            "result": {
                                "success": false,
                                "error": format!("Path resolution failed: {}", e)
                            },
                            "help": {
                                "error_type": "path_resolution",
                                "suggestion": "Check that the test file path is valid and the directory is writable",
                                "working_directory": self.workdir_path
                            }
                        });

                        if !warnings.is_empty() {
                            error_output["warnings"] = json!(warnings);
                        }

                        return Ok(serde_json::to_string_pretty(&error_output)?);
                    }
                };

                // Safely write test file with proper error handling
                match parser::write_test_file(&resolved_test_path, &input.test_structure.structure)
                {
                    Ok(()) => {
                        let mut enhanced_output = json!({
                            "tool": "write_test",
                            "description": "CLT test file written successfully",
                            "test_file": input.test_file,
                            "result": {
                                "success": true
                            },
                            "help": {
                                "next_steps": "Use 'run_test' to execute the written test file"
                            }
                        });

                        if !warnings.is_empty() {
                            enhanced_output["warnings"] = json!(warnings);
                        }

                        Ok(serde_json::to_string_pretty(&enhanced_output)?)
                    }
                    Err(e) => {
                        let mut error_output = json!({
                            "tool": "write_test",
                            "description": "CLT test file write failed",
                            "test_file": input.test_file,
                            "result": {
                                "success": false,
                                "error": format!("Write operation failed: {}", e)
                            },
                            "help": {
                                "error_type": "write_failure",
                                "suggestion": "Check file permissions and disk space",
                                "working_directory": self.workdir_path
                            }
                        });

                        if !warnings.is_empty() {
                            error_output["warnings"] = json!(warnings);
                        }

                        Ok(serde_json::to_string_pretty(&error_output)?)
                    }
                }
            }
            "update_test" => {
                let input: mcp_protocol::TestReplaceInputWithWarning = serde_json::from_value(
                    arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
                )?;

                // Check if we need to add warnings about string parsing
                let mut warnings = Vec::new();
                if input.old_test_structure.was_string {
                    warnings.push("old_test_structure was provided as a JSON string instead of an object. While this works, it's recommended to pass it as a direct JSON object for better performance and clarity.".to_string());
                }
                if input.new_test_structure.was_string {
                    warnings.push("new_test_structure was provided as a JSON string instead of an object. While this works, it's recommended to pass it as a direct JSON object for better performance and clarity.".to_string());
                }

                // Safely resolve test path with proper error handling
                let resolved_test_path = match self.resolve_test_path(&input.test_file) {
                    Ok(path) => path,
                    Err(e) => {
                        let mut error_output = json!({
                            "tool": "update_test",
                            "description": "Test structure update failed during path resolution",
                            "test_file": input.test_file,
                            "result": {
                                "success": false,
                                "message": format!("Path resolution failed: {}", e)
                            },
                            "help": {
                                "error_type": "path_resolution",
                                "suggestion": "Check that the test file path is correct and accessible",
                                "working_directory": self.workdir_path
                            }
                        });

                        if !warnings.is_empty() {
                            error_output["warnings"] = json!(warnings);
                        }

                        return Ok(serde_json::to_string_pretty(&error_output)?);
                    }
                };

                match parser::replace_test_structure(
                    &resolved_test_path,
                    &input.old_test_structure.structure,
                    &input.new_test_structure.structure,
                ) {
                    Ok(()) => {
                        let mut enhanced_output = json!({
                            "tool": "update_test",
                            "description": "Test structure replaced successfully",
                            "test_file": input.test_file,
                            "result": {
                                "success": true,
                                "message": "Old test structure found and replaced with new structure"
                            },
                            "help": {
                                "next_steps": "Use 'run_test' to execute the modified test file",
                                "replacement_info": "The old test structure was found and replaced exactly once"
                            }
                        });

                        if !warnings.is_empty() {
                            enhanced_output["warnings"] = json!(warnings);
                        }

                        Ok(serde_json::to_string_pretty(&enhanced_output)?)
                    }
                    Err(e) => {
                        let mut enhanced_output = json!({
                            "tool": "update_test",
                            "description": "Test structure replacement failed",
                            "test_file": input.test_file,
                            "result": {
                                "success": false,
                                "message": e.to_string()
                            },
                            "help": {
                                "common_errors": {
                                    "not_found": "Old test structure not found in file - check exact match of steps, content, and args",
                                    "ambiguous": "Old test structure matches multiple locations - make it more specific",
                                    "file_not_found": "Test file doesn't exist - check the path"
                                },
                                "matching_rules": "Steps must match exactly: type, args, content, and nested steps (if any)"
                            }
                        });

                        if !warnings.is_empty() {
                            enhanced_output["warnings"] = json!(warnings);
                        }

                        Ok(serde_json::to_string_pretty(&enhanced_output)?)
                    }
                }
            }
            "append_test" => {
                let input: mcp_protocol::TestAppendInputWithWarning = serde_json::from_value(
                    arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
                )?;

                // Check if we need to add a warning about string parsing
                let mut warnings = Vec::new();
                if input.test_structure.was_string {
                    warnings.push("test_structure was provided as a JSON string instead of an object. While this works, it's recommended to pass it as a direct JSON object for better performance and clarity.".to_string());
                }

                match parser::append_test_structure(
                    &self.resolve_test_path(&input.test_file)?,
                    &input.test_structure.structure,
                ) {
                    Ok(steps_added) => {
                        let mut enhanced_output = json!({
                            "tool": "append_test",
                            "description": "Test steps appended successfully",
                            "test_file": input.test_file,
                            "result": {
                                "success": true,
                                "message": format!("Successfully appended {} test steps to the file", steps_added),
                                "steps_added": steps_added
                            },
                            "help": {
                                "next_steps": "Use 'run_test' to execute the updated test file",
                                "append_info": "New steps were added to the end of the existing test file"
                            }
                        });

                        if !warnings.is_empty() {
                            enhanced_output["warnings"] = json!(warnings);
                        }

                        Ok(serde_json::to_string_pretty(&enhanced_output)?)
                    }
                    Err(e) => {
                        let mut enhanced_output = json!({
                            "tool": "append_test",
                            "description": "Test append operation failed",
                            "test_file": input.test_file,
                            "result": {
                                "success": false,
                                "message": e.to_string(),
                                "steps_added": 0
                            },
                            "help": {
                                "common_errors": {
                                    "file_not_found": "Test file doesn't exist - check the path",
                                    "permission_denied": "Cannot write to file - check file permissions",
                                    "invalid_structure": "Test structure is invalid - check step format"
                                }
                            }
                        });

                        if !warnings.is_empty() {
                            enhanced_output["warnings"] = json!(warnings);
                        }

                        Ok(serde_json::to_string_pretty(&enhanced_output)?)
                    }
                }
            }
            _ => {
                // Return a proper error response instead of panicking
                let error_output = json!({
                    "tool": tool_name,
                    "description": "Unknown tool requested",
                    "result": {
                        "success": false,
                        "error": format!("Unknown tool: {}", tool_name)
                    },
                    "help": {
                        "available_tools": [
                            "run_test", "refine_output", "test_match", "clt_help",
                            "get_patterns", "read_test", "write_test", "update_test", "append_test"
                        ],
                        "suggestion": "Use one of the available tools listed above"
                    }
                });
                return Ok(serde_json::to_string_pretty(&error_output)?);
            }
        };

        // If we get here, one of the tools above should have returned a result
        result
    }

    fn get_help_content(&self, topic: &str) -> Value {
        match topic {
            "overview" => json!({
                "topic": "CLT Overview",
                "description": "CLT (Command Line Tester) is a testing framework for command-line applications",
                "content": {
                    "what_is_clt": "CLT allows you to record interactive command sessions, save them as test files, and replay them to verify consistent behavior. All commands run inside Docker containers for reproducible environments.",
                    "key_features": [
                        "Record interactive command sessions",
                        "Replay tests to verify behavior",
                        "Pattern matching for dynamic content (timestamps, IDs, etc.)",
                        "Docker container isolation",
                        "Structured error reporting"
                    ],
                    "typical_workflow": [
                        "1. Record a test session: clt record ubuntu:20.04",
                        "2. Execute commands interactively (all recorded)",
                        "3. Exit with Ctrl+D to save the test file",
                        "4. Replay test: clt test -t mytest -d ubuntu:20.04",
                        "5. Refine patterns if dynamic content causes failures"
                    ],
                    "file_types": {
                        "test_files": "Test recording files with input/output sections",
                        "result_files": "Test replay results (generated during test execution)",
                        "block_files": "Reusable test blocks that can be included in test files"
                    }
                }
            }),
            "test_format" => json!({
                "topic": "Structured Test Format",
                "description": "Complete guide to CLT's structured JSON test format for AI-friendly test creation",
                "content": {
                    "overview": "CLT uses a structured JSON format that makes it easy for AI to create, read, and modify tests. This format abstracts away complex syntax and provides a clear, hierarchical representation of test steps.",
                    "basic_structure": {
                        "description": "A test consists of an optional description and an array of steps",
                        "schema": {
                            "description": "Optional text description of what the test does (appears at top of test file)",
                            "steps": "Array of test steps to execute in sequence"
                        },
                        "minimal_example": {
                            "description": "Simple test with one command",
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
                    },
                    "step_types": {
                        "input": {
                            "purpose": "Command to execute in the test environment",
                            "structure": {
                                "type": "input",
                                "args": "Always empty array []",
                                "content": "Command string to execute"
                            },
                            "example": {
                                "type": "input",
                                "args": [],
                                "content": "ls -la /tmp"
                            }
                        },
                        "output": {
                            "purpose": "Expected result from the previous command",
                            "structure": {
                                "type": "output",
                                "args": "Empty [] or [\"checker-name\"] for custom validation",
                                "content": "Expected output string (can contain patterns)"
                            },
                            "examples": {
                                "basic": {
                                    "type": "output",
                                    "args": [],
                                    "content": "total 0"
                                },
                                "with_patterns": {
                                    "type": "output",
                                    "args": [],
                                    "content": "Process started with PID %{NUMBER}"
                                },
                                "with_custom_checker": {
                                    "type": "output",
                                    "args": ["json-validator"],
                                    "content": "{\"status\": \"success\"}"
                                }
                            }
                        },
                        "comment": {
                            "purpose": "Documentation and notes within the test (ignored during execution)",
                            "structure": {
                                "type": "comment",
                                "args": "Always empty array []",
                                "content": "Comment text"
                            },
                            "example": {
                                "type": "comment",
                                "args": [],
                                "content": "This test validates the file listing functionality"
                            }
                        },
                        "block": {
                            "purpose": "Reference to reusable test sequence from another file",
                            "structure": {
                                "type": "block",
                                "args": "[\"relative/path/to/block\"]",
                                "content": "Always null",
                                "steps": "Array of resolved steps from the block file"
                            },
                            "example": {
                                "type": "block",
                                "args": ["auth/login"],
                                "content": null,
                                "steps": [
                                    {
                                        "type": "input",
                                        "args": [],
                                        "content": "login admin"
                                    },
                                    {
                                        "type": "output",
                                        "args": [],
                                        "content": "Login successful"
                                    }
                                ]
                            }
                        }
                    },
                    "complete_examples": {
                        "simple_test": {
                            "description": "Basic command test with description",
                            "test": {
                                "description": "Test the echo command functionality",
                                "steps": [
                                    {
                                        "type": "comment",
                                        "args": [],
                                        "content": "Test basic echo command"
                                    },
                                    {
                                        "type": "input",
                                        "args": [],
                                        "content": "echo 'Hello CLT'"
                                    },
                                    {
                                        "type": "output",
                                        "args": [],
                                        "content": "Hello CLT"
                                    }
                                ]
                            }
                        },
                        "test_with_patterns": {
                            "description": "Test using patterns for dynamic content",
                            "test": {
                                "description": "Application startup test with dynamic content",
                                "steps": [
                                    {
                                        "type": "input",
                                        "args": [],
                                        "content": "./myapp --version"
                                    },
                                    {
                                        "type": "output",
                                        "args": [],
                                        "content": "MyApp version %{SEMVER}"
                                    },
                                    {
                                        "type": "input",
                                        "args": [],
                                        "content": "./myapp start"
                                    },
                                    {
                                        "type": "output",
                                        "args": [],
                                        "content": "Server started on %{IPADDR}:%{NUMBER}"
                                    }
                                ]
                            }
                        },
                        "test_with_blocks": {
                            "description": "Test using reusable blocks",
                            "test": {
                                "description": "Database integration test",
                                "steps": [
                                    {
                                        "type": "comment",
                                        "args": [],
                                        "content": "Setup database connection"
                                    },
                                    {
                                        "type": "block",
                                        "args": ["database/connect"],
                                        "content": null,
                                        "steps": [
                                            {
                                                "type": "input",
                                                "args": [],
                                                "content": "mysql -u testuser -p"
                                            },
                                            {
                                                "type": "output",
                                                "args": [],
                                                "content": "Enter password:"
                                            }
                                        ]
                                    },
                                    {
                                        "type": "input",
                                        "args": [],
                                        "content": "SELECT COUNT(*) FROM users;"
                                    },
                                    {
                                        "type": "output",
                                        "args": [],
                                        "content": "%{NUMBER}"
                                    }
                                ]
                            }
                        },
                        "test_with_custom_checker": {
                            "description": "Test using custom output validation",
                            "test": {
                                "description": "API response validation test",
                                "steps": [
                                    {
                                        "type": "input",
                                        "args": [],
                                        "content": "curl -s http://api.example.com/status"
                                    },
                                    {
                                        "type": "output",
                                        "args": ["json-validator"],
                                        "content": "{\"status\": \"healthy\", \"timestamp\": \"%{NUMBER}\"}"
                                    }
                                ]
                            }
                        }
                    },
                    "workflow_example": {
                        "description": "Complete workflow from creation to execution",
                        "steps": [
                            "1. Create test structure using JSON format",
                            "2. Use write_test tool to save as test file",
                            "3. Use run_test tool to execute the test",
                            "4. Use read_test tool to load existing tests for modification",
                            "5. Use get_patterns tool to see available patterns for dynamic content"
                        ],
                        "example_workflow": {
                            "step1_create": {
                                "description": "Create test structure",
                                "json": {
                                    "description": "Test file operations",
                                    "steps": [
                                        {
                                            "type": "input",
                                            "args": [],
                                            "content": "touch /tmp/testfile.txt"
                                        },
                                        {
                                            "type": "output",
                                            "args": [],
                                            "content": ""
                                        },
                                        {
                                            "type": "input",
                                            "args": [],
                                            "content": "ls -la /tmp/testfile.txt"
                                        },
                                        {
                                            "type": "output",
                                            "args": [],
                                            "content": "-rw-r--r-- 1 %{USERNAME} %{USERNAME} 0 %{DATE} %{TIME} /tmp/testfile.txt"
                                        }
                                    ]
                                }
                            },
                            "step2_write": "Use write_test with test_file='/tmp/mytest.rec' and test_structure=<json_above>",
                            "step3_run": "Use run_test with test_file='/tmp/mytest.rec' and docker_image='ubuntu:20.04' (or omit docker_image to use server default)",
                            "step4_modify": "Use read_test with test_file='/tmp/mytest.rec' to load for modifications"
                        }
                    },
                    "best_practices": {
                        "structure": [
                            "Always include a descriptive 'description' field for your tests",
                            "Use comment statements to document complex test sections",
                            "Group related commands and outputs together logically",
                            "Use meaningful names for block references"
                        ],
                        "patterns": [
                            "Use %{PATTERN_NAME} for common dynamic content (dates, numbers, IPs)",
                            "Prefer named patterns over custom regex when available",
                            "Use get_patterns tool to see all available patterns",
                            "Test pattern matching with test_match tool before using in tests"
                        ],
                        "blocks": [
                            "Create reusable blocks for common sequences (login, setup, cleanup)",
                            "Use relative paths for block references",
                            "Keep block files focused on single responsibilities",
                            "Document block purposes with comments"
                        ],
                        "validation": [
                            "Use custom checkers for complex output validation (JSON, XML, etc.)",
                            "Test your structured format with write_test before execution",
                            "Use read_test to verify your written tests parse correctly"
                        ]
                    },
                    "common_patterns": {
                        "test_sequence": "input → output → input → output (commands and their expected results)",
                        "setup_test_cleanup": "block(setup) → test_steps → block(cleanup)",
                        "documented_test": "comment → input → output (with documentation)",
                        "conditional_validation": "input → output(with_custom_checker) (for complex validation)"
                    },
                    "troubleshooting": {
                        "invalid_structure": {
                            "symptom": "write_test fails with structure errors",
                            "solutions": [
                                "Ensure all steps have required 'statement' and 'args' fields",
                                "Check that 'statement' values are: input, output, comment, or block",
                                "Verify 'args' is always an array (even if empty)",
                                "For blocks: ensure 'content' is null and 'args' contains path"
                            ]
                        },
                        "block_resolution": {
                            "symptom": "Block references not working",
                            "solutions": [
                                "Check block path is relative to the test file location",
                                "Ensure block file exists at the specified path",
                                "Verify block file contains valid test structure",
                                "Use forward slashes (/) in paths on all platforms"
                            ]
                        },
                        "pattern_issues": {
                            "symptom": "Patterns not matching as expected",
                            "solutions": [
                                "Use get_patterns to see available pattern names",
                                "Test patterns with test_match tool first",
                                "Ensure pattern syntax is %{PATTERN_NAME}",
                                "Check pattern is appropriate for the content type"
                            ]
                        }
                    }
                }
            }),
            "patterns" => json!({
                "topic": "CLT Pattern Syntax",
                "description": "How to handle dynamic content in test outputs using patterns",
                "content": {
                    "why_patterns": "Command outputs often contain dynamic data (timestamps, process IDs, version numbers) that change between test runs. Patterns allow tests to match the structure while ignoring variable content.",
                    "named_patterns": {
                        "syntax": "%{PATTERN_NAME}",
                        "description": "Predefined patterns from .clt/patterns file",
                        "examples": {
                            "%{SEMVER}": "Semantic versions like 1.2.3, 10.0.1",
                            "%{IPADDR}": "IP addresses like 192.168.1.1, 10.0.0.1",
                            "%{DATE}": "Dates like 2023-12-25",
                            "%{TIME}": "Times like 14:30:22",
                            "%{NUMBER}": "Any number like 42, 1234",
                            "%{PATH}": "File paths like /usr/bin/app",
                            "%{YEAR}": "4-digit years like 2023"
                        }
                    },
                    "regex_patterns": {
                        "syntax": "#!/regex/!#",
                        "description": "Custom regular expressions for specific matching",
                        "examples": {
                            "#!/[0-9]+/!#": "Any number (same as %{NUMBER})",
                            "#!/[0-9]{4}-[0-9]{2}-[0-9]{2}/!#": "Date format YYYY-MM-DD",
                            "#!/[a-f0-9]{40}/!#": "SHA1 hash (40 hex characters)",
                            "#!/PID: [0-9]+/!#": "Process ID with prefix",
                            "#!/v[0-9]+\\.[0-9]+\\.[0-9]+/!#": "Version with 'v' prefix"
                        }
                    },
                    "pattern_examples": [
                        {
                            "scenario": "Process started with varying PID",
                            "original_output": "Process started with PID 1234",
                            "with_pattern": "Process started with PID %{NUMBER}",
                            "alternative": "Process started with PID #!/[0-9]+/!#"
                        },
                        {
                            "scenario": "Application version in output",
                            "original_output": "MyApp version 2.1.3 starting",
                            "with_pattern": "MyApp version %{SEMVER} starting",
                            "alternative": "MyApp version #!/[0-9]+\\.[0-9]+\\.[0-9]+/!# starting"
                        }
                    ]
                }
            }),
            "blocks" => json!({
                "topic": "CLT Reusable Blocks",
                "description": "How to create and use reusable test blocks with .recb files",
                "content": {
                    "what_are_blocks": "Blocks are reusable test sequences stored in .recb files that can be included in multiple .rec test files. They help avoid duplication and create modular test components.",
                    "key_concepts": {
                        "block_files": "Files with .recb extension containing reusable test sequences",
                        "relative_paths": "Block files must be located relative to the .rec file that includes them",
                        "nested_blocks": "Block files can include other blocks, creating hierarchical test structures",
                        "same_format": "Block files use the same format as .rec files (input/output sections)"
                    },
                    "file_organization": {
                        "basic_structure": [
                            "tests/",
                            "├── main-test.rec         # Main test file",
                            "├── login.recb            # Block in same directory",
                            "├── setup.recb            # Another block",
                            "└── auth/",
                            "    ├── admin-login.recb  # Block in subdirectory",
                            "    └── user-login.recb   # Another auth block"
                        ],
                        "path_rules": [
                            "Always relative to the .rec file containing the block statement",
                            "Same directory: ––– block: login –––",
                            "Subdirectory: ––– block: auth/admin-login –––",
                            "Parent directory: ––– block: ../common/setup –––",
                            "Multiple levels: ––– block: shared/auth/login –––"
                        ]
                    },
                    "block_syntax": {
                        "inclusion": "––– block: relative-path-to-block –––",
                        "examples": [
                            "––– block: login –––                    # login.recb in same directory",
                            "––– block: auth/admin-login –––         # auth/admin-login.recb",
                            "––– block: ../common/setup –––          # ../common/setup.recb",
                            "––– block: shared/database/connect ––– # shared/database/connect.recb"
                        ],
                        "important_notes": [
                            "Do not include .recb extension in block statement",
                            "Use forward slashes (/) for path separators on all platforms",
                            "Paths are always relative, never absolute",
                            "Block files must exist at the specified relative path"
                        ]
                    },
                    "creating_blocks": {
                        "step1": "Create a .recb file with reusable test sequence",
                        "step2": "Use same format as .rec files (input/output sections)",
                        "step3": "Place file relative to where it will be used",
                        "step4": "Include in .rec files using ––– block: path –––",
                        "example_block_file": {
                            "filename": "database-connect.recb",
                            "content": [
                                "––– comment –––",
                                "Reusable database connection sequence",
                                "––– input –––",
                                "mysql -h localhost -u testuser -p",
                                "––– output –––",
                                "Enter password:",
                                "––– input –––",
                                "testpass123",
                                "––– output –––",
                                "Welcome to the MySQL monitor.",
                                "––– input –––",
                                "USE testdb;",
                                "––– output –––",
                                "Database changed."
                            ]
                        }
                    },
                    "using_blocks": {
                        "in_main_test": [
                            "––– comment –––",
                            "Main test using database connection block",
                            "––– block: database-connect –––",
                            "––– input –––",
                            "SELECT COUNT(*) FROM users;",
                            "––– output –––",
                            "%{NUMBER}",
                            "––– input –––",
                            "EXIT;",
                            "––– output –––",
                            "Bye"
                        ],
                        "multiple_blocks": [
                            "––– comment –––",
                            "Test using multiple blocks",
                            "––– block: setup/environment –––",
                            "––– block: auth/login –––",
                            "––– input –––",
                            "echo 'Custom command after blocks'",
                            "––– output –––",
                            "Custom command after blocks",
                            "––– block: cleanup/teardown –––"
                        ]
                    },
                    "nested_blocks": {
                        "description": "Blocks can include other blocks, creating hierarchical test structures",
                        "example_structure": [
                            "tests/",
                            "├── full-integration-test.rec",
                            "├── full-setup.recb       # Includes multiple setup blocks",
                            "├── auth/",
                            "│   ├── login.recb         # Basic login",
                            "│   └── permissions.recb   # Permission setup",
                            "└── database/",
                            "    ├── connect.recb       # Database connection",
                            "    └── schema.recb        # Schema setup"
                        ],
                        "full_setup_block": [
                            "––– comment –––",
                            "full-setup.recb - Complete environment setup",
                            "––– block: auth/login –––",
                            "––– block: auth/permissions –––",
                            "––– block: database/connect –––",
                            "––– block: database/schema –––",
                            "––– input –––",
                            "echo 'Environment ready'",
                            "––– output –––",
                            "Environment ready"
                        ],
                        "main_test_using_nested": [
                            "––– comment –––",
                            "full-integration-test.rec - Uses nested blocks",
                            "––– block: full-setup –––",
                            "––– input –––",
                            "run-integration-tests.sh",
                            "––– output –––",
                            "All tests passed: %{NUMBER} tests"
                        ]
                    },
                    "best_practices": [
                        "Keep blocks focused on single responsibilities (login, setup, cleanup)",
                        "Use descriptive names for block files (database-connect.recb, not db.recb)",
                        "Organize blocks in logical directory structures",
                        "Document block purposes with comment sections",
                        "Test blocks independently before using in main tests",
                        "Avoid deep nesting of blocks (2-3 levels maximum)",
                        "Use relative paths consistently across your test suite"
                    ],
                    "common_patterns": {
                        "authentication": "––– block: auth/login –––",
                        "environment_setup": "––– block: setup/environment –––",
                        "database_operations": "––– block: database/connect –––",
                        "cleanup": "––– block: cleanup/teardown –––",
                        "service_startup": "––– block: services/start-all –––"
                    },
                    "troubleshooting": {
                        "block_not_found": {
                            "error": "Block file not found",
                            "causes": [
                                "Incorrect relative path",
                                "Missing .recb file",
                                "Wrong directory structure"
                            ],
                            "solutions": [
                                "Verify .recb file exists at specified path",
                                "Check path is relative to .rec file location",
                                "Use forward slashes for path separators"
                            ]
                        },
                        "circular_dependency": {
                            "error": "Circular dependency detected",
                            "cause": "Block A includes Block B, which includes Block A",
                            "solution": "Restructure blocks to avoid circular references"
                        },
                        "path_issues": {
                            "common_mistakes": [
                                "Using absolute paths instead of relative",
                                "Including .recb extension in block statement",
                                "Using backslashes on Windows",
                                "Incorrect relative path calculation"
                            ],
                            "correct_examples": [
                                "✓ ––– block: login –––",
                                "✓ ––– block: auth/admin –––",
                                "✓ ––– block: ../shared/setup –––",
                                "✗ ––– block: login.recb –––",
                                "✗ ––– block: /absolute/path/login –––",
                                "✗ ––– block: auth\\\\admin –––"
                            ]
                        }
                    }
                }
            }),
            "workflow" => json!({
                "topic": "CLT Testing Workflow",
                "description": "Step-by-step process for creating and maintaining CLT tests",
                "content": {
                    "initial_recording": {
                        "step1": "Start recording: clt record ubuntu:20.04",
                        "step2": "Execute your commands interactively",
                        "step3": "Exit with Ctrl+D to save the .rec file",
                        "step4": "Note the saved file path for later use"
                    },
                    "test_execution": {
                        "step1": "Run test: clt test -t mytest.rec -d ubuntu:20.04",
                        "step2": "Check exit code: 0 = success, 1 = failure",
                        "step3": "Review any error output for mismatches"
                    },
                    "handling_failures": {
                        "step1": "Identify dynamic content causing failures",
                        "step2": "Use refine_output tool to get pattern suggestions",
                        "step3": "Edit .rec file to replace dynamic content with patterns",
                        "step4": "Re-run test to verify fixes"
                    },
                    "maintenance": {
                        "step1": "Regularly run tests to catch regressions",
                        "step2": "Update patterns when output formats change",
                        "step3": "Use blocks (.recb files) for common sequences",
                        "step4": "Document test purposes with comment sections"
                    },
                    "best_practices": [
                        "Keep tests focused on specific functionality",
                        "Use descriptive names for test files",
                        "Group related tests in directories",
                        "Document complex patterns with comments",
                        "Test both success and failure scenarios"
                    ]
                }
            }),
            "examples" => json!({
                "topic": "CLT Practical Examples",
                "description": "Real-world examples of CLT test files and usage patterns",
                "content": {
                    "basic_command_test": {
                        "description": "Testing a simple echo command",
                        "rec_file": [
                            "––– comment –––",
                            "Basic echo test",
                            "––– input –––",
                            "echo 'Hello CLT'",
                            "––– output –––",
                            "Hello CLT"
                        ]
                    },
                    "dynamic_content_test": {
                        "description": "Testing command with dynamic output",
                        "rec_file": [
                            "––– comment –––",
                            "Test with current date",
                            "––– input –––",
                            "date +%Y-%m-%d",
                            "––– output –––",
                            "%{DATE}"
                        ]
                    },
                    "application_startup_test": {
                        "description": "Testing application startup with version and PID",
                        "rec_file": [
                            "––– comment –––",
                            "Application startup test",
                            "––– input –––",
                            "./myapp --version",
                            "––– output –––",
                            "MyApp version %{SEMVER}",
                            "––– input –––",
                            "./myapp start &",
                            "––– output –––",
                            "Starting MyApp...",
                            "Process ID: %{NUMBER}",
                            "Listening on %{IPADDR}:8080"
                        ]
                    },
                    "file_operations_test": {
                        "description": "Testing file creation and listing",
                        "rec_file": [
                            "––– input –––",
                            "touch testfile.txt",
                            "––– output –––",
                            "",
                            "––– input –––",
                            "ls -la testfile.txt",
                            "––– output –––",
                            "#!/-rw-r--r--\\s+1\\s+\\w+\\s+\\w+\\s+0\\s+%{DATE}\\s+%{TIME}\\s+testfile\\.txt/!#"
                        ]
                    },
                    "using_blocks": {
                        "description": "Reusable test blocks for common operations",
                        "block_file_rules": [
                            "Block files use .recb extension",
                            "Must be placed relative to the .rec file that includes them",
                            "Can be in same directory or subdirectories",
                            "Block files use same format as .rec files"
                        ],
                        "login_block_file": {
                            "filename": "login-sequence.recb",
                            "location": "Same directory as main test file",
                            "content": [
                                "––– comment –––",
                                "Reusable login sequence",
                                "––– input –––",
                                "mysql -u root -p",
                                "––– output –––",
                                "Enter password:",
                                "––– input –––",
                                "password123",
                                "––– output –––",
                                "Welcome to the MySQL monitor."
                            ]
                        },
                        "main_test_using_block": {
                            "filename": "database-test.rec",
                            "content": [
                                "––– comment –––",
                                "Database test using login block",
                                "––– block: login-sequence –––",
                                "––– input –––",
                                "SHOW DATABASES;",
                                "––– output –––",
                                "#!/\\+.*\\+/!#",
                                "#!/\\|.*Database.*\\|/!#",
                                "#!/\\+.*\\+/!#"
                            ]
                        },
                        "nested_blocks_example": {
                            "description": "Blocks can include other blocks",
                            "structure": [
                                "tests/",
                                "├── full-test.rec",
                                "├── setup.recb           # Includes login.recb",
                                "└── auth/",
                                "    └── login.recb       # Basic login"
                            ],
                            "setup_block": [
                                "––– comment –––",
                                "setup.recb - Full setup including login",
                                "––– block: auth/login –––",
                                "––– input –––",
                                "use testdb;",
                                "––– output –––",
                                "Database changed."
                            ],
                            "main_test": [
                                "––– comment –––",
                                "full-test.rec - Uses nested blocks",
                                "––– block: setup –––",
                                "––– input –––",
                                "SELECT COUNT(*) FROM users;",
                                "––– output –––",
                                "%{NUMBER}"
                            ]
                        }
                    }
                }
            }),
            "troubleshooting" => json!({
                "topic": "CLT Troubleshooting Guide",
                "description": "Common issues and solutions when working with CLT",
                "content": {
                    "test_failures": {
                        "symptom": "Test fails with output mismatch",
                        "causes": [
                            "Dynamic content (timestamps, IDs) in output",
                            "Whitespace differences",
                            "Different environment variables",
                            "Changed application behavior"
                        ],
                        "solutions": [
                            "Use refine_output tool to identify patterns needed",
                            "Add patterns for dynamic content (%{DATE}, %{NUMBER}, etc.)",
                            "Check for trailing whitespace or newlines",
                            "Verify Docker image and environment consistency"
                        ]
                    },
                    "pattern_issues": {
                        "symptom": "Patterns not matching as expected",
                        "causes": [
                            "Incorrect pattern syntax",
                            "Pattern too restrictive or too broad",
                            "Special characters not escaped in regex"
                        ],
                        "solutions": [
                            "Use test_match tool to verify pattern behavior",
                            "Test patterns with simple examples first",
                            "Escape special regex characters with backslashes",
                            "Use named patterns when available instead of custom regex"
                        ]
                    },
                    "docker_issues": {
                        "symptom": "Cannot run tests, Docker errors",
                        "causes": [
                            "Docker daemon not running",
                            "Image not available locally",
                            "Permission issues"
                        ],
                        "solutions": [
                            "Start Docker daemon",
                            "Pull required image: docker pull ubuntu:20.04",
                            "Check Docker permissions for current user"
                        ]
                    },
                    "file_format_issues": {
                        "symptom": "CLT cannot parse .rec file",
                        "causes": [
                            "Using regular hyphens (-) instead of en dashes (–)",
                            "Malformed section markers",
                            "Missing newlines"
                        ],
                        "solutions": [
                            "Use en dashes (–) in section markers: ––– input –––",
                            "Ensure section markers are on their own lines",
                            "Check file encoding (should be UTF-8)"
                        ]
                    },
                    "debugging_tips": [
                        "Use test_match tool to isolate pattern matching issues",
                        "Start with simple tests and gradually add complexity",
                        "Use comment sections to document test intentions",
                        "Check .rep files to see actual vs expected output",
                        "Verify patterns work with refine_output before using in tests"
                    ]
                }
            }),
            "structured_tests" => json!({
                "topic": "Structured Test Format",
                "description": "AI-friendly JSON format for creating and modifying CLT tests",
                "content": {
                    "overview": "The structured test format provides a JSON representation of CLT tests that's easier for AI to work with than the raw .rec format",
                    "new_tools": {
                        "get_patterns": {
                            "purpose": "Get all available patterns for the current project",
                            "description": "Returns patterns from both system (.clt/patterns in CLT binary directory) and project (.clt/patterns in current directory)",
                            "usage": "Use to see what patterns are available for dynamic content matching"
                        },
                        "read_test": {
                            "purpose": "Convert .rec file to structured JSON format",
                            "description": "Parses CLT .rec files and converts them to AI-friendly JSON with nested block resolution",
                            "usage": "Use to analyze existing tests or prepare them for modification"
                        },
                        "write_test": {
                            "purpose": "Convert structured JSON to .rec file",
                            "description": "Takes JSON test structure and writes proper .rec file with CLT syntax. Automatically creates parent directories if needed.",
                            "usage": "Use to create new tests or save modified tests after working with JSON structure"
                        }
                    },
                    "json_structure": {
                        "root": {
                            "description": "Optional description text for the test file (appears before statements)",
                            "steps": "Array of test steps to execute"
                        },
                        "step_object": {
                            "type": "Step type: 'input', 'output', 'comment', or 'block'",
                            "args": "Array of arguments (checker names for output, block paths for block)",
                            "content": "Step content (commands, expected output, comment text, null for blocks)",
                            "steps": "Nested steps array (only for block types with resolved content)"
                        }
                    },
                    "workflow": [
                        "1. Use 'read_test' to convert existing .rec file to JSON",
                        "2. Modify the JSON structure as needed",
                        "3. Use 'write_test' to save the JSON back to .rec format",
                        "4. Use 'run_test' to execute the .rec file",
                        "5. Use 'get_patterns' to see available patterns for dynamic content"
                    ],
                    "advantages": [
                        "No need to learn CLT's en-dash syntax",
                        "Easy programmatic generation and modification",
                        "Structured representation of nested blocks",
                        "Full compatibility with existing CLT infrastructure"
                    ],
                    "examples": {
                        "simple_test": {
                            "description": "A simple test with description",
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
                        },
                        "with_checker": {
                            "steps": [
                                {
                                    "type": "output",
                                    "args": ["custom-checker"],
                                    "content": "Expected output"
                                }
                            ]
                        },
                        "with_block": {
                            "steps": [
                                {
                                    "type": "block",
                                    "args": ["setup/database"],
                                    "content": null,
                                    "steps": [
                                        {
                                            "type": "input",
                                            "args": [],
                                            "content": "setup database"
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                }
            }),
            _ => json!({
                "error": "Unknown help topic",
                "available_topics": ["overview", "test_format", "patterns", "blocks", "workflow", "examples", "troubleshooting", "structured_tests"],
                "usage": "Use clt_help tool with one of the available topics to get detailed information"
            }),
        }
    }

    /// Helper function to create a line-based diff similar to git diff format
    /// This makes the output much more AI-friendly than character-level mismatches
    fn create_line_diff(
        &self,
        expected: &str,
        actual: &str,
        pattern_matcher: &cmp::PatternMatcher,
    ) -> Vec<String> {
        let expected_lines: Vec<&str> = expected.lines().collect();
        let actual_lines: Vec<&str> = actual.lines().collect();
        let mut diff_lines = Vec::new();

        // Check if we have any differences at all
        let has_any_diff = expected_lines.len() != actual_lines.len()
            || expected_lines
                .iter()
                .zip(actual_lines.iter())
                .any(|(exp, act)| pattern_matcher.has_diff(exp.to_string(), act.to_string()));

        if !has_any_diff {
            return diff_lines; // No differences
        }

        // Add diff header
        diff_lines.push("--- expected".to_string());
        diff_lines.push("+++ actual".to_string());

        let max_lines = expected_lines.len().max(actual_lines.len());

        for i in 0..max_lines {
            match (expected_lines.get(i), actual_lines.get(i)) {
                (Some(exp_line), Some(act_line)) => {
                    // Both lines exist - check if they differ
                    if pattern_matcher.has_diff(exp_line.to_string(), act_line.to_string()) {
                        diff_lines.push(format!("-{}", exp_line));
                        diff_lines.push(format!("+{}", act_line));
                    } else {
                        // Lines match (considering patterns) - show as context
                        diff_lines.push(format!(" {}", exp_line));
                    }
                }
                (Some(exp_line), None) => {
                    // Line only in expected (deletion)
                    diff_lines.push(format!("-{}", exp_line));
                }
                (None, Some(act_line)) => {
                    // Line only in actual (addition)
                    diff_lines.push(format!("+{}", act_line));
                }
                (None, None) => break, // Should not happen given max_lines logic
            }
        }

        diff_lines
    }

    /// Generate a clear, human-readable summary of what differs
    fn create_diff_summary(
        &self,
        expected: &str,
        actual: &str,
        pattern_matcher: &cmp::PatternMatcher,
    ) -> String {
        let expected_lines: Vec<&str> = expected.lines().collect();
        let actual_lines: Vec<&str> = actual.lines().collect();

        let mut mismatched_lines = 0;
        let mut extra_lines_in_actual = 0;
        let mut missing_lines_in_actual = 0;

        let max_lines = expected_lines.len().max(actual_lines.len());

        for i in 0..max_lines {
            match (expected_lines.get(i), actual_lines.get(i)) {
                (Some(exp_line), Some(act_line)) => {
                    if pattern_matcher.has_diff(exp_line.to_string(), act_line.to_string()) {
                        mismatched_lines += 1;
                    }
                }
                (Some(_), None) => missing_lines_in_actual += 1,
                (None, Some(_)) => extra_lines_in_actual += 1,
                (None, None) => break,
            }
        }

        let mut summary_parts = Vec::new();

        if mismatched_lines > 0 {
            summary_parts.push(format!(
                "{} line(s) with content differences",
                mismatched_lines
            ));
        }
        if missing_lines_in_actual > 0 {
            summary_parts.push(format!(
                "{} line(s) missing in actual output",
                missing_lines_in_actual
            ));
        }
        if extra_lines_in_actual > 0 {
            summary_parts.push(format!(
                "{} extra line(s) in actual output",
                extra_lines_in_actual
            ));
        }

        if summary_parts.is_empty() {
            "Output matches expected pattern".to_string()
        } else {
            format!("Output differences found: {}", summary_parts.join(", "))
        }
    }

    /// Execute test_match tool with improved diff-based output
    ///
    /// This function compares expected vs actual strings using CLT's pattern matching
    /// and returns a clear, AI-friendly diff format instead of complex character-level mismatches.
    ///
    /// Returns:
    /// - matches: boolean indicating if strings match (considering patterns)
    /// - diff_lines: git-style diff showing line-by-line differences
    /// - summary: human-readable explanation of differences
    fn execute_test_match(&self, expected: &str, actual: &str) -> Result<TestMatchOutput> {
        // Use the same pattern loading logic as get_patterns tool
        let patterns = parser::get_patterns(self.clt_binary_path.as_deref())?;

        // Create a temporary patterns file for the cmp crate
        let temp_patterns_file = if !patterns.is_empty() {
            let temp_file = std::env::temp_dir().join("clt_patterns_temp");
            let mut pattern_lines = Vec::new();
            for (name, regex) in &patterns {
                pattern_lines.push(format!("{} {}", name, regex));
            }
            fs::write(&temp_file, pattern_lines.join("\n"))?;
            Some(temp_file.to_string_lossy().to_string())
        } else {
            None
        };

        let pattern_matcher = cmp::PatternMatcher::new(temp_patterns_file)
            .map_err(|e| anyhow::anyhow!("Failed to create pattern matcher: {}", e))?;

        let has_diff = pattern_matcher.has_diff(expected.to_string(), actual.to_string());

        let (diff_lines, summary) = if has_diff {
            let diff = self.create_line_diff(expected, actual, &pattern_matcher);
            let summary = self.create_diff_summary(expected, actual, &pattern_matcher);
            (diff, summary)
        } else {
            (Vec::new(), "Output matches expected pattern".to_string())
        };

        Ok(TestMatchOutput {
            matches: !has_diff,
            diff_lines,
            summary,
        })
    }

    /// Resolve test file path to absolute path based on working directory
    fn resolve_test_path(&self, test_file: &str) -> Result<String> {
        let test_path = std::path::Path::new(test_file);

        if test_path.is_absolute() {
            // Already absolute, validate it exists or can be created
            let canonical_path = match std::fs::canonicalize(test_path) {
                Ok(path) => path,
                Err(_) => {
                    // If canonicalize fails, check if parent directory exists
                    if let Some(parent) = test_path.parent() {
                        if !parent.exists() {
                            return Err(anyhow::anyhow!(
                                "Parent directory does not exist for test file: {}",
                                test_path.display()
                            ));
                        }
                    }
                    test_path.to_path_buf()
                }
            };
            Ok(canonical_path.to_string_lossy().to_string())
        } else {
            // Resolve relative to working directory
            let workdir = std::path::Path::new(&self.workdir_path);

            // Ensure working directory exists
            if !workdir.exists() {
                return Err(anyhow::anyhow!(
                    "Working directory does not exist: {}",
                    workdir.display()
                ));
            }

            let resolved = workdir.join(test_path);

            // For relative paths, we need to ensure the parent directory exists for write operations
            if let Some(parent) = resolved.parent() {
                if !parent.exists() {
                    // This is not necessarily an error for read operations, but we should note it
                    // The actual file operations will handle this appropriately
                }
            }

            Ok(resolved.to_string_lossy().to_string())
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    let mut server = McpServer::new(args.docker_image, args.clt_binary_path, args.workdir_path)?;

    server.run().await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;
    use tokio_test;

    fn create_fake_clt_binary() -> NamedTempFile {
        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, "#!/bin/bash\necho 'fake clt binary'").unwrap();
        temp_file
    }

    #[test]
    fn test_mcp_server_new_with_valid_bin() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let server = McpServer::new("test-image".to_string(), Some(temp_path), None);

        assert!(server.is_ok());
    }

    #[test]
    fn test_mcp_server_new_with_invalid_bin() {
        let server = McpServer::new(
            "test-image".to_string(),
            Some("/nonexistent/path".to_string()),
            None,
        );

        assert!(server.is_err());
        assert!(server
            .unwrap_err()
            .to_string()
            .contains("CLT binary not found"));
    }

    #[test]
    fn test_handle_initialize() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let server = McpServer::new("test-image".to_string(), Some(temp_path), None).unwrap();

        let response = server.handle_initialize(Some(json!(1)), None);

        assert_eq!(response.jsonrpc, "2.0");
        assert_eq!(response.id, Some(json!(1)));
        assert!(response.result.is_some());
        assert!(response.error.is_none());

        let result = response.result.unwrap();
        assert_eq!(result["protocolVersion"], "2024-11-05");
        assert_eq!(result["serverInfo"]["name"], "CLT MCP Server");
    }

    #[test]
    fn test_handle_tools_list() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let server = McpServer::new("test-image".to_string(), Some(temp_path), None).unwrap();

        let response = server.handle_tools_list(Some(json!(2)));

        assert_eq!(response.jsonrpc, "2.0");
        assert_eq!(response.id, Some(json!(2)));
        assert!(response.result.is_some());

        let result = response.result.unwrap();
        let tools = result["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 9);

        let tool_names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(tool_names.contains(&"run_test"));
        assert!(tool_names.contains(&"refine_output"));
        assert!(tool_names.contains(&"test_match"));
        assert!(tool_names.contains(&"clt_help"));
        assert!(tool_names.contains(&"get_patterns"));
        assert!(tool_names.contains(&"read_test"));
        assert!(tool_names.contains(&"write_test"));
        assert!(tool_names.contains(&"update_test"));
        assert!(tool_names.contains(&"append_test"));
    }

    #[tokio::test]
    async fn test_execute_test_match_tool() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let mut server = McpServer::new("test-image".to_string(), Some(temp_path), None).unwrap();

        let args = json!({
            "expected": "Hello World",
            "actual": "Hello World"
        });

        let result = server.execute_tool("test_match", Some(args)).await.unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let test_result = &parsed["result"];

        assert!(test_result["matches"].as_bool().unwrap());
        assert!(test_result["diff_lines"].as_array().unwrap().is_empty());
        assert_eq!(test_result["summary"], "Output matches expected pattern");
    }

    #[tokio::test]
    async fn test_execute_test_match_tool_with_mismatch() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let mut server = McpServer::new("test-image".to_string(), Some(temp_path), None).unwrap();

        let args = json!({
            "expected": "Hello World",
            "actual": "Hello Universe"
        });

        let result = server.execute_tool("test_match", Some(args)).await.unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let test_result = &parsed["result"];

        assert!(!test_result["matches"].as_bool().unwrap());
        assert!(!test_result["diff_lines"].as_array().unwrap().is_empty());
        assert!(test_result["summary"]
            .as_str()
            .unwrap()
            .contains("differences"));
    }

    #[tokio::test]
    async fn test_execute_refine_output_tool() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let mut server = McpServer::new("test-image".to_string(), Some(temp_path), None).unwrap();

        let args = json!({
            "expected": "Version: 1.2.3",
            "actual": "Version: 2.4.6"
        });

        let result = server
            .execute_tool("refine_output", Some(args))
            .await
            .unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let refine_result = &parsed["result"];

        // Should provide some suggestions or patterns
        assert!(
            !refine_result["suggestions"].as_array().unwrap().is_empty()
                || !refine_result["patterns_applied"]
                    .as_array()
                    .unwrap()
                    .is_empty()
        );
    }

    #[tokio::test]
    async fn test_execute_run_test_tool_with_nonexistent_file() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let mut server = McpServer::new("test-image".to_string(), Some(temp_path), None).unwrap();

        let args = json!({
            "test_file": "/nonexistent/test.rec"
        });

        let result = server.execute_tool("run_test", Some(args)).await.unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let test_result = &parsed["result"];

        assert!(!test_result["success"].as_bool().unwrap());
        assert_eq!(test_result["errors"].as_array().unwrap().len(), 1);
        assert_eq!(test_result["errors"][0]["command"], "file_check");
        assert!(test_result["errors"][0]["actual"]
            .as_str()
            .unwrap()
            .contains("File not found"));
    }

    #[tokio::test]
    async fn test_execute_unknown_tool() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let mut server = McpServer::new("test-image".to_string(), Some(temp_path), None).unwrap();

        let result = server.execute_tool("unknown_tool", None).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Unknown tool"));
    }

    #[tokio::test]
    async fn test_execute_clt_help_tool() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let mut server = McpServer::new("test-image".to_string(), Some(temp_path), None).unwrap();

        let args = json!({
            "topic": "overview"
        });

        let result = server.execute_tool("clt_help", Some(args)).await.unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();

        assert_eq!(parsed["topic"], "CLT Overview");
        assert!(parsed["content"]["what_is_clt"].is_string());
        assert!(parsed["content"]["key_features"].is_array());
    }

    #[test]
    fn test_handle_request_unknown_method() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let mut server = McpServer::new("test-image".to_string(), Some(temp_path), None).unwrap();

        let request = McpRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            method: "unknown_method".to_string(),
            params: None,
        };

        let response = tokio_test::block_on(server.handle_request(request));

        assert!(response.error.is_some());
        assert_eq!(response.error.unwrap().code, -32601);
    }

    #[test]
    fn test_mcp_response_constructors() {
        let success_response = McpResponse::success(Some(json!(1)), json!({"test": "data"}));
        assert_eq!(success_response.jsonrpc, "2.0");
        assert_eq!(success_response.id, Some(json!(1)));
        assert!(success_response.result.is_some());
        assert!(success_response.error.is_none());

        let error_response =
            McpResponse::error(Some(json!(2)), -32602, "Invalid params".to_string());
        assert_eq!(error_response.jsonrpc, "2.0");
        assert_eq!(error_response.id, Some(json!(2)));
        assert!(error_response.result.is_none());
        assert!(error_response.error.is_some());
        assert_eq!(error_response.error.unwrap().code, -32602);
    }

    #[tokio::test]
    async fn test_run_test_with_custom_docker_image() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let mut server =
            McpServer::new("default-image".to_string(), Some(temp_path), None).unwrap();

        // Test with custom docker_image parameter
        let args = json!({
            "test_file": "/nonexistent/test.rec",
            "docker_image": "custom-image"
        });

        let result = server.execute_tool("run_test", Some(args)).await.unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();

        // Verify the custom docker image is used
        assert_eq!(parsed["docker_image"], "custom-image");
        assert!(parsed["help"]["docker_image_info"]
            .as_str()
            .unwrap()
            .contains("custom-image"));
        assert!(parsed["help"]["docker_image_info"]
            .as_str()
            .unwrap()
            .contains("default: default-image"));
    }

    #[tokio::test]
    async fn test_run_test_with_default_docker_image() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let mut server =
            McpServer::new("default-image".to_string(), Some(temp_path), None).unwrap();

        // Test without docker_image parameter (should use default)
        let args = json!({
            "test_file": "/nonexistent/test.rec"
        });

        let result = server.execute_tool("run_test", Some(args)).await.unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();

        // Verify the default docker image is used
        assert_eq!(parsed["docker_image"], "default-image");
        assert!(parsed["help"]["docker_image_info"]
            .as_str()
            .unwrap()
            .contains("default-image"));
    }
}

#[cfg(test)]
mod test_string_format {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_test_structure_object_format() {
        let json_input = json!({
            "test_file": "test.rec",
            "test_structure": {
                "description": "Test description",
                "steps": [
                    {
                        "type": "input",
                        "args": [],
                        "content": "echo hello"
                    }
                ]
            }
        });

        let result: mcp_protocol::WriteTestInputWithWarning =
            serde_json::from_value(json_input).unwrap();
        assert_eq!(result.test_file, "test.rec");
        assert!(!result.test_structure.was_string);
        assert_eq!(
            result.test_structure.structure.description,
            Some("Test description".to_string())
        );
    }

    #[test]
    fn test_test_structure_string_format() {
        let test_structure_json = json!({
            "description": "Test description",
            "steps": [
                {
                    "type": "input",
                    "args": [],
                    "content": "echo hello"
                }
            ]
        });

        let json_input = json!({
            "test_file": "test.rec",
            "test_structure": serde_json::to_string(&test_structure_json).unwrap()
        });

        let result: mcp_protocol::WriteTestInputWithWarning =
            serde_json::from_value(json_input).unwrap();
        assert_eq!(result.test_file, "test.rec");
        assert!(result.test_structure.was_string); // Should be true for string format
        assert_eq!(
            result.test_structure.structure.description,
            Some("Test description".to_string())
        );
    }

    #[test]
    fn test_test_replace_input_string_format() {
        let test_structure_json = json!({
            "description": "Test description",
            "steps": [
                {
                    "type": "input",
                    "args": [],
                    "content": "echo hello"
                }
            ]
        });

        let json_input = json!({
            "test_file": "test.rec",
            "old_test_structure": serde_json::to_string(&test_structure_json).unwrap(),
            "new_test_structure": test_structure_json
        });

        let result: mcp_protocol::TestReplaceInputWithWarning =
            serde_json::from_value(json_input).unwrap();
        assert_eq!(result.test_file, "test.rec");
        assert!(result.old_test_structure.was_string); // String format
        assert!(!result.new_test_structure.was_string); // Object format
    }

    #[test]
    fn test_invalid_json_string() {
        let json_input = json!({
            "test_file": "test.rec",
            "test_structure": "invalid json string"
        });

        let result: Result<mcp_protocol::WriteTestInputWithWarning, _> =
            serde_json::from_value(json_input);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid JSON string"));
    }

    #[test]
    fn test_invalid_type() {
        let json_input = json!({
            "test_file": "test.rec",
            "test_structure": 123  // Invalid type
        });

        let result: Result<mcp_protocol::WriteTestInputWithWarning, _> =
            serde_json::from_value(json_input);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must be an object or a JSON string"));
    }
}
