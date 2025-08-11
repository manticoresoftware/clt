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

## Development Guidelines

### Adding New URL Parameters
1. Add to `parseUrlParams()` return type and function
2. Handle in `onMount()` after unstaged changes check
3. Add to `handleUrlChange()` for dynamic updates
4. Test with unstaged changes scenarios

### Adding New Git Operations
1. Always call `checkUnstagedChanges()` first
2. Use existing patterns from `resetToBranch` and `checkoutAndPull`
3. Preserve expanded state with `preserveExpandedState()`
4. Handle errors gracefully with user feedback

### File Tree Modifications
1. Use `mergeFileTreePreservingState()` for updates
2. Call `preserveExpandedState()` before refreshes
3. Test that user interactions are maintained
4. Verify polling doesn't disrupt workflow

### Performance Best Practices
- Use parallel tool execution for discovery operations
- Batch edits for multiple file changes
- Smart merging reduces DOM updates
- Preserve user state during background operations
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

### Git Default Branch Issues
- **Fixed in helpers.js**: Robust multi-method default branch detection
- Uses progressive fallback: `remote show origin` → `ls-remote` → `origin/HEAD` → branch detection
- All git operations use `baseDir: userRepo` for correct working directory
- Cached per repository to avoid repeated git calls

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
- Session isolation per authenticated usersession secrets and cookies

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
## Block System & Internal Steps

**Critical Fix Applied**: Block internal steps now persist correctly after save/run cycles.

### Block Architecture
- **Block references**: `––– block: path –––` in .rec files reference reusable .recb files
- **Internal steps**: UI allows adding steps directly inside block references
- **Path resolution**: Block paths are resolved relative to the containing test file directory
- **File generation**: Blocks with internal steps automatically generate/update corresponding .recb files

### Technical Implementation
- **TestStep structure**: Contains optional `steps: Option<Vec<TestStep>>` field for nested steps
- **Save flow**: UI → Backend (`/api/save-file`) → WASM → Parser → File system
- **Key functions**:
  - `write_test_file_to_map()` in `parser/src/lib.rs` - generates file map for main + block files
  - `convert_structure_to_rec()` - converts TestStructure to .rec format
  - Backend saves ALL files in generated file map (not just main file)

### Path Resolution Examples
- Test file: `test/clt-tests/buddy/test.rec`
- Block reference: `../base/auth.recb`
- Resolved path: `test/clt-tests/base/auth.recb`

### WASM Build Process
```bash
cd wasm
wasm-pack build --target web --out-dir pkg
cp -r wasm/pkg ui/
```