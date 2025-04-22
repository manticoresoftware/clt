# Manticore Test Editor

A UI application for editing and validating Manticore test files with .rec extension. It provides a web-based interface for creating, editing, and running CLT tests with real-time feedback.

## Features

- File tree explorer for navigating and managing .rec files
- Editor for test commands and expected outputs
- Real-time pattern-based diff comparison using WebAssembly
- Docker image configuration for test validation
- Support for subdirectories and reusable blocks
- GitHub authentication with user access control

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- GitHub OAuth application (for authentication)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) (for building the wasm-diff module)

### Installation

```bash
# Navigate to the ui directory
cd ui

# Install dependencies
npm install

# Create .env file from the example
cp .env.example .env

# Edit the .env file with your GitHub OAuth credentials and allowed usernames

# Build the wasm-diff module (if not already built)
cd ../wasm-diff
wasm-pack build --target web

# Copy the built wasm module to the UI package directory
mkdir -p ../ui/pkg
cp -r pkg/* ../ui/pkg/

# Return to the UI directory and start the development server
cd ../ui
npm run dev
```

The application will be available at http://localhost:5173/ (or another port if 5173 is in use).

## WebAssembly Pattern Matching

The UI uses a WebAssembly module (`wasm-diff`) that provides real-time comparison between expected and actual output with support for pattern matching, mirroring the functionality of the CLI version.

### How Pattern Matching Works

1. The UI reads patterns from `.clt/patterns` file in the UI directory or falls back to the project's `.clt/patterns` file
2. Patterns are loaded into the wasm-diff module which uses them for regex-based variable matching
3. When you type in the expected output, the UI automatically compares it with the actual output in real-time
4. Differences are highlighted with intelligent pattern recognition for variables like timestamps, IP addresses, etc.

### Pattern File Format

The pattern file follows the same format as the CLI version:

```
PATTERN_NAME REGEX_PATTERN
```

For example:
```
SEMVER [0-9]+\.[0-9]+\.[0-9]+
YEAR [0-9]{4}
IPADDR [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+
```

In your test files, you can use these patterns with the syntax `%{PATTERN_NAME}` which will be replaced with the corresponding regex pattern during comparison.

## Authentication Configuration

The application uses GitHub OAuth for authentication. You need to configure the following:

1. Create a GitHub OAuth application at https://github.com/settings/developers
2. Set the callback URL to `http://localhost:3000/auth/github/callback` (or your custom domain)
3. Configure the `.env` file with your OAuth credentials:

```
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
ALLOWED_GITHUB_USERS=username1,username2,username3
```

### Server Configuration

You can configure the server to listen on different ports and hosts:

```
HOST=localhost       # Set to '0.0.0.0' to listen on all interfaces
FRONTEND_PORT=5173   # Default frontend port (Vite)
BACKEND_PORT=3000    # Default backend port (Express)
```

### Development Mode

For development without authentication, you can set:

```
SKIP_AUTH=true
```

This will bypass the authentication check and allow you to access the application without logging in.

## Usage

1. Log in with your GitHub account (if authentication is enabled)
2. The file explorer on the left shows available .rec files
3. Click on a file to open it in the editor
4. Add commands and expected outputs
5. Configure the Docker image at the top for validation
6. Save files as needed
7. Run tests to see real-time diff comparison with pattern recognition

## Project Structure

- `src/components/` - Svelte components
- `src/stores/` - Svelte stores for state management
- `src/lib/` - Utility functions
- `config/` - Application configuration
- `pkg/` - WebAssembly module for diff comparison (compiled from wasm-diff)
- `.clt/patterns` - Pattern definitions for variable matching in tests

## Development

### Building the wasm-diff Module

The wasm-diff module is a WebAssembly component written in Rust that handles pattern-based diff comparison. To update it:

```bash
cd wasm-diff
wasm-pack build --target web
cp -r pkg/* ../ui/pkg/
```

### Building for Production

```bash
# Build the UI
npm run build

# Start the production server
node server.js
```

This will create a production-ready build in the `dist` directory and start the server.

### Running Tests

```bash
npm run test
```

## Technical Details

### Real-time Comparison

The UI performs real-time comparison between expected and actual output as you type. This works by:

1. Loading patterns from the patterns file into the WebAssembly module
2. Converting variable patterns like `%{IPADDR}` to their regex equivalents
3. Applying regex-based pattern matching to normalize variables
4. Generating a diff that highlights only meaningful differences

The comparison is intelligent enough to ignore differences in variable values that match defined patterns, making test development much faster and less error-prone.

### Server API Endpoints

The UI server provides several API endpoints:

- `/api/get-file-tree` - Returns the file tree structure
- `/api/get-file` - Gets the content of a specified file
- `/api/save-file` - Saves content to a file
- `/api/create-directory` - Creates a new directory
- `/api/run-test` - Executes a test and returns results
- `/api/get-patterns` - Retrieves and parses the patterns file

## Limitations

- Performance may be affected when dealing with very large output files
- Authentication is currently limited to GitHub OAuth
- Wasm-diff module must be compiled and placed in the pkg directory