import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createReadStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Root directory of the project (the current directory where server.js is running)
const ROOT_DIR = process.cwd();

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Parse JSON bodies
app.use(express.json());

// Enable CORS for development
app.use((req, res, next) => {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
	res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	if (req.method === 'OPTIONS') {
		return res.sendStatus(200);
	}
	next();
});

// Helper function to get a file tree
async function buildFileTree(dir, basePath = '') {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const tree = [];

	for (const entry of entries) {
		// Skip hidden files/directories that start with a dot
		if (entry.name.startsWith('.')) continue;

		const relativePath = path.join(basePath, entry.name);
		const fullPath = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			const children = await buildFileTree(fullPath, relativePath);
			// Include all directories, even empty ones
			tree.push({
				name: entry.name,
				path: relativePath,
				isDirectory: true,
				children
			});
		} else {
			// Only include .rec and .recb files
			if (entry.name.endsWith('.rec') || entry.name.endsWith('.recb')) {
				tree.push({
					name: entry.name,
					path: relativePath,
					isDirectory: false
				});
			}
		}
	}

	return tree;
}

// API endpoint to get the file tree
app.get('/api/get-file-tree', async (req, res) => {
	try {
		const fileTree = await buildFileTree(ROOT_DIR);
		res.json({ fileTree });
	} catch (error) {
		console.error('Error getting file tree:', error);
		res.status(500).json({ error: 'Failed to get file tree' });
	}
});

// API endpoint to get file content
app.get('/api/get-file', async (req, res) => {
	try {
		const { path: filePath } = req.query;

		if (!filePath) {
			return res.status(400).json({ error: 'File path is required' });
		}

		const absolutePath = path.join(ROOT_DIR, filePath);

		// Basic security check to ensure the path is within the ROOT_DIR
		if (!absolutePath.startsWith(ROOT_DIR)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		const content = await fs.readFile(absolutePath, 'utf8');
		res.json({ content });
	} catch (error) {
		console.error('Error reading file:', error);
		res.status(404).json({ error: 'File not found or could not be read' });
	}
});

// API endpoint to save file content
app.post('/api/save-file', async (req, res) => {
	try {
		const { path: filePath, content } = req.body;

		if (!filePath || content === undefined) {
			return res.status(400).json({ error: 'File path and content are required' });
		}

		const absolutePath = path.join(ROOT_DIR, filePath);

		// Basic security check to ensure the path is within the ROOT_DIR
		if (!absolutePath.startsWith(ROOT_DIR)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Ensure directory exists
		const directory = path.dirname(absolutePath);
		await fs.mkdir(directory, { recursive: true });

		// Write file
		await fs.writeFile(absolutePath, content, 'utf8');

		res.json({ success: true });
	} catch (error) {
		console.error('Error saving file:', error);
		res.status(500).json({ error: 'Failed to save file' });
	}
});

// API endpoint to create directory
app.post('/api/create-directory', async (req, res) => {
	try {
		const { path: dirPath } = req.body;

		if (!dirPath) {
			return res.status(400).json({ error: 'Directory path is required' });
		}

		const absolutePath = path.join(ROOT_DIR, dirPath);

		// Basic security check to ensure the path is within the ROOT_DIR
		if (!absolutePath.startsWith(ROOT_DIR)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Create directory recursively
		await fs.mkdir(absolutePath, { recursive: true });

		res.json({ success: true, path: dirPath });
	} catch (error) {
		console.error('Error creating directory:', error);
		res.status(500).json({ error: 'Failed to create directory' });
	}
});

// Helper function to extract duration from rep file content
function extractDuration(content) {
	const durationMatch = content.match(/––– duration: (\d+)ms/);
	return durationMatch ? parseInt(durationMatch[1], 10) : null;
}

// API endpoint to run a test
app.post('/api/run-test', async (req, res) => {
	try {
		const { filePath, dockerImage } = req.body;

		if (!filePath) {
			return res.status(400).json({ error: 'File path is required' });
		}

		const absolutePath = path.join(ROOT_DIR, filePath);

		// Basic security check to ensure the path is within the ROOT_DIR
		if (!absolutePath.startsWith(ROOT_DIR)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Execute the clt test command to run the test (from the current directory)
		const testCommand = `clt test -d -t ${filePath} ${dockerImage ? dockerImage : ''}`;
		console.log(`Executing test command: ${testCommand}`);

		const { exec } = await import('child_process');

		// Execute in the current working directory
		const execOptions = {
			cwd: process.cwd(),
			env: {
				...process.env,
				CLT_NO_COLOR: '1',
			}
		};


		exec(testCommand, execOptions, async (error, stdout, stderr) => {
			// Log all output regardless of success/failure
			console.log(`Test stdout: ${stdout}`);
			if (stderr) {
				console.log(`Test stderr: ${stderr}`);
			}

			// Warnings like Docker platform mismatch shouldn't be treated as errors
			// If the exit code is 0, the test actually passed
			const exitCode = error ? error.code : 0;
			const testReallyFailed = exitCode !== 0;
			console.log(`Test exit code: ${exitCode}, Test failed: ${testReallyFailed}`);
			console.log(testReallyFailed ? `Test completed with differences: ${error?.message}` : 'Test passed with no differences');

			try {
				// First, read the .rec file to get the expected outputs
				const content = await fs.readFile(absolutePath, 'utf8');

				// Parse commands from .rec file
				const commands = [];
				const sections = content.split('––– input –––').slice(1);

				for (const section of sections) {
					const parts = section.split('––– output –––');
					if (parts.length >= 2) {
						const command = parts[0].trim();

						// Find the next command separator, if any
						const outputPart = parts[1].trim();
						let expectedOutput = outputPart;

						// Look for the next command delimiter (––– ... –––)
						const nextCommandMatch = outputPart.match(/–––\s+.*?\s+–––/);
						if (nextCommandMatch) {
							// Split at the next command delimiter to get just the output
							expectedOutput = outputPart.substring(0, nextCommandMatch.index).trim();
						}

						commands.push({
							command,
							expectedOutput,
							actualOutput: '', // Initialize with empty actual output
							status: 'pending', // Always initialize as pending
							duration: null    // Initialize duration as null
						});
					}
				}

				// Next, try to read the .rep file to get durations and expected outputs
				const repFilePath = absolutePath.replace(/\.rec$/, '.rep');
				let success = false; // Default to failure, will update based on command results

				try {
					const repContent = await fs.readFile(repFilePath, 'utf8');
					console.log(`Successfully read .rep file: ${repFilePath}`);

					// Parse actual outputs from .rep file
					const repSections = repContent.split('––– input –––').slice(1);

					for (let i = 0; i < Math.min(commands.length, repSections.length); i++) {
						const cmd = commands[i];
						const repParts = repSections[i].split('––– output –––');

						if (repParts.length >= 2) {
							// Extract duration from this section of the rep file
							const sectionContent = repSections[i];
							cmd.duration = extractDuration(sectionContent);

							// Get the output from the .rep file
							const outputSection = repParts[1].trim();
							const actualOutput = outputSection.split(/–––\s+.*?\s+–––/)[0].trim();
							
							// Always set the actual output from the rep file
							cmd.actualOutput = actualOutput;

							// If this is a new command without expected output, set it
							if (!cmd.expectedOutput) {
								cmd.expectedOutput = actualOutput;
							}
						}
					}
				} catch (repError) {
					console.log(`Could not read .rep file (this is normal for new tests): ${repError.message}`);
					// If .rep file doesn't exist, keep default values for commands
				}

				// Parse the stdout from the command to determine command statuses
				// The stdout contains the actual results of the test run
				let stdoutSections = stdout.split('––– input –––').slice(1);
				let allCommandsPassed = true;

				for (let i = 0; i < Math.min(commands.length, stdoutSections.length); i++) {
					const cmd = commands[i];
					const stdoutParts = stdoutSections[i].split('––– output –––');

					if (stdoutParts.length >= 2) {
						const commandOutput = stdoutParts[1].trim().split('\n\n')[0].trim();

						// Check if the output contains "OK" which means the test passed for this command
						if (commandOutput === 'OK' || commandOutput.startsWith('OK\n')) {
							cmd.status = 'matched';
							// Don't modify actualOutput here, it comes from rep file
						} else {
							cmd.status = 'failed';
							// Don't modify actualOutput here, it comes from rep file
							allCommandsPassed = false;
						}
					} else {
						// If we can't parse the output properly, mark as failed
						cmd.status = 'failed';
						allCommandsPassed = false;
					}
				}

				// Determine overall success based on command results
				success = allCommandsPassed;

				// Return commands and test status
				res.json({
					filePath,
					commands,
					dockerImage: dockerImage || 'default-image',
					success,
					exitCode: exitCode,
					exitCodeSuccess: exitCode === 0,
					error: testReallyFailed ? error?.message : null,
					stderr: stderr || null,
					stdout: stdout || null,
					message: success ? 'Test executed successfully' : 'Test executed with differences',
					testReallyFailed
				});
			} catch (readError) {
				console.error('Error reading test files:', readError);
				res.status(500).json({
					error: `Failed to read test files: ${readError.message}`,
					stderr,
					stdout
				});
			}
		});
	} catch (error) {
		console.error('Error running test:', error);
		res.status(500).json({ error: `Failed to run test: ${error.message}` });
	}
});

// Handle SPA routes - serve index.html for any other request
app.get('*', (req, res) => {
	res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
