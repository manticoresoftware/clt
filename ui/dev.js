// dev.js - Development server runner
import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load environment variables from .env file
config();

// Define port and host constants
const FRONTEND_PORT = process.env.FRONTEND_PORT || 5173;
const BACKEND_PORT = process.env.BACKEND_PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// Important: Set process.env.BACKEND_PORT and FRONTEND_PORT for child processes
process.env.BACKEND_PORT = BACKEND_PORT;
process.env.FRONTEND_PORT = FRONTEND_PORT;
process.env.HOST = HOST;

// Log important environment variables for debugging (without secrets)
console.log('Environment Configuration:');
console.log('- HOST:', HOST);
console.log('- FRONTEND_PORT:', FRONTEND_PORT);
console.log('- BACKEND_PORT:', BACKEND_PORT);
console.log('- GITHUB_CALLBACK_URL:', process.env.GITHUB_CALLBACK_URL);
console.log('- SKIP_AUTH:', process.env.SKIP_AUTH);
console.log('- ALLOWED_GITHUB_USERS:', process.env.ALLOWED_GITHUB_USERS ? 'Configured' : 'Not configured');

// Override callback URL to use the specified host/port if not set or using dev2.manticoresearch.com
if (!process.env.GITHUB_CALLBACK_URL || process.env.GITHUB_CALLBACK_URL.includes('dev2.manticoresearch.com')) {
  console.log(`⚠️  Warning: Using ${HOST}:${BACKEND_PORT} for GitHub callback URL`);
  process.env.GITHUB_CALLBACK_URL = `http://${HOST}:${BACKEND_PORT}/auth/github/callback`;
}

// Set frontend URL if not already set
if (!process.env.FRONTEND_URL) {
  console.log(`⚠️  Setting frontend URL to ${HOST}:${FRONTEND_PORT}`);
  process.env.FRONTEND_URL = `http://${HOST}:${FRONTEND_PORT}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Run a command and prefix its output
function runCommand(command, args, name, color) {
  const prefix = `${color}[${name}]${colors.reset} `;
  
  console.log(`${colors.bright}${color}Starting ${name}...${colors.reset}`);
  
  const proc = spawn(command, args, { 
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env // Pass environment variables to the child process
  });
  
  proc.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) console.log(prefix + line);
    });
  });
  
  proc.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) console.error(`${prefix}${colors.red}${line}${colors.reset}`);
    });
  });
  
  proc.on('close', (code) => {
    if (code !== 0) {
      console.error(`${prefix}${colors.red}Process exited with code ${code}${colors.reset}`);
    } else {
      console.log(`${prefix}${colors.green}Process completed successfully${colors.reset}`);
    }
  });
  
  return proc;
}

// Run Vite development server with the specified port and host
const viteServer = runCommand('npx', ['vite', '--port', FRONTEND_PORT, '--host', HOST], 'Frontend', colors.cyan);

// Run Express API server
const apiServer = runCommand('node', ['--experimental-modules', 'server.js'], 'Backend', colors.magenta);

// Handle process termination
process.on('SIGINT', () => {
  console.log(`\n${colors.yellow}Shutting down servers...${colors.reset}`);
  viteServer.kill();
  apiServer.kill();
  process.exit(0);
});

console.log(`\n${colors.bright}${colors.green}Development servers started:${colors.reset}`);
console.log(`${colors.cyan}Frontend: ${colors.reset}http://${HOST}:${FRONTEND_PORT}`);
console.log(`${colors.magenta}Backend API: ${colors.reset}http://${HOST}:${BACKEND_PORT}/api`);
console.log(`\n${colors.bright}${colors.yellow}Press Ctrl+C to stop${colors.reset}\n`);