use anyhow::Result;
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;

use crate::mcp_protocol::{self, *};
use crate::pattern_refiner::PatternRefiner;
use crate::test_runner::TestRunner;
use crate::{cmp, parser};

use super::config::ServerConfig;
use super::help::HelpProvider;
use super::utils::{DiffUtils, PathUtils};

/// Individual tool handlers
#[derive(Debug)]
pub struct ToolHandlers {
    pub config: ServerConfig,
    pub test_runner: TestRunner,
    pub pattern_refiner: PatternRefiner,
}

impl ToolHandlers {
    pub fn new(config: ServerConfig) -> Result<Self> {
        let test_runner = TestRunner::new(
            config.docker_image.clone(),
            config.clt_binary_path.clone(),
            config.workdir_path.clone(),
        )?;
        let pattern_refiner = PatternRefiner::new()?;

        Ok(Self {
            config,
            test_runner,
            pattern_refiner,
        })
    }

    pub async fn handle_run_test(&mut self, arguments: Option<Value>) -> Result<String> {
        let input: RunTestInput = serde_json::from_value(
            arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
        )?;

        // Safely resolve test path with proper error handling
        let resolved_test_path = match PathUtils::resolve_test_path(&self.config.workdir_path, &input.test_file) {
            Ok(path) => path,
            Err(e) => {
                // Return a structured error response instead of crashing
                let error_output = json!({
                    "tool": "run_test",
                    "status": "ERROR",
                    "test_file": input.test_file,
                    "docker_image": input.docker_image.as_deref().unwrap_or(&self.config.docker_image),
                    "result": {
                        "success": false,
                        "errors": [{
                            "command": "path_resolution",
                            "expected": "Valid test file path",
                            "actual": format!("Path error: {}", e),
                            "step": 0
                        }],
                        "summary": format!("Path error: {}", e)
                    },
                    "working_directory": self.config.workdir_path
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
                    "status": "ERROR", 
                    "test_file": input.test_file,
                    "docker_image": input.docker_image.as_deref().unwrap_or(&self.config.docker_image),
                    "result": {
                        "success": false,
                        "errors": [{
                            "command": "test_execution",
                            "expected": "Successful test execution",
                            "actual": format!("Execution failed: {}", e),
                            "step": 0
                        }],
                        "summary": format!("Execution failed: {}", e)
                    },
                    "working_directory": self.config.workdir_path
                });
                return Ok(serde_json::to_string_pretty(&error_output)?);
            }
        };

        // Add helpful context to the output with better exit code information
        let docker_image_used = input.docker_image.as_deref().unwrap_or(&self.config.docker_image);
        
        let test_status = if output.success {
            "PASSED"
        } else {
            "FAILED"
        };

        let enhanced_output = json!({
            "tool": "run_test",
            "status": test_status,
            "test_file": input.test_file,
            "docker_image": docker_image_used,
            "result": output,
            "exit_codes": {
                "0": "Test passed - all commands executed successfully and outputs matched",
                "1": "Test failed - commands ran but outputs didn't match expectations", 
                "2+": "System error - compilation, setup, validation, or crash occurred"
            }
        });

        Ok(serde_json::to_string_pretty(&enhanced_output)?)
    }

    pub fn handle_refine_output(&mut self, arguments: Option<Value>) -> Result<String> {
        let input: RefineOutputInput = serde_json::from_value(
            arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
        )?;
        let output = self
            .pattern_refiner
            .refine_output(&input.expected, &input.actual)?;

        let enhanced_output = json!({
            "tool": "refine_output",
            "result": output,
            "usage": "Copy 'refined_output' and use as expected output in your .rec test file"
        });

        Ok(serde_json::to_string_pretty(&enhanced_output)?)
    }

    pub fn handle_test_match(&self, arguments: Option<Value>) -> Result<String> {
        let input: TestMatchInput = serde_json::from_value(
            arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
        )?;
        let output = self.execute_test_match(&input.expected, &input.actual)?;

        let enhanced_output = json!({
            "tool": "test_match",
            "result": output
        });

        Ok(serde_json::to_string_pretty(&enhanced_output)?)
    }

    pub fn handle_clt_help(&self, arguments: Option<Value>) -> Result<String> {
        #[derive(Deserialize)]
        struct HelpInput {
            topic: String,
        }

        let input: HelpInput = serde_json::from_value(
            arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
        )?;

        let help_content = HelpProvider::get_help_content(&input.topic);
        Ok(serde_json::to_string_pretty(&help_content)?)
    }

    pub fn handle_get_patterns(&self, _arguments: Option<Value>) -> Result<String> {
        let patterns = parser::get_patterns(self.config.clt_binary_path.as_deref())?;

        let enhanced_output = json!({
            "tool": "get_patterns",
            "patterns": patterns
        });

        Ok(serde_json::to_string_pretty(&enhanced_output)?)
    }

    pub fn handle_read_test(&self, arguments: Option<Value>) -> Result<String> {
        let input: mcp_protocol::ReadTestInput = serde_json::from_value(
            arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
        )?;

        let test_structure =
            parser::read_test_file(&PathUtils::resolve_test_path(&self.config.workdir_path, &input.test_file)?)?;

        let enhanced_output = json!({
            "tool": "read_test",
            "test_file": input.test_file,
            "result": test_structure
        });

        Ok(serde_json::to_string_pretty(&enhanced_output)?)
    }

    pub fn handle_write_test(&self, arguments: Option<Value>) -> Result<String> {
        let input: mcp_protocol::WriteTestInputWithWarning = serde_json::from_value(
            arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
        )?;

        // Check if we need to add a warning about string parsing
        let mut warnings = Vec::new();
        if input.test_structure.was_string {
            warnings.push("test_structure was provided as a JSON string instead of an object. While this works, it's recommended to pass it as a direct JSON object for better performance and clarity.".to_string());
        }

        // Safely resolve test path with proper error handling
        let resolved_test_path = match PathUtils::resolve_test_path(&self.config.workdir_path, &input.test_file) {
            Ok(path) => path,
            Err(e) => {
                let mut error_output = json!({
                    "tool": "write_test",
                    "test_file": input.test_file,
                    "success": false,
                    "error": format!("Path error: {}", e)
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
                    "test_file": input.test_file,
                    "success": true
                });

                if !warnings.is_empty() {
                    enhanced_output["warnings"] = json!(warnings);
                }

                Ok(serde_json::to_string_pretty(&enhanced_output)?)
            }
            Err(e) => {
                let mut error_output = json!({
                    "tool": "write_test",
                    "test_file": input.test_file,
                    "success": false,
                    "error": format!("Write failed: {}", e)
                });

                if !warnings.is_empty() {
                    error_output["warnings"] = json!(warnings);
                }

                Ok(serde_json::to_string_pretty(&error_output)?)
            }
        }
    }

    pub fn handle_update_test(&self, arguments: Option<Value>) -> Result<String> {
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
        let resolved_test_path = match PathUtils::resolve_test_path(&self.config.workdir_path, &input.test_file) {
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
                        "working_directory": self.config.workdir_path
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

    pub fn handle_append_test(&self, arguments: Option<Value>) -> Result<String> {
        let input: mcp_protocol::TestAppendInputWithWarning = serde_json::from_value(
            arguments.ok_or_else(|| anyhow::anyhow!("Missing arguments"))?,
        )?;

        // Check if we need to add a warning about string parsing
        let mut warnings = Vec::new();
        if input.test_structure.was_string {
            warnings.push("test_structure was provided as a JSON string instead of an object. While this works, it's recommended to pass it as a direct JSON object for better performance and clarity.".to_string());
        }

        match parser::append_test_structure(
            &PathUtils::resolve_test_path(&self.config.workdir_path, &input.test_file)?,
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
        let patterns = parser::get_patterns(self.config.clt_binary_path.as_deref())?;

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
            let diff = DiffUtils::create_line_diff(expected, actual, &pattern_matcher);
            let summary = DiffUtils::create_diff_summary(expected, actual, &pattern_matcher);
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
}