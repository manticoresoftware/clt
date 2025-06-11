// Copyright (c) 2023-present, Manticore Software LTD (https://manticoresearch.com)
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
use std::io::{Cursor, BufReader, BufRead, SeekFrom, Seek, self};
use std::env;
use std::path::Path;
use termcolor::{Color, ColorChoice, ColorSpec, StandardStream, WriteColor};
use std::io::Write;
use tempfile;

// Import from lib
pub use cmp::{PatternMatcher, MatchingPart};

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

	let file_name: String = String::from("./.clt/patterns");
	let file_path = Path::new(&file_name);

	let pattern_matcher = PatternMatcher::new(match file_path.exists() {
		true => Some(file_name),
		false => None,
	}).unwrap();

	let input_content = parser::compile(&args[1]).unwrap();
	let file1_cursor = Cursor::new(input_content);
	let mut file1_reader = BufReader::new(file1_cursor);
	let input_line = parser::get_statement_line(parser::Statement::Input, None);
	move_cursor_to_line(&mut file1_reader, &input_line).unwrap();

	let file2 = File::open(&args[2]).unwrap();
	let mut file2_reader = BufReader::new(file2);
	move_cursor_to_line(&mut file2_reader, &input_line).unwrap();

	let debug_mode = match std::env::var("CLT_DEBUG") {
		Ok(value) => value == "1",
		Err(_) => false,
	};

	let use_inline_diff = match std::env::var("CLT_DIFF_INLINE") {
		Ok(value) => value == "1",
		Err(_) => false,
	};
	let mut files_have_diff = false;
	// Our new loop no longer assumes every block is output. We “peek” for section markers:
	while !reader_at_end(&mut file1_reader) {
    // Make sure both readers are aligned by skipping extra non-command blocks.
    skip_non_command_blocks(&mut file1_reader).unwrap();
    skip_non_command_blocks(&mut file2_reader).unwrap();

		// Get the marker from file1 (this is our expected statement)
		let stmt1_opt = peek_statement(&mut file1_reader).unwrap();
		if stmt1_opt.is_none() {
			break;
		}
		let stmt1 = stmt1_opt.unwrap();

		// Advance file2 until we see the same marker.
		loop {
			let stmt2_opt = peek_statement(&mut file2_reader).unwrap();
			if stmt2_opt.is_none() {
				eprintln!("Out of sync: expected {:?} but file2 ended", stmt1);
				std::process::exit(1);
			}
			let stmt2 = stmt2_opt.unwrap();
			if stmt2 == stmt1 {
				break;
			} else {
				// Skip the block in file2 that does not match file1’s marker.
        let mut dummy = String::new();
        file2_reader.read_line(&mut dummy)
          .expect("Error skipping extra line in file2");
			}
		}
		match stmt1 {
			parser::Statement::Input => {
				writeln!(stdout, "{}", parser::get_statement_line(parser::Statement::Input, None)).unwrap();

				let lines1 = buffer_block(&mut file1_reader)
					.expect("Error reading file1 input block");
				let _ = buffer_block(&mut file2_reader)
					.expect("Error reading file2 input block");

				for line in lines1 {
					writeln!(stdout, "{}", line).unwrap();
				}
			},
			parser::Statement::Output => {

				let pos = file1_reader.seek(SeekFrom::Current(0)).unwrap();

				let mut line = String::new();
				file1_reader.read_line(&mut line).unwrap();

				let (_, args) = parser::parse_statement(&line)
					.expect("Error parsing output statement");

				file1_reader.seek(SeekFrom::Start(pos)).unwrap();

				writeln!(stdout, "{}", parser::get_statement_line(parser::Statement::Output, args.clone())).unwrap();
				let lines1 = buffer_block(&mut file1_reader)
					.expect("Error reading file1 output block");
				let lines2 = buffer_block(&mut file2_reader)
					.expect("Error reading file2 output block");

				if let Some(checker) = args {
					// Create temporary files for both outputs
					let temp_dir = tempfile::Builder::new().prefix("cmp").tempdir().unwrap();
					let file1_path = temp_dir.path().join("expected.txt");
					let file2_path = temp_dir.path().join("actual.txt");

					// Write contents to temp files
					std::fs::write(&file1_path, lines1.join("\n")).unwrap();
					std::fs::write(&file2_path, lines2.join("\n")).unwrap();

					// Run the checker
					let checker_path = Path::new(".clt/checkers").join(checker);
					if !checker_path.exists() {
						panic!("Checker binary not found at: {:?}", checker_path);
					}

					let output = std::process::Command::new(checker_path)
						.arg(file1_path)
						.arg(file2_path)
						.output()
						.expect("Failed to execute checker");

					// Print original output as its arguments
					for line in lines1 {
						writeln!(stdout, "{}", line).unwrap();
					}
					if !output.status.success() {
						files_have_diff = true;
						stdout.set_color(ColorSpec::new().set_fg(Some(Color::Red))).unwrap();
						let output_str = String::from_utf8_lossy(&output.stdout);
						for line in output_str.lines() {
							writeln!(stdout, "! {}", line).unwrap();
						}
						let output_str = String::from_utf8_lossy(&output.stderr);
						for line in output_str.lines() {
							writeln!(stdout, "! {}", line).unwrap();
						}

						stdout.reset().unwrap();
						if debug_mode {
							// Print original replay output
							for line in lines2 {
								writeln!(stdout, "{}", line).unwrap();
							}
						}
					}
				} else {
					let has_diff = block_has_differences(&lines1, &lines2, &pattern_matcher);

					if has_diff {
						files_have_diff = true;
						let max_len = std::cmp::max(lines1.len(), lines2.len());
						for i in 0..max_len {
							match (lines1.get(i), lines2.get(i)) {
								(None, Some(line)) => {
									print_diff(&mut stdout, line, Diff::Plus);
								},
								(Some(line), None) => {
									print_diff(&mut stdout, line, Diff::Minus);
								},
								(Some(l1), Some(l2)) => {

									if pattern_matcher.has_diff(l1.to_string(), l2.to_string()) {
										if use_inline_diff && stdout.supports_color() {
											print_inline_diff(&mut stdout, l1, l2);
										} else {
											print_diff(&mut stdout, l1, Diff::Minus);
											print_diff(&mut stdout, l2, Diff::Plus);
										}
									} else if debug_mode {
										writeln!(stdout, "{}", l1).unwrap();
									}
								},
								_ => {},
							}
						}
					} else {
						if debug_mode {
							// Show all lines when in debug mode
							for line in &lines1 {
								writeln!(stdout, "{}", line).unwrap();
							}
						} else {
							// Just show OK when no differences and not in debug mode
							writeln!(stdout, "OK").unwrap();
						}
					}				}
			}
			_ => {
				// For any other section we simply print the next line from either file.
				let mut line1 = String::new();
				let mut line2 = String::new();
				file1_reader.read_line(&mut line1).unwrap();
				file2_reader.read_line(&mut line2).unwrap();
			},
		}
	}

	if files_have_diff {
		std::process::exit(1);
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

/// Peek the statement and return it from the given reader
fn peek_statement<R: BufRead + Seek>(reader: &mut R) -> io::Result<Option<parser::Statement>> {
	let pos = reader.seek(SeekFrom::Current(0))?;
	let mut line = String::new();
	let len = reader.read_line(&mut line)?;
	reader.seek(SeekFrom::Start(pos))?;
	if len == 0 {
		return Ok(None);
	}
	match parser::parse_statement(&line) {
		Ok((statement, _)) => Ok(Some(statement)),
		Err(_) => Ok(None),
	}
}

/// Buffer the statement block and read all content until the next one
fn buffer_block<R: BufRead + Seek>(reader: &mut R) -> io::Result<Vec<String>> {
	let mut block_lines = Vec::new();
	let mut line = String::new();
	let mut parsed = false;

	loop {
		let pos = reader.seek(SeekFrom::Current(0))?;
		line.clear();
		let len = reader.read_line(&mut line)?;
		if len == 0 {
			break; // EOF
		}

		// If the line can be parsed as a statement...
		if let Ok((_, _)) = parser::parse_statement(&line) {
			// Another statement here, stop
			if parsed {
				// New section reached, rewind and exit.
				reader.seek(SeekFrom::Start(pos))?;
				break;
			}
			parsed = true;
			// Do not include the first statement to the block lines
			continue;
		}

		// Empty lines important, so keep it
		block_lines.push(line.trim_end().to_string());
	}
	Ok(block_lines)
}

///
/// Check if the reader is at end-of-file.
///
/// Since BufReader does not provide an “is_eof” method, we can try peeking by attempting a read.
/// Note: In a more robust solution you might maintain state externally.
///
fn reader_at_end<R: BufRead + Seek>(reader: &mut R) -> bool {
	match reader.fill_buf() {
		Ok(buf) if buf.is_empty() => true,
		_ => false,
	}
}

// Simple printing of the diff with line by line comparison
fn print_diff(stdout:&mut StandardStream, line: &str, diff: Diff) {
	let (line, color) = match diff {
		Diff::Plus => (format!("+ {}", line.trim_end()), Color::Green),
		Diff::Minus => (format!("- {}", line.trim_end()), Color::Red),
	};
	stdout.set_color(ColorSpec::new().set_fg(Some(color))).unwrap();
	writeln!(stdout, "{}", line.trim_end()).unwrap();
	stdout.reset().unwrap();
}

fn print_inline_diff(stdout: &mut StandardStream, old_line: &str, new_line: &str) {
	// Compute common prefix length
	let prefix_len = old_line
		.chars()
		.zip(new_line.chars())
		.take_while(|(c1, c2)| c1 == c2)
		.count();

	// Compute common suffix length.
	let old_chars: Vec<char> = old_line.chars().collect();
	let new_chars: Vec<char> = new_line.chars().collect();
	let mut suffix_len = 0;
	while suffix_len < old_chars.len().saturating_sub(prefix_len) &&
	suffix_len < new_chars.len().saturating_sub(prefix_len) &&
	old_chars[old_chars.len() - suffix_len - 1] == new_chars[new_chars.len() - suffix_len - 1]
	{
		suffix_len += 1;
	}

	// If no common parts, fall back to printing separate -/+ lines (no bold formatting)
	if prefix_len == 0 && suffix_len == 0 {
		// Print the removal in red (non bold)
		stdout.set_color(ColorSpec::new().set_fg(Some(Color::Red)).set_bold(false)).unwrap();
		writeln!(stdout, "- {}", old_line).unwrap();
		stdout.reset().unwrap();
		// Print the addition in green (non bold)
		stdout.set_color(ColorSpec::new().set_fg(Some(Color::Green)).set_bold(false)).unwrap();
		writeln!(stdout, "+ {}", new_line).unwrap();
		stdout.reset().unwrap();
		return;
	}

	// Otherwise there is at least some common text; so produce a single diff line
	// We want the entire line (besides the diff-markers) printed in yellow (non bold)
	// and only the changed parts are highlighted (bold and red/green).
	// Break the line into three pieces.
	let old_prefix = &old_line[..prefix_len];
	let _new_prefix = &new_line[..prefix_len];
	let _old_suffix = &old_line[old_line.len() - suffix_len..];
	let new_suffix = &new_line[new_line.len() - suffix_len..];
	let old_changed = &old_line[prefix_len..old_line.len() - suffix_len];
	let new_changed = &new_line[prefix_len..new_line.len() - suffix_len];

	// Begin the combined diff line with a "~ " prefix.
	stdout.set_color(ColorSpec::new().set_fg(Some(Color::Yellow)).set_bold(false)).unwrap();
	write!(stdout, "~ ").unwrap();

	// Print the common prefix in yellow (non bold).
	write!(stdout, "{}", old_prefix).unwrap();

	// Now, if both removal and addition parts exist,
	// then print the deletion followed immediately by the addition.
	if !old_changed.is_empty() && !new_changed.is_empty() {
		// Print the removed text: bold red.
		stdout.set_color(ColorSpec::new().set_fg(Some(Color::Red)).set_bold(true)).unwrap();
		write!(stdout, "{}", old_changed).unwrap();
		// Switch back to yellow for spacing between removals and additions.
		stdout.set_color(ColorSpec::new().set_fg(Some(Color::Yellow)).set_bold(false)).unwrap();
		// Then print the added text: bold green.
		stdout.set_color(ColorSpec::new().set_fg(Some(Color::Green)).set_bold(true)).unwrap();
		write!(stdout, "{}", new_changed).unwrap();
		stdout.set_color(ColorSpec::new().set_fg(Some(Color::Yellow)).set_bold(false)).unwrap();
	} else if !old_changed.is_empty() {
		// Pure deletion: bold red.
		stdout.set_color(ColorSpec::new().set_fg(Some(Color::Red)).set_bold(true)).unwrap();
		write!(stdout, "{}", old_changed).unwrap();
		stdout.set_color(ColorSpec::new().set_fg(Some(Color::Yellow)).set_bold(false)).unwrap();
	} else if !new_changed.is_empty() {
		// Pure addition: bold green.
		stdout.set_color(ColorSpec::new().set_fg(Some(Color::Green)).set_bold(true)).unwrap();
		write!(stdout, "{}", new_changed).unwrap();
		stdout.set_color(ColorSpec::new().set_fg(Some(Color::Yellow)).set_bold(false)).unwrap();
	}

	// Finally, print the common suffix in yellow.
	write!(stdout, "{}", new_suffix).unwrap();
	writeln!(stdout).unwrap();
	stdout.reset().unwrap();
}

/// Helper to get info if we have any differences in block or not
fn block_has_differences(lines1: &[String], lines2: &[String], pattern_matcher: &PatternMatcher) -> bool {
	if lines1.len() != lines2.len() {
		return true;
	}

	for (l1, l2) in lines1.iter().zip(lines2.iter()) {
		if pattern_matcher.has_diff(l1.to_string(), l2.to_string()) {
			return true;
		}
	}
	false
}

// A helper to skip non-Input/Output blocks in the reader.
fn skip_non_command_blocks<R: BufRead + Seek>(reader: &mut R) -> io::Result<()> {
    loop {
        let pos = reader.seek(SeekFrom::Current(0))?;
        if let Some(stmt) = peek_statement(reader)? {
            if stmt == parser::Statement::Input || stmt == parser::Statement::Output {
                // Found a valid command block, so rewind and exit.
                reader.seek(SeekFrom::Start(pos))?;
                break;
            }
        } else {
            // End of file reached.
            break;
        }
        // Skip the block.
        let _ = buffer_block(reader)?;
    }
    Ok(())
}
