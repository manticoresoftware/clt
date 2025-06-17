use anyhow::{Context, Result};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::error::Error;
use std::str::FromStr;
use std::path::{Path, PathBuf};
use regex::Regex;

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
