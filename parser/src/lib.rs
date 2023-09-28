use anyhow::Result;
use std::fs::{File, read_to_string};
use std::io::{BufRead, BufReader};
use std::path::Path;
use regex::Regex;

pub const COMMAND_PREFIX: &str = "––– input –––";
pub const COMMAND_SEPARATOR: &str = "––– output –––";
pub const BLOCK_REGEX: &str = r"(?m)^––– block: ([\.a-zA-Z0-9\-\/\_]+) –––$";

/// Compile the input rec file into String that
/// - contains expanded blocks with --- block: file –––
/// TODO: - contains expanded patterns from .patterns file into raw regex ()
pub fn compile(rec_file_path: &str) -> Result<String> {
	let input_file = File::open(rec_file_path)?;
	let input_dir = Path::new(rec_file_path).parent().unwrap_or_else(|| Path::new(""));
	let reader = BufReader::new(input_file);
	let mut result = String::new();

	let re = Regex::new(BLOCK_REGEX)?;
	for line in reader.lines() {
		let line = line.unwrap();
		if let Some(caps) = re.captures(&line) {
			let block_name = format!("{}.recb", caps.get(1).map_or("", |m| m.as_str()));
			let relative_path = Path::new(&block_name);
			let block_path = input_dir.join(relative_path);
			let absolute_path = std::fs::canonicalize(block_path)?;
			let block_content = read_to_string(absolute_path)?;
			result.push_str(block_content.trim());
			result.push('\n');
			continue;
		}

		result.push_str(&line);
		result.push('\n');
	}

	Ok(result)
}


