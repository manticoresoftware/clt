# API Endpoints Reference

## Configuration

### GET /api/config

Returns application configuration including default docker image.

**Authentication:** Required (session-based)

**Request:**
```bash
curl -X GET http://localhost:3000/api/config \
  --cookie "connect.sid=..." \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "dockerImage": "ghcr.io/manticoresoftware/manticoresearch:test-kit-latest"
}
```

**Status Codes:**
- `200 OK` - Configuration returned successfully
- `401 Unauthorized` - Not authenticated

**Environment Variables:**
- `DOCKER_IMAGE` - Default docker image (optional, falls back to hardcoded default)

**Usage in Frontend:**
```javascript
const response = await fetch(`${API_URL}/api/config`, {
  credentials: 'include'
});
const config = await response.json();
console.log(config.dockerImage); // Default docker image
```

**Added:** 2025-01-11
**Location:** `ui/routes.js`
**Related:** See [DOCKER_IMAGE.md](./DOCKER_IMAGE.md) for full docker image configuration details

## Health Check

### GET /api/health

Health check endpoint for monitoring and authentication verification.

**Authentication:** Required

**Response:**
```json
{
  "status": "ok",
  "authenticated": true,
  "user": "username"
}
```

## File Operations

### GET /api/get-file-tree

Returns hierarchical file tree structure.

**Authentication:** Required

**Response:**
```json
{
  "fileTree": [
    {
      "name": "test.rec",
      "path": "tests/test.rec",
      "isDirectory": false
    }
  ]
}
```

### GET /api/get-file

Retrieves file content with optional WASM parsing for .rec files.

**Authentication:** Required

**Query Parameters:**
- `path` (required) - File path relative to test directory

**Response:**
```json
{
  "content": "raw file content",
  "structuredData": { /* parsed test structure */ },
  "wasmparsed": true
}
```

### POST /api/save-file

Saves file content.

**Authentication:** Required

**Request Body:**
```json
{
  "path": "tests/test.rec",
  "content": "file content",
  "structuredData": { /* optional structured data */ }
}
```

### POST /api/move-file

Moves or renames file/directory.

**Authentication:** Required

**Request Body:**
```json
{
  "sourcePath": "tests/old.rec",
  "targetPath": "tests/new.rec"
}
```

### DELETE /api/delete-file

Deletes file or directory.

**Authentication:** Required

**Request Body:**
```json
{
  "path": "tests/test.rec"
}
```

## Test Execution

### POST /api/start-test

Starts test execution in Docker container.

**Authentication:** Required

**Request Body:**
```json
{
  "filePath": "tests/test.rec",
  "dockerImage": "ghcr.io/manticoresoftware/manticoresearch:test-kit-latest"
}
```

**Response:**
```json
{
  "jobId": "uuid",
  "timeout": 30000
}
```

### GET /api/poll-test/:jobId

Polls test execution status.

**Authentication:** Required

**Response:**
```json
{
  "running": false,
  "finished": true,
  "exitCode": 0,
  "success": true,
  "testStructure": { /* enriched with results */ }
}
```

### POST /api/stop-test/:jobId

Stops running test.

**Authentication:** Required

**Response:**
```json
{
  "message": "Test stopped successfully"
}
```

## Git Operations

### GET /api/git-status

Returns current git repository status.

**Authentication:** Required

**Response:**
```json
{
  "currentBranch": "main",
  "hasChanges": false,
  "isPrBranch": false,
  "repoUrl": "https://github.com/user/repo"
}
```

### GET /api/current-branch

Returns current branch information.

**Authentication:** Required

**Response:**
```json
{
  "currentBranch": "main",
  "defaultBranch": "master"
}
```

### POST /api/reset-to-branch

Resets repository to specified branch.

**Authentication:** Required

**Request Body:**
```json
{
  "branch": "main"
}
```

## Authentication

### GET /auth/github

Initiates GitHub OAuth flow.

**Redirect:** GitHub OAuth authorization page

### GET /auth/github/callback

GitHub OAuth callback handler.

**Redirect:** Frontend URL with success/failure

### GET /api/current-user

Returns current authenticated user.

**Response:**
```json
{
  "username": "user",
  "displayName": "User Name",
  "avatarUrl": "https://..."
}
```

### GET /logout

Logs out current user.

**Redirect:** Frontend URL

## Interactive Sessions (Ask AI)

### POST /api/interactive/start

Starts interactive AI session.

**Authentication:** Required

**Request Body:**
```json
{
  "sessionName": "optional-name"
}
```

### POST /api/interactive/:sessionId/input

Sends input to interactive session.

**Authentication:** Required

**Request Body:**
```json
{
  "input": "user input text"
}
```

### POST /api/interactive/:sessionId/stop

Stops interactive session.

**Authentication:** Required

### GET /api/interactive/sessions

Lists available session logs.

**Authentication:** Required

### GET /api/interactive/session/:sessionId

Retrieves session log content.

**Authentication:** Required

---

**Note:** All endpoints require authentication via session cookies except the OAuth flow endpoints.
