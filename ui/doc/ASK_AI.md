# Ask AI Feature

## Overview

The Ask AI feature provides an interactive session interface that allows users to run commands and see live output. This feature supports session persistence and only allows one request per logged-in user at a time.

## How It Works

1. **User Interface**: Click the "Ask AI" button in the header to open the interactive session modal
2. **Input**: Enter your command or question in the text area
3. **Execution**: The command is sent to a configurable backend process
4. **Live Output**: See real-time logs as the command executes
5. **History**: View the output from the last completed command
6. **Session Management**: Only one session per user is allowed at a time

## Configuration

The interactive session is configured entirely through environment variables:

### Required Environment Variables

```bash
# Command to execute - receives user input via stdin
ASK_AI_COMMAND="docker run --rm -i ubuntu:latest bash -c \"echo 'Input received:'; cat; echo '\nSleeping for 2 seconds...'; sleep 2; echo 'Done!'\""

# Timeout for commands in milliseconds (default: 30000 = 30 seconds)
ASK_AI_TIMEOUT=30000
```

### Example Configurations

#### Simple Echo Command
```bash
ASK_AI_COMMAND="docker run --rm -i ubuntu:latest bash -c \"echo 'You said:'; cat\""
```

#### Python Script Runner
```bash
ASK_AI_COMMAND="docker run --rm -i python:3.9-slim python3 -c \"import sys; exec(sys.stdin.read())\""
```

#### Custom AI Integration
```bash
ASK_AI_COMMAND="docker run --rm -i your-ai-image:latest /app/process-input.sh"
```

## Features

- **Live Output Streaming**: Real-time display of command output
- **Session Management**: One active session per user
- **Persistent History**: Session history stored in localStorage and restored when reopening
- **Command Restoration**: Last command is automatically restored in the input field
- **Timeout Protection**: Commands automatically timeout after configured duration
- **History Management**: View last command, output, and execution time with clear history option
- **Error Handling**: Displays clear error messages for failed commands
- **Cancellation**: Users can cancel running commands
- **Polling-Based**: Uses efficient polling instead of WebSockets

## Session Persistence

The Ask AI feature includes persistent session history using browser localStorage:

### What Gets Stored
- **Last Command**: The command that was executed
- **Output**: Complete output from the last command execution
- **Timestamp**: When the command was executed
- **Automatic Restoration**: History is automatically loaded when reopening the modal

### Storage Management
- **Automatic Save**: Session data is saved automatically when a command completes
- **Manual Clear**: Users can clear history using the trash icon in the history section
- **Browser Storage**: Data is stored locally in the browser and persists across sessions
- **No Server Storage**: Session history is only stored locally for privacy

### User Experience
- **Seamless Continuation**: Close and reopen the modal without losing your last session
- **Command Restoration**: Last command is automatically filled in the input field
- **Timestamp Display**: See when your last command was executed
- **Easy Cleanup**: One-click history clearing when needed

## Security Considerations

- Commands are executed in isolated Docker containers
- User input is passed via stdin only
- Sessions are automatically cleaned up after completion
- Timeout protection prevents long-running processes
- User authentication is required

## Testing

Run the test script to verify the feature works:

```bash
./test-interactive.sh
```

## API Endpoints

### Start Session
- **POST** `/api/interactive/start`
- **Body**: `{ "input": "user command or question" }`
- **Response**: `{ "sessionId": "unique-session-id", "status": "started" }`

### Check Status
- **GET** `/api/interactive/status/:sessionId`
- **Response**: Session status with logs and completion info

### Cancel Session
- **POST** `/api/interactive/cancel/:sessionId`
- **Response**: `{ "status": "cancelled" }`

## Implementation Details

- Backend uses Node.js child_process to spawn commands
- Frontend polls every 1 second for updates
- Sessions are stored in memory with automatic cleanup
- Docker is used for command isolation and security
- Supports any command that can read from stdin

## Troubleshooting

### "Failed to start command" Error
- Check that Docker is installed and running
- Verify the ASK_AI_COMMAND environment variable is set correctly
- Ensure the command can read from stdin

### Command Timeout
- Increase ASK_AI_TIMEOUT value
- Optimize your command for faster execution
- Check Docker container startup time

### No Output Displayed
- Verify your command writes to stdout
- Check that the command doesn't buffer output
- Ensure proper error handling in your command