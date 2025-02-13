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

use regex::Regex;
use tokio::fs::{OpenOptions, File};
use tokio::io::{AsyncBufReadExt as _, AsyncReadExt as _, AsyncWriteExt as _, BufReader, BufWriter};
use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::oneshot;
use tokio::time::Instant;

#[derive(Debug, structopt::StructOpt)]
#[structopt(
	name = "rec",
	about = "Records input and output in rec files",
	long_about = "\n\
		This program will run a shell (or other program specified by the -c \
		option), and record the full input and output into a single file)."
)]
struct Opt {
	#[structopt(
		short = "I",
		long = "input",
		help = "File to read command to replay from"
	)]
	input_file: Option<std::ffi::OsString>,

	#[structopt(
		short = "O",
		long = "output",
		default_value = "output.rec",
		help = "File to save recorded results to"
	)]
	output_file: std::ffi::OsString,

	#[structopt(
		short = "p",
		long = "prompt",
		multiple = true,
		help = "Default prompts to use for parsing"
	)]
	prompts: Vec<String>,

	#[structopt(
		short = "D",
		long = "delay",
		multiple = false,
		help = "Delay between commands in ms",
		default_value = "0"
	)]
	delay: u64
}

const OUTPUT_HEADER: &str = "You can use regex in the output sections.\nMore info here: https://github.com/manticoresoftware/clt#refine\n";
const SHELL_CMD: &str = "/usr/bin/env";
const SHELL_PROMPT: &str = "clt> ";
const INIT_CMD: &[u8] = b"export PS1='clt> ' \
	PS2='' \
	PS3='' \
	PS4=''; \
	export LANG='en_US.UTF-8' \
	PATH='/bin:/usr/bin:/usr/local/bin:/sbin:/usr/local/sbin' \
	COLUMNS=10000; \
	alias curl='function _curl() { \
		command curl -s \"$@\" | awk \"NR==1{p=\\$0}NR>1{print p;p=\\$0}END{ORS = p ~ /\\\n$/ ? \\\"\\\" : \\\"\\\n\\\";print p}\"; \
	}; _curl'; \
	enable -n exit enable; \
	exec 2>&1;";

#[derive(Debug)]
enum Event {
	Key(textmode::Result<Option<textmode::Key>>),
	Stdout(std::io::Result<Vec<u8>>),
	Write(std::io::Result<Vec<u8>>),
	Error(anyhow::Error),
	Replay(String, oneshot::Sender<()>),
	Quit,
}

#[tokio::main]
async fn async_main(opt: Opt) -> anyhow::Result<()> {
	let Opt { input_file, output_file, mut prompts, delay } = opt;
	prompts.push(SHELL_PROMPT.to_string());
	let mut stdout = tokio::io::stdout();

	let mut pty = pty_process::Pty::new()?;
	let pts = pty.pts()?;
	let mut process = pty_process::Command::new(SHELL_CMD);
	process.arg("-i")
		.arg(format!("PS1={}", SHELL_PROMPT))
		.arg("bash")
		.arg("--noprofile")
		.arg("--rcfile")
		.arg(get_bash_rcfile().await.unwrap())
		// .stdout(std::process::Stdio::piped())
	;

	let is_replay = input_file.is_some();
	let mut child = process.spawn(&pts)?;

	let mut input = textmode::blocking::Input::new()?;
	let _input_guard = input.take_raw_guard();

	let (event_w, mut event_r) = tokio::sync::mpsc::unbounded_channel();
	let (input_w, mut input_r) = tokio::sync::mpsc::unbounded_channel();

	// We use this buffer to gather all inputs we type
	let mut output_fh = tokio::fs::File::create(output_file.clone()).await?;

	// If we have input file passed, we replay, otherwise – record
	// Replay the input_file and save results in output_file
	if let Some(input_file) = input_file {
		let input_file = input_file.into_string().unwrap();
		let input_content = match parser::compile(&input_file) {
			Ok(content) => content,
			Err(e) => panic!("Failed to compile input file: {}", e),
		};

		// Split compiled file into lines to process it next
		let lines: Vec<&str> = input_content.split('\n').collect();

		let mut commands = Vec::new();
		// We need to send empty command to block thread till we get forked and get clt> prompt
		commands.push(String::from(""));

		// Extract all commands
		let mut command_lines = Vec::new();
		let mut is_input_command = false;
		for line in lines {
			let input_check = parser::check_statement!(&line, parser::Statement::Input);
			if input_check == parser::StatementCheck::Yes {
				is_input_command = true;
				continue;
			}
			if input_check == parser::StatementCheck::No {
				let command = command_lines.join("\n");
				command_lines.clear();
				commands.push(command);
				is_input_command = false;
			}

			if is_input_command {
				command_lines.push(line);
			}
		}

		// Trap the signals and exit process in case we receive it for replay only
		{
			tokio::spawn(async move {
				let mut sigterm = signal(SignalKind::terminate()).unwrap();
				let mut sigint = signal(SignalKind::interrupt()).unwrap();
				loop {
					tokio::select! {
						_ = sigterm.recv() => {
							println!("Received SIGINT");
							std::process::exit(130);
						}
						_ = sigint.recv() => {
							println!("Received SIGTERM");
							std::process::exit(143);
						}
					};
				}
			});
		}

		{
			let event_w = event_w.clone();
			tokio::spawn(async move {
				for command in commands {
					let (tx, rx) = oneshot::channel();
					event_w.send(Event::Replay(command.to_string(), tx)).unwrap();
					// Block until the command has finished executing.
					rx.await.unwrap();

					// Sleep for delay before process next command
					if delay > 0 {
						tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
					}
				}

				// Exit with ^D because we do not write it
				// We should not send ^D here because it probably will go to replay,
				// but we do not handle it now
				event_w.send(Event::Quit).unwrap();

			});
		}

	} else {
		{
			let event_w = event_w.clone();
			std::thread::spawn(move || {
				loop {
					event_w
						.send(Event::Key(input.read_key()))
						// event_w is never closed, so this can never fail
						.unwrap();
				}
			});
		}
	}

	{
		let event_w = event_w.clone();
		tokio::task::spawn(async move {
			loop {
				let mut buf = [0_u8; 4096];
				tokio::select! {
					res = pty.read(&mut buf) => {
						match res {
							Ok(n) => {
								let bytes = buf[..n].to_vec();
								// println!("[{}]", String::from_utf8_lossy(&bytes));
								// We need this write only for non replay action
								let filtered = filter_stdout_buf(bytes);
								if !is_replay {
									event_w.send(Event::Write(Ok(filtered.clone()))).unwrap();
								}
								event_w
									.send(Event::Stdout(Ok(filtered)))
									// event_w is never closed, so this can never fail
									.unwrap();
							},
							Err(err) => {
								eprintln!("pty read failed: {}", err);
								break;
							}
						}
					}
					res = input_r.recv() => {
						if res.is_none() {
							return;
						}

						let bytes: Vec<u8> = res.unwrap();

						if let Err(e) = pty.write(&bytes).await {
							event_w
								.send(Event::Error(anyhow::anyhow!(e)))
								// event_w is never closed, so this can never
								// fail
								.unwrap();
						}
					}
					_ = child.wait() => {
						event_w.send(Event::Quit).unwrap();
						break;
					}
				}
			}
		});
	}

	let mut input_pos: usize = 0;
	let mut input: Vec<u8> = Vec::new();
	let mut is_typing = false;
	let mut total_duration: u128 = 0;
	loop {
		match event_r.recv().await.unwrap() {
			Event::Key(key) => {
				let key = key?;
				if let Some(ref key) = key {
					let bytes = key.clone().into_bytes();
					match *key {
						textmode::Key::Char(c) => {
							input.insert(input_pos, c as u8);
							input_pos += 1;
						}
						textmode::Key::Backspace => {
							if input_pos > 0 {
								input.remove(input_pos - 1);
								input_pos -= 1;
							}
						}
						textmode::Key::Delete => {
							if input_pos < input.len() {
								input.remove(input_pos);
							}
						}
						textmode::Key::Left => {
							if input_pos > 0 {
								input_pos -= 1;
							}
						}
						textmode::Key::Right => {
							if input_pos < input.len() {
								input_pos += 1;
							}
						}
						textmode::Key::Ctrl(b'a') => {
							input_pos = 0;
						}
						textmode::Key::Ctrl(b'e') => {
							input_pos = input.len();
						}
						_ => {}
					}

					// And when we hit enter – send it
					is_typing = true;
					if bytes == [13] || bytes == [04] {
						let mut command = if bytes == [04] {
							"^D".to_string()
						} else {
							String::from_utf8_lossy(&input).to_string()
						};
						is_typing = false;

						// Do not write empty commands and ^D to the end of file because we are just exiting
						if !command.is_empty() && command != String::from("^D") {
							let input_line = parser::get_statement_line(parser::Statement::Input, None);
							let output_line = parser::get_statement_line(parser::Statement::Output, None);
							command = format!("\n{}\n{}\n{}\n", input_line, command, output_line);
							event_w.send(Event::Write(Ok(command.as_bytes().to_vec()))).unwrap();
						}

						input.clear();
						input_pos = 0;
					}
					input_w.send(bytes).unwrap();
				} else {
					break;
				}
			}
			Event::Stdout(bytes) => match bytes {
				Ok(bytes) => {
					if !is_replay {
						stdout.write_all(&bytes).await?;
						stdout.flush().await?;
					}
				}
				Err(e) => {
					anyhow::bail!("failed to read from child process: {}", e);
				}
			}
			Event::Write(bytes) => match bytes {
				Ok(bytes) => {
					let output = std::str::from_utf8(&bytes)?;
					// We write only when the output is not the same as input
					// This solves problem with readline usage in interactive mysql shell
					// That duplicates output to stdout from user input
					let input = std::str::from_utf8(&input)?;
					if !is_typing && !input.ends_with(output) {
						output_fh.write_all(&output.as_bytes()).await?;
					}
				}
				Err(e) => {
					anyhow::bail!("failed to read from child process: {}", e);
				}
			}
			Event::Error(e) => {
				return Err(e);
			}
			Event::Replay(command, tx) => {
				let start = Instant::now();
				let mut command_output: String = String::new();
				let mut command_size = 0;
				let mut result: Vec<u8> = Vec::new();
				if !command.is_empty() {
					let mut bytes: Vec<u8>;
					bytes = command.as_bytes().to_vec();
					bytes.push(13u8); // Add enter keystroke

					let input_line = parser::get_statement_line(parser::Statement::Input, None);
					let output_line = parser::get_statement_line(parser::Statement::Output, None);
					let input_cmd = format!("\n{}\n{}\n{}\n", input_line, command, output_line);
					result.extend_from_slice(input_cmd.as_bytes());				// Send the command to the pty
					command_size = bytes.len();
					input_w.send(bytes).unwrap();
				}


				// Wait for the shell prompt to appear in the output, indicating that
				// the command has finished executing. You may need to adjust the
				// prompt detection logic depending on the shell being used.
				let mut ignored_size = 0;
				loop {
					if let Event::Stdout(Ok(bytes)) = event_r.recv().await.unwrap() {
						let mut pos = 0;
						let payload_size = bytes.len();
						if ignored_size < command_size {
							if payload_size > (command_size - ignored_size) {
								pos = command_size - ignored_size;
								ignored_size = command_size;
							} else {
								ignored_size += payload_size;
								continue;
							}
						}

						if pos < payload_size {
							let output = format!("{}", String::from_utf8_lossy(&bytes[pos..payload_size]));
							command_output.push_str(&output);
						}

						let pattern_str = get_pattern_string(String::from(""), &prompts);
						let re = Regex::new(&pattern_str).unwrap();
						let is_done = if re.is_match(&command_output) && is_prompting(&command_output, &prompts) {
							true
						} else {
							false
						};

						if is_done {
							let filtered_output = filter_prompt(command_output.as_str(), &prompts);
							if !command.is_empty() {
								result.extend_from_slice(filtered_output.as_bytes());
								// Add duration line
								let duration = parser::Duration {
									duration: start.elapsed().as_millis(),
									percentage: 0.0
								};
								total_duration += duration.duration;

								let duration_line = get_duration_line(duration);
								result.extend_from_slice(duration_line.as_bytes());
							}

							let content = filter_stdout_buf(result);
							event_w.send(Event::Write(Ok(content))).unwrap();

							// Signal that the command has finished executing.
							tx.send(()).unwrap();
							break;
						}
					}
				}
			}
			Event::Quit => {
				// Do a file clean up to remove spaces and make consistent output
				let file_path = output_file.clone().into_string().unwrap();
				cleanup_file(file_path, total_duration).await.unwrap();

				println!("");
				break
			}
		};
	}

	Ok(())
}

#[paw::main]
fn main(opt: Opt) {
	match async_main(opt) {
		Ok(_) => (),
		Err(e) => {
			eprintln!("rec: {}", e);
			std::process::exit(1);
		}
	};
}

fn filter_stdout_buf(buf: Vec<u8>) -> Vec<u8> {
	// Create new bytes vector and filter from buf zero bytes
	// and also replace \n to \r int it due to we need return caret in terminal
	let mut prev_byte = &0;
	let mut bytes: Vec<u8> = Vec::new();
	for byte in buf.iter() {
		if *byte == b'\0' || *byte == 7u8 {
			continue;
		}

		if *prev_byte != b'\r' && *byte == b'\n' {
			bytes.push(b'\r');
		}

		bytes.push(*byte);
		prev_byte = byte;
	}
	let bytes = clean_escape_sequences(bytes);
	bytes
}

fn filter_prompt(prompt: &str, prompts: &[String]) -> String {
	let pattern_str = get_pattern_string(String::from(".*"), prompts);
	let re = regex::Regex::new(&pattern_str).unwrap();
	re.replace_all(prompt, "").to_string()
}

fn clean_escape_sequences(input: Vec<u8>) -> Vec<u8> {
	let mut result = Vec::with_capacity(input.len());
	let mut inside_escape = false;
	let mut bytes = input.into_iter().peekable();

	while let Some(byte) = bytes.next() {
		if byte == 0x1B && bytes.peek() == Some(&b'[') {
			inside_escape = true;
			bytes.next(); // Skip the '[' byte
		} else if inside_escape {
			if byte.is_ascii_alphabetic() {
				inside_escape = false;
			}
		} else {
			result.push(byte);
		}
	}

	result
}

fn is_prompting(output: &str, prompts: &[String]) -> bool {
	let pattern_str: String = get_pattern_string(String::from(""), prompts);
	let re = regex::Regex::new(&pattern_str).unwrap();
	let last_line = output.lines().last().unwrap_or("");
	re.is_match(last_line)
}

fn get_pattern_string(suffix: String, prompts: &[String]) -> String {
	prompts.iter()
		.map(|prompt| format!(r"(?m)^{}{}\r?$", regex::escape(prompt), suffix))
		.collect::<Vec<_>>()
		.join("|")
}

/// This function cleans up all empty lines and removes the last line containing "exit" to make the consistent output
async fn cleanup_file(file_path: String, total_duration: u128) -> Result<(), Box<dyn std::error::Error>> {
	let file = File::open(&file_path).await?;
	let temp_output_file: String = format!("{}.tmp", &file_path);
	let temp_file = OpenOptions::new()
		.write(true)
		.create(true)
		.open(&temp_output_file)
		.await?;
	let reader = BufReader::new(file);
	let mut writer = BufWriter::new(temp_file);

	let mut lines = reader.lines();

	let mut non_empty_lines = Vec::new();
	non_empty_lines.push(String::from(OUTPUT_HEADER));
	non_empty_lines.push(format!("Time taken for test: {}ms\n", total_duration));
	while let Some(line) = lines.next_line().await? {
		if !line.trim().is_empty() {
			let duration_check = parser::check_statement!(&line, parser::Statement::Duration);
			if duration_check == parser::StatementCheck::Yes {
				let mut duration = parser::parse_duration_line(&line)?;
				duration.percentage = (duration.duration as f32 / total_duration as f32) * 100.0;
				let duration_line = get_duration_line(duration);
				non_empty_lines.push(format!("{}\n", duration_line));
			} else {
				let cur_line = if line.ends_with('\n') {
					line.to_string()
				} else {
					format!("{}\n", line)
				};
				non_empty_lines.push(cur_line);
			}
		}
	}

	if let Some(last_line) = non_empty_lines.last() {
		if last_line.trim().to_lowercase().contains("exit") {
			non_empty_lines.pop();
		}
	}

	for line in non_empty_lines {
		writer.write_all(line.as_bytes()).await?;
	}

	writer.flush().await?;

	tokio::fs::remove_file(&file_path).await?;
	tokio::fs::rename(temp_output_file, file_path).await?;

	Ok(())
}

async fn get_bash_rcfile() -> Result<String, Box<dyn std::error::Error>> {
	let file_name = ".rec-bashrc";
	let temp_dir = std::env::temp_dir();
	let file_path = temp_dir.join(file_name);

	let file = OpenOptions::new()
		.write(true)
		.create(true)
		.truncate(true)
		.open(&file_path)
		.await?;
	let mut writer = BufWriter::new(file);
	writer.write_all(INIT_CMD).await?;
	writer.flush().await?;

	Ok(file_path.to_string_lossy().to_string())
}

fn get_duration_line(duration: parser::Duration) -> String {
	let duration_arg = Some(format!("{}ms ({:.2}%)", duration.duration, duration.percentage));
	let duration_line = parser::get_statement_line(parser::Statement::Duration, duration_arg);
	duration_line
}
