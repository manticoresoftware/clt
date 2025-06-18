import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import session from 'express-session';
import dotenv from 'dotenv';
import simpleGit from 'simple-git';

// Import WASM wrapper functions (file-map-based, no file I/O)
import {
  getPatternsWasm,
  validateTestWasm,
  parseRecFileFromMapWasm,
  generateRecFileToMapWasm,
  convertWasmToUIFormat
} from './wasmNodeWrapper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file FIRST
dotenv.config();

// Import auth modules AFTER environment variables are loaded
import { setupPassport, isAuthenticated, addAuthRoutes } from './auth.js';
import { getAuthConfig } from './config/auth.js';

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

// Add helper to save tokens when users authenticate
app.use((req, res, next) => {
	if (req.user && req.user.username && req.user.token) {
		// Store token for repository operations
		if (!global.userTokens) global.userTokens = {};
		global.userTokens[req.user.username] = req.user.token;
	}
	next();
});

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
const REPO_URL = process.env.REPO_URL;

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

			// Get the user's token if available from session
			const userToken = global.userTokens && global.userTokens[username];

			// Clone the repository using simple-git
			const git = simpleGit({ baseDir: WORKDIR });

			// Use authentication if we have a token
			if (userToken) {
				// Create authenticated URL
				let cloneUrl = REPO_URL;
				if (REPO_URL.startsWith('https://')) {
					cloneUrl = REPO_URL.replace('https://', `https://x-access-token:${userToken}@`);
				}
				console.log(`Cloning repository for user ${username} with authentication`);
				await git.clone(cloneUrl, userDir);

				// Initialize a new git instance in the user's repository directory
				const userGit = simpleGit(userDir);

				// Set local repository configuration for the specific repository
				await userGit.addConfig('user.name', username, false, 'local');
				await userGit.addConfig('user.email', `${username}@users.noreply.github.com`, false, 'local');
				console.log(`Set local git config for ${username}`);
			} else {
				console.log('Missing user token, skipping git clone');
			}

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

// Make sure that we use the origin with the user's authentication token when connecting online
async function ensureGitRemoteWithToken(gitInstance, token) {
	if (!token) return;

	try {
		// Use the REPO_URL variable directly for consistent base URL
		const tokenUrl = REPO_URL.replace('https://', `https://x-access-token:${token}@`);

		// Remove existing origin and add new one with token
		await gitInstance.removeRemote('origin');
		await gitInstance.addRemote('origin', tokenUrl);
		console.log('Git remote configured with authentication token');
	} catch (error) {
		console.warn('Error configuring git remote with token:', error.message);
	}
}

// Store user tokens for repository operations
global.userTokens = {};

// Store for interactive sessions
global.interactiveSessions = {};

// Make the function available globally for the auth system
global.ensureUserRepo = ensureUserRepo;

// Get user repository path (working directory)
function getUserRepoPath(req) {
	// Get fresh auth config
	const authConfig = getAuthConfig();
	
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

// Helper function to create file content map for WASM processing
async function createFileContentMap(mainFilePath, baseDir) {
	const fileMap = {};
	
	try {
		// Read the main file
		const mainContent = await fs.readFile(mainFilePath, 'utf8');
		const relativePath = path.relative(baseDir, mainFilePath);
		fileMap[relativePath] = mainContent;
		
		// Find and read all .recb block files in the same directory and subdirectories
		const mainDir = path.dirname(mainFilePath);
		await findAndReadBlockFiles(mainDir, baseDir, fileMap);
		
		console.log(`📁 Created file content map with ${Object.keys(fileMap).length} files`);
		return fileMap;
	} catch (error) {
		console.error('Error creating file content map:', error);
		throw error;
	}
}

// Recursively find and read .recb files
async function findAndReadBlockFiles(dir, baseDir, fileMap) {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		
		for (const entry of entries) {
			if (entry.name.startsWith('.')) continue; // Skip hidden files
			
			const fullPath = path.join(dir, entry.name);
			
			if (entry.isDirectory()) {
				// Recursively search subdirectories
				await findAndReadBlockFiles(fullPath, baseDir, fileMap);
			} else if (entry.name.endsWith('.recb')) {
				// Read block file
				try {
					const content = await fs.readFile(fullPath, 'utf8');
					const relativePath = path.relative(baseDir, fullPath);
					fileMap[relativePath] = content;
					console.log(`📄 Added block file to map: ${relativePath}`);
				} catch (error) {
					console.warn(`⚠️  Could not read block file ${fullPath}:`, error.message);
				}
			}
		}
	} catch (error) {
		console.warn(`⚠️  Could not read directory ${dir}:`, error.message);
	}
}

// Pure JavaScript .rec file parser (NO WASM)
function parseRecFileContent(content, baseDir) {
	const lines = content.split('\n');
	const steps = [];
	let i = 0;

	// Extract description (everything before the first statement)
	let description = '';
	const descriptionLines = [];

	while (i < lines.length) {
		const line = lines[i].trim();

		// Check if this is a statement line
		if (line.startsWith('––– ') && line.endsWith(' –––')) {
			break;
		}

		// Skip empty lines at the beginning if no content yet
		if (descriptionLines.length === 0 && line === '') {
			i++;
			continue;
		}

		descriptionLines.push(lines[i]); // Keep original line with whitespace
		i++;
	}

	// Trim trailing empty lines from description
	while (descriptionLines.length > 0 && descriptionLines[descriptionLines.length - 1].trim() === '') {
		descriptionLines.pop();
	}

	description = descriptionLines.join('\n');

	// Parse statements
	while (i < lines.length) {
		const line = lines[i].trim();

		if (line.startsWith('––– ') && line.endsWith(' –––')) {
			// Extract statement name
			const statement = line.slice(4, -4).trim();
			i++;

			// Create a statement step
			steps.push({
				type: 'statement',
				args: [statement],
				content: null,
				steps: null,
			});

			// Parse command blocks and expected output
			let currentCommand = '';
			let inExpectedOutput = false;
			let inCommandBlock = false;

			while (i < lines.length) {
				const line = lines[i];
				const trimmed = line.trim();

				// Check for next statement
				if (trimmed.startsWith('––– ') && trimmed.endsWith(' –––')) {
					break;
				}

				// Check for block reference
				if (trimmed.startsWith('@')) {
					const blockPath = trimmed.slice(1).trim();
					
					// Add block step
					steps.push({
						type: 'block',
						args: [blockPath],
						content: null,
						steps: null,
					});
					i++;
					continue;
				}

				// Check for expected output marker
				if (trimmed === '---') {
					if (inCommandBlock && currentCommand.trim() !== '') {
						steps.push({
							type: 'command',
							args: [],
							content: currentCommand.trim(),
							steps: null,
						});
						currentCommand = '';
					}
					inExpectedOutput = true;
					inCommandBlock = false;
					i++;
					continue;
				}

				if (inExpectedOutput) {
					// We're collecting expected output
					let expectedOutput = '';
					while (i < lines.length) {
						const line = lines[i];
						const trimmed = line.trim();
						
						// Check for next statement
						if (trimmed.startsWith('––– ') && trimmed.endsWith(' –––')) {
							break;
						}
						
						if (expectedOutput !== '') {
							expectedOutput += '\n';
						}
						expectedOutput += line;
						i++;
					}
					
					if (expectedOutput.trim() !== '') {
						steps.push({
							type: 'expected_output',
							args: [],
							content: expectedOutput.trim(),
							steps: null,
						});
					}
					break; // Exit the inner loop
				} else {
					// We're in a command block
					inCommandBlock = true;
					if (currentCommand !== '') {
						currentCommand += '\n';
					}
					currentCommand += line;
				}

				i++;
			}

			// Add any remaining command
			if (inCommandBlock && currentCommand.trim() !== '') {
				steps.push({
					type: 'command',
					args: [],
					content: currentCommand.trim(),
					steps: null,
				});
			}
		} else {
			i++;
		}
	}

	return {
		description: description || null,
		steps,
	};
}

// Convert parsed structure to UI format
function convertToUIFormat(testStructure) {
	const commands = [];
	
	for (const step of testStructure.steps) {
		switch (step.type) {
			case 'statement':
				// Statements don't become commands in UI
				break;
			case 'command':
				commands.push({
					command: step.content,
					type: 'command',
					status: 'pending'
				});
				break;
			case 'expected_output':
				// Expected output is handled separately
				break;
			case 'block':
				// Block references could be expanded later
				commands.push({
					command: `@${step.args[0]}`,
					type: 'command',
					status: 'pending'
				});
				break;
		}
	}
	
	return commands;
}

// Convert structured format back to .rec content (JavaScript implementation)
function convertStructureToRecContent(testStructure) {
	let content = '';

	// Add description
	if (testStructure.description && testStructure.description.trim() !== '') {
		content += testStructure.description;
		content += '\n\n';
	}

	// Add test steps
	let currentStatement = null;
	let commandContent = '';
	let expectedOutput = '';

	for (const step of testStructure.steps) {
		switch (step.type) {
			case 'statement':
				// Finish previous statement if any
				if (currentStatement !== null) {
					content += `––– ${currentStatement} –––\n`;
					if (commandContent.trim() !== '') {
						content += commandContent;
						content += '\n';
					}
					if (expectedOutput.trim() !== '') {
						content += '---\n';
						content += expectedOutput;
						content += '\n';
					}
					content += '\n';
					commandContent = '';
					expectedOutput = '';
				}
				
				// Start new statement
				if (step.args && step.args.length > 0) {
					currentStatement = step.args[0];
				}
				break;
			case 'command':
				if (step.content) {
					if (commandContent !== '') {
						commandContent += '\n';
					}
					commandContent += step.content;
				}
				break;
			case 'expected_output':
				if (step.content) {
					if (expectedOutput !== '') {
						expectedOutput += '\n';
					}
					expectedOutput += step.content;
				}
				break;
			case 'block':
				if (step.args && step.args.length > 0) {
					if (commandContent !== '') {
						commandContent += '\n';
					}
					commandContent += `@${step.args[0]}`;
				}
				break;
		}
	}

	// Finish last statement if any
	if (currentStatement !== null) {
		content += `––– ${currentStatement} –––\n`;
		if (commandContent.trim() !== '') {
			content += commandContent;
			content += '\n';
		}
		if (expectedOutput.trim() !== '') {
			content += '---\n';
			content += expectedOutput;
			content += '\n';
		}
	}

	return content;
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
		// Get fresh auth config
		const authConfig = getAuthConfig();
		
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

		// For .rec and .recb files, use WASM parsing to return structured content
		if (filePath.endsWith('.rec') || filePath.endsWith('.recb')) {
			try {
				console.log(`📖 Loading structured test file via WASM: ${absolutePath}`);
				
				// Get raw content first
				const rawContent = await fs.readFile(absolutePath, 'utf8');
				
				// Parse .rec file using WASM with file content map (NO file I/O in WASM)
				try {
					console.log(`📖 Parsing .rec file with WASM using content map: ${absolutePath}`);
					
					// Create file content map for WASM
					const fileMap = await createFileContentMap(absolutePath, testDir);
					const relativeFilePath = path.relative(testDir, absolutePath);
					
					// Call WASM with path + content map
					const testStructure = await parseRecFileFromMapWasm(relativeFilePath, fileMap);
					const uiCommands = convertWasmToUIFormat(testStructure);
					
					res.json({ 
						content: rawContent,
						structuredData: testStructure,
						uiCommands: uiCommands,
						wasmparsed: true
					});
				} catch (wasmError) {
					console.warn('WASM parsing failed, falling back to JavaScript:', wasmError.message);
					
					// Fallback to JavaScript parsing - MUST return same structure format as WASM
					const testStructure = parseRecFileContent(rawContent, path.dirname(absolutePath));
					const uiCommands = convertWasmToUIFormat(testStructure); // Use same converter
					
					res.json({ 
						content: rawContent,
						structuredData: testStructure,
						uiCommands: uiCommands,
						wasmparsed: false // JavaScript fallback, but same format
					});
				}
			} catch (fileError) {
				console.error('File read error:', fileError);
				throw fileError;
			}
		} else {
			// For non-test files, return raw content
			const content = await fs.readFile(absolutePath, 'utf8');
			res.json({ content });
		}
	} catch (error) {
		console.error('Error reading file:', error);
		res.status(404).json({ error: 'File not found or could not be read' });
	}
});

// API endpoint to save file content
app.post('/api/save-file', isAuthenticated, async (req, res) => {
	try {
		const { path: filePath, content, structuredData } = req.body;

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

		// For .rec and .recb files, try WASM generation with content map if structured data is provided
		if ((filePath.endsWith('.rec') || filePath.endsWith('.recb')) && structuredData) {
			try {
				console.log(`💾 Attempting to save structured test file via WASM: ${absolutePath}`);
				
				// Use WASM with file content map (no file I/O in WASM)
				const relativeFilePath = path.relative(testDir, absolutePath);
				const fileContentMap = await generateRecFileToMapWasm(relativeFilePath, structuredData);
				
				// Get the generated content for the main file
				const generatedContent = fileContentMap[relativeFilePath];
				
				if (generatedContent && generatedContent.length > 0) {
					// JavaScript writes the file (WASM doesn't touch filesystem)
					await fs.writeFile(absolutePath, generatedContent, 'utf8');
					console.log('✅ File saved via WASM generation');
					res.json({ 
						success: true,
						method: 'wasm',
						generatedContent: generatedContent
					});
					return;
				} else {
					console.warn('WASM generation returned empty content, using manual content');
				}
			} catch (wasmError) {
				console.warn('WASM generation failed, using manual content:', wasmError.message);
			}
		}
		
		// Fallback: save the manual content directly
		await fs.writeFile(absolutePath, content, 'utf8');
		console.log('✅ File saved via manual content');
		res.json({ 
			success: true,
			method: 'manual'
		});
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

// Helper function to parse a .rec file using WASM and handle blocks recursively
async function parseRecFile(absolutePath) {
	try {
		console.log(`📖 Parsing .rec file with WASM: ${absolutePath}`);
		
		// Use WASM to parse the file into structured format
		const testStructure = await parseRecFileWasm(absolutePath);
		
		// Convert to the format expected by the rest of the backend
		const commands = convertWasmToUIFormat(testStructure);
		
		// After parsing the file, recursively expand any blocks
		try {
			const expandedCommands = await expandBlocks(commands, absolutePath);
			return expandedCommands;
		} catch (error) {
			console.error(`Error expanding blocks in ${absolutePath}:`, error);
			// Return the original commands if block expansion fails
			return commands;
		}
	} catch (error) {
		console.warn(`WASM parsing failed for ${absolutePath}, using fallback:`, error.message);
		// Fallback to reading raw content and returning minimal structure
		try {
			const content = await fs.readFile(absolutePath, 'utf8');
			return [{
				command: `echo "File parsing failed: ${error.message}"`,
				expectedOutput: '',
				type: 'command',
				status: 'failed'
			}];
		} catch (readError) {
			console.error(`Failed to read file ${absolutePath}:`, readError);
			return [];
		}
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

		try {
			// Initialize simple-git with the user's repo path
			const git = simpleGit({ baseDir: userRepoPath });
			ensureGitRemoteWithToken(git, req.user.token);

			// Get current branch and status
			const branchSummary = await git.branch();
			const currentBranch = branchSummary.current;
			console.log(`Current branch: ${currentBranch}`);

			// Check if we're on a PR branch
			const isPrBranch = currentBranch.startsWith('clt-ui-');
			console.log(`Is PR branch: ${isPrBranch}`);

			let branchName = currentBranch;
			let needToCreatePr = createPr && !isPrBranch;

			// Determine test directory for staging
			const testDir = getUserTestPath(req);
			const relativeTestPath = path.relative(userRepoPath, testDir);
			console.log(`Tests relative path: ${relativeTestPath}`);

			// Stage changes in the tests directory
			await git.add(relativeTestPath);
			console.log(`Staged changes in tests directory: ${relativeTestPath}`);

			// Check if there are changes to commit
			const status = await git.status();
			if (status.isClean()) {
				return res.status(400).json({ error: 'No changes to commit' });
			}

			// If we need to create a PR, create a new branch
			if (needToCreatePr) {
				// Create a new branch name based on timestamp and username
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				branchName = `clt-ui-${req.user.username}-${timestamp}`;

				// Create and checkout new branch
				await git.checkoutLocalBranch(branchName);
				console.log(`Created and switched to new branch: ${branchName}`);
			}

			// Create a commit
			await git.commit(title);
			console.log(`Created commit with message: ${title}`);

			// Push to the remote repository
			await git.push('origin', branchName, ['--set-upstream']);
			console.log(`Pushed to remote branch: ${branchName}`);

			// Create a PR if needed
			let prUrl = null;
			if (needToCreatePr) {
				try {
					// Use GitHub CLI to create PR if available
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

					// Set environment for gh command
					const env = { ...process.env, GH_TOKEN: req.user.token };
					const ghOptions = { cwd: userRepoPath, env };

					// Get default branch for PR base
					const defaultBranch = branchSummary.branches[branchSummary.current]?.tracking?.split('/')[1] || 'master';

					// Create PR command
					let prCommand = `gh pr create --title "${title}" --head ${branchName}`;
					if (description) {
						prCommand += ` --body "${description}"`;
					}
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

			// Get repo URL for response
			const remote = await git.remote(['get-url', 'origin']).catch(() => '');
			// Remove token from URL if present
			const cleanRemote = remote.replace(/https:\/\/[^@]+@/, 'https://');

			return res.json({
				success: true,
				branch: branchName,
				commit: title,
				pr: prUrl,
				repository: cleanRemote,
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

		try {
			// Initialize simple-git with the user's repo path
			const git = simpleGit({ baseDir: userRepoPath });

			// Get current branch
			const branchSummary = await git.branch();
			const currentBranch = branchSummary.current;
			console.log(`Current branch: ${currentBranch}`);

			// Check if the branch is a PR branch
			const isPrBranch = currentBranch.startsWith('clt-ui-');
			console.log(`Is PR branch: ${isPrBranch}`);

			// Get status information
			const status = await git.status();
			console.log('Git status:', status);

			// Parse the status to get modified files
			const modifiedFiles = [];
			const modifiedDirs = new Set();

			const testDir = getUserTestPath(req);
			// Get the relative path to the test directory from the repo root
			const relativeTestPath = path.relative(userRepoPath, testDir);
			console.log(`Relative test path: ${relativeTestPath}`);

			// Process modified, created, and deleted files
			const allChangedFiles = [
				...status.modified,
				...status.created,
				...status.deleted,
				...status.not_added
			];

			for (const filePath of allChangedFiles) {
				console.log(`Checking file: ${filePath}`);

				// Check if this file is in the test directory
				if (filePath.startsWith(relativeTestPath)) {
					// Determine the status code
					let statusCode = '';
					if (status.modified.includes(filePath)) statusCode = 'M';
						else if (status.created.includes(filePath)) statusCode = 'A';
							else if (status.deleted.includes(filePath)) statusCode = 'D';
								else if (status.not_added.includes(filePath)) statusCode = '??';

					modifiedFiles.push({
						path: filePath,
						status: statusCode
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

		try {
			// Initialize simple-git with the user's repo path
			const git = simpleGit({ baseDir: userRepoPath });

			// Get branch information
			const branchSummary = await git.branch();
			const currentBranch = branchSummary.current;
			console.log(`Current branch: ${currentBranch}`);

			// Get remote repository URL
			const remoteUrl = await git.remote(['get-url', 'origin']);
			const cleanRemoteUrl = remoteUrl.replace(/https:\/\/[^@]+@/, 'https://');
			console.log(`Remote repository URL: ${cleanRemoteUrl}`);

			// Get default branch
			let defaultBranch;
			try {
				// Try to get the default branch from the HEAD reference
				defaultBranch = await git.revparse(['--abbrev-ref', 'origin/HEAD']);
				defaultBranch = defaultBranch.replace('origin/', '');
			} catch (headError) {
				// Fallback: use master or main
				console.warn('Could not determine default branch from HEAD:', headError);

				// Check if main or master exists
				const branches = await git.branch(['-r']);
				if (branches.all.includes('origin/main')) {
					defaultBranch = 'main';
				} else {
					defaultBranch = 'master';
				}
			}
			console.log(`Default branch: ${defaultBranch}`);

			return res.json({
				success: true,
				currentBranch,
				defaultBranch,
				repository: cleanRemoteUrl
			});
		} catch (gitError) {
			console.error('Git operation error:', gitError);
			return res.status(500).json({
				error: 'Git operation failed',
				details: gitError.message
			});
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

		try {
			// Initialize simple-git with the user's repo path
			const git = simpleGit(userRepoPath);
			ensureGitRemoteWithToken(git, req.user.token);

			// Get current status to check for changes
			const status = await git.status();
			let stashMessage = '';

			// Stash changes if needed
			if (!status.isClean()) {
				const timestamp = new Date().toISOString();
				stashMessage = `Auto-stashed by CLT-UI for ${req.user.username} at ${timestamp}`;
				await git.stash(['push', '-m', stashMessage]);
				console.log(`Stashed current changes: ${stashMessage}`);
			}

			// Fetch latest from remote
			await git.fetch(['--all']);
			console.log('Fetched latest updates from remote');

			// Get the list of branches to check if the requested branch exists
			const branches = await git.branch();
			const branchExists = branches.all.includes(branch);

			if (branchExists) {
				// Local branch exists, checkout and reset to remote
				await git.checkout(branch);
				console.log(`Switched to branch: ${branch}`);

				// Reset to origin's version of the branch
				await git.reset(['--hard', `origin/${branch}`]);
				console.log(`Reset to origin/${branch}`);
			} else {
				// Local branch doesn't exist, create tracking branch
				await git.checkout(['-b', branch, `origin/${branch}`]);
				console.log(`Created and checked out branch ${branch} tracking origin/${branch}`);
			}

			return res.json({
				success: true,
				branch,
				repository: status.tracking,
				stashed: status.isClean() ? null : stashMessage,
				message: `Successfully reset to branch: ${branch}`
				});
		} catch (gitError) {
			console.error('Git operation error:', gitError);
			return res.status(500).json({
				error: 'Git operation failed',
				details: gitError.message || 'Unknown error during git operation'
			});
		}
	} catch (error) {
		console.error('Error resetting to branch:', error);
		res.status(500).json({ error: `Failed to reset to branch: ${error.message}` });
	}
});

// Convert the title of PR into the branch
function slugify(str) {
	return str
		.toLowerCase()
		.trim()
		.replace(/[\s\_]+/g, '-')
		.replace(/[^\w\-]+/g, '')
		.replace(/\-+/g, '-');
}

app.post('/api/create-pr', isAuthenticated, async (req, res) => {
	const { title, description } = req.body;
	if (!title) return res.status(400).json({ error: 'PR title is required' });

	const username = req.user.username;
	const userRepo = getUserRepoPath(req);

	// slugify title for branch name
	const branchName = `clt-ui-${slugify(title)}`;

	const git = simpleGit({ baseDir: userRepo });
	ensureGitRemoteWithToken(git, req.user.token);

	try {
		// fetch all
		await git.fetch(['--all']);

		// list local + remote branches
		const local  = await git.branchLocal();
		const remote = await git.branch(['-r']);
		const existsLocally = local.all.includes(branchName);
		const existsRemote  = remote.all.includes(`origin/${branchName}`);
		const branchExists  = existsLocally || existsRemote;

		const { exec } = await import('child_process');

		// helper to run gh commands
		const execPromise = (cmd) => new Promise((resolve, reject) => {
			exec(cmd, { cwd: userRepo, env: { ...process.env, GH_TOKEN: req.user.token } },
				(err, stdout, stderr) => {
					if (err) {
						reject(stderr || err);
					} else {
						resolve(stdout.trim());
					}
				}
			);
		});


		if (branchExists) {
			// check if there's an OPEN PR for that head
			const prList = await execPromise(
				`gh pr list --state open --head ${branchName} --json url`
			).catch(() => '');
			if (!prList) {
				return res
					.status(400)
					.json({ error: `Branch '${branchName}' exists with no open PR.` });
			}

			// branch and PR both exist → just commit & push
			await git.checkout(branchName);
			await git.add('.');
			const commit = await git.commit(title);
			await git.push('origin', branchName);

			return res.json({
				success: true,
				branch: branchName,
				commit: commit.latest,
				pr: JSON.parse(prList)[0]?.url,
				message: 'Committed and pushed to existing PR branch.'
			});
		}

		// branch does not exist → create it, commit & push, open PR
		await git.checkoutLocalBranch(branchName);
		await git.add('.');
		const commit = await git.commit(title);
		await git.push('origin', branchName, ['--set-upstream']);

		// build gh pr create command
		let ghCmd = `gh pr create --title "${title.replace(/"/g,'\\"')}" --head ${branchName}`;
		if (description) {
			ghCmd += ` --body "${description.replace(/"/g,'\\"')}"`;
		}

		const prOutput = await execPromise(ghCmd).catch(e => { throw e });
		const prUrlMatch = prOutput.match(/https:\/\/github\.com\/[^\s]+/);
		const prUrl = prUrlMatch?.[0] || null;

		return res.json({
			success: true,
			branch: branchName,
			commit: commit.latest,
			pr: prUrl,
			message: prUrl
				? 'Pull request created successfully.'
				: 'Branch pushed; PR creation failed—please open manually.'
		});
	}
	catch (err) {
		console.error('create-pr error:', err);
		return res.status(500).json({ error: err.toString() });
	}
});

// API endpoint to get patterns file
app.get('/api/get-patterns', isAuthenticated, async (req, res) => {
	try {
		console.log('🎯 Getting patterns via WASM for user repository');
		
		// Get the user's repository path for pattern context
		const authConfig = getAuthConfig();
		const username = req.user?.username || (authConfig.skipAuth ? 'dev-mode' : null);
		let userRepoPath = null;
		
		if (username) {
			userRepoPath = getUserRepoPath(req);
			console.log(`Using user repo path for patterns: ${userRepoPath}`);
		}
		
		// Try to get patterns using WASM with user's repo context
		try {
			const patterns = await getPatternsWasm(userRepoPath);
			console.log(`✅ Found ${Object.keys(patterns).length} patterns via WASM`);
			return res.json({ patterns });
		} catch (wasmError) {
			console.error('WASM pattern retrieval failed:', wasmError);
			// Return empty patterns instead of failing
			return res.json({ patterns: {} });
		}
	} catch (error) {
		console.error('Error getting patterns:', error);
		res.status(500).json({ error: 'Failed to get patterns' });
	}
});

// API endpoint to validate a test file
app.post('/api/validate-test', isAuthenticated, async (req, res) => {
	try {
		const { filePath } = req.body;

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

		// Validate using WASM
		try {
			console.log(`🔍 Validating test file via WASM: ${absolutePath}`);
			const validationResult = await validateTestWasm(absolutePath);
			console.log('✅ WASM validation completed');
			res.json(validationResult);
		} catch (wasmError) {
			console.warn('WASM validation failed, returning default valid result:', wasmError.message);
			res.json({ valid: true, errors: [], method: 'fallback' });
		}
	} catch (error) {
		console.error('Error validating test:', error);
		res.status(500).json({ error: 'Failed to validate test' });
	}
});

// Interactive session endpoints
// Start a new interactive command session
app.post('/api/interactive/start', isAuthenticated, async (req, res) => {
	try {
		const { input } = req.body;
		
		if (!input || !input.trim()) {
			return res.status(400).json({ error: 'Input is required' });
		}

		// Check if user is authenticated
		if (!req.user || !req.user.username) {
			return res.status(401).json({ error: 'Authentication required' });
		}

		const username = req.user.username;

		// Check if user already has a running session
		if (global.interactiveSessions[username] && global.interactiveSessions[username].running) {
			return res.status(409).json({ error: 'Another command is already running for this user' });
		}

		// Generate session ID
		const sessionId = `${username}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

		// Get the interactive command from environment
		const askAiCommand = process.env.ASK_AI_COMMAND || 'docker run --rm -i ubuntu:latest bash -c "echo \\"Input received:\\"; cat; echo \\"\\nSleeping for 2 seconds...\\"; sleep 2; echo \\"Done!\\""';
		const askAiTimeout = parseInt(process.env.ASK_AI_TIMEOUT || '30000');
		
		console.log(`Starting interactive session ${sessionId} for user ${username}`);
		console.log(`Command: ${askAiCommand}`);
		console.log(`Input: ${input}`);
		console.log(`Timeout: ${askAiTimeout}ms`);

		// Initialize session
		const session = {
			id: sessionId,
			username,
			running: true,
			completed: false,
			logs: [],
			output: '',
			startTime: new Date(),
			process: null,
			timeout: null
		};

		global.interactiveSessions[username] = session;

		// Import child_process
		const { spawn } = await import('child_process');

		// Start the process with shell to handle complex commands
		const childProcess = spawn('sh', ['-c', askAiCommand], {
			stdio: ['pipe', 'pipe', 'pipe']
		});

		session.process = childProcess;

		// Set up timeout
		session.timeout = setTimeout(() => {
			if (session.running && childProcess) {
				console.log(`Session ${sessionId} timed out after ${askAiTimeout}ms`);
				childProcess.kill('SIGTERM');
				session.logs.push(`\nTIMEOUT: Command timed out after ${askAiTimeout}ms`);
			}
		}, askAiTimeout);

		// Send input to the process
		childProcess.stdin.write(input);
		childProcess.stdin.end();

		// Handle stdout
		childProcess.stdout.on('data', (data) => {
			const output = data.toString();
			session.logs.push(output);
			console.log(`Session ${sessionId} stdout:`, output);
		});

		// Handle stderr
		childProcess.stderr.on('data', (data) => {
			const output = data.toString();
			session.logs.push(`STDERR: ${output}`);
			console.log(`Session ${sessionId} stderr:`, output);
		});

		// Handle process completion
		childProcess.on('close', (code) => {
			session.running = false;
			session.completed = true;
			session.exitCode = code;
			session.output = session.logs.join('');
			session.endTime = new Date();
			
			// Clear timeout
			if (session.timeout) {
				clearTimeout(session.timeout);
				session.timeout = null;
			}
			
			console.log(`Session ${sessionId} completed with exit code: ${code}`);
			
			// Clean up after 5 minutes
			setTimeout(() => {
				if (global.interactiveSessions[username] && global.interactiveSessions[username].id === sessionId) {
					delete global.interactiveSessions[username];
					console.log(`Cleaned up session ${sessionId}`);
				}
			}, 5 * 60 * 1000);
		});

		// Handle process error
		childProcess.on('error', (error) => {
			session.running = false;
			session.completed = true;
			session.error = error.message;
			session.logs.push(`ERROR: ${error.message}`);
			session.output = session.logs.join('');
			
			// Clear timeout
			if (session.timeout) {
				clearTimeout(session.timeout);
				session.timeout = null;
			}
			
			console.error(`Session ${sessionId} error:`, error);
		});

		res.json({ sessionId, status: 'started' });
	} catch (error) {
		console.error('Error starting interactive session:', error);
		res.status(500).json({ error: 'Failed to start interactive session' });
	}
});

// Get status of an interactive session
app.get('/api/interactive/status/:sessionId', isAuthenticated, async (req, res) => {
	try {
		const { sessionId } = req.params;
		
		if (!req.user || !req.user.username) {
			return res.status(401).json({ error: 'Authentication required' });
		}

		const username = req.user.username;
		const session = global.interactiveSessions[username];

		if (!session || session.id !== sessionId) {
			return res.status(404).json({ error: 'Session not found' });
		}

		res.json({
			sessionId,
			running: session.running,
			completed: session.completed,
			logs: session.logs,
			output: session.output,
			exitCode: session.exitCode,
			error: session.error,
			startTime: session.startTime,
			endTime: session.endTime
		});
	} catch (error) {
		console.error('Error getting session status:', error);
		res.status(500).json({ error: 'Failed to get session status' });
	}
});

// Cancel an interactive session
app.post('/api/interactive/cancel/:sessionId', isAuthenticated, async (req, res) => {
	try {
		const { sessionId } = req.params;
		
		if (!req.user || !req.user.username) {
			return res.status(401).json({ error: 'Authentication required' });
		}

		const username = req.user.username;
		const session = global.interactiveSessions[username];

		if (!session || session.id !== sessionId) {
			return res.status(404).json({ error: 'Session not found' });
		}

		if (session.process && session.running) {
			session.process.kill('SIGTERM');
			session.running = false;
			session.completed = true;
			session.cancelled = true;
			session.logs.push('\nProcess cancelled by user');
			session.output = session.logs.join('');
			
			// Clear timeout
			if (session.timeout) {
				clearTimeout(session.timeout);
				session.timeout = null;
			}
			
			console.log(`Session ${sessionId} cancelled by user`);
		}

		res.json({ status: 'cancelled' });
	} catch (error) {
		console.error('Error cancelling session:', error);
		res.status(500).json({ error: 'Failed to cancel session' });
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
