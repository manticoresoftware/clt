// Copyright (c) 2023, Manticore Software LTD (https://manticoresearch.com)
// All rights reserved
//
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, BufReader, BufRead, SeekFrom, Seek, self};
use std::env;
use std::path::Path;
use regex::Regex;
use termcolor::{Color, ColorChoice, ColorSpec, StandardStream, WriteColor};
use std::io::Write;

enum Diff {
	Plus,
	Minus
}

fn main() {
	// Set up the SIGINT signal handler
	ctrlc::set_handler(move || {
		println!("Received Ctrl+C! Exiting...");
		std::process::exit(130);
	}).expect("Error setting Ctrl-C handler");

	let mut stdout = StandardStream::stdout(ColorChoice::Auto);

	let args: Vec<String> = env::args().collect();
	if args.len() != 3 {
		eprintln!("Usage: {} rec-file rep-file", args[0]);
		std::process::exit(1);
	}

	let file_name: String = String::from(".patterns");
	let file_path = Path::new(&file_name);

	let pattern_matcher = PatternMatcher::new(match file_path.exists() {
		true => Some(file_name),
		false => None,
	}).unwrap();

	let input_content = parser::compile(&args[1]).unwrap();
	let file1_cursor = Cursor::new(input_content);
	let mut file1_reader = BufReader::new(file1_cursor);
	move_cursor_to_line(&mut file1_reader, parser::COMMAND_PREFIX).unwrap();

	let file2 = File::open(&args[2]).unwrap();
	let mut file2_reader = BufReader::new(file2);
	move_cursor_to_line(&mut file2_reader, parser::COMMAND_PREFIX).unwrap();

	let mut line1 = String::new();
	let mut line2 = String::new();

	let mut lines1 = vec![];
	let mut lines2 = vec![];

	let mut files_have_diff = false;
	loop {
		let [read1, read2] = [
			file1_reader.read_line(&mut line1).unwrap(),
			file2_reader.read_line(&mut line2).unwrap(),
		];

		if read1 == 0 && read2 == 0 {
			break;
		}

		if read1 == 0 {
			print_diff(&mut stdout, line2.trim(), Diff::Plus);
		} else if read2 == 0 {
			print_diff(&mut stdout, line1.trim(), Diff::Minus);
		} else {
			println!("{}", line2.trim());
		}

		// Change the current mode if we are in output section or not
		let mut r1 = read1;
		while r1 > 0 && line1.trim() != parser::COMMAND_SEPARATOR {
			line1.clear();
			r1 = file1_reader.read_line(&mut line1).unwrap();
			if read2 == 0 {
				print_diff(&mut stdout, line1.trim(), Diff::Minus);
			}
		}

		lines1.clear();
		while r1 > 0 {
			line1.clear();
			r1 = file1_reader.read_line(&mut line1).unwrap();
			if line1.trim() == parser::COMMAND_PREFIX {
				break;
			}
			if parser::is_duration_line(&line1) {
				continue;
			}
			lines1.push(line1.trim().to_string());
		}

		let mut r2 = read2;
		while r2 > 0 && line2.trim() != parser::COMMAND_SEPARATOR {
			line2.clear();
			r2 = file2_reader.read_line(&mut line2).unwrap();
			if read1 == 0 {
				print_diff(&mut stdout, line2.trim(), Diff::Plus);
			} else {
				println!("{}", line2.trim());
			}

		}

		lines2.clear();
		while r2 > 0 {
			line2.clear();
			r2 = file2_reader.read_line(&mut line2).unwrap();
			if line2.trim() == parser::COMMAND_PREFIX {
				break;
			}
			if parser::is_duration_line(&line2) {
				continue;
			}
			lines2.push(line2.trim().to_string());
		}

		let max_len = std::cmp::max(lines1.len(), lines2.len());

		for i in 0..max_len {
			match (lines1.get(i), lines2.get(i)) {
				(None, Some(line)) => {
					print_diff(&mut stdout, line.trim(), Diff::Plus);
					files_have_diff = true;
				},
				(Some(line), None) => {
					print_diff(&mut stdout, line.trim(), Diff::Minus);
					files_have_diff = true;
				},
				(Some(line1), Some(line2)) => {
					let has_diff: bool = pattern_matcher.has_diff(line1.to_string(), line2.to_string());
					if has_diff {
						print_diff(&mut stdout, line1.trim(), Diff::Minus);
						print_diff(&mut stdout, line2.trim(), Diff::Plus);
						files_have_diff = true;
					} else {
						println!("{}", line1.trim());
					}
				},
				_ => {}
			}
		}
	}

	if files_have_diff {
		std::process::exit(1);
	}
}

enum MatchingPart {
	Static(String),
	Pattern(String),
}

struct PatternMatcher {
	config: HashMap<String, String>,
	var_regex: Regex,
}

impl PatternMatcher {
	/// Initialize struct by using file name of the variables description for patterns
	/// If the option is none, we just will have empty map of keys for pattersn
	/// And in that case we will use only raw regexes to validate
	fn new(file_name: Option<String>) -> Result<Self, Box<dyn std::error::Error>> {
		let config = match file_name {
			Some(file_name) => Self::parse_config(file_name)?,
			None =>  HashMap::new(),
		};

		let var_regex = Regex::new(r"%\{[A-Z]{1}[A-Z_0-9]*\}")?;
		Ok(Self { config, var_regex })
	}

	/// Validate line from .rec file and line from .rep file
	/// by using open regex patterns and matched variables
	/// and return true or false in case if we have diff or not
	fn has_diff(&self, rec_line: String, rep_line: String) -> bool {
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

	/// Helper method to split line into parts
	/// To make it possible to validate pattern matched vars and static parts
	///
	fn split_into_parts(&self, rec_line: &str) -> Vec<MatchingPart> {
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

	/// Helper function that go through matched variable patterns in line
	/// And replace it all with values from our parsed config
	/// So we have raw regex to validate as an output
	fn replace_vars_to_patterns(&self, line: String) -> String {
		let result = self.var_regex.replace_all(&line, |caps: &regex::Captures| {
			let matched = &caps[0];
			let key = matched[2..matched.len() - 1].to_string();
			self.config.get(&key).unwrap_or(&matched.to_string()).clone()
		});

		result.into_owned()
	}

	/// Helper to parse the variables into config map when we pass path to the file
	fn parse_config(file_name: String) -> Result<HashMap<String, String>, Box<dyn std::error::Error>> {
		let mut config: HashMap<String, String> = HashMap::new();

		let file_path = Path::new(&file_name);
		let file = File::open(&file_path)?;
		let reader = BufReader::new(file);

		for line in reader.lines() {
			let line = line?.trim().to_string();
			let parts: Vec<&str> = line.split_whitespace().collect(); // adjust this based on how your file is structured
			if parts.len() == 2 {
				config.insert(
					parts[0].trim().to_string(),
					format!("#!/{}/!#", parts[1].trim())
				);
			}
		}

		Ok(config)
	}
}

fn move_cursor_to_line<R: BufRead + Seek>(reader: &mut R, command_prefix: &str) -> io::Result<()> {
	let mut line = String::new();

	loop {
		let pos = reader.seek(SeekFrom::Current(0))?;
		let len = reader.read_line(&mut line)?;

		if len == 0 {
			break;
		}

		if line.trim() == command_prefix {
			reader.seek(SeekFrom::Start(pos))?;
			break;
		}

		line.clear();
	}

	Ok(())
}

fn print_diff(stdout:&mut StandardStream, line: &str, diff: Diff) {
	let (line, color) = match diff {
		Diff::Plus => (format!("+ {}", line.trim()), Color::Green),
		Diff::Minus => (format!("- {}", line.trim()), Color::Red),
	};
	stdout.set_color(ColorSpec::new().set_fg(Some(color))).unwrap();
	writeln!(stdout, "{}", line.trim()).unwrap();
	stdout.reset().unwrap();
}
