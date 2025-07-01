use anyhow::Result;

use crate::cmp;

/// Utility functions for path resolution and diff creation
pub struct PathUtils;

impl PathUtils {
    /// Resolve test file path to absolute path based on working directory
    pub fn resolve_test_path(workdir_path: &str, test_file: &str) -> Result<String> {
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
            let workdir = std::path::Path::new(workdir_path);

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

/// Diff utilities for comparing expected vs actual output
pub struct DiffUtils;

impl DiffUtils {
    /// Helper function to create a line-based diff similar to git diff format
    /// This makes the output much more AI-friendly than character-level mismatches
    pub fn create_line_diff(
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
    pub fn create_diff_summary(
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
}