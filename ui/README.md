# CLT UI - Command Line Tool Test Interface

A comprehensive Svelte-based web application for managing and testing Command Line Tool (CLT) test files with advanced Git integration and Docker support.

## 🏗️ Architecture Overview

### Technology Stack
- **Frontend**: Svelte 5.20.2 with TypeScript 5.7.2
- **Build Tool**: Vite 6.2.0 with hot-reload development
- **Styling**: TailwindCSS 4.1.3 with PostCSS processing
- **Backend**: Express.js 4.18.3 with Node.js ES modules
- **Authentication**: Passport.js with GitHub OAuth2 strategy
- **Git Operations**: simple-git 3.27.0 for repository management
- **File Management**: Native Node.js fs/promises with security validation
- **WASM Module**: Custom Rust-based pattern matching engine (wasm_diff)
- **Session Management**: express-session 1.18.1 with secure cookies

## 📁 Project Structure

```
ui/
├── src/                          # Frontend source code
│   ├── components/               # Svelte components
│   │   ├── Header.svelte        # Navigation, Docker settings, git status
│   │   ├── FileExplorer.svelte  # File tree with drag-and-drop
│   │   ├── Editor.svelte        # Main .rec file editor with WASM
│   │   └── PullRequestModal.svelte # GitHub PR creation
│   ├── stores/                   # Svelte state management
│   │   ├── filesStore.ts        # File operations & test execution
│   │   ├── authStore.ts         # GitHub authentication state
│   │   ├── branchStore.ts       # Git branch operations
│   │   └── githubStore.ts       # Pull request management
│   ├── App.svelte               # Root component with auth flow
│   ├── main.ts                  # Application entry point
│   └── config.js                # API configuration
├── pkg/                         # WASM module (Rust-compiled)
│   ├── wasm_diff.js            # WASM JavaScript bindings
│   ├── wasm_diff_bg.wasm       # Compiled WASM binary
│   └── *.d.ts                  # TypeScript definitions
├── public/                      # Static assets
│   └── auth/login.html         # Login page
├── config/                      # Server configuration
│   └── auth.js                 # Authentication settings
├── server.js                   # Express backend server
├── auth.js                     # Passport.js authentication
├── dev.js                      # Development server runner
└── package.json                # Dependencies and scripts
```

## 🚀 Quick Start

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- GitHub OAuth application (for authentication)
- Docker (for test execution)
- Git CLI tools

### Installation

```bash
# Navigate to the ui directory
cd ui

# Install dependencies
npm install

# Create .env file from the example
cp .env.example .env

# Edit the .env file with your GitHub OAuth credentials and allowed usernames

# Start development servers (frontend + backend)
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

## 🔧 Backend Architecture (server.js)

### Core Features

1. **User Repository Management**
   - Per-user Git repository cloning
   - Secure directory isolation
   - Token-based authentication for Git operations

2. **File Operations API**
   ```javascript
   GET  /api/get-file-tree     # Hierarchical file listing
   GET  /api/get-file          # File content retrieval
   POST /api/save-file         # File content saving
   POST /api/move-file         # File/directory movement
   DELETE /api/delete-file     # File/directory deletion
   ```

3. **Test Execution Engine**
   ```javascript
   POST /api/run-test          # Execute CLT tests with Docker
   ```
   - Docker container orchestration
   - .rec/.recb file processing
   - Output comparison and status reporting
   - Duration tracking and performance metrics

4. **Git Integration**
   ```javascript
   GET  /api/git-status        # Repository status
   GET  /api/current-branch    # Branch information
   POST /api/reset-to-branch   # Branch reset operations
   POST /api/create-pr         # Pull request creation
   ```

5. **Authentication System**
   ```javascript
   GET  /auth/github           # GitHub OAuth initiation
   GET  /auth/github/callback  # OAuth callback handler
   GET  /api/current-user      # User session validation
   GET  /logout                # Session termination
   ```

### Security Model

1. **Path Validation**: All file operations validate paths within user directories
2. **Authentication**: GitHub OAuth with configurable user allowlist
3. **Session Security**: Secure cookie configuration with SameSite protection
4. **CORS Configuration**: Development-friendly CORS with production security

## 📊 Performance Optimizations

### Frontend Optimizations
- **Debounced Auto-save**: Configurable delay to prevent excessive API calls
- **Optimistic Updates**: Immediate UI feedback for file operations
- **Batch Operations**: Efficient multi-file operations
- **WASM Acceleration**: High-performance pattern matching

### Backend Optimizations
- **Streaming File Operations**: Efficient handling of large files
- **Git Operation Caching**: Reduced redundant Git operations
- **Process Isolation**: Secure and efficient Docker container management

## 🔍 Technical Details

### Real-time Comparison

The UI performs real-time comparison between expected and actual output as you type. This works by:

1. Loading patterns from the patterns file into the WebAssembly module
2. Converting variable patterns like `%{IPADDR}` to their regex equivalents
3. Applying regex-based pattern matching to normalize variables
4. Generating a diff that highlights only meaningful differences

The comparison is intelligent enough to ignore differences in variable values that match defined patterns, making test development much faster and less error-prone.

## 🚦 Deployment Considerations

### Production Build
- **Asset Optimization**: Minified and compressed static assets
- **Code Splitting**: Optimized bundle loading
- **Security Headers**: Production-ready security configuration

### Environment Requirements
- **Node.js**: ES modules support required
- **Docker**: Container runtime for test execution
- **Git**: Repository operations and CLI tools
- **GitHub CLI**: Required for pull request creation

## ⚠️ Limitations

- Performance may be affected when dealing with very large output files
- Authentication is currently limited to GitHub OAuth
- Wasm-diff module must be compiled and placed in the pkg directory
- GitHub CLI must be installed for pull request creation functionality

This architecture provides a robust, scalable foundation for CLT test management with modern web technologies and comprehensive Git integration.