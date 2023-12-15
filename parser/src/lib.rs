use anyhow::Result;
use std::fs::{File, read_to_string};
use std::io::{BufRead, BufReader};
use std::error::Error;

use std::path::Path;
use regex::Regex;

pub const COMMAND_PREFIX: &str = "––– input –––";
pub const COMMAND_SEPARATOR: &str = "––– output –––";
pub const BLOCK_REGEX: &str = r"(?m)^––– block: ([\.a-zA-Z0-9\-\/\_]+) –––$";
pub const DURATION_REGEX: &str = r"(?m)^––– duration: ([0-9\.]+)ms \(([0-9\.]+)%\) –––$";

pub struct Duration {
  pub duration: u128,
  pub percentage: f32,
}

/// Compile the input rec file into String that
/// - contains expanded blocks with --- block: file –––
/// TODO: - contains expanded patterns from .patterns file into raw regex ()
pub fn compile(rec_file_path: &str) -> Result<String> {
	let input_file = File::open(rec_file_path)?;
	let input_dir = Path::new(rec_file_path).parent().unwrap_or_else(|| Path::new(""));
	let reader = BufReader::new(input_file);
	let mut result = String::new();

	let block_re = Regex::new(BLOCK_REGEX)?;
	let duration_re = Regex::new(DURATION_REGEX)?;
	for line in reader.lines() {
		let line = line.unwrap();
		if let Some(caps) = block_re.captures(&line) {
			let block_name = format!("{}.recb", caps.get(1).map_or("", |m| m.as_str()));
			let relative_path = Path::new(&block_name);
			let block_path = input_dir.join(relative_path);
			let absolute_path = std::fs::canonicalize(block_path)?;
			let block_content = read_to_string(absolute_path)?;
			result.push_str(block_content.trim());
			result.push('\n');
			continue;
		} else if let Some(_) = duration_re.captures(&line) {
			continue;
		}

		result.push_str(&line);
		result.push('\n');
	}

	Ok(result)
}

/// Generate duration line normally for writing it to the replay file
pub fn get_duration_line(duration: Duration) -> String {
	format!("––– duration: {}ms ({:.2}%) –––", duration.duration, duration.percentage)
}

/// Check if the current line is duration line
pub fn is_duration_line(line: &str) -> bool {
	line.starts_with("––– duration:")
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
