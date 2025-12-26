# Docker Image Configuration

## Overview

The CLT UI supports flexible Docker image configuration with a priority-based system that allows defaults, file-specific images, URL parameters, and user overrides.

## Priority System

The docker image is determined by the following priority (highest to lowest):

1. **User Input** - Manual entry in the UI input field (highest priority)
2. **URL Parameter** - `?docker_image=custom:tag` in the URL
3. **File Metadata** - `Docker image: <value>` in the test file
4. **Environment Variable** - `DOCKER_IMAGE` env variable
5. **Hardcoded Default** - `ghcr.io/manticoresoftware/manticoresearch:test-kit-latest`

## Configuration Methods

### 1. Environment Variable (Recommended)

Set the default docker image via environment variable:

```bash
# In .env file or environment
DOCKER_IMAGE=ghcr.io/myorg/myimage:latest
```

The backend exposes this via `/api/config` endpoint:

```javascript
GET /api/config
Response: { "dockerImage": "ghcr.io/myorg/myimage:latest" }
```

### 2. File Metadata

Add docker image specification in your `.rec` test file:

```
Docker image: custom-image:tag

––– input –––
echo "test"
––– output –––
test
```

**Rules:**
- Case-insensitive: `docker image:`, `Docker Image:`, `DOCKER IMAGE:` all work
- Must appear before first `––– input –––` marker
- Can be in description field (if parsed) or raw content
- Extracted via regex: `/docker\s+image:\s*(.+)/i`

### 3. URL Parameter

Pass docker image via URL when linking to tests:

```
http://localhost:9151/?docker_image=custom:tag
http://localhost:9151/?test_path=test.rec&docker_image=custom:tag
```

**Use case:** GitHub Actions can pass custom images when linking to failed tests.

### 4. User Input

Users can manually type or clear the docker image in the UI header input field:

- **Empty input** = Use file metadata or default (placeholder shows default)
- **Typed value** = Override everything (highest priority)
- **Clear input** = Remove override, fall back to file/default

## Implementation Details

### Backend (`ui/routes.js`)

```javascript
// Config endpoint returns default docker image
app.get('/api/config', isAuthenticated, (req, res) => {
  return res.json({
    dockerImage: process.env.DOCKER_IMAGE || 'ghcr.io/manticoresoftware/manticoresearch:test-kit-latest'
  });
});
```

### Store (`ui/src/stores/filesStore.ts`)

```typescript
// Default docker image (mutable, updated from backend)
let DEFAULT_DOCKER_IMAGE = 'ghcr.io/manticoresoftware/manticoresearch:test-kit-latest';

interface FilesState {
  dockerImage: string;           // Effective image used for running tests
  userDockerImage: string | null; // User's explicit input (null = no override)
  currentFile: RecordingFile | null;
}

interface RecordingFile {
  fileDockerImage?: string | null; // Docker image from file metadata
}

// Extract docker image from file content
const extractDockerImageFromFile = (testStructure, rawContent) => {
  // Search in description or raw content before first ––– input –––
  const match = content.match(/docker\s+image:\s*(.+)/i);
  return match ? match[1].trim() : null;
};

// Get effective docker image based on priority
const getEffectiveDockerImage = (state: FilesState): string => {
  if (state.userDockerImage && state.userDockerImage.trim() !== '') {
    return state.userDockerImage; // User override
  }
  if (state.currentFile?.fileDockerImage) {
    return state.currentFile.fileDockerImage; // File metadata
  }
  return DEFAULT_DOCKER_IMAGE; // Default from env or hardcoded
};
```

### Header Component (`ui/src/components/Header.svelte`)

```svelte
<script>
  let dockerImage = ''; // Empty by default
  let defaultImage = 'ghcr.io/...'; // Loaded from /api/config
  
  // Sync input with store
  $: {
    if ($filesStore.userDockerImage !== null) {
      dockerImage = $filesStore.userDockerImage; // Show user input
    } else if ($filesStore.currentFile?.fileDockerImage) {
      dockerImage = $filesStore.currentFile.fileDockerImage; // Show file image
    } else {
      dockerImage = ''; // Empty = use default
    }
  }
  
  // Load default from backend
  async function loadDefaultImage() {
    const response = await fetch(`${API_URL}/api/config`);
    const config = await response.json();
    defaultImage = config.dockerImage;
  }
  
  onMount(() => {
    loadDefaultImage();
  });
</script>

<input
  type="text"
  placeholder={defaultImage}
  bind:value={dockerImage}
  on:blur={updateDockerImage}
/>
```

### URL Parameter Handling (`ui/src/components/FileExplorer.svelte`)

```javascript
async function handleUrlChange() {
  const urlParams = parseUrlParams();
  
  // Set docker image from URL parameter
  if (urlParams.dockerImage) {
    filesStore.setDockerImage(urlParams.dockerImage);
  }
}
```

## User Experience

### Empty Input Field
- **What user sees:** Empty input with placeholder showing default image
- **What happens:** Tests run with file metadata image or default
- **Benefit:** Clean UI, clear indication of what will be used

### URL Parameter
- **What user sees:** Input field populated with URL parameter value
- **What happens:** Tests run with URL-specified image
- **Benefit:** GitHub Actions can specify custom images for CI runs

### File Metadata
- **What user sees:** Input field shows file's docker image
- **What happens:** Tests run with file-specified image
- **Benefit:** Per-test customization without manual input

### User Override
- **What user sees:** Their typed value in input field
- **What happens:** Tests run with user-specified image
- **Benefit:** Quick testing with different images

## Testing Scenarios

1. **Fresh load, no file**
   - Input: Empty
   - Placeholder: Default from env
   - Runs with: Default

2. **Load file with "Docker image: custom:tag"**
   - Input: Shows "custom:tag"
   - Runs with: custom:tag

3. **User types "override:latest"**
   - Input: Shows "override:latest"
   - Runs with: override:latest

4. **User clears input**
   - Input: Empty
   - Runs with: File image or default

5. **URL: ?docker_image=url:tag**
   - Input: Shows "url:tag"
   - Runs with: url:tag

## Troubleshooting

### Input field shows image but I didn't enter it
- Check if URL has `?docker_image=...` parameter
- Check if file contains `Docker image: ...` metadata
- This is expected behavior - showing what will be used

### Clearing input doesn't work
- Make sure to blur the input (click outside or press Tab)
- Check browser console for errors
- Verify `/api/config` endpoint is accessible

### Default image not from environment
- Verify `DOCKER_IMAGE` is set in `.env` file
- Restart backend server after changing `.env`
- Check backend logs for config loading

### URL parameter not working
- Ensure parameter name is `docker_image` (underscore, not dash)
- Check browser console for URL parsing
- Verify FileExplorer component is mounted

## API Reference

### GET /api/config

Returns configuration including default docker image.

**Authentication:** Required

**Response:**
```json
{
  "dockerImage": "ghcr.io/manticoresoftware/manticoresearch:test-kit-latest"
}
```

**Usage:**
```javascript
const response = await fetch('/api/config', { credentials: 'include' });
const config = await response.json();
console.log(config.dockerImage);
```

## Migration Notes

### From Hardcoded Default

**Before:**
```typescript
dockerImage: 'ghcr.io/manticoresoftware/manticoresearch:test-kit-latest'
```

**After:**
```bash
# Set in .env
DOCKER_IMAGE=ghcr.io/manticoresoftware/manticoresearch:test-kit-latest
```

### From Always-Filled Input

**Before:** Input always showed current docker image

**After:** Input is empty unless explicitly set by user/URL/file

**Benefit:** Clearer UX - empty = default, filled = override
