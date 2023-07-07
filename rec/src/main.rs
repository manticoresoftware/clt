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

use regex::Regex;
use tokio::fs::{OpenOptions, File};
use tokio::io::{AsyncBufReadExt as _, AsyncReadExt as _, AsyncWriteExt as _, BufReader, BufWriter};
use tokio::sync::oneshot;

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
		short = "-I",
		long,
		help = "File to read command to replay from"
	)]
	input_file: Option<std::ffi::OsString>,

	#[structopt(
		short = "-O",
		long,
		default_value = "output.rec",
		help = "File to save recorded results to"
	)]
	output_file: std::ffi::OsString,
}

const SHELL_CMD: &str = "/usr/bin/env";
const SHELL_PROMPT: &str = "clt> ";
const PROMPT_REGEX_STR: &str = "([A-Za-z\\[\\]\\(\\)\\s]+?[$#>])";
const PROMPT_REGEX: &str = r"(?m)^([A-Za-z\[\]\(\)\s]+?[$#>])\s+?$";
const PROMPT_LINE_REGEX: &str = r"(?m)^([A-Za-z\[\]\(\)\s]+?[$#>][^\n]+?$)+";
const INIT_CMD: &[u8] = b"export PS1='clt> ';export LANG='en_US.UTF-8' PATH='/bin:/usr/bin:/usr/local/bin:/sbin:/usr/local/sbin' COLUMNS=10000;enable -n exit enable;exec 2>&1;";

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
	let Opt { input_file, output_file } = opt;

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
		let input_content = parser::compile(&input_file)?;

		// Split compiled file into lines to process it next
		let lines: Vec<&str> = input_content.split('\n').collect();

		let mut commands = Vec::new();
		// We need to send empty command to block thread till we get forked and get clt> prompt
		commands.push(String::from(""));

    let mut last_line = "";
    for line in lines {
			if line.starts_with(parser::COMMAND_SEPARATOR) {
				commands.push(last_line.to_string())
			}
			last_line = line;
    }

		{
			let event_w = event_w.clone();
			tokio::spawn(async move {
				for command in commands {
					let (tx, rx) = oneshot::channel();
					event_w.send(Event::Replay(command, tx)).unwrap();
					// Block until the command has finished executing.
					rx.await.unwrap();
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
	let mut command_output_last_line = String::new();
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

						// Do not write ^D to the end of file because we are just exiting
						if command != String::from("^D") {
							command = format!("\n{}\n{}\n{}\n", parser::COMMAND_PREFIX, command, parser::COMMAND_SEPARATOR);
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
						let filtered_output = filter_prompt(output);
						output_fh.write_all(&filtered_output.as_bytes()).await?;
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
				let mut command_output: String = String::new();
				command_output.push_str(&command_output_last_line);
				let mut result: Vec<u8> = Vec::new();
				if !command.is_empty() {
					let mut bytes: Vec<u8>;
					bytes = command.trim().as_bytes().to_vec();
					bytes.push(13u8); // Add enter keystroke

					let input_cmd = format!("\n{}\n{}\n{}\n", parser::COMMAND_PREFIX, command, parser::COMMAND_SEPARATOR);
					result.extend_from_slice(input_cmd.as_bytes());				// Send the command to the pty
					input_w.send(bytes).unwrap();
				}

				// Wait for the shell prompt to appear in the output, indicating that
				// the command has finished executing. You may need to adjust the
				// prompt detection logic depending on the shell being used.
				loop {
					if let Event::Stdout(Ok(bytes)) = event_r.recv().await.unwrap() {
						let output = format!("{}", String::from_utf8_lossy(&bytes));
						command_output.push_str(&output);

						let prompt_command_string = format!(r"^{} {}", PROMPT_REGEX_STR, regex::escape(&command));
						let prompt_command_regex = prompt_command_string.as_str();
						let re = Regex::new(prompt_command_regex).unwrap();
						let is_done = if re.is_match(&command_output) && is_prompting(&command_output) {
							true
						} else {
							false
						};

						if is_done {
							{
								let command_output_clone = command_output.clone();
								let command_output_lines = command_output_clone.lines();
								command_output_last_line = String::from(command_output_lines.last().unwrap_or(""));
							}
							let mut filtered_output = filter_prompt(command_output.as_str());
							if filtered_output.trim() == command.as_str() || filtered_output.trim().starts_with(format!("{}{}", command.as_str(), "\n").as_str()) {
								let start: usize = filtered_output.find(command.as_str()).unwrap_or(0) + command.len();
								filtered_output = substring(&filtered_output, start, filtered_output.len() - start).to_string();
							}
							result.extend_from_slice(filtered_output.as_bytes());

							let content = filter_stdout_buf(result);
							if content.len() > 0 {
								event_w.send(Event::Write(Ok(content))).unwrap();
							}

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
				cleanup_file(file_path).await.unwrap();

				println!("");
				break
			}
		}
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
	bytes
}

fn filter_prompt(prompt: &str) -> String {
	let re = Regex::new(PROMPT_LINE_REGEX).unwrap();
	re.replace_all(prompt, "").to_string()
}

fn is_prompting(output: &str) -> bool {
	let re = Regex::new(PROMPT_REGEX).unwrap();
	let last_line = output.lines().last().unwrap_or("");
	re.is_match(last_line)
}

/// This function cleans up all empty lines and removes the last line containing "exit" to make the consistent output
async fn cleanup_file(file_path: String) -> Result<(), Box<dyn std::error::Error>> {
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

	while let Some(line) = lines.next_line().await? {
		if !line.trim().is_empty() {
			non_empty_lines.push(format!("{}\n", line.trim()));
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

fn substring(s: &str, start: usize, len: usize) -> &str {
	let end = start + len;

	if end > s.len() {
		panic!("Substring index out of range");
	}

	&s[start..end]
}
