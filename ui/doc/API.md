# CLT UI Backend API Reference

## Core Endpoints

### File Management

#### GET `/api/get-file-tree`
**Purpose**: Get file tree for file explorer
**Auth**: Required
**Response**: Recursive file tree with .rec/.recb files only
```json
{
  "fileTree": [
    {
      "name": "test.rec",
      "path": "test.rec",
      "isDirectory": false,
      "isSymlink": false
    }
  ]
}
```

#### GET `/api/get-file?path=<filepath>`
**Purpose**: Get file content for editing
**Auth**: Required
**Response**: File content as text
```json
{
  "content": "––– input –––\necho hello\n––– output –––\nhello"
}
```

#### POST `/api/save-file`
**Purpose**: Save file changes
**Auth**: Required
**Body**: `{ "path": "test.rec", "content": "file content" }`

### Test Execution

#### POST `/api/run-test`
**Purpose**: Execute CLT test with optional Docker image
**Auth**: Required
**Body**: `{ "filePath": "test.rec", "dockerImage": "ubuntu:latest" }`
**Response**: Test results with command statuses and outputs

### Ask AI Interactive Sessions

#### POST `/api/interactive/start`
**Purpose**: Start new interactive command session
**Auth**: Required
**Body**: `{ "input": "user command" }`
**Limitation**: One session per user
**Response**: `{ "sessionId": "unique-id", "status": "started" }`

#### GET `/api/interactive/status/:sessionId`
**Purpose**: Poll session status and get live logs
**Auth**: Required
**Response**: 
```json
{
  "sessionId": "unique-id",
  "running": true,
  "completed": false,
  "logs": ["output line 1", "output line 2"],
  "output": "final output when completed",
  "exitCode": 0
}
```

#### POST `/api/interactive/cancel/:sessionId`
**Purpose**: Cancel running session
**Auth**: Required
**Response**: `{ "status": "cancelled" }`

### Git Operations

#### GET `/api/git-status`
**Purpose**: Get git status for PR button state
**Auth**: Required
**Response**: Modified files and change detection

#### POST `/api/commit-changes`
**Purpose**: Commit changes and optionally create PR
**Auth**: Required
**Body**: `{ "title": "commit message", "description": "PR body", "createPr": true }`

#### GET `/api/current-branch`
**Purpose**: Get current git branch info
**Auth**: Required

#### POST `/api/reset-to-branch`
**Purpose**: Reset to specific branch
**Auth**: Required
**Body**: `{ "branch": "main" }`

## Authentication & Session Management

### Authentication Middleware
```javascript
function isAuthenticated(req, res, next) {
  if (authConfig.skipAuth || req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}
```

### User Repository Setup
- Each user gets isolated directory: `workdir/{username}`
- Repository cloned with user's GitHub token
- Git operations use authenticated URLs

### Session Storage
- **Active sessions**: `global.interactiveSessions[username]`
- **User tokens**: `global.userTokens[username]`
- **Auto cleanup**: Sessions cleaned after 5 minutes

## Environment Configuration

### Required Variables
```bash
# Server
BACKEND_PORT=9150
HOST=localhost

# Ask AI
ASK_AI_COMMAND="docker run --rm -i ubuntu:latest bash -c 'echo Input:; cat; sleep 2'"
ASK_AI_TIMEOUT=30000

# GitHub OAuth
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_secret
SKIP_AUTH=true  # Development mode
```

### Security Features
- CORS configured for frontend URL
- Session-based authentication
- File access restricted to user directories
- Docker command isolation
- Timeout protection for long-running commands

## Error Handling Patterns

### Standard Error Response
```json
{
  "error": "Descriptive error message",
  "details": "Additional context if available"
}
```

### Common Status Codes
- `200` - Success
- `400` - Bad request (missing parameters)
- `401` - Authentication required
- `403` - Access denied (file outside user directory)
- `404` - Resource not found
- `409` - Conflict (session already running)
- `500` - Server error

## Performance Considerations

### Session Management
- One active session per user enforced
- Background process cleanup after completion
- Memory-based storage (no database required)

### File Operations
- Path validation for security
- Recursive directory creation
- Symlink support with target resolution

### Git Operations
- Token-based authentication for private repos
- Remote URL rewriting for user tokens
- Branch tracking and status monitoring

## Development Tips

### Testing API Endpoints
```bash
# Test with curl
curl -X POST http://localhost:9150/api/interactive/start \
  -H "Content-Type: application/json" \
  -d '{"input":"echo hello"}' \
  --cookie-jar cookies.txt

# Poll status
curl http://localhost:9150/api/interactive/status/session-id \
  --cookie cookies.txt
```

### Debugging Sessions
- Check `global.interactiveSessions` in Node.js console
- Monitor process spawning and cleanup
- Verify localStorage persistence on frontend

### Common Issues
- **Session conflicts**: Only one session per user allowed
- **File access**: Paths must be within user's test directory
- **Git authentication**: Requires valid GitHub token
- **Docker availability**: Ask AI commands need Docker installed