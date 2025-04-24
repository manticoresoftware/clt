import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import session from 'express-session';
import dotenv from 'dotenv';
import { setupPassport, isAuthenticated, addAuthRoutes } from './auth.js';
import authConfig from './config/auth.js';

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

// Create a workdir folder for the user repos if it doesn't exist
const WORKDIR = path.join(ROOT_DIR, 'workdir');
const REPO_URL = process.env.REPO_URL || 'git@github.com:manticoresoftware/manticoresearch.git';

// Ensure workdir exists
try {
  await fs.mkdir(WORKDIR, { recursive: true });
  console.log(`Ensured workdir exists at ${WORKDIR}`);
} catch (error) {
  console.error(`Error creating workdir: ${error}`);
}

// Setup or fetch the user's repository on login
async function ensureUserRepo(username) {
  if (!username) return null;

  try {
    const userDir = path.join(WORKDIR, username);
    const userRepoExists = await fs.access(userDir).then(() => true).catch(() => false);

    if (!userRepoExists) {
      console.log(`Setting up repository for user ${username}`);
      await fs.mkdir(userDir, { recursive: true });

      // Clone the repository
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

      await execPromise(`git clone ${REPO_URL} ${userDir}`, { cwd: WORKDIR });
      console.log(`Cloned repository for user ${username}`);
    }

    // Verify the repo is valid and the CLT tests folder exists
    const testDir = path.join(userDir, 'test', 'clt-tests');
    const testDirExists = await fs.access(testDir).then(() => true).catch(() => false);

    if (!testDirExists) {
      console.error(`CLT tests directory not found for user ${username}. Expected at: ${testDir}`);
      return null;
    }

    return { userDir, testDir };
  } catch (error) {
    console.error(`Error setting up user repository: ${error}`);
    return null;
  }
}

// Make the function available globally for the auth system
global.ensureUserRepo = ensureUserRepo;

// Get user repository path (working directory)
function getUserRepoPath(req) {
  // If auth is skipped, use a default user
  if (authConfig.skipAuth) {
    return path.join(WORKDIR, 'dev-mode');
  }

  // If user is authenticated, use their username
  if (req.isAuthenticated() && req.user && req.user.username) {
    return path.join(WORKDIR, req.user.username);
  }

  // Fallback to the root directory if no user is available
  return ROOT_DIR;
}

// Get user repository test path
function getUserTestPath(req) {
  const userRepo = getUserRepoPath(req);
  return path.join(userRepo, 'test', 'clt-tests');
}

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
		// Ensure user repo exists
		const username = req.user?.username || (authConfig.skipAuth ? 'dev-mode' : null);
		if (username) {
			await ensureUserRepo(username);
		}

		// Get the user's test directory
		const testDir = getUserTestPath(req);
		const testDirExists = await fs.access(testDir).then(() => true).catch(() => false);

		if (!testDirExists) {
			return res.status(404).json({ error: 'Test directory not found' });
		}

		// Build the file tree with the user's test directory as the base
		const fileTree = await buildFileTree(testDir);

		// Return the file tree directly without wrapping in a virtual root node
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

		// Use the user's test directory as the base
		const testDir = getUserTestPath(req);
		const absolutePath = path.join(testDir, filePath);

		// Basic security check to ensure the path is within the test directory
		if (!absolutePath.startsWith(testDir)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Read the file content
		const content = await fs.readFile(absolutePath, 'utf8');
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

		// Use the user's test directory as the base
		const testDir = getUserTestPath(req);
		const absolutePath = path.join(testDir, filePath);

		// Basic security check to ensure the path is within the test directory
		if (!absolutePath.startsWith(testDir)) {
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

// API endpoint to move or rename a file
app.post('/api/move-file', isAuthenticated, async (req, res) => {
	try {
		const { sourcePath, targetPath } = req.body;

		if (!sourcePath || !targetPath) {
			return res.status(400).json({ error: 'Source and target paths are required' });
		}

		// Use the user's test directory as the base
		const testDir = getUserTestPath(req);
		const absoluteSourcePath = path.join(testDir, sourcePath);
		const absoluteTargetPath = path.join(testDir, targetPath);

		// Basic security check to ensure both paths are within the test directory
		if (!absoluteSourcePath.startsWith(testDir) || !absoluteTargetPath.startsWith(testDir)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Ensure target directory exists
		const targetDir = path.dirname(absoluteTargetPath);
		await fs.mkdir(targetDir, { recursive: true });

		// Move/rename the file
		await fs.rename(absoluteSourcePath, absoluteTargetPath);

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

		// Use the user's test directory as the base
		const testDir = getUserTestPath(req);
		const absolutePath = path.join(testDir, filePath);

		// Basic security check to ensure the path is within the test directory
		if (!absolutePath.startsWith(testDir)) {
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

		// Use the user's test directory as the base
		const testDir = getUserTestPath(req);
		const absolutePath = path.join(testDir, dirPath);

		// Basic security check to ensure the path is within the test directory
		if (!absolutePath.startsWith(testDir)) {
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

// Helper function to resolve a block file path
async function resolveBlockPath(blockPath, basePath) {
	// If the block path is already absolute, use it directly
	if (path.isAbsolute(blockPath)) {
		return blockPath;
	}

	// If it's a relative path, resolve it relative to the base file's directory
	const baseDir = path.dirname(basePath);
	const resolvedPath = path.join(baseDir, blockPath);

	// First try with the exact path as specified
	try {
		await fs.access(resolvedPath);
		return resolvedPath;
	} catch (exactPathError) {
		// If exact path doesn't exist, try with .recb extension
		const recbPath = `${resolvedPath}.recb`;
		try {
			await fs.access(recbPath);
			return recbPath;
		} catch (recbError) {
			// If .recb doesn't exist, try with .rec extension
			const recPath = `${resolvedPath}.rec`;
			try {
				await fs.access(recPath);
				return recPath;
			} catch (recError) {
				// If we still can't find it, log a detailed error and throw
				console.error(`Block file not found: ${blockPath}`);
				console.error(`Tried paths: ${resolvedPath}, ${recbPath}, ${recPath}`);
				throw new Error(`Block file not found: ${blockPath}`);
			}
		}
	}
}

// Helper function to read and parse a .recb file
async function loadBlockContent(blockPath) {
	try {
		// Read the block file content
		const content = await fs.readFile(blockPath, 'utf8');

		// Parse the content into commands
		const commands = [];
		const sections = content.split('––– input –––').slice(1);

		// If there are no input sections, add a placeholder error command
		if (sections.length === 0) {
			console.warn(`Block file ${blockPath} has no input sections`);
			return [{
				command: `echo "Warning: Block file ${path.basename(blockPath)} has no input sections"`,
				expectedOutput: '',
				blockSource: blockPath,
			}];
		}

		for (const section of sections) {
			const parts = section.split('––– output –––');
			if (parts.length >= 2) {
				const command = parts[0].trim();

				// Find the next command separator if any
				const outputPart = parts[1].trim();
				let expectedOutput = outputPart;

				// Look for next command delimiter
				const nextCommandMatch = outputPart.match(/–––\s+.*?\s+–––/);
				if (nextCommandMatch) {
					// Split at the next delimiter to get just the output
					expectedOutput = outputPart.substring(0, nextCommandMatch.index).trim();
				}

				commands.push({
					command,
					expectedOutput,
					blockSource: blockPath,
				});
			} else if (parts.length === 1 && parts[0].trim()) {
				// There's a command but no output section
				console.warn(`Block file ${blockPath} has a command without output section: ${parts[0].trim().substring(0, 40)}...`);
				commands.push({
					command: parts[0].trim(),
					expectedOutput: '',
					blockSource: blockPath,
				});
			}
		}

		// If we couldn't parse any commands, add an error command
		if (commands.length === 0) {
			console.warn(`Failed to parse any commands from block file ${blockPath}`);
			return [{
				command: `echo "Warning: Failed to parse commands from block file ${path.basename(blockPath)}"`,
				expectedOutput: '',
				blockSource: blockPath,
			}];
		}

		return commands;
	} catch (error) {
		console.error(`Error loading block file ${blockPath}:`, error);
		// Return a single error command that will display in the UI
		return [{
			command: `echo "Error loading block file: ${path.basename(blockPath)} - ${error.message}"`,
			expectedOutput: '',
			blockSource: blockPath,
		}];
	}
}

// Recursively expand blocks in a list of commands
async function expandBlocks(commands, basePath, expandedBlocks = new Set()) {
	const result = [];

	// Process each command
	for (const cmd of commands) {
		// Check if this is a block reference or a regular command
		if (cmd.type === 'block') {
			// Get the block path from the command
			const blockPath = cmd.command;

			try {
				// Resolve the actual path to the block file
				const resolvedBlockPath = await resolveBlockPath(blockPath, basePath);

				// Guard against recursive inclusion
				if (expandedBlocks.has(resolvedBlockPath)) {
					console.warn(`Circular block reference detected: ${resolvedBlockPath}`);
					// Add an error command instead
					result.push({
						command: `echo "Error: Circular reference detected for block: ${blockPath}"`,
						expectedOutput: '',
						type: 'command',
						parentBlock: cmd,
						blockSource: resolvedBlockPath,
						isBlockCommand: true
					});
				} else {
					// Mark this block as being expanded to prevent circular references
					expandedBlocks.add(resolvedBlockPath);

					// Load the block file content
					const blockCommands = await loadBlockContent(resolvedBlockPath);

					// Add metadata to each command from the block
					const processedBlockCommands = blockCommands.map(blockCmd => ({
						...blockCmd,
						type: 'command',
						parentBlock: cmd,
						blockSource: resolvedBlockPath,
						isBlockCommand: true
					}));

					// Recursively expand any nested blocks
					const expandedBlockCommands = await expandBlocks(
						processedBlockCommands,
						resolvedBlockPath,
						new Set(expandedBlocks)
					);

					// Add all expanded commands to the result
					result.push(...expandedBlockCommands);

					// Remove this block from the set of expanded blocks
					expandedBlocks.delete(resolvedBlockPath);
				}
			} catch (error) {
				console.error(`Error expanding block ${blockPath}:`, error);
				// Add an error command
				result.push({
					command: `echo "Error: Failed to load block: ${blockPath} - ${error.message}"`,
					expectedOutput: '',
					type: 'command',
					parentBlock: cmd,
					isBlockCommand: true
				});
			}
		} else if (cmd.type !== 'comment') {
			// Regular command, add directly to the result
			result.push(cmd);
		}
		// Comments are skipped in the expanded result as they don't run
	}

	return result;
}

//
//
// Function to process test results with proper block handling

// Helper function to parse a .rec file and handle blocks recursively
async function parseRecFile(absolutePath) {
	// Read the file content
	const content = await fs.readFile(absolutePath, 'utf8');

	// Parse initial commands from .rec file
	const commands = [];
	const lines = content.split('\n');
	let currentSection = '';
	let currentCommand = '';
	let currentOutput = '';
	let commandType = 'command';

	let i = 0;
	while (i < lines.length) {
		const line = lines[i].trim();

		// Detect section markers
		if (line.startsWith('––– ') || line.startsWith('--- ')) {
			// Process completed section before starting a new one
			if (currentSection === 'input' && currentCommand) {
				// We have a command but no output section yet
				currentSection = ''; // Reset section
			} else if (currentSection === 'output' && currentCommand) {
				// We've completed an input/output pair
				commands.push({
					command: currentCommand.trim(),
					expectedOutput: currentOutput.trim(),
					type: 'command',
					status: 'pending',
				});

				// Reset for next command
				currentCommand = '';
				currentOutput = '';
				currentSection = '';
			} else if (currentSection === 'comment' && currentCommand) {
				// We've completed a comment section
				commands.push({
					command: currentCommand.trim(),
					type: 'comment',
					status: 'pending',
				});

				// Reset for next command
				currentCommand = '';
				currentSection = '';
			} else if (currentSection === 'block' && currentCommand) {
				// We've completed a block reference
				commands.push({
					command: currentCommand.trim(),
					type: 'block',
					status: 'pending',
				});

				// Reset for next command
				currentCommand = '';
				currentSection = '';
			}

			// Parse the marker to determine what section follows
			if (line.includes('input')) {
				currentSection = 'input';
				commandType = 'command';
			} else if (line.includes('output')) {
				currentSection = 'output';
			} else if (line.includes('comment')) {
				currentSection = 'comment';
				commandType = 'comment';
			} else if (line.includes('block:')) {
				currentSection = 'block';
				commandType = 'block';
				// Extract path from block marker: "--- block: path/to/file ---"
				const pathMatch = line.match(/block:\s*([^\s]+)/);
				if (pathMatch && pathMatch[1]) {
					currentCommand = pathMatch[1].trim();
				}
			}

			i++;
			continue;
		}

		// Process content based on current section
		if (currentSection === 'input') {
			if (currentCommand) currentCommand += '\n';
			currentCommand += lines[i];
		} else if (currentSection === 'output') {
			if (currentOutput) currentOutput += '\n';
			currentOutput += lines[i];
		} else if (currentSection === 'comment') {
			if (currentCommand) currentCommand += '\n';
			currentCommand += lines[i];
		} else if (currentSection === 'block' && !currentCommand) {
			// Only set the command if we haven't extracted it from the marker
			currentCommand = lines[i];
		}

		i++;
	}

	// Handle the last section if it wasn't closed properly
	if (currentSection === 'input' && currentCommand) {
		commands.push({
			command: currentCommand.trim(),
			type: 'command',
			status: 'pending',
		});
	} else if (currentSection === 'output' && currentCommand) {
		commands.push({
			command: currentCommand.trim(),
			expectedOutput: currentOutput.trim(),
			type: 'command',
			status: 'pending',
		});
	} else if (currentSection === 'comment' && currentCommand) {
		commands.push({
			command: currentCommand.trim(),
			type: 'comment',
			status: 'pending',
		});
	} else if (currentSection === 'block' && currentCommand) {
		commands.push({
			command: currentCommand.trim(),
			type: 'block',
			status: 'pending',
		});
	}

	// After parsing the file, recursively expand any blocks
	try {
		const expandedCommands = await expandBlocks(commands, absolutePath);
		return expandedCommands;
	} catch (error) {
		console.error(`Error expanding blocks in ${absolutePath}:`, error);
		// Return the original commands if block expansion fails
		return commands;
	}
}

// API endpoint to run a test
app.post('/api/run-test', isAuthenticated, async (req, res) => {
	try {
		const { filePath, dockerImage } = req.body;

		if (!filePath) {
			return res.status(400).json({ error: 'File path is required' });
		}

		// Use the user's test directory as the base
		const testDir = getUserTestPath(req);
		const absolutePath = path.join(testDir, filePath);

		// Basic security check to ensure the path is within the test directory
		if (!absolutePath.startsWith(testDir)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Execute the clt test command to run the test (from the user's project directory)
		const userRepoPath = getUserRepoPath(req);
		const relativeFilePath = path.relative(userRepoPath, absolutePath);
		const testCommand = `clt test -d -t ${relativeFilePath} ${dockerImage ? dockerImage : ''}`;
		console.log(`Executing test command: ${testCommand} in dir: ${userRepoPath}`);

		const { exec } = await import('child_process');

		// Execute in the user's repository directory
		const execOptions = {
			cwd: userRepoPath,
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
				// Parse the .rec file and expand blocks
				const expandedCommands = await parseRecFile(absolutePath);

				// Process the test results with expanded blocks
				const results = await processTestResults(absolutePath, expandedCommands, stdout, stderr, exitCode, error);

				// Return the results
				res.json({
					filePath,
					dockerImage: dockerImage || 'default-image',
					...results
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

// API endpoint to commit changes (with or without creating PR)
app.post('/api/commit-changes', isAuthenticated, async (req, res) => {
	try {
		const { title, description, createPr = true } = req.body;

		if (!title) {
			return res.status(400).json({ error: 'Commit message is required' });
		}

		// Check if user is authenticated with GitHub
		if (!req.user || !req.user.username) {
			return res.status(401).json({ error: 'GitHub authentication required' });
		}

		// Get the user's repo path
		const userRepoPath = getUserRepoPath(req);
		const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

		if (!repoExists) {
			return res.status(404).json({ error: 'Repository not found' });
		}

		// Helper function for executing commands
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

		// Try to find the git repository root for the user's repo
		try {
			// Change to the user's repo directory
			process.chdir(userRepoPath);

			// Set the GH_TOKEN from env variable
			const env = Object.assign({}, process.env, { GH_TOKEN: req.user.token });
			const ghOptions = { env };

			// Get current branch name
			const currentBranch = await execPromise('git rev-parse --abbrev-ref HEAD', ghOptions);
			console.log(`Current branch: ${currentBranch}`);

			// Get remote repository information
			const remoteUrl = await execPromise('gh repo view --json url -q .url', ghOptions);
			console.log(`Remote repository URL: ${remoteUrl}`);

			// Get the default branch (main/master)
			const defaultBranch = await execPromise('gh repo view --json defaultBranchRef -q .defaultBranchRef.name', ghOptions);
			console.log(`Default branch: ${defaultBranch}`);

			// Check if we're already on a clt-ui branch (PR branch)
			const isPrBranch = currentBranch.startsWith('clt-ui-');
			console.log(`Is PR branch: ${isPrBranch}`);

			let branchName = currentBranch;
			let needToCreatePr = createPr && !isPrBranch;

			// Determine which parts of the tests directory to stage
			const testDir = getUserTestPath(req);
			const relativeTestPath = path.relative(userRepoPath, testDir);
			console.log(`Tests relative path: ${relativeTestPath}`);

			// Stage changes in the tests directory
			await execPromise(`git add ${relativeTestPath}`, ghOptions);
			console.log(`Staged changes in tests directory: ${relativeTestPath}`);

			// Check if there are changes to commit
			const status = await execPromise('git status --porcelain', ghOptions);
			if (!status) {
				return res.status(400).json({ error: 'No changes to commit' });
			}

			// If we need to create a PR, we need to create a new branch first
			if (needToCreatePr) {
				// Create a new branch name based on timestamp and username
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				branchName = `clt-ui-${req.user.username}-${timestamp}`;

				// Create a new branch
				await execPromise(`git checkout -b ${branchName}`, ghOptions);
				console.log(`Created and switched to new branch: ${branchName}`);
			}

			// Create a commit
			await execPromise(`git commit -m "${title}"`, ghOptions);
			console.log(`Created commit with message: ${title}`);

			// Push to the remote repository
			await execPromise(`git push -u origin ${branchName}`, ghOptions);
			console.log(`Pushed to remote branch: ${branchName}`);

			// Create a PR if needed
			let prUrl = null;
			if (needToCreatePr) {
				try {
					// Create PR command
					let prCommand = `gh pr create --title "${title}" --head ${branchName}`;

					// Add description if provided
					if (description) {
						prCommand += ` --body "${description}"`;
					}

					// Add default base branch
					prCommand += ` --base ${defaultBranch}`;

					// Create the PR
					const prOutput = await execPromise(prCommand, ghOptions);
					console.log('PR created successfully');

					// Extract PR URL from the output
					const prUrlMatch = prOutput.match(/(https:\/\/github\.com\/[^\s]+)/);
					prUrl = prUrlMatch ? prUrlMatch[0] : null;
				} catch (prError) {
					console.error('Error creating PR:', prError);
					// Continue with the flow since we've already pushed changes
				}
			}

			return res.json({
				success: true,
				branch: branchName,
				commit: title,
				pr: prUrl,
				repository: remoteUrl,
				message: needToCreatePr && prUrl
					? 'Pull request created successfully'
					: (needToCreatePr
						? 'Changes committed and pushed to new branch. PR creation failed.'
						: 'Changes committed successfully')
			});

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
		console.error('Error creating commit:', error);
		res.status(500).json({ error: `Failed to create commit: ${error.message}` });
	}
});

// API endpoint to get git status information
app.get('/api/git-status', isAuthenticated, async (req, res) => {
	try {
		// Check if user is authenticated with GitHub
		if (!req.user || !req.user.username) {
			return res.status(401).json({ error: 'GitHub authentication required' });
		}

		// Get the user's repo path
		const userRepoPath = getUserRepoPath(req);
		const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

		if (!repoExists) {
			return res.status(404).json({ error: 'Repository not found' });
		}

		// Helper function for executing commands
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

		// Try to find the git repository root for the user's repo
		try {
			// Change to the user's repo directory
			process.chdir(userRepoPath);

			// Set the GH_TOKEN from env variable
			const env = Object.assign({}, process.env, { GH_TOKEN: req.user.token });
			const ghOptions = { env };

			// Get current branch name
			const currentBranch = await execPromise('git rev-parse --abbrev-ref HEAD', ghOptions);
			console.log(`Current branch: ${currentBranch}`);

			// Check if the branch is a PR branch (starts with clt-ui-)
			const isPrBranch = currentBranch.startsWith('clt-ui-');
			console.log(`Is PR branch: ${isPrBranch}`);

			// Get list of files with changes (modified, unstaged)
			const statusOutput = await execPromise('git status --porcelain', ghOptions);
			console.log('Git status output:', statusOutput);

			// Parse the status output to get modified files
			const modifiedFiles = [];
			const modifiedDirs = new Set();

			const testDir = getUserTestPath(req);
			// Get the relative path to the test directory from the repo root
			const relativeTestPath = path.relative(userRepoPath, testDir);
			console.log(`Relative test path: ${relativeTestPath}`);

			if (statusOutput) {
				const statusLines = statusOutput.split('\n');
				for (const line of statusLines) {
					if (line.trim()) {
						// Format is XY filename (X is staging status, Y is working tree status)
						const match = line.trim().match(/^(\S+)\s+(.+)$/);
						if (!match) continue;

						const status = match[1];
						const filePath = match[2];

						console.log(`Checking file: ${filePath}`);

						// Check if this file is in the test directory
						if (filePath.startsWith(relativeTestPath)) {
							modifiedFiles.push({
								path: filePath,
								status: status.trim()
							});

							// Add all parent directories to modifiedDirs set
							// Start with the file's directory
							let dirPath = path.dirname(filePath);
							while (dirPath && dirPath !== '.' && dirPath !== '/') {
								modifiedDirs.add(dirPath);
								dirPath = path.dirname(dirPath);
							}
						}
					}
				}
			}

			// Check if there are any changes to commit in the test directory
			const hasChanges = modifiedFiles.length > 0;

			return res.json({
				success: true,
				currentBranch,
				isPrBranch,
				hasChanges,
				modifiedFiles,
				modifiedDirs: Array.from(modifiedDirs),
				testPath: relativeTestPath
			});

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
		console.error('Error getting git status:', error);
		res.status(500).json({ error: `Failed to get git status: ${error.message}` });
	}
});

// API endpoint to get current branch information
app.get('/api/current-branch', isAuthenticated, async (req, res) => {
	try {
		// Check if user is authenticated with GitHub
		if (!req.user || !req.user.username) {
			return res.status(401).json({ error: 'GitHub authentication required' });
		}

		// Get the user's repo path
		const userRepoPath = getUserRepoPath(req);
		const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

		if (!repoExists) {
			return res.status(404).json({ error: 'Repository not found' });
		}

		// Helper function for executing commands
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

		// Try to find the git repository root for the user's repo
		try {
			// Change to the user's repo directory
			process.chdir(userRepoPath);

			// Set the GH_TOKEN from env variable
			const env = Object.assign({}, process.env, { GH_TOKEN: req.user.token });
			const ghOptions = { env };

			// Get current branch name
			const currentBranch = await execPromise('git rev-parse --abbrev-ref HEAD', ghOptions);
			console.log(`Current branch: ${currentBranch}`);

			// Get remote repository URL
			const remoteUrl = await execPromise('gh repo view --json url -q .url', ghOptions);
			console.log(`Remote repository URL: ${remoteUrl}`);

			// Get default branch
			const defaultBranch = await execPromise('gh repo view --json defaultBranchRef -q .defaultBranchRef.name', ghOptions);
			console.log(`Default branch: ${defaultBranch}`);

			return res.json({
				success: true,
				currentBranch,
				defaultBranch,
				repository: remoteUrl
			});

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
		console.error('Error getting current branch:', error);
		res.status(500).json({ error: `Failed to get current branch: ${error.message}` });
	}
});

// API endpoint to get current branch information
app.get('/api/current-branch', isAuthenticated, async (req, res) => {
	try {
		// Check if user is authenticated with GitHub
		if (!req.user || !req.user.username) {
			return res.status(401).json({ error: 'GitHub authentication required' });
		}

		// Determine if the tests directory is a symlink
		const testsDir = path.join(ROOT_DIR, 'tests');
		let actualRepoPath = testsDir;
		try {
			const testsDirStats = await fs.lstat(testsDir);
			if (testsDirStats.isSymbolicLink()) {
				// Resolve the symlink target
				const symlinkTarget = await fs.readlink(testsDir);
				const resolvedTarget = path.isAbsolute(symlinkTarget)
					? symlinkTarget
					: path.resolve(path.dirname(testsDir), symlinkTarget);

				console.log(`Tests directory is a symlink pointing to ${resolvedTarget}`);
				actualRepoPath = resolvedTarget;
			}
		} catch (error) {
			console.error('Error checking if tests directory is a symlink:', error);
			return res.status(500).json({ error: 'Failed to determine if tests directory is a symlink' });
		}

		// Helper function for executing commands
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

		// Try to find the git repository root for the actual tests directory
		try {
			// Change to the actual tests directory
			process.chdir(actualRepoPath);

			// Set the GH_TOKEN from env variable
			const env = Object.assign({}, process.env, { GH_TOKEN: req.user.token });
			const ghOptions = { env };

			// Try to get the git repo root
			const gitRoot = await execPromise('git rev-parse --show-toplevel', ghOptions);
			console.log(`Git repository found at: ${gitRoot}`);

			// Change to the git root directory
			process.chdir(gitRoot);

			// Get current branch name
			const currentBranch = await execPromise('git rev-parse --abbrev-ref HEAD', ghOptions);
			console.log(`Current branch: ${currentBranch}`);

			// Get remote repository URL
			const remoteUrl = await execPromise('gh repo view --json url -q .url', ghOptions);
			console.log(`Remote repository URL: ${remoteUrl}`);

			// Get default branch
			const defaultBranch = await execPromise('gh repo view --json defaultBranchRef -q .defaultBranchRef.name', ghOptions);
			console.log(`Default branch: ${defaultBranch}`);

			return res.json({
				success: true,
				currentBranch,
				defaultBranch,
				repository: remoteUrl
			});

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
		console.error('Error getting current branch:', error);
		res.status(500).json({ error: `Failed to get current branch: ${error.message}` });
	}
});

// API endpoint to reset and sync to a specific branch
app.post('/api/reset-to-branch', isAuthenticated, async (req, res) => {
	try {
		const { branch } = req.body;

		if (!branch) {
			return res.status(400).json({ error: 'Branch name is required' });
		}

		// Check if user is authenticated with GitHub
		if (!req.user || !req.user.username) {
			return res.status(401).json({ error: 'GitHub authentication required' });
		}

		// Get the user's repo path
		const userRepoPath = getUserRepoPath(req);
		const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

		if (!repoExists) {
			return res.status(404).json({ error: 'Repository not found' });
		}

		// Helper function for executing commands
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

		// Try to find the git repository root for the user's repo
		try {
			// Change to the user's repo directory
			process.chdir(userRepoPath);

			// Set the GH_TOKEN from env variable
			const env = Object.assign({}, process.env, { GH_TOKEN: req.user.token });
			const ghOptions = { env };

			// Get current repository information
			const remoteUrl = await execPromise('gh repo view --json url -q .url', ghOptions);
			console.log(`Remote repository URL: ${remoteUrl}`);

			// Save current changes if any (in case user has unsaved work)
			const hasChanges = await execPromise('git status --porcelain', ghOptions);
			let stashMessage = '';

			if (hasChanges) {
				// Stash changes with a timestamp and username
				const timestamp = new Date().toISOString();
				stashMessage = `Auto-stashed by CLT-UI for ${req.user.username} at ${timestamp}`;
				await execPromise(`git stash push -m "${stashMessage}"`, ghOptions);
				console.log(`Stashed current changes: ${stashMessage}`);
			}

			// Make sure we have the latest from remote
			await execPromise('git fetch', ghOptions);
			console.log('Fetched latest updates from remote');

			// Check if the branch exists
			const branchExists = await execPromise(`git branch --list ${branch}`, ghOptions);

			if (branchExists) {
				// Local branch exists, check out and reset to remote
				await execPromise(`git checkout ${branch}`, ghOptions);
				console.log(`Switched to branch: ${branch}`);

				// Reset to origin's version of the branch
				await execPromise(`git reset --hard origin/${branch}`, ghOptions);
				console.log(`Reset to origin/${branch}`);
			} else {
				// Local branch doesn't exist, create and track remote branch
				await execPromise(`git checkout -b ${branch} origin/${branch}`, ghOptions);
				console.log(`Created and checked out branch ${branch} tracking origin/${branch}`);
			}

			return res.json({
				success: true,
				branch,
				repository: remoteUrl,
				stashed: hasChanges ? stashMessage : null,
				message: `Successfully reset to branch: ${branch}`
			});

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
		console.error('Error resetting to branch:', error);
		res.status(500).json({ error: `Failed to reset to branch: ${error.message}` });
	}
});

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

		// Get the user's repo path
		const userRepoPath = getUserRepoPath(req);
		const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

		if (!repoExists) {
			return res.status(404).json({ error: 'Repository not found' });
		}

		// Helper function for executing commands
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

		// Try to find the git repository root for the user's repo
		try {
			// Change to the user's repo directory
			process.chdir(userRepoPath);

			// Set the GH_TOKEN from env variable
			const env = Object.assign({}, process.env, { GH_TOKEN: req.user.token });
			const ghOptions = { env };

			// Get current repository information
			const remoteUrl = await execPromise('gh repo view --json url -q .url', ghOptions);
			console.log(`Remote repository URL: ${remoteUrl}`);

			// Get the current branch
			const currentBranch = await execPromise('gh repo view --json defaultBranchRef -q .defaultBranchRef.name', ghOptions);
			console.log(`Current branch: ${currentBranch}`);

			// Create a new branch
			await execPromise(`git checkout -b ${branchName}`, ghOptions);
			console.log(`Created and switched to new branch: ${branchName}`);

			// Determine which parts of the tests directory to stage
			const testDir = getUserTestPath(req);
			const relativeTestPath = path.relative(userRepoPath, testDir);
			console.log(`Tests relative path: ${relativeTestPath}`);

			// Stage changes in the tests directory
			await execPromise(`git add ${relativeTestPath}`, ghOptions);
			console.log(`Staged changes in tests directory: ${relativeTestPath}`);

			// Check if there are changes to commit
			const status = await execPromise('git status --porcelain', ghOptions);
			if (!status) {
				return res.status(400).json({ error: 'No changes to commit' });
			}

			// Create a commit
			await execPromise(`git commit -m "${title}"`, ghOptions);
			console.log(`Created commit with message: ${title}`);

			// Push to the remote repository
			await execPromise(`git push -u origin ${branchName}`, ghOptions);
			console.log(`Pushed to remote branch: ${branchName}`);

			// Check if gh CLI is available
			try {
				await execPromise('gh --version', ghOptions, ghOptions);
				console.log('GitHub CLI is available');

				// Create a PR using gh CLI
				let prCommand = `gh pr create --title "${title}" --head ${branchName}`;

				// Add description if provided
				if (description) {
					prCommand += ` --body "${description}"`;
				}

				// Add default base branch
				prCommand += ` --base ${currentBranch}`;

				// Create the PR
				const prOutput = await execPromise(prCommand, ghOptions);
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
					repository: remoteUrl,
					message: 'Pull request created successfully'
				});
			} catch (ghError) {
				console.error('Error using GitHub CLI:', ghError);

				// GitHub CLI not available, but we still pushed the branch
				return res.json({
					success: true,
					branch: branchName,
					commit: title,
					repository: remoteUrl,
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
});

app.get('*', isAuthenticated, (req, res) => {
	res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
app.listen(PORT, HOST === 'localhost' ? HOST : '0.0.0.0', () => {
	console.log(`Server is running on ${HOST}:${PORT}`);
});
// Function to process test results with proper block handling
async function processTestResults(absolutePath, expandedCommands, stdout, stderr, exitCode, error) {
	const repFilePath = absolutePath.replace(/\.rec$/, '.rep');
	let success = false; // Default to failure, will update based on command results

	// Create a mapping of block commands by their parent block for status propagation
	const blockCommandMap = new Map();
	expandedCommands.forEach(cmd => {
		if (cmd.isBlockCommand && cmd.parentBlock) {
			// The key is the parent block's index/ID
			const key = `${cmd.parentBlock.command}|${cmd.blockSource || ''}`;

			if (!blockCommandMap.has(key)) {
				blockCommandMap.set(key, []);
			}
			blockCommandMap.get(key).push(cmd);
		}
	});

	try {
		// Try to read the .rep file for actual outputs and durations
		let repContent = '';
		const repSections = [];

		try {
			repContent = await fs.readFile(repFilePath, 'utf8');
			console.log(`Successfully read .rep file: ${repFilePath}`);

			// Check if rep file is empty
			if (!repContent || repContent.trim() === '') {
				console.warn(`The .rep file is empty: ${repFilePath}`);
				throw new Error('Empty rep file');
			}

			// Parse sections
			const sections = repContent.split('\u2013\u2013\u2013 input \u2013\u2013\u2013').slice(1);
			if (sections.length === 0) {
				console.warn(`No input sections found in .rep file: ${repFilePath}`);
				throw new Error('No sections found in rep file');
			}

			// Parse the .rep file sections
			for (const section of sections) {
				const parts = section.split('\u2013\u2013\u2013 output \u2013\u2013\u2013');
				if (parts.length >= 2) {
					repSections.push({
						command: parts[0].trim(),
						output: parts[1].trim(),
						full: section
					});
				}
			}

			console.log(`Parsed ${repSections.length} sections from rep file`);
			if (repSections.length === 0) {
				console.warn(`Failed to parse sections from .rep file: ${repFilePath}`);
				throw new Error('Failed to parse sections from rep file');
			}
		} catch (repError) {
			// If the rep file doesn't exist or is invalid, continue without it
			console.warn(`Could not process .rep file: ${repError.message}`);

			// Try to parse outputs from stdout instead
			if (stdout && stdout.trim()) {
				console.log('Attempting to parse command outputs from stdout');
				const sections = stdout.split('\u2013\u2013\u2013 input \u2013\u2013\u2013').slice(1);
				for (const section of sections) {
					const parts = section.split('\u2013\u2013\u2013 output \u2013\u2013\u2013');
					if (parts.length >= 2) {
						repSections.push({
							command: parts[0].trim(),
							output: parts[1].trim(),
							full: section
						});
					}
				}
				console.log(`Parsed ${repSections.length} sections from stdout`);
			}
		}

		// Process commands with outputs from rep file or stdout
		let allCommandsPassed = true;

		// Debug logging for initial command statuses
		console.log('Processing commands - total:', expandedCommands.length);
		console.log('Block commands:', expandedCommands.filter(cmd => cmd.isBlockCommand).length);
		console.log('Block references:', expandedCommands.filter(cmd => cmd.type === 'block' && !cmd.isBlockCommand).length);

		for (const cmd of expandedCommands) {
			// Skip comments and mark blocks
			if (cmd.type === 'comment') {
				continue;
			} else if (cmd.type === 'block' && !cmd.isBlockCommand) {
				// Mark block with appropriate initial status based on exit code
				cmd.status = exitCode === 0 ? 'matched' : 'pending';
				continue;
			}

			// For regular commands, find the corresponding output
			const commandText = cmd.command.trim();
			const matchingSection = repSections.find(s => s.command.trim() === commandText);

			if (matchingSection) {
				// Extract duration
				cmd.duration = extractDuration(matchingSection.full);

				// Get the output content
				const output = matchingSection.output;
				const nextDelimiterMatch = output.match(/\u2013\u2013\u2013\s.*?\s\u2013\u2013\u2013/);
				const actualOutput = nextDelimiterMatch
					? output.substring(0, nextDelimiterMatch.index).trim()
					: output;

				// Set actual output
				cmd.actualOutput = actualOutput;

				// Set expected output if not already set
				if (!cmd.expectedOutput) {
					cmd.expectedOutput = actualOutput;
				}

				// If the exitCode is 0, treat everything as matched, otherwise do normal comparison
				if (exitCode === 0) {
					cmd.status = 'matched';
				} else {
					// Determine status based on comparison
					if (cmd.expectedOutput === actualOutput) {
						cmd.status = 'matched';
					} else {
						cmd.status = 'failed';
						allCommandsPassed = false;
					}
				}
			} else {
				// Could not find matching output
				console.warn(`No matching output found for command: ${commandText.substring(0, 50)}...`);

				// If the exitCode is 0, treat everything as matched, even if no output was found
				if (exitCode === 0) {
					cmd.status = 'matched';
					cmd.actualOutput = 'No matching output found, but test passed.';
				} else {
					cmd.status = 'failed';
					allCommandsPassed = false;

					// Set actual output to an error message for UI display
					cmd.actualOutput = 'Error: No matching output found for this command';
				}
			}
		}

		// Now propagate status to block declarations based on their contained commands only
		for (const cmd of expandedCommands) {
			if (cmd.isBlockCommand && cmd.parentBlock) {
				// The key is the parent block's index/ID
				const key = `${cmd.parentBlock.command}|${cmd.blockSource || ''}`;
				const blockCommands = blockCommandMap.get(key) || [];

				if (blockCommands.length > 0) {
					// If any block command failed, mark the block as failed
					const anyFailed = blockCommands.some(bc => bc.status === 'failed');
					// If any command matched, consider the block matched
					const anyMatched = blockCommands.some(bc => bc.status === 'matched');

					// Set status based only on the block's commands, independent of test exit code
					// If no failures and at least one passed, then the block passed
					cmd.status = anyFailed ? 'failed' : (anyMatched ? 'matched' : 'pending');

					// Debug log for block status
					console.log(`Block ${cmd.command} status: ${cmd.status} (anyFailed=${anyFailed}, anyMatched=${anyMatched}, command count=${blockCommands.length})`);
					console.log('Block commands:', blockCommands.map(bc => ({ cmd: bc.command.substring(0, 30), status: bc.status })));

					// Update overall success status only for real failures
					if (anyFailed) allCommandsPassed = false;
				}
			}
		}

		// Determine overall success - a test is successful if exitCode is 0,
		// regardless of individual command comparisons, which might only be different due to pattern variables
		success = exitCode === 0;

	} catch (processError) {
		console.error('Error processing test results:', processError);
		// Mark all commands as failed if there was an error
		for (const cmd of expandedCommands) {
			if (cmd.type !== 'comment' && !cmd.status) {
				cmd.status = 'failed';
			}
		}
	}

	// Make sure non-block commands have a status set (blocks already handled above)
	for (const cmd of expandedCommands) {
		if (cmd.type !== 'comment' && cmd.type !== 'block' && !cmd.status) {
			// For non-block commands without a status, set default status
			cmd.status = 'pending';
		}
	}

	const testReallyFailed = exitCode !== 0;
	return {
		commands: expandedCommands,
		success,
		exitCode,
		exitCodeSuccess: exitCode === 0,
		error: exitCode !== 0 ? error?.message : null,
		stderr,
		stdout,
		message: success ? 'Test executed successfully' : 'Test executed with differences',
		testReallyFailed: exitCode !== 0
	};
}
