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

fn main() {
	let args: Vec<String> = env::args().collect();
	if args.len() != 3 {
		eprintln!("Usage: {} rec-file rep-file", args[0]);
		std::process::exit(1);
	}

	let file1 = File::open(&args[1]).unwrap();
	let file2 = File::open(&args[2]).unwrap();
	let file1_reader = BufReader::new(file1);
	let file2_reader = BufReader::new(file2);

	let pattern_regex = Regex::new(r"#!/(.+?)/!#").unwrap();

	let mut line_no = 0;
	let mut diff = Vec::new();
	for (line1, line2) in file1_reader.lines().zip(file2_reader.lines()) {
		line_no += 1;
		let line1 = line1.unwrap();
		let line2 = line2.unwrap();
		let mut has_diff = false;
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
			eprintln!("- {}", line1);
			eprintln!("+ {}", line2);

			diff.push((line_no, line1, line2));
		} else {
			println!("{}", line1);
		}
	}

	if !diff.is_empty() {
		std::process::exit(1);
	}
}
