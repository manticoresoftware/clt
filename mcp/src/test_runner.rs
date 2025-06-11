use crate::mcp_protocol::{RunTestOutput, TestError};
use anyhow::{Context, Result};
use std::path::Path;
use std::process::Command;
use std::fs;

#[derive(Debug)]
pub struct TestRunner {
    docker_image: String,
    clt_path: String,
}

impl TestRunner {
    pub fn new(docker_image: String, clt_binary_path: Option<String>) -> Result<Self> {
        let clt_path = match clt_binary_path {
            Some(path) => {
                let path_buf = std::path::Path::new(&path);
                if !path_buf.exists() {
                    return Err(anyhow::anyhow!("CLT binary not found at specified path: {}", path));
                }
                if !path_buf.is_file() {
                    return Err(anyhow::anyhow!("Specified CLT path is not a file: {}", path));
                }
                path
            }
            None => {
                which::which("clt")
                    .context("CLT executable not found in PATH. Use --bin to specify path.")?
                    .to_string_lossy()
                    .to_string()
            }
        };

        Ok(Self {
            docker_image,
            clt_path,
        })
    }

    pub fn run_test(&self, test_path: &str) -> Result<RunTestOutput> {
        let test_path = Path::new(test_path);
        
        if !test_path.exists() {
            return Ok(RunTestOutput {
                success: false,
                errors: vec![TestError {
                    command: "file_check".to_string(),
                    expected: "Test file should exist".to_string(),
                    actual: format!("File not found: {}", test_path.display()),
                    line_number: 0,
                }],
                summary: "Test file not found".to_string(),
            });
        }

        // Execute CLT test command
        let output = Command::new(&self.clt_path)
            .args(["test", "-t", &test_path.to_string_lossy(), "-d", &self.docker_image])
            .output()
            .context("Failed to execute CLT test command")?;

        let exit_success = output.status.success();
        
        // Ignore stderr output as it may contain platform warnings
        // We only care about the exit code for success/failure determination
        if exit_success {
            Ok(RunTestOutput {
                success: true,
                errors: vec![],
                summary: "Test passed successfully".to_string(),
            })
        } else {
            // Parse failures from .rep file comparison
            // Read the .rep file to get the actual test results
            let errors = self.parse_test_failures_from_rep_file(test_path)?;
            let summary = if errors.is_empty() {
                "Test failed".to_string()
            } else {
                format!("Test failed with {} error(s)", errors.len())
            };

            Ok(RunTestOutput {
                success: false,
                errors,
                summary,
            })
        }
    }

    fn parse_test_failures_from_rep_file(&self, test_path: &Path) -> Result<Vec<TestError>> {
        let mut errors = Vec::new();

        // Try to find and parse .rep file
        let rep_path = test_path.with_extension("rep");
        if rep_path.exists() {
            // Parse .rep file and compare with compiled .rec file
            errors.extend(self.parse_rep_file_errors(&rep_path, test_path)?);
        }

        Ok(errors)
    }

    fn parse_rep_file_errors(&self, rep_path: &Path, rec_path: &Path) -> Result<Vec<TestError>> {
        let mut errors = Vec::new();

        // Compile the .rec file to get expected content
        let compiled_rec = parser::compile(&rec_path.to_string_lossy())
            .context("Failed to compile .rec file")?;

        // Read the .rep file
        let rep_content = fs::read_to_string(rep_path)
            .context("Failed to read .rep file")?;

        // Parse both files and compare sections
        let rec_sections = self.parse_sections(&compiled_rec)?;
        let rep_sections = self.parse_sections(&rep_content)?;

        // Compare input/output pairs
        let mut line_number = 1;
        for (rec_section, rep_section) in rec_sections.iter().zip(rep_sections.iter()) {
            match (rec_section, rep_section) {
                (Section::Input(rec_input), Section::Input(rep_input)) => {
                    if rec_input != rep_input {
                        errors.push(TestError {
                            command: rec_input.clone(),
                            expected: rec_input.clone(),
                            actual: rep_input.clone(),
                            line_number,
                        });
                    }
                }
                (Section::Output(rec_output), Section::Output(rep_output)) => {
                    // Use pattern matcher to check if outputs match
                    let pattern_matcher = cmp::PatternMatcher::new(None)
                        .map_err(|e| anyhow::anyhow!("Failed to create pattern matcher: {}", e))?;
                    if pattern_matcher.has_diff(rec_output.clone(), rep_output.clone()) {
                        errors.push(TestError {
                            command: "output_comparison".to_string(),
                            expected: rec_output.clone(),
                            actual: rep_output.clone(),
                            line_number,
                        });
                    }
                }
                _ => {} // Skip other section types
            }
            line_number += 1;
        }

        Ok(errors)
    }

    fn parse_sections(&self, content: &str) -> Result<Vec<Section>> {
        let mut sections = Vec::new();
        let mut current_section = None;
        let mut current_content = Vec::new();

        for line in content.lines() {
            if let Ok((statement, _)) = parser::parse_statement(line) {
                // Save previous section if exists
                if let Some(ref section_type) = current_section {
                    sections.push(match section_type {
                        parser::Statement::Input => Section::Input(current_content.join("\n")),
                        parser::Statement::Output => Section::Output(current_content.join("\n")),
                        _ => continue,
                    });
                    current_content.clear();
                }

                // Start new section
                current_section = Some(statement);
            } else if current_section.is_some() {
                current_content.push(line.to_string());
            }
        }

        // Save last section
        if let Some(ref section_type) = current_section {
            sections.push(match section_type {
                parser::Statement::Input => Section::Input(current_content.join("\n")),
                parser::Statement::Output => Section::Output(current_content.join("\n")),
                _ => return Ok(sections),
            });
        }

        Ok(sections)
    }

    #[cfg(test)]
    pub fn get_clt_path(&self) -> &str {
        &self.clt_path
    }
}

#[derive(Debug, Clone)]
enum Section {
    Input(String),
    Output(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use std::io::Write;

    #[test]
    fn test_new_with_valid_bin_path() {
        // Create a temporary file to simulate a CLT binary
        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, "#!/bin/bash\necho 'fake clt'").unwrap();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let runner = TestRunner::new(
            "test-image".to_string(),
            Some(temp_path.clone())
        ).unwrap();

        assert_eq!(runner.get_clt_path(), &temp_path);
        assert_eq!(runner.docker_image, "test-image");
    }

    #[test]
    fn test_new_with_invalid_bin_path() {
        let result = TestRunner::new(
            "test-image".to_string(),
            Some("/nonexistent/path".to_string())
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("CLT binary not found"));
    }

    #[test]
    fn test_new_with_directory_bin_path() {
        let temp_dir = tempfile::tempdir().unwrap();
        let dir_path = temp_dir.path().to_string_lossy().to_string();

        let result = TestRunner::new(
            "test-image".to_string(),
            Some(dir_path)
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not a file"));
    }

    #[test]
    fn test_run_test_with_nonexistent_file() {
        let runner = TestRunner::new(
            "test-image".to_string(),
            None
        );

        // Skip this test if CLT is not available
        if runner.is_err() {
            return;
        }

        let runner = runner.unwrap();
        let result = runner.run_test("/nonexistent/test.rec").unwrap();

        assert!(!result.success);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].command, "file_check");
        assert!(result.errors[0].actual.contains("File not found"));
    }

    #[test]
    fn test_parse_sections() {
        let runner = TestRunner::new(
            "test-image".to_string(),
            None
        );

        // Skip this test if CLT is not available
        if runner.is_err() {
            return;
        }

        let runner = runner.unwrap();
        let content = "––– input –––\necho hello\n––– output –––\nhello\n";
        let sections = runner.parse_sections(content).unwrap();

        assert_eq!(sections.len(), 2);
        match &sections[0] {
            Section::Input(content) => assert_eq!(content, "echo hello"),
            _ => panic!("Expected Input section"),
        }
        match &sections[1] {
            Section::Output(content) => assert_eq!(content, "hello"),
            _ => panic!("Expected Output section"),
        }
    }
}