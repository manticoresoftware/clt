use crate::mcp_protocol::{RunTestOutput, TestError};
use anyhow::{Context, Result};
use parser::{parse_rec_content, TestStructure};
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Debug)]
pub struct TestRunner {
    docker_image: String,
    clt_path: String,
    workdir_path: String,
}

impl TestRunner {
    pub fn new(
        docker_image: String,
        clt_binary_path: Option<String>,
        workdir_path: String,
    ) -> Result<Self> {
        let clt_path = match clt_binary_path {
            Some(path) => {
                let path_buf = std::path::Path::new(&path);
                if !path_buf.exists() {
                    return Err(anyhow::anyhow!(
                        "CLT binary not found at specified path: {}",
                        path
                    ));
                }
                if !path_buf.is_file() {
                    return Err(anyhow::anyhow!(
                        "Specified CLT path is not a file: {}",
                        path
                    ));
                }
                path
            }
            None => which::which("clt")
                .context("CLT executable not found in PATH. Use --bin to specify path.")?
                .to_string_lossy()
                .to_string(),
        };

        Ok(Self {
            docker_image,
            clt_path,
            workdir_path,
        })
    }

    pub fn run_test(&self, test_path: &str, docker_image: Option<&str>) -> Result<RunTestOutput> {
        let test_path = Path::new(test_path);

        if !test_path.exists() {
            return Ok(RunTestOutput {
                success: false,
                errors: vec![TestError {
                    command: "file_check".to_string(),
                    expected: "Test file should exist".to_string(),
                    actual: format!("File not found: {}", test_path.display()),
                    step: 0,
                }],
                summary: "Test file not found".to_string(),
            });
        }

        // Validate test file is readable
        if let Err(e) = fs::metadata(test_path) {
            return Ok(RunTestOutput {
                success: false,
                errors: vec![TestError {
                    command: "file_access".to_string(),
                    expected: "Test file should be accessible".to_string(),
                    actual: format!("Cannot access file {}: {}", test_path.display(), e),
                    step: 0,
                }],
                summary: "Test file access error".to_string(),
            });
        }

        // Use provided docker_image or fall back to the default from server startup
        let image_to_use = docker_image.unwrap_or(&self.docker_image);

        // Convert absolute test path to relative path from working directory for docker execution
        let workdir = Path::new(&self.workdir_path);

        // Validate working directory exists
        if !workdir.exists() {
            return Ok(RunTestOutput {
                success: false,
                errors: vec![TestError {
                    command: "workdir_check".to_string(),
                    expected: "Working directory should exist".to_string(),
                    actual: format!("Working directory not found: {}", workdir.display()),
                    step: 0,
                }],
                summary: "Working directory not found".to_string(),
            });
        }
        let relative_test_path = if test_path.is_absolute() {
            match test_path.strip_prefix(workdir) {
                Ok(rel_path) => rel_path.to_string_lossy().to_string(),
                Err(_) => {
                    // Test file is outside working directory, this might be an issue
                    return Ok(RunTestOutput {
                        success: false,
                        errors: vec![TestError {
                            command: "path_resolution".to_string(),
                            expected: "Test file should be within working directory".to_string(),
                            actual: format!(
                                "Test file {} is outside working directory {}",
                                test_path.display(),
                                workdir.display()
                            ),
                            step: 0,
                        }],
                        summary: "Test file path issue".to_string(),
                    });
                }
            }
        } else {
            test_path.to_string_lossy().to_string()
        };

        // Execute CLT test command with working directory set and proper error handling
        let output = match Command::new(&self.clt_path)
            .args(["test", "-t", &relative_test_path, "-d", image_to_use])
            .current_dir(&self.workdir_path) // Set working directory for CLT execution
            .output()
        {
            Ok(output) => output,
            Err(e) => {
                return Ok(RunTestOutput {
                    success: false,
                    errors: vec![TestError {
                        command: "clt_execution".to_string(),
                        expected: "CLT command should execute successfully".to_string(),
                        actual: format!("Failed to execute CLT: {}", e),
                        step: 0,
                    }],
                    summary: format!("CLT execution failed: {}", e),
                });
            }
        };

        let exit_code = output.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&output.stderr);

        match exit_code {
            0 => {
                // Test passed successfully
                Ok(RunTestOutput {
                    success: true,
                    errors: vec![],
                    summary: "Test passed successfully".to_string(),
                })
            }
            1 => {
                // Test failed but ran (expected test failure)
                let errors = match self.parse_test_failures_from_rep_file(test_path) {
                    Ok(errors) => errors,
                    Err(e) => {
                        // If we can't parse the rep file, create a generic error
                        vec![TestError {
                            command: "rep_file_parsing".to_string(),
                            expected: "Should be able to parse test results".to_string(),
                            actual: format!("Failed to parse test results: {}", e),
                            step: 0,
                        }]
                    }
                };

                let summary = if errors.is_empty() {
                    "Test failed - no specific errors identified".to_string()
                } else {
                    format!("Test failed with {} error(s)", errors.len())
                };

                Ok(RunTestOutput {
                    success: false,
                    errors,
                    summary,
                })
            }
            code => {
                // System error, validation error, or crash (exit code 2+)
                let error_type = match code {
                    2 => "compilation_error",
                    3 => "setup_error", 
                    4 => "recording_error",
                    5 => "validation_error",
                    _ if code >= 129 && code <= 143 => "signal_termination",
                    _ => "system_error",
                };

                let error_description = match code {
                    2 => "Compilation or build error occurred".to_string(),
                    3 => "Test setup or environment error".to_string(),
                    4 => "Recording or file system error".to_string(), 
                    5 => "Test validation or format error".to_string(),
                    _ if code >= 129 && code <= 143 => format!("Process terminated by signal {}", code - 128),
                    _ => format!("System error (exit code {})", code),
                };

                Ok(RunTestOutput {
                    success: false,
                    errors: vec![TestError {
                        command: error_type.to_string(),
                        expected: "Successful test execution".to_string(),
                        actual: format!("{}: {}", error_description, stderr.trim()),
                        step: 0,
                    }],
                    summary: format!("System error: {} (exit code {})", error_description, code),
                })
            }
        }
    }

    fn parse_test_failures_from_rep_file(&self, test_path: &Path) -> Result<Vec<TestError>> {
        let mut errors = Vec::new();

        // Check if .rep file exists (generated by CLT test execution)
        let rep_path = test_path.with_extension("rep");
        if !rep_path.exists() {
            // If no .rep file, create a generic error
            errors.push(TestError {
                command: "test_execution".to_string(),
                expected: "Test should generate .rep file".to_string(),
                actual: "No .rep file found after test execution".to_string(),
                step: 0,
            });
            return Ok(errors);
        }

        // Use CLT's cmp tool to compare .rec and .rep files with error handling
        // This ensures we use the same comparison logic as the native CLT test
        match self.compare_rec_rep_files(test_path, &rep_path) {
            Ok(comparison_errors) => {
                errors.extend(comparison_errors);
            }
            Err(e) => {
                // If comparison fails, add a generic comparison error
                errors.push(TestError {
                    command: "file_comparison".to_string(),
                    expected: "Should be able to compare test files".to_string(),
                    actual: format!("File comparison failed: {}", e),
                    step: 0,
                });
            }
        }

        Ok(errors)
    }

    fn compare_rec_rep_files(&self, rec_path: &Path, rep_path: &Path) -> Result<Vec<TestError>> {
        let mut errors = Vec::new();

        // Read both files with proper error handling
        let rec_content = fs::read_to_string(rec_path)
            .with_context(|| format!("Failed to read .rec file: {}", rec_path.display()))?;
        let rep_content = fs::read_to_string(rep_path)
            .with_context(|| format!("Failed to read .rep file: {}", rep_path.display()))?;

        // Parse REC file into structured format (reuse existing logic)
        let base_dir = rec_path.parent().ok_or_else(|| {
            anyhow::anyhow!(
                "Cannot determine parent directory of .rec file: {}",
                rec_path.display()
            )
        })?;

        let test_structure = match parse_rec_content(&rec_content, base_dir) {
            Ok(structure) => structure,
            Err(e) => {
                // If we can't parse the REC file, return a parsing error
                errors.push(TestError {
                    command: "rec_file_parsing".to_string(),
                    expected: "Valid .rec file format".to_string(),
                    actual: format!("Failed to parse .rec file: {}", e),
                    step: 0,
                });
                return Ok(errors);
            }
        };

        // Extract all expected outputs from structured REC (handles blocks, nesting, etc.)
        let expected_outputs = self.extract_all_outputs_from_structured(&test_structure);

        // Extract all actual outputs from flat REP file
        let actual_outputs = match self.extract_all_outputs_from_rep(&rep_content) {
            Ok(outputs) => outputs,
            Err(e) => {
                errors.push(TestError {
                    command: "rep_file_parsing".to_string(),
                    expected: "Valid .rep file format".to_string(),
                    actual: format!("Failed to parse .rep file: {}", e),
                    step: 0,
                });
                return Ok(errors);
            }
        };

        // Find pattern file for comparison (same logic as CLT)
        let pattern_file = self.find_pattern_file(rec_path);

        // Compare output sequences using existing pattern matching logic
        match self.compare_output_sequences(&expected_outputs, &actual_outputs, pattern_file) {
            Ok(comparison_errors) => {
                errors.extend(comparison_errors);
            }
            Err(e) => {
                errors.push(TestError {
                    command: "output_comparison".to_string(),
                    expected: "Successful output comparison".to_string(),
                    actual: format!("Output comparison failed: {}", e),
                    step: 0,
                });
            }
        }

        Ok(errors)
    }

    fn find_pattern_file(&self, rec_path: &Path) -> Option<String> {
        // Look for .clt/patterns file in the same way CLT does
        if let Some(parent) = rec_path.parent() {
            let patterns_path = parent.join(".clt").join("patterns");
            if patterns_path.exists() {
                return Some(patterns_path.to_string_lossy().to_string());
            }
        }
        None
    }

    #[cfg(test)]
    pub fn get_clt_path(&self) -> &str {
        &self.clt_path
    }

    fn extract_all_outputs_from_structured(
        &self,
        test_structure: &TestStructure,
    ) -> Vec<OutputExpectation> {
        let mut outputs = Vec::new();
        let mut global_step_index = 0;

        self.extract_outputs_from_steps(
            &test_structure.steps,
            &mut outputs,
            &mut global_step_index,
        );
        outputs
    }

    fn extract_outputs_from_steps(
        &self,
        steps: &[parser::TestStep],
        outputs: &mut Vec<OutputExpectation>,
        global_step_index: &mut usize,
    ) {
        let mut current_input: Option<(String, usize)> = None;

        for step in steps {
            let current_step_index = *global_step_index;
            *global_step_index += 1;

            match step.step_type.as_str() {
                "input" => {
                    if let Some(content) = &step.content {
                        current_input = Some((content.clone(), current_step_index));
                    }
                }
                "output" => {
                    if let Some(content) = &step.content {
                        if let Some((input_command, input_step_index)) = &current_input {
                            outputs.push(OutputExpectation {
                                expected_content: content.clone(),
                                command: input_command.clone(),
                                command_index: *input_step_index, // Use the step index of the input command
                            });
                        }
                    }
                }
                "block" => {
                    // Handle nested steps from blocks - they get their own step indices
                    if let Some(nested_steps) = &step.steps {
                        self.extract_outputs_from_steps(nested_steps, outputs, global_step_index);
                    }
                }
                _ => {} // Skip comments and other types
            }
        }
    }

    fn extract_all_outputs_from_rep(&self, rep_content: &str) -> Result<Vec<ActualOutput>> {
        let mut outputs = Vec::new();
        let mut current_section = None;
        let mut current_content = Vec::new();

        for line in rep_content.lines() {
            // Check if this is a section marker
            if line.starts_with("––– ") && line.ends_with(" –––") {
                // Save previous section if it was an output
                if let Some("output") = current_section {
                    outputs.push(ActualOutput {
                        actual_content: current_content.join("\n"),
                    });
                    current_content.clear();
                }

                // Determine new section type
                current_section = if line.contains("input") {
                    Some("input")
                } else if line.contains("output") {
                    Some("output")
                } else {
                    None // Skip other section types
                };
            } else if current_section == Some("output") {
                current_content.push(line.to_string());
            }
            // Skip input content - we only care about outputs
        }

        // Save last section if it was an output
        if let Some("output") = current_section {
            outputs.push(ActualOutput {
                actual_content: current_content.join("\n"),
            });
        }

        Ok(outputs)
    }

    fn compare_output_sequences(
        &self,
        expected: &[OutputExpectation],
        actual: &[ActualOutput],
        pattern_file: Option<String>,
    ) -> Result<Vec<TestError>> {
        let mut errors = Vec::new();

        // Create pattern matcher (reuse existing CLT logic)
        let pattern_matcher = match cmp::PatternMatcher::new(pattern_file) {
            Ok(matcher) => matcher,
            Err(e) => {
                errors.push(TestError {
                    command: "pattern_matcher_init".to_string(),
                    expected: "Pattern matcher should initialize".to_string(),
                    actual: format!("Failed to create pattern matcher: {}", e),
                    step: 0,
                });
                return Ok(errors);
            }
        };

        // Compare each expected output with actual output
        for (exp, act) in expected.iter().zip(actual.iter()) {
            // Use CLT's pattern matcher for comparison (handles regex patterns)
            if pattern_matcher.has_diff(exp.expected_content.clone(), act.actual_content.clone()) {
                errors.push(TestError {
                    command: exp.command.clone(), // The input command that produced this output
                    expected: exp.expected_content.clone(),
                    actual: act.actual_content.clone(),
                    step: exp.command_index, // Use the actual step index from the structured test
                });
            }
        }

        // Check for count mismatch
        if expected.len() != actual.len() {
            errors.push(TestError {
                command: "output_count_mismatch".to_string(),
                expected: format!("{} outputs expected", expected.len()),
                actual: format!("{} outputs found", actual.len()),
                step: 0,
            });
        }

        Ok(errors)
    }
}

#[derive(Debug, Clone)]
struct OutputExpectation {
    expected_content: String,
    command: String,      // The input command that should produce this output
    command_index: usize, // Index of the step in the test structure (for error reporting)
}

#[derive(Debug, Clone)]
struct ActualOutput {
    actual_content: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_new_with_valid_bin_path() {
        // Create a temporary file to simulate a CLT binary
        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, "#!/bin/bash\necho 'fake clt'").unwrap();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let runner = TestRunner::new(
            "test-image".to_string(),
            Some(temp_path.clone()),
            std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
        )
        .unwrap();

        assert_eq!(runner.get_clt_path(), &temp_path);
        assert_eq!(runner.docker_image, "test-image");
    }

    #[test]
    fn test_new_with_invalid_bin_path() {
        let result = TestRunner::new(
            "test-image".to_string(),
            Some("/nonexistent/path".to_string()),
            std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
        );

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("CLT binary not found"));
    }

    #[test]
    fn test_new_with_directory_bin_path() {
        let temp_dir = tempfile::tempdir().unwrap();
        let dir_path = temp_dir.path().to_string_lossy().to_string();

        let result = TestRunner::new(
            "test-image".to_string(),
            Some(dir_path),
            std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not a file"));
    }

    #[test]
    fn test_run_test_with_nonexistent_file() {
        let runner = TestRunner::new(
            "test-image".to_string(),
            None,
            std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
        );

        // Skip this test if CLT is not available
        if runner.is_err() {
            return;
        }

        let runner = runner.unwrap();
        let result = runner.run_test("/nonexistent/test.rec", None).unwrap();

        assert!(!result.success);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].command, "file_check");
        assert!(result.errors[0].actual.contains("File not found"));
    }

    #[test]
    fn test_extract_all_outputs_from_structured() {
        let runner = TestRunner::new(
            "test-image".to_string(),
            None,
            std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
        );

        // Skip this test if CLT is not available
        if runner.is_err() {
            return;
        }

        let runner = runner.unwrap();

        // Create a test structure with nested blocks
        let test_structure = TestStructure {
            description: Some("Test with blocks".to_string()),
            steps: vec![
                crate::mcp_protocol::TestStep {
                    step_type: "input".to_string(),
                    args: vec![],
                    content: Some("echo hello".to_string()),
                    steps: None,
                },
                crate::mcp_protocol::TestStep {
                    step_type: "output".to_string(),
                    args: vec![],
                    content: Some("hello".to_string()),
                    steps: None,
                },
                crate::mcp_protocol::TestStep {
                    step_type: "block".to_string(),
                    args: vec!["test-block".to_string()],
                    content: None,
                    steps: Some(vec![
                        crate::mcp_protocol::TestStep {
                            step_type: "input".to_string(),
                            args: vec![],
                            content: Some("echo world".to_string()),
                            steps: None,
                        },
                        crate::mcp_protocol::TestStep {
                            step_type: "output".to_string(),
                            args: vec![],
                            content: Some("world".to_string()),
                            steps: None,
                        },
                    ]),
                },
            ],
        };

        let outputs = runner.extract_all_outputs_from_structured(&test_structure);

        assert_eq!(outputs.len(), 2);
        assert_eq!(outputs[0].expected_content, "hello");
        assert_eq!(outputs[0].command, "echo hello");
        assert_eq!(outputs[0].command_index, 0); // Input was at step 0
        assert_eq!(outputs[1].expected_content, "world");
        assert_eq!(outputs[1].command, "echo world");
        assert_eq!(outputs[1].command_index, 3); // Input was at step 3 (inside the block)
    }

    #[test]
    fn test_extract_all_outputs_from_rep() {
        let runner = TestRunner::new(
            "test-image".to_string(),
            None,
            std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
        );

        // Skip this test if CLT is not available
        if runner.is_err() {
            return;
        }

        let runner = runner.unwrap();
        let rep_content = "––– input –––\necho hello\n––– output –––\nhello\n––– input –––\necho world\n––– output –––\nworld\n";

        let outputs = runner.extract_all_outputs_from_rep(rep_content).unwrap();

        assert_eq!(outputs.len(), 2);
        assert_eq!(outputs[0].actual_content, "hello");
        assert_eq!(outputs[1].actual_content, "world");
    }
}
