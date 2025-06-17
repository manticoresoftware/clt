# CLT UI Development Guide

## Architecture Overview

CLT UI is a Svelte-based web interface for managing and editing CLT test files with real-time execution capabilities.

### Tech Stack
- **Frontend**: Svelte 5 + TypeScript + Vite
- **Backend**: Node.js + Express
- **Authentication**: GitHub OAuth (optional, can skip with SKIP_AUTH=true)
- **Storage**: localStorage for session persistence
- **Testing**: WASM-based diff engine for output comparison

## Core Components

### Main Layout
- **App.svelte** - Root component with auth state management
- **Header.svelte** - Navigation with Ask AI and Create PR buttons
- **FileExplorer.svelte** - File tree navigation and management
- **Editor.svelte** - Main editing interface with command/output pairs

### Key Features
- **Ask AI** (`InteractiveSession.svelte`) - Interactive command execution with session persistence
- **Pull Request Modal** (`PullRequestModal.svelte`) - GitHub integration for PR creation
- **Real-time Testing** - Execute CLT tests with live output comparison

## Critical Development Notes

### State Management
- **filesStore** - Current file, commands, test results, running state
- **authStore** - User authentication and GitHub integration
- **githubStore** - PR creation modal state
- **branchStore** - Git branch information

### Session Persistence (Ask AI)
- **Active sessions**: `askAI_activeSession` in localStorage
- **Completed history**: `askAI_sessionHistory` in localStorage
- **Background polling**: Continues even when modal is closed
- **One session per user**: Backend enforces this limitation

### Authentication Flow
1. GitHub OAuth (if enabled) or skip auth mode
2. User repo cloning to `workdir/{username}`
3. Session management with tokens stored globally
4. Repository operations use user's GitHub token

## Environment Configuration

### Required Variables
```bash
# Backend
BACKEND_PORT=9150
FRONTEND_PORT=9151

# Ask AI Feature
ASK_AI_COMMAND="docker run --rm -i ubuntu:latest bash -c \"echo 'Input:'; cat; sleep 2; echo 'Done'\""
ASK_AI_TIMEOUT=30000

# GitHub OAuth (optional)
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_secret
SKIP_AUTH=true  # for development
```

## Development Workflow

### Setup
```bash
cd ui
npm install
npm run dev  # Frontend on :5173
node server.js  # Backend on :9150
```

### File Structure
```
ui/
├── src/
│   ├── components/     # Svelte components
│   ├── stores/        # State management
│   └── config.js      # API configuration
├── server.js          # Express backend
├── doc/              # Development docs
└── dist/             # Build output
```

### Key API Endpoints
- `/api/get-file-tree` - File explorer data
- `/api/get-file` - File content
- `/api/save-file` - Save file changes
- `/api/run-test` - Execute CLT tests
- `/api/interactive/*` - Ask AI session management
- `/api/commit-changes` - Git operations

## Testing & Building

### Development
```bash
npm run dev     # Development server
npm run build   # Production build
npm run preview # Preview build
```

### Testing Ask AI
```bash
./test-session-persistence.sh  # Test session persistence
./test-interactive.sh          # Test basic functionality
```

## Common Issues & Solutions

### Session Persistence Not Working
- Check localStorage keys: `askAI_activeSession`, `askAI_sessionHistory`
- Verify background polling continues after modal close
- Ensure `loadSessionState()` is called on component mount

### Authentication Issues
- Set `SKIP_AUTH=true` for development
- Check GitHub OAuth configuration
- Verify session secrets and cookies

### File Operations Failing
- Check user repo exists in `workdir/{username}`
- Verify file paths are within test directory
- Ensure proper authentication for git operations

## Performance Notes

- **Batch edits**: Use `batch_edit` for multiple file changes
- **Polling efficiency**: Ask AI polls every 1 second
- **WASM loading**: Diff engine loads asynchronously
- **Memory cleanup**: Sessions auto-cleanup after 5 minutes

## Security Considerations

- Commands execute in isolated Docker containers
- User input passed via stdin only
- File operations restricted to user's test directory
- GitHub tokens stored securely and cleaned up
- Session isolation per authenticated user