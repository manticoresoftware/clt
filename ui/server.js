import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import session from 'express-session';
import dotenv from 'dotenv';
import simpleGit from 'simple-git';

import {
  getPatternsWasm,
  parseRecFileFromMapWasm,
  generateRecFileToMapWasm,
  validateTestFromMapWasm
} from './wasmNodeWrapper.js';

// Import refactored modules
import { setupRoutes, getUserRepoPath, getUserTestPath } from './routes.js';
import { setupGitAndTestRoutes } from './testAndGitRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file FIRST
dotenv.config();

// Import auth modules AFTER environment variables are loaded
import { setupPassport, isAuthenticated, addAuthRoutes } from './auth.js';
import { getAuthConfig } from './config/auth.js';
import tokenManager from './tokenManager.js';

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

// Store user tokens for repository operations
global.userTokens = {};

// Store for interactive sessions
global.interactiveSessions = {};

// Make the function available globally for the auth system
global.ensureUserRepo = ensureUserRepo;

// Setup routes from refactored modules
const dependencies = {
  WORKDIR,
  ROOT_DIR,
  REPO_URL,
  __dirname,
  getAuthConfig,
  ensureUserRepo
};

setupRoutes(app, isAuthenticated, dependencies);
setupGitAndTestRoutes(app, isAuthenticated, dependencies);

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Serve public content (for login page and other public resources)
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', isAuthenticated, (req, res) => {
	res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
app.listen(PORT, HOST === 'localhost' ? HOST : '0.0.0.0', () => {
	console.log(`Server is running on ${HOST}:${PORT}`);
});