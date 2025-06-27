# CLT UI Documentation Index

## Development Documentation

### 📚 Core Guides
- **[DEVELOPMENT.md](./DEVELOPMENT.md)** - Architecture overview, setup, and critical development notes
- **[COMPONENTS.md](./COMPONENTS.md)** - Detailed component guide with code patterns
- **[API.md](./API.md)** - Backend API reference and endpoint documentation

### 🎯 Feature Documentation
- **[ASK_AI.md](./ASK_AI.md)** - Ask AI interactive session feature with session persistence\n- **[THEMING.md](./THEMING.md)** - CodeMirror theming guide for command syntax highlighting

## Quick Reference

### Development Setup
```bash
cd ui
npm install
npm run dev     # Frontend :5173
node server.js  # Backend :9150
```

### Key Environment Variables
```bash
ASK_AI_COMMAND="docker run --rm -i ubuntu:latest bash -c 'echo Input; cat'"
ASK_AI_TIMEOUT=30000
SKIP_AUTH=true  # Development mode
```

# CLT UI Documentation Index

## Development Documentation

### 📚 Core Guides
- **[DEVELOPMENT.md](./DEVELOPMENT.md)** - Enhanced architecture with Git safety, URL parameters, and state preservation
- **[COMPONENTS.md](./COMPONENTS.md)** - Detailed component guide with new patterns
- **[API.md](./API.md)** - Backend API reference including new Git safety endpoints

### 🎯 Feature Documentation
- **[URL_PARAMETERS.md](./URL_PARAMETERS.md)** - Comprehensive URL parameter system with Git safety
- **[ASK_AI.md](./ASK_AI.md)** - Ask AI interactive session feature with session persistence
- **[THEMING.md](./THEMING.md)** - CodeMirror theming guide for command syntax highlighting

## Quick Reference

### Development Setup
```bash
cd ui
npm install
npm run dev     # Frontend :5173
node server.js  # Backend :9150
```

### New URL Parameter System
```bash
# Auto-open file with custom Docker image
?test_path=core/file.rec&docker_image=custom:latest

# Switch branch and highlight failed tests  
?branch=feature-branch&failed_tests[]=test1.rec&failed_tests[]=test2.rec

# Complete workflow URL
?test_path=integration/auth.rec&branch=auth-fixes&docker_image=test:latest&failed_tests[]=integration/auth.rec
```

### Git Safety Features
- **Unstaged Changes Detection**: Automatic check before git operations
- **User Confirmation**: Clear dialog explaining consequences
- **Complete Cancellation**: Option to ignore URL parameters if conflicts exist
- **Applied Everywhere**: URL processing AND manual branch operations

### Key Environment Variables
```bash
ASK_AI_COMMAND="docker run --rm -i ubuntu:latest bash -c 'echo Input; cat'"
ASK_AI_TIMEOUT=30000
SKIP_AUTH=true  # Development mode
```

### Enhanced Architecture Points

#### State Preservation System
- **Smart Merging**: `mergeFileTreePreservingState()` preserves user interactions
- **Background Polling**: 10-second updates without workflow disruption
- **Expanded Folders**: Maintained across all operations
- **Selected Files**: Current selection preserved during updates

#### Failed Test Highlighting
- **File Level**: Direct red "F" indicator for failed test files
- **Directory Level**: Parent directories marked with "F" indicator
- **Complete Path**: Entire directory chain highlighted
- **Git Integration**: Reuses existing git status infrastructure

#### URL Parameter Processing
- **Git Safety**: Unstaged changes check before processing
- **Parameter Types**: `test_path`, `docker_image`, `branch`, `failed_tests[]`
- **Error Handling**: Non-existent files show errors instead of auto-creation
- **State Management**: Failed test highlighting preserved during operations

### Common Development Tasks

#### Adding New Component
1. Create in `src/components/`
2. Import in parent component
3. Add to stores if state needed
4. Update documentation

#### Adding API Endpoint
1. Add route in `server.js`
2. Use `isAuthenticated` middleware
3. Validate user directory access
4. Update API.md documentation

#### Debugging Ask AI
1. Check localStorage keys in browser
2. Monitor `global.interactiveSessions` in Node.js
3. Verify Docker command execution
4. Test session persistence across modal close/open

### Performance Guidelines
- Use `batch_edit` for multiple file changes
- Minimize API polling frequency
- Load WASM diff engine asynchronously
- Clean up intervals and sessions properly

### Security Notes
- All commands run in Docker containers
- File access restricted to user directories
- GitHub tokens handled securely
- Session isolation per user enforced

## File Structure
```
ui/
├── src/
│   ├── components/          # Svelte components
│   │   ├── App.svelte      # Root component
│   │   ├── Header.svelte   # Navigation
│   │   ├── FileExplorer.svelte
│   │   ├── Editor.svelte   # Main editor
│   │   └── InteractiveSession.svelte  # Ask AI
│   ├── stores/             # State management
│   └── config.js           # API configuration
├── server.js               # Express backend
├── doc/                    # This documentation
└── dist/                   # Build output
```

## Getting Help

### Common Issues
1. **Session not persisting** → Check localStorage and background polling
2. **Auth failing** → Verify GitHub OAuth or use SKIP_AUTH=true
3. **File operations failing** → Check user directory permissions
4. **Ask AI not working** → Verify Docker is installed and ASK_AI_COMMAND

### Debugging Tools
- Browser DevTools → localStorage, network, console
- Node.js console → `global.interactiveSessions`, `global.userTokens`
- Test scripts → `./test-session-persistence.sh`, `./test-interactive.sh`

### Key Logs to Monitor
- Session creation/cleanup
- File operation security checks
- Git authentication status
- Docker command execution