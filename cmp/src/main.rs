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
use std::io::{Cursor, BufReader, BufRead};
use std::env;
use std::path::Path;
use regex::Regex;

const COMMAND_PREFIX: &str = "––– input –––";
const COMMAND_SEPARATOR: &str = "––– output –––";

fn main() {
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

	let file2 = File::open(&args[2]).unwrap();
	let mut file2_reader = BufReader::new(file2);

	let mut line1 = String::new();
	let mut line2 = String::new();

	let mut files_have_diff = false;
	let mut is_line1_output = false;
	let mut is_line2_output = false;

	let mut line1_skip_read = false;
	let mut line2_skip_read = false;
	loop {
		let [read1, read2] = if line1_skip_read || line2_skip_read {
			line1_skip_read = false;
			line2_skip_read = false;
			[line1.len() as usize, line2.len() as usize]
		} else {
			[
				file1_reader.read_line(&mut line1).unwrap(),
				file2_reader.read_line(&mut line2).unwrap(),
			]
		};

		if read1 == 0 && read2 == 0 {
			break;
		}

		// Change the current mode if we are in output section or not
		if line1.trim() == COMMAND_SEPARATOR {
			is_line1_output = true;
		}
		if line2.trim() == COMMAND_SEPARATOR {
			is_line2_output = true;
		}

		if line1.trim() == COMMAND_PREFIX {
			is_line1_output = false;
		}
		if line2.trim() == COMMAND_PREFIX {
			is_line2_output = false;
		}

		// Skip all lines of second file until to move cursor to the same position
		while !is_line1_output && is_line2_output && line2.trim() != COMMAND_PREFIX {
			eprintln!("+ {}", line2.trim());
			line2.clear();
			line2_skip_read = true;
			let read2 = file2_reader.read_line(&mut line2).unwrap();
			if read2 == 0 {
				break;
			}
		}

		// Skip all lines of first file until to move cursor to the same position
		while !is_line2_output && is_line1_output && line1.trim() != COMMAND_PREFIX {
			eprintln!("- {}", line1.trim());
			line1.clear();
			line1_skip_read = true;
			let read1 = file1_reader.read_line(&mut line1).unwrap();
			if read1 == 0 {
				break;
			}
		}

		if line1_skip_read || line2_skip_read {
			continue;
		}

		// Do the logic only for output
		if is_line1_output && is_line2_output {
			let has_diff: bool = pattern_matcher.has_diff(line1.to_string(), line2.to_string());

			if has_diff {
				eprintln!("- {}", line1.trim());
				eprintln!("+ {}", line2.trim());

				files_have_diff = true;
			} else {
				println!("{}", line1.trim());
			}
		} else {
			println!("{}", line1.trim());
		}

		line1.clear();
		line2.clear();
	}

	if files_have_diff {
		std::process::exit(1);
	}
}

struct PatternMatcher {
	config: HashMap<String, String>,
	val_regex: Regex,
	key_regex: Regex,
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

		let key_regex = Regex::new(r"%\{[A-Z]{1}[A-Z_0-9]*\}")?;
		let val_regex = Regex::new(r"#!/(.+?)/!#")?;

		Ok(Self { config, key_regex, val_regex })
	}

	/// Validate line from .rec file and line from .rep file
	/// by using open regex patterns and matched variables
	/// and return true or false in case if we have diff or not
	fn has_diff(&self, rec_line: String, rep_line: String) -> bool {
		// 1. We replace all variables matches to raw regexp
		let rec_line = self.replace_vars_to_patterns(rec_line);

		// 2. We go through the line and validate it as expanded raw regex in it without any vars
		let mut match_count = 0u8;
		for capture in self.val_regex.captures_iter(&rec_line) {
			match_count = match_count + 1;
			let pattern = capture.get(1).unwrap().as_str();
			let pattern_regex = Regex::new(pattern).unwrap();
			if !pattern_regex.is_match(&rep_line) {
				return true;
			}
		}

		match_count == 0 && rec_line != rep_line
	}

  /// Helper function that go through matched variable patterns in line
	/// And replace it all with values from our parsed config
	/// So we have raw regex to validate as an output
	fn replace_vars_to_patterns(&self, line: String) -> String {
    let result = self.key_regex.replace_all(&line, |caps: &regex::Captures| {
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
