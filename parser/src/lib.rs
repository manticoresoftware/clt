use anyhow::{Context, Result};
use std::collections::{HashSet, HashMap};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::error::Error;
use std::str::FromStr;
use std::path::{Path, PathBuf};
use regex::Regex;
use serde::{Serialize, Deserialize};

pub const BLOCK_REGEX: &str = r"(?m)^––– block: ([\.a-zA-Z0-9\-\/\_]+) –––$";
pub const DURATION_REGEX: &str = r"(?m)^––– duration: ([0-9\.]+)ms \(([0-9\.]+)%\) –––$";
pub const STATEMENT_REGEX: &str = r"(?m)^––– ([\.a-zA-Z0-9\/\_]+)(?:\s*:\s*(.+))? –––$";

pub struct Duration {
	pub duration: u128,
	pub percentage: f32,
}

#[derive(Debug, PartialEq)]
pub enum Statement {
	Block,
	Input,
	Output,
	Duration,
	Comment,
}

#[derive(Debug, PartialEq)]
pub enum StatementCheck {
	Yes,
	No,
	None,
}

impl FromStr for Statement {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s.trim().to_lowercase().as_str() {
			"block" => Ok(Statement::Block),
			"input" => Ok(Statement::Input),
			"output" => Ok(Statement::Output),
			"duration" => Ok(Statement::Duration),
			"comment" => Ok(Statement::Comment),
			_ => Err(format!("Invalid statement type: {}", s)),
		}
	}
}

impl std::fmt::Display for Statement {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		match self {
			Statement::Block => write!(f, "block"),
			Statement::Input => write!(f, "input"),
			Statement::Output => write!(f, "output"),
			Statement::Duration => write!(f, "duration"),
			Statement::Comment => write!(f, "comment"),
		}
	}
}

/// Compile the input rec file into String with expanded blocks
/// Supports recursive block expansion (blocks inside other block files)
pub fn compile(rec_file_path: &str) -> Result<String> {
	let mut visited = HashSet::new();
	let path = PathBuf::from(rec_file_path);
	let canonical_path = std::fs::canonicalize(&path)?;

	compile_recursive(&canonical_path, &mut visited)
}

/// Recursive helper function to compile blocks
fn compile_recursive(file_path: &Path, visited: &mut HashSet<PathBuf>) -> Result<String> {
	// Check for circular dependencies
	if !visited.insert(file_path.to_path_buf()) {
		return Err(anyhow::anyhow!("Circular dependency detected: {}", file_path.display()));
	}

	let input_file = File::open(file_path)
		.with_context(|| format!("Failed to open file: {}", file_path.display()))?;
	let input_dir = file_path.parent().unwrap_or_else(|| Path::new(""));
	let reader = BufReader::new(input_file);
	let mut result = String::new();

	let block_re = Regex::new(BLOCK_REGEX)?;
	let duration_re = Regex::new(DURATION_REGEX)?;

	for line in reader.lines() {
		let line = line.with_context(|| format!("Failed to read line from {}", file_path.display()))?;

		if let Some(caps) = block_re.captures(&line) {
			let block_name = caps.get(1).map_or("", |m| m.as_str());
			let block_file = if block_name.ends_with(".recb") {
				block_name.to_string()
			} else {
				format!("{}.recb", block_name)
			};

			let relative_path = Path::new(&block_file);
			let block_path = input_dir.join(relative_path);

			let absolute_path = std::fs::canonicalize(&block_path).map_err(|e| match e.kind() {
				std::io::ErrorKind::NotFound => std::io::Error::new(
					std::io::ErrorKind::NotFound,
					format!("Block file not found at path: {}", block_path.display())
				),
				_ => e
			})?;

			// Recursively compile the block
			let mut visited_clone = visited.clone();
			let block_content = compile_recursive(&absolute_path, &mut visited_clone)
				.with_context(|| format!("Failed to compile block: {}", block_path.display()))?;

			result.push_str(block_content.trim());
			result.push('\n');
			continue;
		} else if duration_re.captures(&line).is_some() {
			continue;
		}

		result.push_str(&line);
		result.push('\n');
	}

	// Remove this path from visited to allow it to be used in other branches
	visited.remove(file_path);

	Ok(result.trim().to_string())
}

/// Create a fresh statement line to place in file with additional argument in case we need it
pub fn get_statement_line(statement: Statement, additional_arg: Option<String>) -> String {
	let statement_str = statement.to_string();

	let additional_arg_str = match additional_arg {
		Some(arg) => format!(": {}", arg),
		None => String::new(),
	};

	format!("––– {}{} –––", statement_str, additional_arg_str)
}

/// Parse ––– statement ––– line and get the statement and optional argument
pub fn parse_statement(line: &str) -> Result<(Statement, Option<String>)> {
	if !line.starts_with("––– ") || !line.trim().ends_with(" –––") {
		anyhow::bail!("Line does not match statement format");
	}

	let statement_re = Regex::new(STATEMENT_REGEX)
		.context("Failed to create regex")?;

	let caps = statement_re
		.captures(line)
		.ok_or_else(|| anyhow::anyhow!("Failed to capture statement pattern"))?;

	let statement = caps
		.get(1)
		.ok_or_else(|| anyhow::anyhow!("Missing statement capture group"))?
		.as_str()
		.parse::<Statement>()
		.map_err(|e| anyhow::anyhow!("Failed to parse statement: {}", e))?;

	let additional_arg = caps.get(2).map(|m| m.as_str().to_string());

	Ok((statement, additional_arg))
}

/// Parse the line with duration and return the structure
pub fn parse_duration_line(line: &str) -> Result<Duration, Box<dyn Error>> {
	let duration_re = Regex::new(DURATION_REGEX)?;
	if let Some(caps) = duration_re.captures(line) {
		let duration = caps.get(1)
			.ok_or("Duration capture group missing")?
			.as_str()
			.parse::<u128>()?;

		let percentage = caps.get(2)
			.ok_or("Percentage capture group missing")?
			.as_str()
			.parse::<f32>()?;

		Ok(Duration { duration, percentage })
	} else {
		Err("Line did not match regex pattern".into())
	}
}

#[macro_export]
macro_rules! check_statement {
	($line:expr, $statement:expr) => {{
		if let Ok((statement, _)) = parser::parse_statement($line) {
		if statement == $statement {
		$crate::StatementCheck::Yes
		} else {
		$crate::StatementCheck::No
		}
		} else {
		$crate::StatementCheck::None
		}
		}};
}

/// Test validation error structure
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TestError {
    pub command: String,
    pub expected: String,
    pub actual: String,
    pub step: usize,
}

/// Test validation result
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationResult {
    pub success: bool,
    pub errors: Vec<TestError>,
    pub summary: String,
}

// ===== REC FILE STRUCTURED PARSING =====

/// Represents a structured test with description and steps
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct TestStructure {
    pub description: Option<String>,
    pub steps: Vec<TestStep>,
}

/// Represents a single test step
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct TestStep {
    #[serde(rename = "type")]
    pub step_type: String,
    pub args: Vec<String>,
    pub content: Option<String>,
    pub steps: Option<Vec<TestStep>>, // For block types with resolved content
}

/// Convert a .rec file to structured JSON format
pub fn read_test_file(test_file_path: &str) -> Result<TestStructure> {
    let content = fs::read_to_string(test_file_path)?;
    let test_dir = Path::new(test_file_path)
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine parent directory of test file"))?;

    parse_rec_content(&content, test_dir)
}

/// Parse .rec content and convert to structured format
pub fn parse_rec_content(content: &str, base_dir: &Path) -> Result<TestStructure> {
    let lines: Vec<&str> = content.lines().collect();
    let mut steps = Vec::new();
    let mut i = 0;

    // First, extract description (everything before the first statement)
    let mut description_lines = Vec::new();

    while i < lines.len() {
        let line = lines[i].trim();

        // Check if this is a statement line
        if line.starts_with("––– ") && line.ends_with(" –––") {
            break;
        }

        // Skip empty lines at the beginning if no content yet
        if description_lines.is_empty() && line.is_empty() {
            i += 1;
            continue;
        }

        description_lines.push(lines[i]); // Keep original line with whitespace
        i += 1;
    }

    // Trim trailing empty lines from description
    while let Some(last) = description_lines.last() {
        if last.trim().is_empty() {
            description_lines.pop();
        } else {
            break;
        }
    }

    let description = if description_lines.is_empty() {
        None
    } else {
        Some(description_lines.join("\n"))
    };

    // Now parse the statements starting from where we left off
    while i < lines.len() {
        let line = lines[i].trim();

        // Skip empty lines
        if line.is_empty() {
            i += 1;
            continue;
        }

        // Check if this is a statement line
        if line.starts_with("––– ") && line.ends_with(" –––") {
            let (statement, arg) = parse_statement(line)?;
            let step = match statement {
                Statement::Input => {
                    // Collect input content until next statement
                    let (content, next_idx) = collect_content(&lines, i + 1)?;
                    i = next_idx;
                    TestStep {
                        step_type: "input".to_string(),
                        args: vec![],
                        content: Some(content),
                        steps: None,
                    }
                }
                Statement::Output => {
                    // Collect output content until next statement
                    let (content, next_idx) = collect_content(&lines, i + 1)?;
                    i = next_idx;
                    let args = if let Some(checker) = arg {
                        vec![checker]
                    } else {
                        vec![]
                    };
                    TestStep {
                        step_type: "output".to_string(),
                        args,
                        content: Some(content),
                        steps: None,
                    }
                }
                Statement::Comment => {
                    // Collect comment content until next statement
                    let (content, next_idx) = collect_content(&lines, i + 1)?;
                    i = next_idx;
                    TestStep {
                        step_type: "comment".to_string(),
                        args: vec![],
                        content: Some(content),
                        steps: None,
                    }
                }
                Statement::Block => {
                    let block_path =
                        arg.ok_or_else(|| anyhow::anyhow!("Block statement missing path argument"))?;

                    // Resolve block file and parse recursively
                    let nested_steps = resolve_block(&block_path, base_dir)?;
                    i += 1; // Move past the block statement line

                    TestStep {
                        step_type: "block".to_string(),
                        args: vec![block_path],
                        content: None,
                        steps: Some(nested_steps),
                    }
                }
                Statement::Duration => {
                    // Skip duration statements (they're auto-generated)
                    i += 1;
                    continue;
                }
            };
            steps.push(step);
        } else {
            // This shouldn't happen in a well-formed .rec file
            return Err(anyhow::anyhow!("Unexpected line format: {}", line));
        }
    }

    Ok(TestStructure { description, steps })
}

/// Collect content lines until the next statement or end of file
fn collect_content(lines: &[&str], start_idx: usize) -> Result<(String, usize)> {
    let mut content_lines = Vec::new();
    let mut i = start_idx;

    while i < lines.len() {
        let line = lines[i];

        // Check if this is a statement line
        if line.trim().starts_with("––– ") && line.trim().ends_with(" –––") {
            break;
        }

        content_lines.push(line);
        i += 1;
    }

    // Join lines and trim trailing whitespace
    let content = content_lines.join("\n").trim_end().to_string();
    Ok((content, i))
}

/// Resolve a block reference by loading and parsing the .recb file
fn resolve_block(block_path: &str, base_dir: &Path) -> Result<Vec<TestStep>> {
    let block_file_path = base_dir.join(format!("{}.recb", block_path));

    if !block_file_path.exists() {
        return Err(anyhow::anyhow!(
            "Block file not found: {}",
            block_file_path.display()
        ));
    }

    let block_content = fs::read_to_string(&block_file_path)?;
    let block_dir = block_file_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine parent directory of block file"))?;

    let block_structure = parse_rec_content(&block_content, block_dir)?;
    Ok(block_structure.steps)
}

/// Convert structured JSON format back to .rec file content
pub fn write_test_file(test_file_path: &str, test_structure: &TestStructure) -> Result<()> {
    // Validate test file path
    let test_path = Path::new(test_file_path);

    // Create parent directories if they don't exist
    if let Some(parent_dir) = test_path.parent() {
        if !parent_dir.exists() {
            fs::create_dir_all(parent_dir).map_err(|e| {
                anyhow::anyhow!("Failed to create directory {}: {}", parent_dir.display(), e)
            })?;
        }

        // Validate that parent directory is writable
        if let Err(e) = fs::metadata(parent_dir) {
            return Err(anyhow::anyhow!(
                "Cannot access parent directory {}: {}",
                parent_dir.display(),
                e
            ));
        }
    }

    // Convert structure to REC format with error handling
    let rec_content = convert_structure_to_rec(test_structure)
        .map_err(|e| anyhow::anyhow!("Failed to convert test structure to .rec format: {}", e))?;

    // Write file with proper error handling
    fs::write(test_file_path, rec_content)
        .map_err(|e| anyhow::anyhow!("Failed to write test file {}: {}", test_file_path, e))?;

    Ok(())
}

/// Replace old test structure with new test structure in existing file
pub fn replace_test_structure(
    test_file_path: &str,
    old_structure: &TestStructure,
    new_structure: &TestStructure,
) -> Result<()> {
    // Read the current test file
    let current_structure = read_test_file(test_file_path)?;

    // Find the old structure in the current structure
    let replacement_result =
        find_and_replace_structure(&current_structure, old_structure, new_structure)?;

    // Write the modified structure back to the file
    write_test_file(test_file_path, &replacement_result)?;
    Ok(())
}

/// Append test structure to existing file
pub fn append_test_structure(
    test_file_path: &str,
    append_structure: &TestStructure,
) -> Result<usize> {
    // Read the current test file
    let mut current_structure = read_test_file(test_file_path)?;

    // If append_structure has a description and current doesn't, use the append description
    if current_structure.description.is_none() && append_structure.description.is_some() {
        current_structure.description = append_structure.description.clone();
    }

    // Count steps being added
    let steps_added = append_structure.steps.len();

    // Append the new steps
    current_structure
        .steps
        .extend(append_structure.steps.clone());

    // Write the modified structure back to the file
    write_test_file(test_file_path, &current_structure)?;

    Ok(steps_added)
}

/// Find and replace a test structure within another test structure
fn find_and_replace_structure(
    current: &TestStructure,
    old: &TestStructure,
    new: &TestStructure,
) -> Result<TestStructure> {
    // Simple approach: find exact sequence match in steps
    let old_steps = &old.steps;
    let current_steps = &current.steps;

    if old_steps.is_empty() {
        return Err(anyhow::anyhow!("Old test structure cannot be empty"));
    }

    // Look for the sequence of old steps in current steps
    let mut found_at = None;
    for i in 0..=current_steps.len().saturating_sub(old_steps.len()) {
        if steps_match_sequence(&current_steps[i..i + old_steps.len()], old_steps) {
            if found_at.is_some() {
                return Err(anyhow::anyhow!("Ambiguous replacement: old test structure matches multiple locations in the file"));
            }
            found_at = Some(i);
        }
    }

    let start_idx =
        found_at.ok_or_else(|| anyhow::anyhow!("Old test structure not found in the current file"))?;

    // Create new structure with replacement
    let mut new_steps = Vec::new();

    // Add steps before the match
    new_steps.extend_from_slice(&current_steps[..start_idx]);

    // Add the new steps
    new_steps.extend(new.steps.clone());

    // Add steps after the match
    new_steps.extend_from_slice(&current_steps[start_idx + old_steps.len()..]);

    // Handle description replacement logic
    let final_description = if new.description.is_some() {
        // If new structure has description, use it
        new.description.clone()
    } else {
        // Otherwise keep current description
        current.description.clone()
    };

    Ok(TestStructure {
        description: final_description,
        steps: new_steps,
    })
}

/// Check if two step sequences match exactly
fn steps_match_sequence(seq1: &[TestStep], seq2: &[TestStep]) -> bool {
    if seq1.len() != seq2.len() {
        return false;
    }

    for (step1, step2) in seq1.iter().zip(seq2.iter()) {
        if !steps_match(step1, step2) {
            return false;
        }
    }

    true
}

/// Check if two test steps match exactly
fn steps_match(step1: &TestStep, step2: &TestStep) -> bool {
    step1.step_type == step2.step_type
        && step1.args == step2.args
        && step1.content == step2.content
        && match (&step1.steps, &step2.steps) {
            (None, None) => true,
            (Some(s1), Some(s2)) => steps_match_sequence(s1, s2),
            _ => false,
        }
}

/// Convert TestStructure to .rec file format
fn convert_structure_to_rec(test_structure: &TestStructure) -> Result<String> {
    let mut lines = Vec::new();

    // Add description at the beginning if present
    if let Some(description) = &test_structure.description {
        lines.push(description.clone());
        // Add empty line after description if there are steps
        if !test_structure.steps.is_empty() {
            lines.push("".to_string());
        }
    }

    for step in &test_structure.steps {
        match step.step_type.as_str() {
            "input" => {
                lines.push("––– input –––".to_string());
                if let Some(content) = &step.content {
                    if !content.is_empty() {
                        lines.push(content.clone());
                    }
                }
            }
            "output" => {
                if step.args.is_empty() {
                    lines.push("––– output –––".to_string());
                } else {
                    lines.push(format!("––– output: {} –––", step.args[0]));
                }
                if let Some(content) = &step.content {
                    if !content.is_empty() {
                        lines.push(content.clone());
                    }
                }
            }
            "comment" => {
                lines.push("––– comment –––".to_string());
                if let Some(content) = &step.content {
                    if !content.is_empty() {
                        lines.push(content.clone());
                    }
                }
            }
            "block" => {
                if step.args.is_empty() {
                    return Err(anyhow::anyhow!("Block step missing path argument"));
                }
                lines.push(format!("––– block: {} –––", step.args[0]));

                // Note: We don't write the nested steps to the .rec file
                // The block reference will be resolved when the file is read
            }
            _ => {
                return Err(anyhow::anyhow!("Unknown step type: {}", step.step_type));
            }
        }
    }

    Ok(lines.join("\n"))
}

/// Get all available patterns from system and project .clt/patterns files
pub fn get_patterns(clt_binary_path: Option<&str>) -> Result<HashMap<String, String>> {
    let mut patterns = HashMap::new();

    // First, load system patterns from CLT binary directory
    if let Some(binary_path) = clt_binary_path {
        let binary_dir = Path::new(binary_path)
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine CLT binary directory"))?;
        let system_patterns_path = binary_dir.join(".clt/patterns");

        if system_patterns_path.exists() {
            load_patterns_from_file(&system_patterns_path, &mut patterns)?;
        }
    }

    // Then, load project patterns from current directory (these override system patterns)
    let project_patterns_path = Path::new(".clt/patterns");
    if project_patterns_path.exists() {
        load_patterns_from_file(project_patterns_path, &mut patterns)?;
    }

    Ok(patterns)
}

// ===== TEST VALIDATION LOGIC =====

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

/// Validate a test by comparing .rec file with its .rep result file
/// Input: path to .rec file, .rep file will be found automatically
pub fn validate_test(rec_file_path: &str) -> Result<ValidationResult> {
    let rec_path = Path::new(rec_file_path);

    // Find corresponding .rep file
    let rep_path = rec_path.with_extension("rep");
    if !rep_path.exists() {
        return Ok(ValidationResult {
            success: false,
            errors: vec![TestError {
                command: "file_check".to_string(),
                expected: "Test result file should exist".to_string(),
                actual: format!("No .rep file found at: {}", rep_path.display()),
                step: 0,
            }],
            summary: "Test result file not found".to_string(),
        });
    }

    // Read both files with proper error handling
    let rec_content = fs::read_to_string(rec_path)
        .map_err(|e| anyhow::anyhow!("Failed to read .rec file: {}", e))?;
    let rep_content = fs::read_to_string(&rep_path)
        .map_err(|e| anyhow::anyhow!("Failed to read .rep file: {}", e))?;

    // Parse REC file into structured format
    let base_dir = rec_path.parent().ok_or_else(|| {
        anyhow::anyhow!("Cannot determine parent directory of .rec file: {}", rec_path.display())
    })?;

    let test_structure = match parse_rec_content(&rec_content, base_dir) {
        Ok(structure) => structure,
        Err(e) => {
            return Ok(ValidationResult {
                success: false,
                errors: vec![TestError {
                    command: "rec_file_parsing".to_string(),
                    expected: "Valid .rec file format".to_string(),
                    actual: format!("Failed to parse .rec file: {}", e),
                    step: 0,
                }],
                summary: "Failed to parse test file".to_string(),
            });
        }
    };

    // Extract all expected outputs from structured REC (handles blocks, nesting, etc.)
    let expected_outputs = extract_all_outputs_from_structured(&test_structure);

    // Extract all actual outputs from flat REP file
    let actual_outputs = match extract_all_outputs_from_rep(&rep_content) {
        Ok(outputs) => outputs,
        Err(e) => {
            return Ok(ValidationResult {
                success: false,
                errors: vec![TestError {
                    command: "rep_file_parsing".to_string(),
                    expected: "Valid .rep file format".to_string(),
                    actual: format!("Failed to parse .rep file: {}", e),
                    step: 0,
                }],
                summary: "Failed to parse test result file".to_string(),
            });
        }
    };

    // Find pattern file for comparison (same logic as CLT)
    let pattern_file = find_pattern_file(rec_path);

    // Compare output sequences using pattern matching logic
    let mut errors = Vec::new();
    match compare_output_sequences(&expected_outputs, &actual_outputs, pattern_file) {
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

    let success = errors.is_empty();
    let summary = if success {
        "All outputs match expected results".to_string()
    } else {
        format!("{} validation error(s) found", errors.len())
    };

    Ok(ValidationResult {
        success,
        errors,
        summary,
    })
}

fn find_pattern_file(rec_path: &Path) -> Option<String> {
    // Look for .clt/patterns file in the same way CLT does
    if let Some(parent) = rec_path.parent() {
        let patterns_path = parent.join(".clt").join("patterns");
        if patterns_path.exists() {
            return Some(patterns_path.to_string_lossy().to_string());
        }
    }
    None
}

fn extract_all_outputs_from_structured(test_structure: &TestStructure) -> Vec<OutputExpectation> {
    let mut outputs = Vec::new();
    let mut global_step_index = 0;

    extract_outputs_from_steps(&test_structure.steps, &mut outputs, &mut global_step_index);
    outputs
}

fn extract_outputs_from_steps(
    steps: &[TestStep],
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
                            command_index: *input_step_index,
                        });
                    }
                }
            }
            "block" => {
                // Process nested steps in blocks
                if let Some(nested_steps) = &step.steps {
                    extract_outputs_from_steps(nested_steps, outputs, global_step_index);
                }
            }
            _ => {} // Skip comments and other step types
        }
    }
}

fn extract_all_outputs_from_rep(rep_content: &str) -> Result<Vec<ActualOutput>> {
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
                None
            };
        } else if let Some(section) = current_section {
            // Add content to current section
            if section == "output" {
                current_content.push(line);
            }
        }
    }

    // Handle the last section if it was an output
    if let Some("output") = current_section {
        outputs.push(ActualOutput {
            actual_content: current_content.join("\n"),
        });
    }

    Ok(outputs)
}

fn compare_output_sequences(
    expected: &[OutputExpectation],
    actual: &[ActualOutput],
    pattern_file: Option<String>,
) -> Result<Vec<TestError>> {
    let mut errors = Vec::new();

    // Simple pattern matching logic (extracted from cmp crate to avoid circular dependency)
    let patterns = if let Some(pattern_file_path) = pattern_file {
        load_patterns_for_validation(&PathBuf::from(pattern_file_path))
            .unwrap_or_default()
    } else {
        HashMap::new()
    };

    // Compare each expected output with actual output
    for (exp, act) in expected.iter().zip(actual.iter()) {
        // Use simple pattern matching for comparison
        if has_diff_simple(&exp.expected_content, &act.actual_content, &patterns) {
            errors.push(TestError {
                command: exp.command.clone(),
                expected: exp.expected_content.clone(),
                actual: act.actual_content.clone(),
                step: exp.command_index,
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

// COPY the working PatternMatcher from CMP - DON'T REINVENT
#[derive(Debug)]
pub enum MatchingPart {
    Static(String),
    Pattern(String),
}

pub struct PatternMatcher {
    config: HashMap<String, String>,
    var_regex: Regex,
}

impl PatternMatcher {
    /// Initialize with patterns HashMap (for WASM use)
    pub fn from_patterns(patterns: HashMap<String, String>) -> Self {
        // Convert patterns to CMP format: PATTERN_NAME REGEX -> PATTERN_NAME #!/REGEX/!#
        let config: HashMap<String, String> = patterns.iter()
            .map(|(name, regex)| (name.clone(), format!("#!/{}/!#", regex)))
            .collect();

        let var_regex = Regex::new(r"%\{[A-Z]{1}[A-Z_0-9]*\}").unwrap();
        Self { config, var_regex }
    }

    /// COPY the working has_diff method from CMP
    pub fn has_diff(&self, rec_line: String, rep_line: String) -> bool {
        let rec_line = self.replace_vars_to_patterns(rec_line);
        let parts = self.split_into_parts(&rec_line);
        let mut last_index = 0;

        for part in parts {
            match part {
                MatchingPart::Static(static_part) => {
                    if rep_line[last_index..].starts_with(&static_part) {
                        last_index += static_part.len();
                    } else {
                        return true;
                    }
                }
                MatchingPart::Pattern(pattern) => {
                    let pattern_regex = Regex::new(&pattern).unwrap();
                    if let Some(mat) = pattern_regex.find(&rep_line[last_index..]) {
                        last_index += mat.end();
                    } else {
                        return true;
                    }
                }
            }
        }

        last_index != rep_line.len()
    }

    /// COPY split_into_parts from CMP
    pub fn split_into_parts(&self, rec_line: &str) -> Vec<MatchingPart> {
        let mut parts = Vec::new();

        let first_splits: Vec<&str> = rec_line.split("#!/").collect();
        for first_split in first_splits {
            let second_splits: Vec<&str> = first_split.split("/!#").collect();
            if second_splits.len() == 1 {
                parts.push(MatchingPart::Static(second_splits.first().unwrap().to_string()));
            } else {
                for (i, second_split) in second_splits.iter().enumerate() {
                    if i % 2 == 1 {
                        parts.push(MatchingPart::Static(second_split.to_string()));
                    } else {
                        parts.push(MatchingPart::Pattern(second_split.to_string()));
                    }
                }
            }
        }
        parts
    }

    /// COPY replace_vars_to_patterns from CMP
    pub fn replace_vars_to_patterns(&self, line: String) -> String {
        let result = self.var_regex.replace_all(&line, |caps: &regex::Captures| {
            let matched = &caps[0];
            let key = matched[2..matched.len() - 1].to_string();
            self.config.get(&key).unwrap_or(&matched.to_string()).clone()
        });

        result.into_owned()
    }
}

// Use the WORKING CMP PatternMatcher instead of broken logic
fn has_diff_simple(expected: &str, actual: &str, patterns: &HashMap<String, String>) -> bool {
    let pattern_matcher = PatternMatcher::from_patterns(patterns.clone());
    pattern_matcher.has_diff(expected.to_string(), actual.to_string())
}

/// Load patterns from a specific file into the patterns map
fn load_patterns_for_validation(file_path: &Path) -> Result<HashMap<String, String>> {
    let mut patterns = HashMap::new();

    if !file_path.exists() {
        return Ok(patterns);
    }

    let content = fs::read_to_string(file_path)?;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Parse pattern line: PATTERN_NAME REGEX_PATTERN
        let parts: Vec<&str> = line.splitn(2, ' ').collect();
        if parts.len() == 2 {
            patterns.insert(parts[0].to_string(), parts[1].to_string());
        }
    }

    Ok(patterns)
}

/// Load patterns from a specific file into the patterns map
fn load_patterns_from_file(file_path: &Path, patterns: &mut HashMap<String, String>) -> Result<()> {
    let content = fs::read_to_string(file_path)?;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Parse pattern line: PATTERN_NAME REGEX_PATTERN
        let parts: Vec<&str> = line.splitn(2, ' ').collect();
        if parts.len() == 2 {
            patterns.insert(parts[0].to_string(), parts[1].to_string());
        }
    }

    Ok(())
}

// ===== WASM-COMPATIBLE FUNCTIONS (NO FILE SYSTEM OPERATIONS) =====

/// WASM-compatible function to read and parse test file using file content map
pub fn read_test_file_from_map(
    main_file_path: &str,
    file_map: &HashMap<String, String>
) -> Result<TestStructure> {
    // Get the main file content from the map
    let main_content = file_map.get(main_file_path)
        .ok_or_else(|| anyhow::anyhow!("Main file not found in file map: {}", main_file_path))?;

    // Parse using the existing logic but with file map override
    parse_rec_content_with_file_map(main_content, file_map)
}

/// Modified version of parse_rec_content that uses file map instead of file system
fn parse_rec_content_with_file_map(content: &str, file_map: &HashMap<String, String>) -> Result<TestStructure> {
    let lines: Vec<&str> = content.lines().collect();
    let mut steps = Vec::new();
    let mut i = 0;

    // First, extract description (everything before the first statement)
    let mut description_lines = Vec::new();

    while i < lines.len() {
        let line = lines[i].trim();

        // Check if this is a statement line
        if line.starts_with("––– ") && line.ends_with(" –––") {
            break;
        }

        // Skip empty lines at the beginning if no content yet
        if description_lines.is_empty() && line.is_empty() {
            i += 1;
            continue;
        }

        description_lines.push(lines[i]); // Keep original line with whitespace
        i += 1;
    }

    // Trim trailing empty lines from description
    while let Some(last) = description_lines.last() {
        if last.trim().is_empty() {
            description_lines.pop();
        } else {
            break;
        }
    }

    let description = if description_lines.is_empty() {
        None
    } else {
        Some(description_lines.join("\n"))
    };

    // Now parse the statements starting from where we left off - COPY EXACT LOGIC
    while i < lines.len() {
        let line = lines[i].trim();

        // Skip empty lines
        if line.is_empty() {
            i += 1;
            continue;
        }

        // Check if this is a statement line
        if line.starts_with("––– ") && line.ends_with(" –––") {
            let (statement, arg) = parse_statement(line)?;
            let step = match statement {
                Statement::Input => {
                    // Collect input content until next statement
                    let (content, next_idx) = collect_content(&lines, i + 1)?;
                    i = next_idx;
                    TestStep {
                        step_type: "input".to_string(),
                        args: vec![],
                        content: Some(content),
                        steps: None,
                    }
                }
                Statement::Output => {
                    // Collect output content until next statement
                    let (content, next_idx) = collect_content(&lines, i + 1)?;
                    i = next_idx;
                    let args = if let Some(checker) = arg {
                        vec![checker]
                    } else {
                        vec![]
                    };
                    TestStep {
                        step_type: "output".to_string(),
                        args,
                        content: Some(content),
                        steps: None,
                    }
                }
                Statement::Comment => {
                    // Collect comment content until next statement
                    let (content, next_idx) = collect_content(&lines, i + 1)?;
                    i = next_idx;
                    TestStep {
                        step_type: "comment".to_string(),
                        args: vec![],
                        content: Some(content),
                        steps: None,
                    }
                }
                Statement::Block => {
                    let block_path =
                        arg.ok_or_else(|| anyhow::anyhow!("Block statement missing path argument"))?;

                    // Resolve block file using file map instead of file system
                    let nested_steps = resolve_block_with_file_map(&block_path, file_map)?;
                    i += 1; // Move past the block statement line

                    TestStep {
                        step_type: "block".to_string(),
                        args: vec![block_path],
                        content: None,
                        steps: Some(nested_steps),
                    }
                }
                Statement::Duration => {
                    // Skip duration statements (they're auto-generated)
                    i += 1;
                    continue;
                }
            };

            steps.push(step);
        } else {
            return Err(anyhow::anyhow!("Unexpected line: {}", line));
        }
    }

    Ok(TestStructure {
        description,
        steps,
    })
}

/// Resolve a block reference using file map instead of file system
fn resolve_block_with_file_map(block_path: &str, file_map: &HashMap<String, String>) -> Result<Vec<TestStep>> {
    let block_file_key = format!("{}.recb", block_path);

    if let Some(block_content) = file_map.get(&block_file_key) {
        let block_structure = parse_rec_content_with_file_map(block_content, file_map)?;
        Ok(block_structure.steps)
    } else {
        Err(anyhow::anyhow!("Block file not found in file map: {}", block_file_key))
    }
}

/// WASM-compatible function that returns file content map for writing
pub fn write_test_file_to_map(
    test_file_path: &str,
    test_structure: &TestStructure
) -> Result<HashMap<String, String>> {
    // Use the existing convert_structure_to_rec function
    let content = convert_structure_to_rec(test_structure)?;
    let mut file_map = HashMap::new();
    file_map.insert(test_file_path.to_string(), content);
    Ok(file_map)
}

/// WASM-compatible function to validate a test using file content map
/// This avoids file system operations that are not supported in WASM
/// Input: rec_file_path (key in file_map), file_map containing all files (.rec, .rep, .recb, patterns)
pub fn validate_test_from_map(
    rec_file_path: &str,
    file_map: &HashMap<String, String>
) -> Result<ValidationResult> {
    // Get REC file content from map
    let rec_content = file_map.get(rec_file_path)
        .ok_or_else(|| anyhow::anyhow!("REC file not found in file map: {}", rec_file_path))?;

    // Derive REP file path by replacing .rec with .rep
    let rep_file_path = rec_file_path.replace(".rec", ".rep");

    // Get REP file content from map
    let rep_content = file_map.get(&rep_file_path)
        .ok_or_else(|| anyhow::anyhow!("REP file not found in file map: {}", rep_file_path))?;

    // Parse REC file into structured format using file map for block resolution
    let test_structure = match parse_rec_content_with_file_map(rec_content, file_map) {
        Ok(structure) => structure,
        Err(e) => {
            return Ok(ValidationResult {
                success: false,
                errors: vec![TestError {
                    command: "rec_file_parsing".to_string(),
                    expected: "Valid .rec file format".to_string(),
                    actual: format!("Failed to parse .rec file: {}", e),
                    step: 0,
                }],
                summary: "Failed to parse test file".to_string(),
            });
        }
    };

    // Extract all expected outputs from structured REC (handles blocks, nesting, etc.)
    let expected_outputs = extract_all_outputs_from_structured(&test_structure);

    // Extract all actual outputs from flat REP file
    let actual_outputs = match extract_all_outputs_from_rep(rep_content) {
        Ok(outputs) => outputs,
        Err(e) => {
            return Ok(ValidationResult {
                success: false,
                errors: vec![TestError {
                    command: "rep_file_parsing".to_string(),
                    expected: "Valid .rep file format".to_string(),
                    actual: format!("Failed to parse .rep file: {}", e),
                    step: 0,
                }],
                summary: "Failed to parse test result file".to_string(),
            });
        }
    };

    // For WASM compatibility, we can't use file system to find pattern files
    // Instead, we'll check if a pattern file exists in the file map
    let pattern_file = find_pattern_file_from_map(rec_file_path, file_map);

    // Compare output sequences using pattern matching logic
    let mut errors = Vec::new();
    match compare_output_sequences(&expected_outputs, &actual_outputs, pattern_file) {
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

    let success = errors.is_empty();
    let summary = if success {
        "All outputs match expected results".to_string()
    } else {
        format!("{} validation error(s) found", errors.len())
    };

    Ok(ValidationResult {
        success,
        errors,
        summary,
    })
}

/// WASM-compatible function to validate a test using file content map with optional patterns
/// This version accepts patterns directly instead of trying to discover them from file map
pub fn validate_test_from_map_with_patterns(
    rec_file_path: &str,
    file_map: &HashMap<String, String>,
    patterns: Option<HashMap<String, String>>
) -> Result<ValidationResult> {
    // Get REC file content from map
    let rec_content = file_map.get(rec_file_path)
        .ok_or_else(|| anyhow::anyhow!("REC file not found in file map: {}", rec_file_path))?;

    // Derive REP file path by replacing .rec with .rep
    let rep_file_path = rec_file_path.replace(".rec", ".rep");

    // Get REP file content from map
    let rep_content = file_map.get(&rep_file_path)
        .ok_or_else(|| anyhow::anyhow!("REP file not found in file map: {}", rep_file_path))?;

    // Parse REC file into structured format using file map for block resolution
    let test_structure = match parse_rec_content_with_file_map(rec_content, file_map) {
        Ok(structure) => structure,
        Err(e) => {
            return Ok(ValidationResult {
                success: false,
                errors: vec![TestError {
                    command: "rec_file_parsing".to_string(),
                    expected: "Valid .rec file format".to_string(),
                    actual: format!("Failed to parse .rec file: {}", e),
                    step: 0,
                }],
                summary: "Failed to parse test file".to_string(),
            });
        }
    };

    // Extract all expected outputs from structured REC (handles blocks, nesting, etc.)
    let expected_outputs = extract_all_outputs_from_structured(&test_structure);

    // Extract all actual outputs from flat REP file
    let actual_outputs = match extract_all_outputs_from_rep(rep_content) {
        Ok(outputs) => outputs,
        Err(e) => {
            return Ok(ValidationResult {
                success: false,
                errors: vec![TestError {
                    command: "rep_file_parsing".to_string(),
                    expected: "Valid .rep file format".to_string(),
                    actual: format!("Failed to parse .rep file: {}", e),
                    step: 0,
                }],
                summary: "Failed to parse test result file".to_string(),
            });
        }
    };

    // Use provided patterns or fall back to file map discovery
    let pattern_file_path = if let Some(patterns_map) = patterns {
        // Write to a temporary location that compare_output_sequences can read
        // Actually, let's not use files - let's modify the approach
        eprintln!("🔥 USING PROVIDED PATTERNS: {} patterns", patterns_map.len());

        // Use the working comparison logic directly with our patterns
        let mut errors = Vec::new();
        for (exp, act) in expected_outputs.iter().zip(actual_outputs.iter()) {
            if has_diff_simple(&exp.expected_content, &act.actual_content, &patterns_map) {
                errors.push(TestError {
                    command: exp.command.clone(),
                    expected: exp.expected_content.clone(),
                    actual: act.actual_content.clone(),
                    step: exp.command_index,
                });
            }
        }

        // Check for count mismatch
        if expected_outputs.len() != actual_outputs.len() {
            errors.push(TestError {
                command: "output_count_mismatch".to_string(),
                expected: format!("{} outputs expected", expected_outputs.len()),
                actual: format!("{} outputs found", actual_outputs.len()),
                step: 0,
            });
        }

        let success = errors.is_empty();
        let summary = if success {
            "All outputs match expected results".to_string()
        } else {
            format!("{} validation error(s) found", errors.len())
        };

        return Ok(ValidationResult {
            success,
            errors,
            summary,
        });
    } else {
        // Fallback: try to find patterns in file map (existing behavior)
        let pattern_file = find_pattern_file_from_map(rec_file_path, file_map);
        pattern_file
    };

    // Use the WORKING compare_output_sequences function
    let mut errors = Vec::new();
    match compare_output_sequences(&expected_outputs, &actual_outputs, pattern_file_path) {
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

    let success = errors.is_empty();
    let summary = if success {
        "All outputs match expected results".to_string()
    } else {
        format!("{} validation error(s) found", errors.len())
    };

    Ok(ValidationResult {
        success,
        errors,
        summary,
    })
}

/// Helper function to find pattern file from file map instead of filesystem
fn find_pattern_file_from_map(rec_file_path: &str, file_map: &HashMap<String, String>) -> Option<String> {
    // Try to find pattern file in the same directory as the rec file
    let rec_path = std::path::Path::new(rec_file_path);
    let dir = rec_path.parent()?.to_str()?;

    // Look for patterns file in the same directory
    let patterns_path = if dir.is_empty() {
        "patterns".to_string()
    } else {
        format!("{}/patterns", dir)
    };

    file_map.get(&patterns_path).cloned()
}
