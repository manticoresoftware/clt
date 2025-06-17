# CLT UI Documentation Index

## Development Documentation

### 📚 Core Guides
- **[DEVELOPMENT.md](./DEVELOPMENT.md)** - Architecture overview, setup, and critical development notes
- **[COMPONENTS.md](./COMPONENTS.md)** - Detailed component guide with code patterns
- **[API.md](./API.md)** - Backend API reference and endpoint documentation

### 🎯 Feature Documentation
- **[ASK_AI.md](./ASK_AI.md)** - Ask AI interactive session feature with session persistence

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

### Critical Architecture Points

#### State Management
- **filesStore** - File content and test execution
- **authStore** - User authentication and GitHub
- **localStorage** - Session persistence for Ask AI

#### Session Persistence (Ask AI)
- **Active**: `askAI_activeSession` - Running sessions
- **History**: `askAI_sessionHistory` - Completed sessions
- **Polling**: Continues in background when modal closed

#### Authentication Flow
1. GitHub OAuth or skip auth mode
2. User repo cloning to `workdir/{username}`
3. Token-based git operations

#### File Operations
- Restricted to user's `test/clt-tests` directory
- Only `.rec` and `.recb` files supported
- Real-time diff highlighting with WASM

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