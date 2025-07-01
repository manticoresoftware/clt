use crate::mcp_protocol::*;
use serde_json::json;

/// Tool definitions and schemas for MCP server
#[derive(Debug)]
pub struct ToolDefinitions {
    pub docker_image: String,
}

impl ToolDefinitions {
    pub fn new(docker_image: String) -> Self {
        Self { docker_image }
    }

    pub fn get_tools(&self) -> Vec<McpTool> {
        vec![
            self.run_test_tool(),
            self.refine_output_tool(),
            self.test_match_tool(),
            self.clt_help_tool(),
            self.get_patterns_tool(),
            self.read_test_tool(),
            self.write_test_tool(),
            self.update_test_tool(),
            self.append_test_tool(),
        ]
    }

    fn run_test_tool(&self) -> McpTool {
        McpTool {
            name: "run_test".to_string(),
            description: format!(
                "Execute a CLT test file in Docker container. Returns status: PASSED (exit 0), FAILED (exit 1 - test ran but outputs didn't match), or ERROR (exit 2+ - system/validation error). Docker image defaults to '{}' if not specified.",
                self.docker_image
            ),
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
        }
    }

    fn refine_output_tool(&self) -> McpTool {
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
        }
    }

    fn test_match_tool(&self) -> McpTool {
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
        }
    }

    fn clt_help_tool(&self) -> McpTool {
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
        }
    }

    fn get_patterns_tool(&self) -> McpTool {
        McpTool {
            name: "get_patterns".to_string(),
            description: "Get all available patterns for the current CLT project. Returns predefined patterns that can be used in test outputs for dynamic content matching.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        }
    }

    fn read_test_tool(&self) -> McpTool {
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
        }
    }

    fn write_test_tool(&self) -> McpTool {
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
        }
    }

    fn update_test_tool(&self) -> McpTool {
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
        }
    }

    fn append_test_tool(&self) -> McpTool {
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
        }
    }
}