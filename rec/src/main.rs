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

use tokio::fs::{OpenOptions, File};
use tokio::io::{AsyncReadExt as _, AsyncBufReadExt as _, AsyncWriteExt as _, BufReader, BufWriter};
use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::Mutex;
use tokio::time::Instant;
use tokio::process::{Child, Command};
use std::process::Stdio;
use std::sync::Arc;

// Exit code constants
const EXIT_SUCCESS: i32 = 0;              // Success (recording completed OR replay completed)
const EXIT_TEST_EXECUTION_FAILED: i32 = 1; // Test execution failed (replay mode crashes)
const EXIT_COMPILATION_ERROR: i32 = 2;     // Input file compilation/parsing errors  
const EXIT_SETUP_ERROR: i32 = 3;          // Environment setup errors (shell, paths)
const EXIT_RECORDING_ERROR: i32 = 4;      // Recording infrastructure errors
const EXIT_VALIDATION_ERROR: i32 = 5;     // Validation errors (file not found, invalid paths)
// Signal exit codes already defined: 129, 130, 143

// Custom error types for better error handling and exit code management
#[derive(Debug)]
pub enum RecError {
    // Test execution errors (replay mode)
    TestExecutionFailed(String),
    
    // Compilation and parsing errors
    CompilationError(String),
    
    // Setup and environment errors  
    SetupError(String),
    
    // Recording infrastructure errors (recording mode)
    RecordingError(String),
    
    // Validation errors (file not found, invalid paths)
    ValidationError(String),
}

impl RecError {
    pub fn exit_code(&self) -> i32 {
        match self {
            RecError::TestExecutionFailed(_) => EXIT_TEST_EXECUTION_FAILED,
            RecError::CompilationError(_) => EXIT_COMPILATION_ERROR,
            RecError::SetupError(_) => EXIT_SETUP_ERROR,
            RecError::RecordingError(_) => EXIT_RECORDING_ERROR,
            RecError::ValidationError(_) => EXIT_VALIDATION_ERROR,
        }
    }
}

impl std::fmt::Display for RecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RecError::TestExecutionFailed(msg) => write!(f, "Test execution failed: {}", msg),
            RecError::CompilationError(msg) => write!(f, "Compilation error: {}", msg),
            RecError::SetupError(msg) => write!(f, "Setup error: {}", msg),
            RecError::RecordingError(msg) => write!(f, "Recording error: {}", msg),
            RecError::ValidationError(msg) => write!(f, "Validation error: {}", msg),
        }
    }
}

impl std::error::Error for RecError {}

// Helper function for safe string conversion
fn safe_string_conversion(os_string: std::ffi::OsString, context: &str) -> Result<String, RecError> {
    os_string.into_string()
        .map_err(|_| RecError::SetupError(format!("Failed to convert path to string: {}", context)))
}

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
		short = "D",
		long = "delay",
		multiple = false,
		help = "Delay between commands in ms",
		default_value = "0"
	)]
	delay: u64
}

const OUTPUT_HEADER: &str = "You can use regex in the output sections.\nMore info here: https://github.com/manticoresoftware/clt#refine\n";
const END_MARKER: &str = "–––[END]–––";
const SHELL_PROMPT: &str = "clt> ";
const INIT_CMD: &[u8] = b"export PS1='clt> ' \
	PS2='' \
	PS3='' \
	PS4=''; \
	export LANG='en_US.UTF-8' \
	PATH='/bin:/usr/bin:/usr/local/bin:/sbin:/usr/local/sbin' \
	COLUMNS=10000; \
	enable -n exit enable;
	set +m;
	exec 2>&1;
	detach() { \"$@\" > /dev/null 2>&1 & }
";


#[tokio::main]
async fn async_main(opt: Opt) -> anyhow::Result<()> {
	let start_time = Instant::now();
	let Opt { input_file, output_file, delay } = opt;

	// Determine mode early for proper error handling
	let _is_replay_mode = input_file.is_some();

	let mut binding = Command::new("bash");
	let process = binding
		.arg("--noprofile")
		.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::null())
	;

	let mut child = process.spawn()?;
	let mut child_stdin = child.stdin.take().expect("Failed to get stdin");
	let child_stdout = child.stdout.take().expect("Failed to get stdout");

	child_stdin.write_all(INIT_CMD).await
		.map_err(|e| RecError::SetupError(
			format!("Failed to initialize shell environment: {}", e)
		))?;

	let child_arc = Arc::new(Mutex::new(child));

	// We use this buffer to gather all inputs we type
	let mut output_fh = tokio::fs::File::create(output_file.clone()).await?;

	let mut stdin_handle = None;
	let mut stdout_handle = None;
	let mut signal_handle = None;

	// If we have input file passed, we replay, otherwise – record
	// Replay the input_file and save results in output_file
	if let Some(input_file) = input_file {
		let input_file = safe_string_conversion(input_file, "input file path")?;
		let input_content = match parser::compile(&input_file) {
			Ok(content) => content,
			Err(e) => {
				// Check if this is a file not found error (validation) vs parsing error (compilation)
				let error_msg = e.to_string();
				if error_msg.contains("No such file or directory") || 
				   error_msg.contains("not found") ||
				   error_msg.contains("does not exist") {
					return Err(RecError::ValidationError(
						format!("The record file does not exist: {}", input_file)
					).into());
				} else {
					return Err(RecError::CompilationError(
						format!("Failed to compile test file '{}': {}", input_file, e)
					).into());
				}
			}
		};

		// Split compiled file into lines to process it next
		let lines: Vec<&str> = input_content.split('\n').collect();

		let mut commands = Vec::new();

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
				if is_input_command {
					commands.push(command);
					is_input_command = false;
				}
			}

			if is_input_command {
				command_lines.push(line);
			}
		}

		// Trap the signals and exit process in case we receive it for replay only
		let child_clone = child_arc.clone();
		signal_handle = Some(tokio::spawn(async move {
			handle_signals(&child_clone).await;
		}));

		// Read output now from stdout that is already merged with stderr
		let mut stdout_reader = BufReader::new(child_stdout);
		for command in commands {
			let command_with_marker = format!("{}\necho '{}'\n", command, END_MARKER);
			child_stdin.write_all(command_with_marker.as_bytes()).await
				.map_err(|e| RecError::TestExecutionFailed(
					format!("Failed to execute test command: {}", e)
				))?;
			child_stdin.flush().await
				.map_err(|e| RecError::TestExecutionFailed(
					format!("Failed to flush command to shell: {}", e)
				))?;

			let input_line = parser::get_statement_line(parser::Statement::Input, None);
			let output_line = parser::get_statement_line(parser::Statement::Output, None);

			// Read until marker
			let command_start = Instant::now();
			let mut output = String::new();
			loop {
				let mut buffer = [0; 1024];
				match stdout_reader.read(&mut buffer).await {
					Ok(0) => break, // EOF
					Ok(bytes_read) => {
						let read_data = &buffer[..bytes_read];

						// Check for end marker
						let read_str = String::from_utf8_lossy(read_data);
						if read_str.contains(END_MARKER) {
							if let Some(end_pos) = read_str.find(END_MARKER) {
								output.push_str(&read_str[..end_pos]);
								break;
							}
						}

						// Append the raw bytes to output
						output.push_str(&read_str);
					},
					Err(e) => {
						eprintln!("Failed to read from shell stdout: {}", e);
						break;
					}
				}
			}

			let command_end = Instant::now();
			let duration = parser::Duration {
				duration: command_end.duration_since(command_start).as_millis(),
				percentage: 0.0,
			};
			let duration_line = get_duration_line(duration);
			let content = format!("\n{}\n{}\n{}\n{}\n{}\n", input_line, command, output_line, output, duration_line);
			output_fh.write_all(&content.as_bytes()).await?;

			// Sleep for delay before process next command
			if delay > 0 {
				tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
			}
		}

		// Emulate Ctrl+D
		drop(child_stdin);
	} else {
		// At the beginning of the else block where you handle recording
		let command_buffer = Arc::new(Mutex::new(String::new()));
		let command_buffer_stdin = command_buffer.clone();
		let command_buffer_stdout = command_buffer.clone();

		// In the stdin handler
		let output_file_clone = output_file.clone();
		stdin_handle = Some(tokio::spawn(async move {
			let mut user_input = String::new();
			let mut stdin = BufReader::new(tokio::io::stdin());
			loop {
				user_input.clear();
				match stdin.read_line(&mut user_input).await {
					Ok(0) => {
						flush_output_file(output_file_clone, start_time).await;

						// Ctrl+D (EOF) detected
						drop(child_stdin);
						break;
					}
					Ok(_) => {
						if !user_input.trim().is_empty() {
							let command = user_input.clone();
							let command_with_marker = format!("{}echo '{}'\n", command, END_MARKER);

							// Write to shell
							if let Err(e) = child_stdin.write_all(command_with_marker.as_bytes()).await {
								eprintln!("Failed to write to shell: {}", e);
								break;
							}

							// Store command for later writing to file
							let mut buffer = command_buffer_stdin.lock().await;
							buffer.push_str(&command);
						}
					}
					Err(e) => {
						eprintln!("Failed to read from stdin: {}", e);
						break;
					}
				}
			}
		}));

		// In the stdout handler
		let mut stdout = tokio::io::stdout();
		stdout.write_all(SHELL_PROMPT.as_bytes()).await
			.map_err(|e| RecError::RecordingError(
				format!("Failed to write shell prompt during recording: {}", e)
			))?;
		stdout.flush().await
			.map_err(|e| RecError::RecordingError(
				format!("Failed to flush stdout during recording: {}", e)
			))?;

		stdout_handle = Some(tokio::spawn(async move {
			let mut reader = BufReader::new(child_stdout);
			let mut output_buffer = String::new();
			let mut line = String::new();
			let mut command_start = Instant::now();

			loop {
				line.clear();
				match reader.read_line(&mut line).await {
					Ok(0) => break, // EOF
					Ok(_) => {
						if line.trim() == END_MARKER {
							// Command completed, write to file
							let command_end = Instant::now();
							let duration = parser::Duration {
								duration: command_end.duration_since(command_start).as_millis(),
								percentage: 0.0,
							};
							let duration_line = get_duration_line(duration);

							let input_line = parser::get_statement_line(parser::Statement::Input, None);
							let output_line = parser::get_statement_line(parser::Statement::Output, None);

							let command = {
								let mut buffer = command_buffer_stdout.lock().await;
								let command = buffer.clone();
								buffer.clear();
								command
							};

							let content = format!(
								"\n{}\n{}\n{}\n{}\n{}\n",
								input_line,
								command,
								output_line,
								output_buffer,
								duration_line
							);

							if let Err(e) = output_fh.write_all(content.as_bytes()).await {
								eprintln!("Failed to write to output file: {}", e);
								break;
							}

							// Clear output buffer for next command
							output_buffer.clear();

							// Update command start time for next command
							command_start = Instant::now();

							if let Err(e) = stdout.write_all(SHELL_PROMPT.as_bytes()).await {
								eprintln!("Failed to write shell prompt: {}", e);
								break;
							}
							if let Err(e) = stdout.flush().await {
								eprintln!("Failed to flush stdout: {}", e);
								break;
							}

						} else {
							// Write to stdout and store in buffer
							if let Err(e) = stdout.write_all(line.as_bytes()).await {
								eprintln!("Failed to write to stdout: {}", e);
								break;
							}
							if let Err(e) = stdout.flush().await {
								eprintln!("Failed to flush stdout: {}", e);
								break;
							}
							output_buffer.push_str(&line);
						}
					}
					Err(e) => {
						eprintln!("Failed to read from shell stdout: {}", e);
						break;
					}
				}
			}
		}));

	}

	// Wait for the shell process to complete
	let mut child_guard = child_arc.lock().await;
	child_guard.wait().await?;

	// Cancel the I/O handlers
	if let Some(handle) = stdin_handle {
		handle.abort();
	}
	if let Some(handle) = stdout_handle {
		handle.abort();
	}
	if let Some(handle) = signal_handle {
		handle.abort();
	}

	flush_output_file(output_file, start_time).await;
	println!("");

	Ok(())
}

#[paw::main]
fn main(opt: Opt) {
    let exit_code = match async_main(opt) {
        Ok(_) => EXIT_SUCCESS,
        Err(e) => {
            eprintln!("rec: {}", e);
            
            // Try to downcast to RecError to get specific exit code
            if let Some(rec_error) = e.downcast_ref::<RecError>() {
                rec_error.exit_code()
            } else {
                // For any other anyhow::Error, use general error code
                EXIT_TEST_EXECUTION_FAILED
            }
        }
    };
    
    std::process::exit(exit_code);
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

fn get_duration_line(duration: parser::Duration) -> String {
	let duration_arg = Some(format!("{}ms ({:.2}%)", duration.duration, duration.percentage));
	let duration_line = parser::get_statement_line(parser::Statement::Duration, duration_arg);
	duration_line
}

/// Handle signals
async fn handle_signals(child: &Arc<Mutex<Child>>) {
	let sigterm = match signal(SignalKind::terminate()) {
		Ok(sig) => sig,
		Err(e) => {
			eprintln!("Warning: Failed to setup SIGTERM handler: {}", e);
			return;
		}
	};
	let sigint = match signal(SignalKind::interrupt()) {
		Ok(sig) => sig,
		Err(e) => {
			eprintln!("Warning: Failed to setup SIGINT handler: {}", e);
			return;
		}
	};
	let sighup = match signal(SignalKind::hangup()) {
		Ok(sig) => sig,
		Err(e) => {
			eprintln!("Warning: Failed to setup SIGHUP handler: {}", e);
			return;
		}
	};

	let mut sigterm = sigterm;
	let mut sigint = sigint;
	let mut sighup = sighup;

	tokio::select! {
	_ = sigterm.recv() => {
		println!("\nReceived SIGTERM");
		let mut child = child.lock().await;
		let _ = child.kill().await;
		std::process::exit(143);
	}
		_ = sigint.recv() => {
			println!("\nReceived SIGINT");
			let mut child = child.lock().await;
			let _ = child.kill().await;
			std::process::exit(130);
		}
		_ = sighup.recv() => {
			println!("\nReceived SIGHUP");
			let mut child = child.lock().await;
			let _ = child.kill().await;
			std::process::exit(129);
		}
	}
}

async fn flush_output_file(output_file: std::ffi::OsString, start_time: Instant) {
	let file_path = match output_file.into_string() {
		Ok(path) => path,
		Err(_) => {
			eprintln!("Warning: Failed to convert output file path to string");
			return;
		}
	};
	let total_duration = Instant::now() - start_time;
	if let Err(e) = cleanup_file(file_path, total_duration.as_millis()).await {
		eprintln!("Warning: Failed to cleanup output file: {}", e);
	}
}
