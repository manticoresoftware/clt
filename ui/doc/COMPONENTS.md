# CLT UI Components Guide

## Core Components Overview

### App.svelte
**Purpose**: Root application component with authentication management
**Key Features**:
- Authentication state management and periodic checks
- Loading states and error handling
- Auth-required vs skip-auth modes
- Branch info fetching after authentication

**Critical Code**:
```javascript
// Periodic auth check every 60 seconds
const authCheckInterval = setInterval(async () => {
  if ($authStore.isAuthenticated) {
    const result = await fetch(`${API_URL}/api/health`);
    // Refresh auth state if needed
  }
}, 60000);
```

### Header.svelte
**Purpose**: Navigation bar with main action buttons
**Key Features**:
- Ask AI button (opens interactive session)
- Create PR button (enabled when git changes detected)
- User profile and logout
- Docker image configuration input

**Critical Code**:
```javascript
// Git status checking every 10 seconds
const interval = setInterval(checkGitStatus, 10000);

// Ask AI modal opening
function openInteractiveSession() {
  interactiveSession?.openSession();
}
```

### FileExplorer.svelte
**Purpose**: File tree navigation and management
**Key Features**:
- Recursive file tree building with symlink support
- File operations (create, delete, rename, move)
- Drag & drop functionality
- File filtering (.rec and .recb files only)

**Critical Code**:
```javascript
// File tree API call
const response = await fetch(`${API_URL}/api/get-file-tree`);
// Only shows .rec and .recb files
if (entry.name.endsWith('.rec') || entry.name.endsWith('.recb'))
```

### Editor.svelte
**Purpose**: Main editing interface for CLT test files
**Key Features**:
- Command/output pair editing
- Real-time WASM diff highlighting
- Auto-save functionality
- Test execution with live results
- Block references and comments support

**Critical Code**:
```javascript
// WASM diff highlighting
async function highlightDifferences(actual: string, expected: string) {
  const diffResult = JSON.parse(patternMatcher.diff_text(expected, actual));
  // Renders git-style diff with highlighting
}

// Auto-save on changes
filesStore.updateCommand(i, newValue);
```

### InteractiveSession.svelte (Ask AI)
**Purpose**: Interactive command execution with session persistence
**Key Features**:
- Real-time command output streaming
- Session persistence across modal close/open
- Background polling continuation
- localStorage-based state management

**Critical Code**:
```javascript
// Session persistence
function saveActiveSession(sessionId: string, command: string) {
  localStorage.setItem('askAI_activeSession', JSON.stringify({
    sessionId, command, timestamp: new Date().toISOString()
  }));
}

// Background polling (continues when modal closed)
pollingInterval = setInterval(async () => {
  const data = await fetch(`/api/interactive/status/${sessionId}`);
  logs = data.logs;
}, 1000);
```

## State Management (Stores)

### filesStore.ts
**Purpose**: File content and test execution state
**Key State**:
- `currentFile` - Currently edited file with commands
- `running` - Test execution status
- `saving` - File save status
- `dockerImage` - Docker image for test execution

### authStore.ts
**Purpose**: User authentication and GitHub integration
**Key State**:
- `isAuthenticated` - Auth status
- `user` - User profile data
- `skipAuth` - Development mode flag
- `token` - GitHub access token

### githubStore.ts
**Purpose**: Pull request creation modal
**Key State**:
- `showModal` - Modal visibility
- `success` - PR creation success
- `prUrl` - Created PR URL

### branchStore.ts
**Purpose**: Git branch information
**Key State**:
- `currentBranch` - Current git branch
- `defaultBranch` - Repository default branch

## Component Communication Patterns

### Parent-Child Props
```svelte
<!-- Parent passes data down -->
<ChildComponent bind:this={componentRef} />

<!-- Child exposes methods -->
export function openSession() { ... }
```

### Store Subscriptions
```javascript
// Reactive store subscriptions
$: commands = $filesStore.currentFile ? $filesStore.currentFile.commands : [];
```

### Event Handling
```javascript
// File operations
filesStore.addCommand(index, text, type);
filesStore.updateCommand(index, newValue);
filesStore.deleteCommand(index);
```

## Performance Optimizations

### Batch Operations
- Use `batch_edit` for multiple file changes
- Minimize individual API calls

### Efficient Polling
- Ask AI polls every 1 second only when active
- Git status checks every 10 seconds
- Auth checks every 60 seconds

### WASM Loading
- Diff engine loads asynchronously
- Graceful fallback to plain text
- Pattern caching for performance

## Common Development Patterns

### Error Handling
```javascript
try {
  const result = await apiCall();
  // Handle success
} catch (error) {
  console.error('Operation failed:', error);
  // Show user-friendly error
}
```

### Async UI Updates
```javascript
// Use setTimeout to avoid reactive update cycles
setTimeout(() => {
  filesStore.updateCommand(i, newValue);
}, 0);
```

### localStorage Management
```javascript
// Always wrap in try-catch
try {
  localStorage.setItem(key, JSON.stringify(data));
} catch (err) {
  console.warn('localStorage failed:', err);
}
```