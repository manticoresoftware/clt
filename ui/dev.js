// dev.js - Development server runner
import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

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

// Function to run a command and prefix its output
function runCommand(command, args, name, color) {
  const prefix = `${color}[${name}]${colors.reset} `;
  
  console.log(`${colors.bright}${color}Starting ${name}...${colors.reset}`);
  
  const proc = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'] });
  
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

// Run Vite development server
const viteServer = runCommand('npx', ['vite'], 'Frontend', colors.cyan);

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
console.log(`${colors.cyan}Frontend: ${colors.reset}http://localhost:5173`);
console.log(`${colors.magenta}Backend API: ${colors.reset}http://localhost:3000/api`);
console.log(`\n${colors.bright}${colors.yellow}Press Ctrl+C to stop${colors.reset}\n`);