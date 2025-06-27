# CLT UI - URL Parameter System

## Overview

CLT UI supports a comprehensive URL parameter system for deep linking, automated workflows, and CI/CD integration. The system includes Git safety features and state preservation.

## Supported Parameters

### `test_path`
**Purpose**: Auto-open specific test file
**Type**: String
**Example**: `?test_path=core/show-threads.rec`

```bash
# Open specific test file
http://localhost:9151/?test_path=buddy/test-buddy.rec

# Open nested test file
http://localhost:9151/?test_path=integration/auth/login.rec
```

### `docker_image`
**Purpose**: Set Docker image for test execution
**Type**: String
**Example**: `?docker_image=manticore:dev`

```bash
# Set custom Docker image
http://localhost:9151/?docker_image=ghcr.io/manticoresoftware/manticoresearch:test-kit-latest

# Use local image
http://localhost:9151/?docker_image=my-local-image:latest
```

### `branch`
**Purpose**: Auto-checkout and pull specified branch
**Type**: String
**Example**: `?branch=feature-branch`
**Safety**: Checks for unstaged changes before proceeding

```bash
# Switch to feature branch
http://localhost:9151/?branch=feature-auth-fixes

# Switch to main branch
http://localhost:9151/?branch=main
```

### `failed_tests[]`
**Purpose**: Highlight failed tests with red "F" indicator
**Type**: Array of strings
**Example**: `?failed_tests[]=test1.rec&failed_tests[]=test2.rec`

```bash
# Highlight single failed test
http://localhost:9151/?failed_tests[]=core/test-error.rec

# Highlight multiple failed tests
http://localhost:9151/?failed_tests[]=core/test1.rec&failed_tests[]=api/test2.rec&failed_tests[]=integration/test3.rec
```

## Combined Examples

### Development Workflow
```bash
# Open specific test with custom Docker image
http://localhost:9151/?test_path=buddy/test-buddy.rec&docker_image=manticore:dev
```

### CI/CD Integration
```bash
# Switch branch and highlight failed tests from CI
http://localhost:9151/?branch=feature-fixes&failed_tests[]=core/test1.rec&failed_tests[]=api/test2.rec
```

### Complete Workflow URL
```bash
# Full workflow: branch + file + image + failed tests
http://localhost:9151/?test_path=integration/auth.rec&branch=auth-fixes&docker_image=test:latest&failed_tests[]=integration/auth.rec&failed_tests[]=core/auth-helper.rec
```

## Git Safety Features

### Unstaged Changes Detection

When URL parameters include git-affecting operations (`branch` or `test_path`), the system automatically checks for unstaged changes:

**Detection Triggers:**
- `branch` parameter (any branch switching)
- `test_path` parameter (file operations)

**User Dialog:**
```
You have unstaged changes in your repository.

Proceeding will potentially modify your working directory when switching branches or pulling changes.

Do you want to continue?

• Click "OK" to continue (your changes may be affected)
• Click "Cancel" to ignore URL parameters and keep current state
```

**Behavior:**
- **User clicks "OK"**: Proceeds with all URL parameters
- **User clicks "Cancel"**: Clears ALL URL parameters, maintains current state
- **Safe operations continue**: `failed_tests[]` highlighting still works (doesn't affect git state)

### Error Handling

**Non-existent Files:**
```bash
# If file doesn't exist
http://localhost:9151/?test_path=non-existent-file.rec
# Result: Shows error dialog, clears URL parameters
```

**Invalid Branch:**
```bash
# If branch doesn't exist
http://localhost:9151/?branch=non-existent-branch
# Result: Shows error message, maintains current branch
```

## Implementation Details

### URL Parsing
```typescript
function parseUrlParams(): {
  filePath?: string;
  dockerImage?: string;
  branch?: string;
  failedTests?: string[];
} {
  const params = new URLSearchParams(window.location.search);
  
  return {
    filePath: params.get('test_path') || undefined,
    dockerImage: params.get('docker_image') || undefined,
    branch: params.get('branch') || undefined,
    failedTests: params.getAll('failed_tests[]')
  };
}
```

### Safety Check Integration
```typescript
// Check for git-affecting parameters
const hasGitAffectingParams = urlParams.branch || urlParams.filePath;
if (hasGitAffectingParams) {
  const canProceed = await checkUnstagedChanges();
  if (!canProceed) {
    // Clear URL parameters and stop processing
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url.toString());
    return;
  }
}
```

### Failed Test Highlighting
```typescript
function isDirWithFailedTests(dirPath: string): boolean {
  for (const failedTest of failedTestPaths) {
    if (failedTest.startsWith(dirPath + '/')) {
      return true;
    }
  }
  return false;
}
```

## State Preservation

### File Tree State
- **Expanded folders**: Maintained across URL parameter processing
- **Selected files**: Current selection preserved
- **Background polling**: Continues without disruption

### URL Updates
- **Dynamic changes**: URL parameters can be updated without page reload
- **History management**: Proper browser history integration
- **State consistency**: UI state always matches URL parameters

## Best Practices

### For CI/CD Integration
1. **Always URL-encode file paths**: Use `encodeURIComponent()` for file paths with special characters
2. **Check git state**: Ensure clean working directory before using branch parameters
3. **Batch failed tests**: Include all failed tests in single URL for complete overview
4. **Use absolute URLs**: Include full domain for reliable linking

### For Development
1. **Test with unstaged changes**: Verify safety dialogs work correctly
2. **Verify state preservation**: Ensure user interactions aren't disrupted
3. **Check error handling**: Test with non-existent files and branches
4. **Validate highlighting**: Confirm failed test indicators appear correctly

### URL Encoding Examples
```bash
# File with spaces or special characters
test_path=core%2Fshow-threads.rec  # core/show-threads.rec

# Multiple failed tests
failed_tests[]=test%20with%20spaces.rec&failed_tests[]=core%2Fnested%2Ftest.rec
```

## Security Considerations

### Path Validation
- All file paths are validated against user's allowed directory
- Path traversal attacks (`../`) are prevented
- Only `.rec` and `.recb` files are accessible

### Git Operations
- All git operations require authentication
- Users can only access their own repository clone
- Branch operations are limited to user's permissions

### Parameter Sanitization
- All URL parameters are properly decoded and validated
- Malicious input is rejected with appropriate error messages
- Git commands are executed with proper escaping