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

use std::fs::File;
use std::io::{BufReader, BufRead};
use std::env;
use regex::Regex;

const COMMAND_PREFIX: &str = "––– input –––";
const COMMAND_SEPARATOR: &str = "––– output –––";

fn main() {
	let args: Vec<String> = env::args().collect();
	if args.len() != 3 {
		eprintln!("Usage: {} rec-file rep-file", args[0]);
		std::process::exit(1);
	}

	let file1 = File::open(&args[1]).unwrap();
	let file2 = File::open(&args[2]).unwrap();
	let mut reader1 = BufReader::new(file1);
	let mut reader2 = BufReader::new(file2);

	let mut line1 = String::new();
	let mut line2 = String::new();

	let pattern_regex = Regex::new(r"#!/(.+?)/!#").unwrap();
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
				reader1.read_line(&mut line1).unwrap(),
				reader2.read_line(&mut line2).unwrap(),
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
			let read2 = reader2.read_line(&mut line2).unwrap();
			if read2 == 0 {
				break;
			}
		}

		// Skip all lines of first file until to move cursor to the same position
		while !is_line2_output && is_line1_output && line1.trim() != COMMAND_PREFIX {
			eprintln!("- {}", line1.trim());
			line1.clear();
			line1_skip_read = true;
			let read1 = reader1.read_line(&mut line1).unwrap();
			if read1 == 0 {
				break;
			}
		}

		if line1_skip_read || line2_skip_read {
			continue;
		}

		// Do the logic only for output
		if is_line1_output && is_line2_output {
			let mut has_diff: bool = false;
			let mut match_count = 0;
			for capture in pattern_regex.captures_iter(&line1) {
				match_count += 1;
				let pattern = capture.get(1).unwrap().as_str();
				let pattern_regex = Regex::new(pattern).unwrap();
				if !pattern_regex.is_match(&line2) {
					has_diff = true;
					break;
				}
			}

			// If no matches but lines are different – also add to diff
			if match_count == 0 && &line1 != &line2 {
				has_diff = true;
			}

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
