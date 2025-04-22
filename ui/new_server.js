import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import session from 'express-session';
import dotenv from 'dotenv';
import { setupPassport, isAuthenticated, addAuthRoutes } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.BACKEND_PORT || process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// Root directory of the project (the current directory where server.js is running)
const ROOT_DIR = process.cwd();

// Initialize session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'clt-ui-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    sameSite: 'lax' // Allow cookies in cross-domain context with some security
  }
}));

// Initialize passport and authentication
const passport = setupPassport();
app.use(passport.initialize());
app.use(passport.session());

// Enable CORS for development
app.use((req, res, next) => {
  // Always allow the frontend URL
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const origin = req.headers.origin;

  // If request comes from frontend URL or another known origin
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  } else {
    // For requests without origin (like API tools), set a less permissive policy
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Parse JSON bodies
app.use(express.json());

// Add authentication routes
addAuthRoutes(app);

// API health check endpoint - can be used to verify authentication
app.get('/api/health', isAuthenticated, (req, res) => {
  return res.json({
    status: 'ok',
    authenticated: req.isAuthenticated(),
    user: req.user ? req.user.username : null
  });
});

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Serve public content (for login page and other public resources)
app.use(express.static(path.join(__dirname, 'public')));

// Helper function to get a file tree
async function buildFileTree(dir, basePath = '', followSymlinks = true) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const tree = [];

	for (const entry of entries) {
		// Skip hidden files/directories that start with a dot
		if (entry.name.startsWith('.')) continue;

		const relativePath = path.join(basePath, entry.name);
		const fullPath = path.join(dir, entry.name);

		let isDirectory = entry.isDirectory();
		let targetPath = fullPath;

		// Handle symlinks
		if (entry.isSymbolicLink() && followSymlinks) {
			try {
				// Get the symlink target
				const linkTarget = await fs.readlink(fullPath);
				
				// Resolve to absolute path if needed
				const resolvedTarget = path.isAbsolute(linkTarget)
					? linkTarget
					: path.resolve(path.dirname(fullPath), linkTarget);
				
				// Attempt to get stats of the target
				const targetStats = await fs.stat(resolvedTarget);
				isDirectory = targetStats.isDirectory();
				targetPath = resolvedTarget;
				
				console.log(`Symlink ${fullPath} -> ${resolvedTarget} (is directory: ${isDirectory})`);
			} catch (error) {
				console.error(`Error processing symlink ${fullPath}:`, error);
				continue; // Skip this entry if we can't resolve the symlink
			}
		}

		if (isDirectory) {
			// For directories (or symlinks to directories), recursively build the tree
			let children = [];
			try {
				children = await buildFileTree(targetPath, relativePath, followSymlinks);
			} catch (error) {
				console.error(`Error reading directory ${targetPath}:`, error);
			}

			tree.push({
				name: entry.name,
				path: relativePath,
				isDirectory: true,
				isSymlink: entry.isSymbolicLink(),
				targetPath: entry.isSymbolicLink() ? targetPath : undefined,
				children
			});
		} else {
			// For files, check if they match our extensions
			if (entry.name.endsWith('.rec') || entry.name.endsWith('.recb')) {
				tree.push({
					name: entry.name,
					path: relativePath,
					isDirectory: false,
					isSymlink: entry.isSymbolicLink(),
					targetPath: entry.isSymbolicLink() ? targetPath : undefined
				});
			}
		}
	}

	return tree;
}

// API endpoint to get the file tree
app.get('/api/get-file-tree', isAuthenticated, async (req, res) => {
	try {
		const fileTree = await buildFileTree(ROOT_DIR);
		res.json({ fileTree });
	} catch (error) {
		console.error('Error getting file tree:', error);
		res.status(500).json({ error: 'Failed to get file tree' });
	}
});

// API endpoint to get file content
app.get('/api/get-file', isAuthenticated, async (req, res) => {
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

		// Handle symlinks and resolve to the actual file
		let actualPath = absolutePath;
		const pathParts = filePath.split('/');
		
		// Check if the file is within a potential symlink directory
		for (let i = 1; i <= pathParts.length; i++) {
			const partialPath = pathParts.slice(0, i).join('/');
			const partialAbsolutePath = path.join(ROOT_DIR, partialPath);
			
			try {
				const stats = await fs.lstat(partialAbsolutePath);
				if (stats.isSymbolicLink()) {
					// Found a symlink in the path hierarchy
					const linkTarget = await fs.readlink(partialAbsolutePath);
					const resolvedTarget = path.isAbsolute(linkTarget)
						? linkTarget
						: path.resolve(path.dirname(partialAbsolutePath), linkTarget);
					
					// Replace the symlink part of the path with its target
					const remainingPath = pathParts.slice(i).join('/');
					actualPath = path.join(resolvedTarget, remainingPath);
					console.log(`Resolved symlink: ${absolutePath} -> ${actualPath}`);
					break;
				}
			} catch (error) {
				// If we can't access this path part, continue with the next one
				continue;
			}
		}

		// Read the actual file content
		const content = await fs.readFile(actualPath, 'utf8');
		res.json({ content });
	} catch (error) {
		console.error('Error reading file:', error);
		res.status(404).json({ error: 'File not found or could not be read' });
	}
});

// API endpoint to save file content
app.post('/api/save-file', isAuthenticated, async (req, res) => {
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

		// Handle symlinks in the path and save to the actual file location
		let actualPath = absolutePath;
		const pathParts = filePath.split('/');
		
		// Check if the file is within a potential symlink directory
		for (let i = 1; i <= pathParts.length; i++) {
			const partialPath = pathParts.slice(0, i).join('/');
			const partialAbsolutePath = path.join(ROOT_DIR, partialPath);
			
			try {
				const stats = await fs.lstat(partialAbsolutePath);
				if (stats.isSymbolicLink()) {
					// Found a symlink in the path hierarchy
					const linkTarget = await fs.readlink(partialAbsolutePath);
					const resolvedTarget = path.isAbsolute(linkTarget)
						? linkTarget
						: path.resolve(path.dirname(partialAbsolutePath), linkTarget);
					
					// Replace the symlink part of the path with its target
					const remainingPath = pathParts.slice(i).join('/');
					actualPath = path.join(resolvedTarget, remainingPath);
					console.log(`Resolved symlink for save: ${absolutePath} -> ${actualPath}`);
					break;
				}
			} catch (error) {
				// If we can't access this path part, continue with the next one
				continue;
			}
		}

		// Ensure directory exists
		const directory = path.dirname(actualPath);
		await fs.mkdir(directory, { recursive: true });

		// Write file to the resolved path
		await fs.writeFile(actualPath, content, 'utf8');

		res.json({ success: true });
	} catch (error) {
		console.error('Error saving file:', error);
		res.status(500).json({ error: 'Failed to save file' });
	}
});

// API endpoint to move or rename a file
app.post('/api/move-file', isAuthenticated, async (req, res) => {
	try {
		const { sourcePath, targetPath } = req.body;

		if (!sourcePath || !targetPath) {
			return res.status(400).json({ error: 'Source and target paths are required' });
		}

		const absoluteSourcePath = path.join(ROOT_DIR, sourcePath);
		const absoluteTargetPath = path.join(ROOT_DIR, targetPath);

		// Basic security check to ensure both paths are within the ROOT_DIR
		if (!absoluteSourcePath.startsWith(ROOT_DIR) || !absoluteTargetPath.startsWith(ROOT_DIR)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Handle symlinks in the source path
		let actualSourcePath = absoluteSourcePath;
		const sourcePathParts = sourcePath.split('/');
		
		// Check if the source file is within a potential symlink directory
		for (let i = 1; i <= sourcePathParts.length; i++) {
			const partialPath = sourcePathParts.slice(0, i).join('/');
			const partialAbsolutePath = path.join(ROOT_DIR, partialPath);
			
			try {
				const stats = await fs.lstat(partialAbsolutePath);
				if (stats.isSymbolicLink()) {
					// Found a symlink in the path hierarchy
					const linkTarget = await fs.readlink(partialAbsolutePath);
					const resolvedTarget = path.isAbsolute(linkTarget)
						? linkTarget
						: path.resolve(path.dirname(partialAbsolutePath), linkTarget);
					
					// Replace the symlink part of the path with its target
					const remainingPath = sourcePathParts.slice(i).join('/');
					actualSourcePath = path.join(resolvedTarget, remainingPath);
					console.log(`Resolved source symlink: ${absoluteSourcePath} -> ${actualSourcePath}`);
					break;
				}
			} catch (error) {
				// If we can't access this path part, continue with the next one
				continue;
			}
		}

		// Handle symlinks in the target path
		let actualTargetPath = absoluteTargetPath;
		const targetPathParts = targetPath.split('/');
		
		// Check if the target file is within a potential symlink directory
		for (let i = 1; i <= targetPathParts.length; i++) {
			const partialPath = targetPathParts.slice(0, i).join('/');
			const partialAbsolutePath = path.join(ROOT_DIR, partialPath);
			
			try {
				const stats = await fs.lstat(partialAbsolutePath);
				if (stats.isSymbolicLink()) {
					// Found a symlink in the path hierarchy
					const linkTarget = await fs.readlink(partialAbsolutePath);
					const resolvedTarget = path.isAbsolute(linkTarget)
						? linkTarget
						: path.resolve(path.dirname(partialAbsolutePath), linkTarget);
					
					// Replace the symlink part of the path with its target
					const remainingPath = targetPathParts.slice(i).join('/');
					actualTargetPath = path.join(resolvedTarget, remainingPath);
					console.log(`Resolved target symlink: ${absoluteTargetPath} -> ${actualTargetPath}`);
					break;
				}
			} catch (error) {
				// If we can't access this path part, continue with the next one
				continue;
			}
		}

		// Ensure target directory exists
		const targetDir = path.dirname(actualTargetPath);
		await fs.mkdir(targetDir, { recursive: true });

		// Move/rename the file using resolved paths
		await fs.rename(actualSourcePath, actualTargetPath);

		res.json({ success: true });
	} catch (error) {
		console.error('Error moving file:', error);
		res.status(500).json({ error: 'Failed to move file' });
	}
});

// API endpoint to delete a file
app.delete('/api/delete-file', isAuthenticated, async (req, res) => {
	try {
		const { path: filePath } = req.body;

		if (!filePath) {
			return res.status(400).json({ error: 'File path is required' });
		}

		const absolutePath = path.join(ROOT_DIR, filePath);

		// Basic security check to ensure the path is within the ROOT_DIR
		if (!absolutePath.startsWith(ROOT_DIR)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Check if it's a file or directory
		const stats = await fs.stat(absolutePath);
		
		if (stats.isDirectory()) {
			// For directories, use recursive removal
			await fs.rm(absolutePath, { recursive: true });
		} else {
			// For individual files
			await fs.unlink(absolutePath);
		}

		res.json({ success: true });
	} catch (error) {
		console.error('Error deleting file:', error);
		res.status(500).json({ error: 'Failed to delete file' });
	}
});

// API endpoint to create directory
app.post('/api/create-directory', isAuthenticated, async (req, res) => {
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

// API endpoint to get patterns file
app.get('/api/get-patterns', isAuthenticated, async (req, res) => {
  try {
    // Read the patterns file from the .clt/patterns path in UI folder or fall back to the project root
    let patternsContent;
    try {
      // First try to read from UI folder .clt directory
      patternsContent = await fs.readFile(path.join(__dirname, '.clt', 'patterns'), 'utf8');
    } catch (err) {
      // If not found, try to read from project root
      try {
        patternsContent = await fs.readFile(path.join(ROOT_DIR, '.clt', 'patterns'), 'utf8');
      } catch (innerErr) {
        // If both fail, return an error
        return res.status(404).json({ error: 'Patterns file not found' });
      }
    }

    // Parse the patterns file to convert it to JSON format
    const patterns = {};
    const lines = patternsContent.split('\n').filter(line => line.trim() !== '');

    for (const line of lines) {
      const parts = line.split(' ');
      if (parts.length >= 2) {
        const patternName = parts[0].trim();
        const patternRegex = parts.slice(1).join(' ').trim();
        patterns[patternName] = patternRegex;
      }
    }

    res.json({ patterns });
  } catch (error) {
    console.error('Error reading patterns file:', error);
    res.status(500).json({ error: 'Failed to read patterns file' });
  }
});

// API endpoint to run a test
app.post('/api/run-test', isAuthenticated, async (req, res) => {
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
// Apply light authentication check - client side will show login UI when needed

// API endpoint to create GitHub PR
// API endpoint to create GitHub PR
app.post('/api/create-pr', isAuthenticated, async (req, res) => {
	try {
		const { title, description } = req.body;
		
		if (!title) {
			return res.status(400).json({ error: 'PR title is required' });
		}

		// Check if user is authenticated with GitHub
		if (!req.user || !req.user.username) {
			return res.status(401).json({ error: 'GitHub authentication required' });
		}

		// Create a new branch name based on timestamp and username
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const branchName = `clt-ui-${req.user.username}-${timestamp}`;

		// Check if git and gh CLI are available
		const { exec } = await import('child_process');
		const execPromise = (cmd, options) => new Promise((resolve, reject) => {
			exec(cmd, options, (error, stdout, stderr) => {
				if (error) {
					console.error(`Command execution error: ${stderr}`);
					return reject(error);
				}
				resolve(stdout.trim());
			});
		});

		// Get the tests directory path and resolve if it's a symlink
		const testsDir = path.join(ROOT_DIR, 'tests');
		let actualTestsDir = testsDir;
		let isSymlink = false;

		try {
			// Check if tests dir is a symlink
			const testsDirStats = await fs.lstat(testsDir);
			if (testsDirStats.isSymbolicLink()) {
				isSymlink = true;
				// Get symlink target
				const symlinkTarget = await fs.readlink(testsDir);
				// Resolve to absolute path if needed
				actualTestsDir = path.isAbsolute(symlinkTarget) ? 
					symlinkTarget : path.resolve(path.dirname(testsDir), symlinkTarget);
				console.log(`Tests directory is a symlink pointing to ${actualTestsDir}`);
			}
		} catch (err) {
			console.error('Error checking tests directory:', err);
			return res.status(500).json({ error: 'Failed to access tests directory' });
		}

		// Check if tests directory is a git repository or inside one
		try {
			// Change to the actual tests directory
			process.chdir(actualTestsDir);

			// Check if git is available
			await execPromise('git --version');

			// Try to get the git repo root
			const gitRoot = await execPromise('git rev-parse --show-toplevel');
			console.log(`Git repository found at: ${gitRoot}`);

			// Change to the git root directory
			process.chdir(gitRoot);

			// Get the current branch
			const currentBranch = await execPromise('git rev-parse --abbrev-ref HEAD');
			console.log(`Current branch: ${currentBranch}`);

			// Get current repository information
			const remoteUrl = await execPromise('git config --get remote.origin.url');
			console.log(`Remote repository URL: ${remoteUrl}`);

			// Create a new branch
			await execPromise(`git checkout -b ${branchName}`);
			console.log(`Created and switched to new branch: ${branchName}`);

			// Stage all changes in the tests directory
			// If we're using a symlink, we need to stage the actual directory inside the repo
			const pathToStage = isSymlink ? 
				// If symlink, find the relative path from the git root to the actual tests directory
				path.relative(gitRoot, actualTestsDir) : 
				// If not symlink, use the standard relative path
				path.relative(gitRoot, testsDir);
			
			await execPromise(`git add ${pathToStage}`);
			console.log(`Staged changes in tests directory (${pathToStage})`);

			// Create a commit
			await execPromise(`git commit -m "${title}"`);
			console.log(`Created commit with message: ${title}`);

			// Check if gh CLI is available
			try {
				await execPromise('gh --version');
				console.log('GitHub CLI is available');

				// Push to the remote repository
				await execPromise(`git push -u origin ${branchName}`);
				console.log(`Pushed to remote branch: ${branchName}`);

				// Create a PR using gh CLI
				let prCommand = `gh pr create --title "${title}" --head ${branchName}`;
				
				// Add description if provided
				if (description) {
					prCommand += ` --body "${description}"`;
				}
				
				// Add default base branch
				prCommand += ` --base ${currentBranch}`;

				// Create the PR
				const prOutput = await execPromise(prCommand);
				console.log('PR created successfully');

				// Extract PR URL from the output
				const prUrlMatch = prOutput.match(/(https:\/\/github\.com\/[^\s]+)/);
				const prUrl = prUrlMatch ? prUrlMatch[0] : null;

				// Return success response with PR info
				return res.json({
					success: true,
					branch: branchName,
					commit: title,
					pr: prUrl,
					repoUrl: remoteUrl,
					message: 'Pull request created successfully'
				});
			} catch (ghError) {
				console.error('Error using GitHub CLI:', ghError);
				
				// Push to the remote repository anyway
				await execPromise(`git push -u origin ${branchName}`);
				console.log(`Pushed to remote branch: ${branchName}`);
				
				// GitHub CLI not available, but we still pushed the branch
				return res.json({
					success: true,
					branch: branchName,
					commit: title,
					repoUrl: remoteUrl,
					message: 'Changes pushed to new branch. Please create PR manually.',
					info: 'GitHub CLI not available for automatic PR creation'
				});
			}
		} catch (gitError) {
			console.error('Git operation error:', gitError);
			return res.status(500).json({
				error: 'Git operation failed',
				details: gitError.message
			});
		} finally {
			// Change back to the original directory
			process.chdir(ROOT_DIR);
		}
	} catch (error) {
		console.error('Error creating PR:', error);
		res.status(500).json({ error: `Failed to create PR: ${error.message}` });
	}
});});

app.get('*', isAuthenticated, (req, res) => {
	res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
app.listen(PORT, HOST === 'localhost' ? HOST : '0.0.0.0', () => {
	console.log(`Server is running on ${HOST}:${PORT}`);
});
