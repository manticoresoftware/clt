use serde_json::{json, Value};

/// Help content provider for CLT documentation
pub struct HelpProvider;

impl HelpProvider {
    pub fn get_help_content(topic: &str) -> Value {
        match topic {
            "overview" => Self::overview_help(),
            "test_format" => Self::test_format_help(),
            "patterns" => Self::patterns_help(),
            "blocks" => Self::blocks_help(),
            "workflow" => Self::workflow_help(),
            "examples" => Self::examples_help(),
            "troubleshooting" => Self::troubleshooting_help(),
            "structured_tests" => Self::structured_tests_help(),
            _ => Self::unknown_topic_help(),
        }
    }

    fn overview_help() -> Value {
        json!({
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
        })
    }

    fn test_format_help() -> Value {
        json!({
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
                }
            }
        })
    }

    fn patterns_help() -> Value {
        json!({
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
                }
            }
        })
    }

    fn blocks_help() -> Value {
        json!({
            "topic": "CLT Reusable Blocks",
            "description": "How to create and use reusable test blocks with .recb files",
            "content": {
                "what_are_blocks": "Blocks are reusable test sequences stored in .recb files that can be included in multiple .rec test files. They help avoid duplication and create modular test components.",
                "key_concepts": {
                    "block_files": "Files with .recb extension containing reusable test sequences",
                    "relative_paths": "Block files must be located relative to the .rec file that includes them",
                    "nested_blocks": "Block files can include other blocks, creating hierarchical test structures",
                    "same_format": "Block files use the same format as .rec files (input/output sections)"
                }
            }
        })
    }

    fn workflow_help() -> Value {
        json!({
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
                }
            }
        })
    }

    fn examples_help() -> Value {
        json!({
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
                }
            }
        })
    }

    fn troubleshooting_help() -> Value {
        json!({
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
                }
            }
        })
    }

    fn structured_tests_help() -> Value {
        json!({
            "topic": "Structured Test Format",
            "description": "AI-friendly JSON format for creating and modifying CLT tests",
            "content": {
                "overview": "The structured test format provides a JSON representation of CLT tests that's easier for AI to work with than the raw .rec format",
                "workflow": [
                    "1. Use 'read_test' to convert existing .rec file to JSON",
                    "2. Modify the JSON structure as needed",
                    "3. Use 'write_test' to save the JSON back to .rec format",
                    "4. Use 'run_test' to execute the .rec file",
                    "5. Use 'get_patterns' to see available patterns for dynamic content"
                ]
            }
        })
    }

    fn unknown_topic_help() -> Value {
        json!({
            "error": "Unknown help topic",
            "available_topics": ["overview", "test_format", "patterns", "blocks", "workflow", "examples", "troubleshooting", "structured_tests"],
            "usage": "Use clt_help tool with one of the available topics to get detailed information"
        })
    }
}