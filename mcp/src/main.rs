mod mcp_protocol;
mod test_runner;
mod pattern_refiner;

use mcp_protocol::*;
use test_runner::TestRunner;
use pattern_refiner::PatternRefiner;

use anyhow::Result;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader as AsyncBufReader};

#[derive(Debug)]
struct McpServer {
    #[allow(dead_code)]
    docker_image: String,
    test_runner: TestRunner,
    pattern_refiner: PatternRefiner,
}

impl McpServer {
    fn new(docker_image: String, clt_binary_path: Option<String>) -> Result<Self> {
        let test_runner = TestRunner::new(docker_image.clone(), clt_binary_path)?;
        let pattern_refiner = PatternRefiner::new()?;

        Ok(Self {
            docker_image,
            test_runner,
            pattern_refiner,
        })
    }

    async fn run(&mut self) -> Result<()> {
        let stdin = tokio::io::stdin();
        let mut reader = AsyncBufReader::new(stdin);
        let mut stdout = tokio::io::stdout();

        let mut line = String::new();
        while reader.read_line(&mut line).await? > 0 {
            if let Ok(request) = serde_json::from_str::<McpRequest>(line.trim()) {
                let response = self.handle_request(request).await;
                let response_json = serde_json::to_string(&response)?;
                stdout.write_all(response_json.as_bytes()).await?;
                stdout.write_all(b"\n").await?;
                stdout.flush().await?;
            }
            line.clear();
        }

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
                description: "Execute a CLT (Command Line Tester) test file and return detailed results. CLT tests are defined in .rec files containing input commands and expected outputs. Test files can include reusable blocks from .recb files using '––– block: relative-path –––' statements. This tool runs the test in a Docker container, compiles any included blocks, and compares actual vs expected results, providing structured error information for any mismatches. Use this to validate that command-line applications behave as expected.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "test_path": {
                            "type": "string",
                            "description": "Absolute path to the .rec test file. CLT test files use a specific format with sections like '––– input –––' (commands to execute) and '––– output –––' (expected results). Example: /path/to/test.rec"
                        }
                    },
                    "required": ["test_path"],
                    "additionalProperties": false
                }),
            },
            McpTool {
                name: "refine_output".to_string(),
                description: "Analyze differences between expected and actual command outputs, then suggest regex patterns to handle dynamic content. This tool uses diff analysis to identify parts that change between test runs (like timestamps, PIDs, version numbers) and suggests CLT-compatible patterns to make tests more robust. It supports both named patterns from .clt/patterns file (like %{SEMVER} for version numbers) and custom regex patterns (like #!/[0-9]+/!# for any number). Use this when test outputs contain dynamic data that changes between runs.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "expected": {
                            "type": "string",
                            "description": "The expected output string from your test. This can already contain CLT patterns like %{SEMVER} for semantic versions or #!/regex/!# for custom patterns. Example: 'Process started with PID 1234'"
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
                description: "Compare expected vs actual output strings using CLT's pattern matching engine. This tool understands CLT pattern syntax including named patterns (%{PATTERN_NAME}) and regex patterns (#!/regex/!#), and performs intelligent matching that can handle dynamic content. It returns detailed mismatch information showing exactly where and why strings don't match, including character positions and context. Use this to validate if test outputs match expectations, especially when they contain patterns for dynamic data.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "expected": {
                            "type": "string",
                            "description": "Expected output string with optional CLT patterns. Patterns include: %{SEMVER} (semantic versions like 1.2.3), %{IPADDR} (IP addresses), %{DATE} (dates), %{TIME} (times), %{NUMBER} (any number), #!/[0-9]+/!# (custom regex for numbers), #!/[0-9]{4}-[0-9]{2}-[0-9]{2}/!# (custom regex for dates). Example: 'Server started on %{IPADDR} at %{TIME}'"
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
                description: "Get comprehensive documentation about CLT (Command Line Tester) concepts, file formats, pattern syntax, and workflow examples. This tool provides detailed explanations of how CLT works, the .rec file format, pattern matching syntax, and step-by-step examples for common testing scenarios. Use this to understand CLT concepts before using other tools.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "topic": {
                            "type": "string",
                            "description": "Help topic to explain. Options: 'overview' (CLT introduction), 'rec_format' (.rec file structure), 'patterns' (pattern syntax guide), 'blocks' (reusable test blocks and .recb files), 'workflow' (testing workflow), 'examples' (practical examples), 'troubleshooting' (common issues)",
                            "enum": ["overview", "rec_format", "patterns", "blocks", "workflow", "examples", "troubleshooting"]
                        }
                    },
                    "required": ["topic"],
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

        let result = match self.execute_tool(&tool_call.name, tool_call.arguments).await {
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
        match tool_name {
            "run_test" => {
                let input: RunTestInput = serde_json::from_value(
                    arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
                )?;
                let output = self.test_runner.run_test(&input.test_path)?;
                
                // Add helpful context to the output
                let enhanced_output = json!({
                    "tool": "run_test",
                    "description": "CLT test execution results",
                    "test_file": input.test_path,
                    "result": output,
                    "help": {
                        "success_meaning": "true = test passed, all commands executed and outputs matched expectations",
                        "errors_meaning": "Array of specific mismatches between expected and actual outputs",
                        "next_steps": "If test failed, use 'refine_output' tool to suggest patterns for dynamic content"
                    }
                });
                
                Ok(serde_json::to_string_pretty(&enhanced_output)?)
            }
            "refine_output" => {
                let input: RefineOutputInput = serde_json::from_value(
                    arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
                )?;
                let output = self.pattern_refiner.refine_output(&input.expected, &input.actual)?;
                
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
                        "mismatches_details": "Character-by-character differences with position and context",
                        "pattern_support": "Understands %{PATTERN} and #!/regex/!# syntax for dynamic content",
                        "next_steps": "If match fails, check mismatches array for specific differences, then use 'refine_output' to suggest patterns"
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
            _ => {
                anyhow::bail!("Unknown tool: {}. Available tools: run_test, refine_output, test_match, clt_help", tool_name);
            }
        }
    }

    fn get_help_content(&self, topic: &str) -> Value {
        match topic {
            "overview" => json!({
                "topic": "CLT Overview",
                "description": "CLT (Command Line Tester) is a testing framework for command-line applications",
                "content": {
                    "what_is_clt": "CLT allows you to record interactive command sessions, save them as test files (.rec), and replay them to verify consistent behavior. All commands run inside Docker containers for reproducible environments.",
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
                        "3. Exit with Ctrl+D to save the .rec file",
                        "4. Replay test: clt test -t mytest.rec -d ubuntu:20.04",
                        "5. Refine patterns if dynamic content causes failures"
                    ],
                    "file_types": {
                        ".rec": "Test recording files with input/output sections",
                        ".rep": "Test replay results (generated during test execution)",
                        ".recb": "Reusable test blocks that can be included in .rec files"
                    }
                }
            }),
            "rec_format" => json!({
                "topic": "CLT .rec File Format",
                "description": "Structure and syntax of CLT test recording files",
                "content": {
                    "basic_structure": "CLT files use section markers with en dashes (–) to separate different parts",
                    "section_types": {
                        "input": {
                            "marker": "––– input –––",
                            "purpose": "Contains commands to execute",
                            "example": "echo 'Hello World'"
                        },
                        "output": {
                            "marker": "––– output –––",
                            "purpose": "Contains expected output from the command",
                            "example": "Hello World"
                        },
                        "block": {
                            "marker": "––– block: filename –––",
                            "purpose": "Includes reusable test blocks from .recb files",
                            "example": "––– block: login-sequence –––",
                            "important": "Block files (.recb) must be in relative path from the current .rec file location",
                            "path_rules": [
                                "Relative to the .rec file containing the block statement",
                                "Can use subdirectories: ––– block: auth/admin-login –––",
                                "Always use .recb extension for block files",
                                "Block files can include other blocks (nested blocks supported)"
                            ]
                        },
                        "comment": {
                            "marker": "––– comment –––",
                            "purpose": "Documentation (ignored during execution)",
                            "example": "This test validates user authentication"
                        }
                    },
                    "complete_example": [
                        "––– comment –––",
                        "Test with reusable login block",
                        "––– block: common/login-sequence –––",
                        "––– input –––",
                        "echo 'After login'",
                        "––– output –––",
                        "After login"
                    ],
                    "block_file_structure": {
                        "description": "Block files (.recb) contain reusable test sequences",
                        "location": "Must be relative to the .rec file that includes them",
                        "format": "Same as .rec files but without the .rec extension",
                        "example_structure": [
                            "tests/",
                            "├── main-test.rec         # Main test file",
                            "├── login-sequence.recb   # Block in same directory", 
                            "└── auth/",
                            "    └── admin-login.recb  # Block in subdirectory"
                        ],
                        "usage_in_rec": [
                            "––– block: login-sequence –––      # Same directory",
                            "––– block: auth/admin-login –––    # Subdirectory"
                        ]
                    },
                    "important_notes": [
                        "Use en dashes (–) not regular hyphens (-) in section markers",
                        "Each input section should have a corresponding output section",
                        "Patterns can be used in output sections for dynamic content"
                    ]
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
            _ => json!({
                "error": "Unknown help topic",
                "available_topics": ["overview", "rec_format", "patterns", "workflow", "examples", "troubleshooting"],
                "usage": "Use clt_help tool with one of the available topics to get detailed information"
            })
        }
    }

    fn execute_test_match(&self, expected: &str, actual: &str) -> Result<TestMatchOutput> {
        // Use the existing PatternMatcher from cmp crate with patterns file
        // Try to find patterns file in current directory or parent directory
        let patterns_path = if std::path::Path::new(".clt/patterns").exists() {
            Some(".clt/patterns".to_string())
        } else if std::path::Path::new("../.clt/patterns").exists() {
            Some("../.clt/patterns".to_string())
        } else {
            None
        };
        
        let pattern_matcher = cmp::PatternMatcher::new(patterns_path)
            .map_err(|e| anyhow::anyhow!("Failed to create pattern matcher: {}", e))?;

        let has_diff = pattern_matcher.has_diff(expected.to_string(), actual.to_string());
        
        let mut mismatches = Vec::new();

        let summary = if has_diff {
            // Find specific mismatches by comparing character by character
            let expected_chars: Vec<char> = expected.chars().collect();
            let actual_chars: Vec<char> = actual.chars().collect();
            
            let max_len = expected_chars.len().max(actual_chars.len());
            for i in 0..max_len {
                let expected_char = expected_chars.get(i).copied().unwrap_or('\0');
                let actual_char = actual_chars.get(i).copied().unwrap_or('\0');
                
                if expected_char != actual_char {
                    // Get context around the mismatch
                    let context_start = i.saturating_sub(10);
                    let context_end = (i + 10).min(max_len);
                    let context = expected_chars[context_start..context_end.min(expected_chars.len())]
                        .iter()
                        .collect::<String>();
                    
                    mismatches.push(Mismatch {
                        position: i,
                        expected_char: if expected_char == '\0' { "EOF".to_string() } else { expected_char.to_string() },
                        actual_char: if actual_char == '\0' { "EOF".to_string() } else { actual_char.to_string() },
                        context,
                    });
                    
                    // Only report first few mismatches to avoid overwhelming output
                    if mismatches.len() >= 5 {
                        break;
                    }
                }
            }
            
            format!("Output does not match. Found {} mismatch(es)", mismatches.len())
        } else {
            "Output matches expected pattern".to_string()
        };

        Ok(TestMatchOutput {
            matches: !has_diff,
            mismatches,
            summary,
        })
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    
    if args.len() < 3 {
        eprintln!("Usage: clt-mcp --docker-image <image> [--bin <clt-binary-path>]");
        std::process::exit(1);
    }
    
    let mut docker_image = None;
    let mut clt_binary_path = None;
    let mut i = 1;
    
    while i < args.len() {
        match args[i].as_str() {
            "--docker-image" => {
                if i + 1 >= args.len() {
                    eprintln!("Error: --docker-image requires a value");
                    std::process::exit(1);
                }
                docker_image = Some(args[i + 1].clone());
                i += 2;
            }
            "--bin" => {
                if i + 1 >= args.len() {
                    eprintln!("Error: --bin requires a value");
                    std::process::exit(1);
                }
                clt_binary_path = Some(args[i + 1].clone());
                i += 2;
            }
            _ => {
                eprintln!("Error: Unknown argument: {}", args[i]);
                eprintln!("Usage: clt-mcp --docker-image <image> [--bin <clt-binary-path>]");
                std::process::exit(1);
            }
        }
    }
    
    let docker_image = docker_image.ok_or_else(|| {
        anyhow::anyhow!("--docker-image is required")
    })?;
    
    let mut server = McpServer::new(docker_image, clt_binary_path)?;
    
    server.run().await?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use std::io::Write;
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

        let server = McpServer::new(
            "test-image".to_string(),
            Some(temp_path)
        );

        assert!(server.is_ok());
    }

    #[test]
    fn test_mcp_server_new_with_invalid_bin() {
        let server = McpServer::new(
            "test-image".to_string(),
            Some("/nonexistent/path".to_string())
        );

        assert!(server.is_err());
        assert!(server.unwrap_err().to_string().contains("CLT binary not found"));
    }

    #[test]
    fn test_handle_initialize() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();
        
        let server = McpServer::new(
            "test-image".to_string(),
            Some(temp_path)
        ).unwrap();

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
        
        let server = McpServer::new(
            "test-image".to_string(),
            Some(temp_path)
        ).unwrap();

        let response = server.handle_tools_list(Some(json!(2)));
        
        assert_eq!(response.jsonrpc, "2.0");
        assert_eq!(response.id, Some(json!(2)));
        assert!(response.result.is_some());
        
        let result = response.result.unwrap();
        let tools = result["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 4);
        
        let tool_names: Vec<&str> = tools.iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert!(tool_names.contains(&"run_test"));
        assert!(tool_names.contains(&"refine_output"));
        assert!(tool_names.contains(&"test_match"));
        assert!(tool_names.contains(&"clt_help"));
    }

    #[tokio::test]
    async fn test_execute_test_match_tool() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();
        
        let mut server = McpServer::new(
            "test-image".to_string(),
            Some(temp_path)
        ).unwrap();

        let args = json!({
            "expected": "Hello World",
            "actual": "Hello World"
        });

        let result = server.execute_tool("test_match", Some(args)).await.unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let test_result = &parsed["result"];
        
        assert!(test_result["matches"].as_bool().unwrap());
        assert!(test_result["mismatches"].as_array().unwrap().is_empty());
        assert_eq!(test_result["summary"], "Output matches expected pattern");
    }

    #[tokio::test]
    async fn test_execute_test_match_tool_with_mismatch() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();
        
        let mut server = McpServer::new(
            "test-image".to_string(),
            Some(temp_path)
        ).unwrap();

        let args = json!({
            "expected": "Hello World",
            "actual": "Hello Universe"
        });

        let result = server.execute_tool("test_match", Some(args)).await.unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let test_result = &parsed["result"];
        
        assert!(!test_result["matches"].as_bool().unwrap());
        assert!(!test_result["mismatches"].as_array().unwrap().is_empty());
        assert!(test_result["summary"].as_str().unwrap().contains("mismatch"));
    }

    #[tokio::test]
    async fn test_execute_refine_output_tool() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();
        
        let mut server = McpServer::new(
            "test-image".to_string(),
            Some(temp_path)
        ).unwrap();

        let args = json!({
            "expected": "Version: 1.2.3",
            "actual": "Version: 2.4.6"
        });

        let result = server.execute_tool("refine_output", Some(args)).await.unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let refine_result = &parsed["result"];
        
        // Should provide some suggestions or patterns
        assert!(!refine_result["suggestions"].as_array().unwrap().is_empty() || 
                !refine_result["patterns_applied"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_execute_run_test_tool_with_nonexistent_file() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();
        
        let mut server = McpServer::new(
            "test-image".to_string(),
            Some(temp_path)
        ).unwrap();

        let args = json!({
            "test_path": "/nonexistent/test.rec"
        });

        let result = server.execute_tool("run_test", Some(args)).await.unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let test_result = &parsed["result"];
        
        assert!(!test_result["success"].as_bool().unwrap());
        assert_eq!(test_result["errors"].as_array().unwrap().len(), 1);
        assert_eq!(test_result["errors"][0]["command"], "file_check");
        assert!(test_result["errors"][0]["actual"].as_str().unwrap().contains("File not found"));
    }

    #[tokio::test]
    async fn test_execute_unknown_tool() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();
        
        let mut server = McpServer::new(
            "test-image".to_string(),
            Some(temp_path)
        ).unwrap();

        let result = server.execute_tool("unknown_tool", None).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Unknown tool"));
    }

    #[tokio::test]
    async fn test_execute_clt_help_tool() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();
        
        let mut server = McpServer::new(
            "test-image".to_string(),
            Some(temp_path)
        ).unwrap();

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
        
        let mut server = McpServer::new(
            "test-image".to_string(),
            Some(temp_path)
        ).unwrap();

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

        let error_response = McpResponse::error(Some(json!(2)), -32602, "Invalid params".to_string());
        assert_eq!(error_response.jsonrpc, "2.0");
        assert_eq!(error_response.id, Some(json!(2)));
        assert!(error_response.result.is_none());
        assert!(error_response.error.is_some());
        assert_eq!(error_response.error.unwrap().code, -32602);
    }
}