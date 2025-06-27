<script lang="ts">
  import { githubStore } from '../stores/githubStore';
  import { gitStatusStore } from '../stores/gitStatusStore';

  // Store subscriptions
  $: github = $githubStore;
  $: gitStatus = $gitStatusStore;

  // Form state
  let title = '';
  let description = '';
  let showAdvanced = false;

  // Workflow detection - only commit mode if we have an actual existing PR
  $: prStatus = github.prStatus;
  $: existingPr = prStatus?.existingPr;
  // Show commit mode ONLY if we have an existing PR (regardless of branch name)
  $: isCommitMode = !!(existingPr);
  $: recentCommits = prStatus?.recentCommits || [];

  // Debug logging
  $: if (prStatus) {
    console.log('PR Status:', {
      isPrBranch: prStatus.isPrBranch,
      existingPr: existingPr,
      isCommitMode: isCommitMode,
      currentBranch: prStatus.currentBranch
    });
  }

  // Validation
  $: isValidTitle = title.trim().length >= 3;
  $: isValidDescription = isCommitMode || description.trim().length >= 10; // Require description for PR creation
  $: canSubmit = isValidTitle && isValidDescription && !github.isCreating && !github.isCommitting && gitStatus.hasChanges;
  $: isLoading = github.isCreating || github.isCommitting || github.isLoadingStatus;

  // Auto-generate title and description based on changes and mode (only once when modal opens)
  let titleGenerated = false;
  let descriptionGenerated = false;

  $: if (gitStatus.modifiedFiles.length > 0 && !title && !isCommitMode && !titleGenerated) {
    title = generateTitle(gitStatus.modifiedFiles, gitStatus.modifiedDirs);
    titleGenerated = true;
  }

  $: if (gitStatus.modifiedFiles.length > 0 && !description && !isCommitMode && !descriptionGenerated) {
    description = generateDescription(gitStatus.modifiedFiles, gitStatus.modifiedDirs);
    descriptionGenerated = true;
  }

  // For commit mode, only generate title (commit message) once
  $: if (gitStatus.modifiedFiles.length > 0 && !title && isCommitMode && !titleGenerated) {
    title = generateCommitMessage(gitStatus.modifiedFiles, gitStatus.modifiedDirs);
    titleGenerated = true;
  }

  // Reset generation flags when modal closes
  $: if (!github.showModal) {
    titleGenerated = false;
    descriptionGenerated = false;
  }

  function generateTitle(files, dirs) {
    const addedFiles = files.filter(f => f.status === '??').length;
    const modifiedFiles = files.filter(f => f.status === 'M').length;
    const deletedFiles = files.filter(f => f.status === 'D').length;

    const mainDir = dirs[0] || 'files';
    const baseName = mainDir.split('/').pop() || mainDir;

    if (files.length === 1) {
      const file = files[0];
      const fileName = file.path.split('/').pop().replace('.rec', '');
      if (file.status === '??') {
        return `Add test: ${fileName}`;
      } else if (file.status === 'M') {
        return `Update test: ${fileName}`;
      } else if (file.status === 'D') {
        return `Remove test: ${fileName}`;
      }
    }

    if (addedFiles > 0 && modifiedFiles === 0 && deletedFiles === 0) {
      return `Add ${addedFiles} test${addedFiles > 1 ? 's' : ''} in ${baseName}`;
    } else if (modifiedFiles > 0 && addedFiles === 0 && deletedFiles === 0) {
      return `Update ${modifiedFiles} test${modifiedFiles > 1 ? 's' : ''} in ${baseName}`;
    } else if (deletedFiles > 0 && addedFiles === 0 && modifiedFiles === 0) {
      return `Remove ${deletedFiles} test${deletedFiles > 1 ? 's' : ''} from ${baseName}`;
    } else {
      // Mixed changes
      const parts = [];
      if (addedFiles > 0) parts.push(`${addedFiles} added`);
      if (modifiedFiles > 0) parts.push(`${modifiedFiles} modified`);
      if (deletedFiles > 0) parts.push(`${deletedFiles} removed`);
      return `Update tests in ${baseName} (${parts.join(', ')})`;
    }
  }

  function generateCommitMessage(files, dirs) {
    // Simpler commit messages
    const addedFiles = files.filter(f => f.status === '??').length;
    const modifiedFiles = files.filter(f => f.status === 'M').length;
    const deletedFiles = files.filter(f => f.status === 'D').length;

    if (files.length === 1) {
      const file = files[0];
      const fileName = file.path.split('/').pop();
      if (file.status === '??') {
        return `Add ${fileName}`;
      } else if (file.status === 'M') {
        return `Update ${fileName}`;
      } else if (file.status === 'D') {
        return `Remove ${fileName}`;
      }
    }

    const totalFiles = files.length;
    if (addedFiles > 0 && modifiedFiles === 0) {
      return `Add ${addedFiles} file${addedFiles > 1 ? 's' : ''}`;
    } else if (modifiedFiles > 0 && addedFiles === 0) {
      return `Update ${modifiedFiles} file${modifiedFiles > 1 ? 's' : ''}`;
    } else {
      return `Update ${totalFiles} file${totalFiles > 1 ? 's' : ''}`;
    }
  }

  function generateDescription(files, dirs) {
    const byDirectory = {};
    const addedFiles = [];
    const modifiedFiles = [];
    const deletedFiles = [];

    // Organize files by directory and status
    files.forEach(file => {
      const dir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '.';
      if (!byDirectory[dir]) byDirectory[dir] = [];
      byDirectory[dir].push(file);

      if (file.status === '??') addedFiles.push(file);
      else if (file.status === 'M') modifiedFiles.push(file);
      else if (file.status === 'D') deletedFiles.push(file);
    });

    let description = '';

    // Summary
    const parts = [];
    if (addedFiles.length > 0) parts.push(`${addedFiles.length} added`);
    if (modifiedFiles.length > 0) parts.push(`${modifiedFiles.length} modified`);
    if (deletedFiles.length > 0) parts.push(`${deletedFiles.length} deleted`);

    description += `## Summary\n${parts.join(', ')} files\n\n`;

    // Changes by status
    if (addedFiles.length > 0) {
      description += `## Added Files\n`;
      addedFiles.forEach(file => {
        const fileName = file.path.split('/').pop();
        description += `- \`${fileName}\` - New test file\n`;
      });
      description += '\n';
    }

    if (modifiedFiles.length > 0) {
      description += `## Modified Files\n`;
      modifiedFiles.forEach(file => {
        const fileName = file.path.split('/').pop();
        description += `- \`${fileName}\` - Updated test\n`;
      });
      description += '\n';
    }

    if (deletedFiles.length > 0) {
      description += `## Removed Files\n`;
      deletedFiles.forEach(file => {
        const fileName = file.path.split('/').pop();
        description += `- \`${fileName}\` - Removed test\n`;
      });
      description += '\n';
    }

    // Directory breakdown if multiple directories
    const dirCount = Object.keys(byDirectory).length;
    if (dirCount > 1) {
      description += `## Changes by Directory\n`;
      Object.entries(byDirectory).forEach(([dir, dirFiles]) => {
        const dirName = dir === '.' ? 'root' : dir;
        description += `- **${dirName}**: ${dirFiles.length} file${dirFiles.length > 1 ? 's' : ''}\n`;
      });
      description += '\n';
    }

    description += `---\n*Auto-generated from CLT UI*`;

    return description;
  }

  function handleSubmit() {
    if (!canSubmit) return;

    if (isCommitMode) {
      // Commit to existing PR
      githubStore.commitChanges(title.trim())
        .then(() => {
          // Success handled by store - DO NOT auto-close modal
          // User can see the success message and PR link
        })
        .catch(error => {
          console.error('Commit failed:', error);
          // Error handled by store
        });
    } else {
      // Create new PR
      githubStore.createPullRequest(title.trim(), description.trim())
        .then(() => {
          // Success handled by store - DO NOT auto-close modal
          // User can see the success message and PR link
          // Refresh PR status to switch to commit mode
          setTimeout(() => {
            githubStore.fetchPrStatus();
          }, 1000);
        })
        .catch(error => {
          console.error('PR creation failed:', error);
          // Error handled by store
        });
    }
  }

  function handleCancel() {
    githubStore.hideModal();
    // Reset form when closing
    title = '';
    description = '';
    titleGenerated = false;
    descriptionGenerated = false;
    successProcessed = false;
  }

  // Refresh git status when modal opens (only once)
  let modalInitialized = false;
  $: if (github.showModal && !modalInitialized) {
    gitStatusStore.fetchGitStatus();
    githubStore.fetchPrStatus(); // Also fetch PR status when modal opens
    modalInitialized = true;
  } else if (!github.showModal) {
    modalInitialized = false;
  }

  // Watch for successful PR creation and refresh PR status (only once)
  let successProcessed = false;
  $: if (github.success && !github.isCommitting && !github.isCreating && !successProcessed) {
    // PR was just created successfully, refresh status after a short delay
    successProcessed = true;
    setTimeout(() => {
      githubStore.fetchPrStatus();
      gitStatusStore.fetchGitStatus();
    }, 2000);
  } else if (!github.success) {
    successProcessed = false;
  }
</script>

{#if github.showModal}
  <div class="modal-backdrop" on:click={handleCancel}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <div class="header-content">
          <h3>{isCommitMode ? 'Commit Changes' : 'Create Pull Request'}</h3>
          {#if isCommitMode && existingPr}
            <a href={existingPr.url} target="_blank" class="header-pr-link">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15,3 21,3 21,9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              PR #{existingPr.number}
            </a>
          {/if}
        </div>
        <button class="close-button" on:click={handleCancel}>&times;</button>
      </div>

      <div class="modal-body">
        {#if !github.success && !github.error}
          <!-- Existing PR Section -->
          {#if isCommitMode && existingPr}
            <div class="existing-pr-section">
              <h4>📋 Existing Pull Request</h4>
              <div class="pr-info">
                <div class="pr-header">
                  <a href={existingPr.url} target="_blank" class="pr-title-link">
                    <strong>#{existingPr.number}: {existingPr.title}</strong>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15,3 21,3 21,9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                </div>
                <p class="pr-description">Your changes will be committed to this existing pull request.</p>
                <div class="pr-actions">
                  <a href={existingPr.url} target="_blank" class="view-pr-button">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15,3 21,3 21,9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                    View Pull Request
                  </a>
                </div>
              </div>
            </div>
          {/if}

          <!-- PR Branch Section (when we know it's a PR branch but don't have PR details) -->
          {#if isCommitMode && !existingPr}
            <div class="pr-branch-section">
              <h4>🔀 Pull Request Branch</h4>
              <div class="pr-info">
                <p class="pr-description">You're on a pull request branch. Your changes will be committed to the existing pull request for this branch.</p>
                <div class="pr-actions">
                  <button
                    class="find-pr-button"
                    on:click={() => githubStore.fetchPrStatus()}
                    disabled={github.isLoadingStatus}
                  >
                    {#if github.isLoadingStatus}
                      <span class="spinner"></span>
                      Finding PR...
                    {:else}
                      🔍 Find Pull Request
                    {/if}
                  </button>
                </div>
              </div>
            </div>
          {/if}

          <!-- Recent Commits Section -->
          {#if isCommitMode && recentCommits.length > 0}
            <div class="recent-commits-section">
              <h4>📝 Recent Commits</h4>
              <div class="commits-list">
                {#each recentCommits.slice(0, 3) as commit}
                  <div class="commit-item">
                    <span class="commit-hash">{commit.hash}</span>
                    <span class="commit-message">{commit.message}</span>
                    <span class="commit-author">{commit.author}</span>
                  </div>
                {/each}
                {#if recentCommits.length > 3}
                  <div class="more-commits">... and {recentCommits.length - 3} more commits</div>
                {/if}
              </div>
            </div>
          {/if}
          <!-- Git Status Section -->
          <div class="git-status-section">
            <h4>Changes to be committed</h4>
            {#if gitStatus.isLoading}
              <div class="loading">Checking git status...</div>
            {:else if gitStatus.error}
              <div class="error">
                <strong>Error:</strong> {gitStatus.error}
                <button on:click={() => gitStatusStore.fetchGitStatus()}>Retry</button>
              </div>
            {:else if !gitStatus.hasChanges}
              <div class="no-changes">
                <p>No changes detected in your working directory.</p>
                <p>Make some changes to your test files first.</p>
              </div>
            {:else}
              <div class="file-list">
                <div class="branch-info">
                  <strong>Branch:</strong> {gitStatus.currentBranch}
                  {#if gitStatus.isPrBranch}
                    <span class="pr-branch-badge">PR Branch</span>
                  {/if}
                </div>

                <div class="files-summary">
                  <span class="file-count">{gitStatus.modifiedFiles.length} files changed</span>
                </div>

                <div class="file-details">
                  {#each gitStatus.modifiedFiles.slice(0, 10) as file}
                    <div class="file-item">
                      <span class="file-status status-{file.status === '??' ? 'untracked' : file.status.toLowerCase()}">{file.status}</span>
                      <span class="file-path">{file.path}</span>
                    </div>
                  {/each}

                  {#if gitStatus.modifiedFiles.length > 10}
                    <div class="more-files">
                      ... and {gitStatus.modifiedFiles.length - 10} more files
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>

          <!-- Form Section -->
          {#if gitStatus.hasChanges && !gitStatus.error && !gitStatus.success}
            <div class="pr-form-section">
              <div class="form-group">
                <label for="pr-title">{isCommitMode ? 'Commit Message' : 'Pull Request Title'} *</label>
                <input
                  id="pr-title"
                  type="text"
                  bind:value={title}
                  placeholder={isCommitMode ? 'Describe your changes...' : 'Describe your pull request...'}
                  class:invalid={title && !isValidTitle}
                  disabled={isLoading}
                />
                {#if title && !isValidTitle}
                  <div class="validation-error">{isCommitMode ? 'Commit message' : 'Title'} must be at least 3 characters</div>
                {/if}
                {#if !isCommitMode}
                  <div class="form-help">
                    💡 Auto-generated from your changes - you can edit if needed
                  </div>
                {/if}
              </div>

              {#if !isCommitMode}
                <div class="form-group">
                  <label for="pr-description">Description *</label>
                  <textarea
                    id="pr-description"
                    bind:value={description}
                    placeholder="Detailed description of your changes..."
                    rows="6"
                    disabled={isLoading}
                    class:invalid={!isCommitMode && description && !isValidDescription}
                  ></textarea>
                  {#if !isCommitMode && description && !isValidDescription}
                    <div class="validation-error">Description must be at least 10 characters for PR creation</div>
                  {/if}
                  <div class="form-help">
                    💡 Auto-generated summary of your file changes - you can edit if needed
                  </div>
                </div>
              {/if}

              <div class="advanced-toggle">
                <button
                  type="button"
                  class="toggle-button"
                  on:click={() => showAdvanced = !showAdvanced}
                >
                  {showAdvanced ? '▼' : '▶'} Details
                </button>
              </div>

              {#if showAdvanced}
                <div class="advanced-options">
                  <div class="info-box">
                    <h5>Branch Strategy</h5>
                    <p>A new branch will be created: <code>clt-ui-{title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}</code></p>

                    <h5>Commit Strategy</h5>
                    <p>All changes will be committed with the PR title as the commit message.</p>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        {/if}

        <!-- Success/Error States -->
        {#if github.success}
          <div class="success-section">
            <div class="success-message">
              <h4>✅ {isCommitMode ? 'Changes Committed Successfully!' : 'Pull Request Created Successfully!'}</h4>
              <p>{github.message}</p>

              <!-- Debug info -->
              <!-- <p>Debug: PR URL = {github.prUrl || 'null'}</p> -->

              {#if github.prUrl}
                <a href={github.prUrl} target="_blank" class="pr-link">
                  View Pull Request →
                </a>
              {:else}
                <div class="pr-link-missing">
                  <p>⚠️ PR created but link not available. Check your repository.</p>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        {#if github.error}
          <div class="error-section">
            <div class="error-message">
              <h4>❌ Error Creating Pull Request</h4>
              <p>{github.error}</p>
              <button on:click={() => githubStore.reset()}>Try Again</button>
            </div>
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button
          class="cancel-button"
          on:click={handleCancel}
          disabled={isLoading}
        >
          {(github.success || github.error) ? 'Close' : 'Cancel'}
        </button>

        {#if !github.success && !github.error}
          <button
            class="submit-button {isCommitMode ? 'commit-mode' : 'pr-mode'}"
            on:click={handleSubmit}
            disabled={!canSubmit}
            class:loading={isLoading}
          >
            {#if isLoading}
              <span class="spinner"></span>
              {isCommitMode ? 'Committing...' : 'Creating PR...'}
            {:else}
              {isCommitMode ? 'Commit Changes' : 'Create Pull Request'}
            {/if}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--color-bg-primary);
    border-radius: 8px;
    width: 90%;
    max-width: 600px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    border: 1px solid var(--color-border-light);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--color-border-light);
  }

  .header-content {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .modal-header h3 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: 1.4em;
  }

  .header-pr-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--color-bg-accent);
    color: var(--color-text-inverted);
    text-decoration: none;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 0.85em;
    font-weight: 500;
    transition: background-color 0.2s ease;
  }

  .header-pr-link:hover {
    background: #0056b3;
    color: var(--color-text-inverted);
    text-decoration: none;
  }

  .close-button {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: var(--color-text-secondary);
    padding: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-button:hover {
    color: var(--color-text-primary);
  }

  .modal-body {
    padding: 20px 24px;
  }

  .git-status-section {
    margin-bottom: 24px;
  }

  .git-status-section h4 {
    margin: 0 0 12px 0;
    color: var(--color-text-primary);
    font-size: 1.1em;
  }

  .loading {
    text-align: center;
    padding: 20px;
    color: var(--color-text-secondary);
  }

  .error {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    padding: 12px;
    border-radius: 4px;
    color: #ef4444;
  }

  .no-changes {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border-light);
    padding: 16px;
    border-radius: 4px;
    text-align: center;
    color: var(--color-text-secondary);
  }

  .file-list {
    border: 1px solid var(--color-border-light);
    border-radius: 4px;
    overflow: hidden;
  }

  .branch-info {
    background: var(--color-bg-secondary);
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border-light);
    font-size: 0.9em;
    color: var(--color-text-primary);
  }

  .pr-branch-badge {
    background: var(--color-bg-accent);
    color: var(--color-text-inverted);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.8em;
    margin-left: 8px;
  }

  .files-summary {
    background: var(--color-bg-primary);
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border-light);
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .file-details {
    max-height: 200px;
    overflow-y: auto;
  }

  .file-item {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    border-bottom: 1px solid var(--color-border-light);
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--color-bg-primary);
  }

  .file-item:last-child {
    border-bottom: none;
  }

  .file-status {
    width: 24px;
    text-align: center;
    font-weight: bold;
    margin-right: 8px;
  }

  .status-m { color: #fd7e14; } /* Modified - Orange */
  .status-a { color: #28a745; } /* Added - Green */
  .status-d { color: #dc3545; } /* Deleted - Red */
  .status-u { color: #6f42c1; } /* Unmerged - Purple */
  .status-untracked { color: #17a2b8; } /* Untracked - Cyan */

  .file-path {
    color: var(--color-text-primary);
  }

  .more-files {
    padding: 8px 12px;
    font-style: italic;
    color: var(--color-text-secondary);
    text-align: center;
    background: var(--color-bg-secondary);
  }

  .pr-form-section {
    margin-bottom: 24px;
  }

  .form-group {
    margin-bottom: 16px;
  }

  .form-group label {
    display: block;
    margin-bottom: 4px;
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .form-group input,
  .form-group textarea {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--color-border-medium);
    border-radius: 4px;
    font-size: 14px;
    box-sizing: border-box;
    background-color: var(--color-bg-primary);
    color: var(--color-text-primary);
  }

  .form-group input:focus,
  .form-group textarea:focus {
    outline: none;
    border-color: var(--color-bg-accent);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
  }

  .form-group input.invalid {
    border-color: #dc3545;
  }

  .form-group textarea.invalid {
    border-color: #dc3545;
  }

  .validation-error {
    color: #dc3545;
    font-size: 0.85em;
    margin-top: 4px;
  }

  .form-help {
    color: var(--color-text-secondary);
    font-size: 0.8em;
    margin-top: 4px;
    font-style: italic;
  }

  .advanced-toggle {
    margin: 16px 0;
  }

  .toggle-button {
    background: none;
    border: none;
    color: var(--color-text-accent);
    cursor: pointer;
    font-size: 0.9em;
    padding: 4px 0;
  }

  .toggle-button:hover {
    color: var(--color-text-primary);
  }

  .advanced-options {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border-light);
    border-radius: 4px;
    padding: 16px;
    margin-top: 8px;
  }

  .info-box h5 {
    margin: 0 0 8px 0;
    color: var(--color-text-primary);
    font-size: 0.9em;
  }

  .info-box p {
    margin: 0 0 12px 0;
    color: var(--color-text-secondary);
    font-size: 0.85em;
    line-height: 1.4;
  }

  .info-box code {
    background: var(--color-bg-tertiary);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 0.8em;
    color: var(--color-text-primary);
  }

  .success-section,
  .error-section {
    margin-bottom: 16px;
  }

  .success-message {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    color: #22c55e;
    padding: 16px;
    border-radius: 4px;
    text-align: center;
  }

  .success-message h4 {
    margin: 0 0 8px 0;
    color: #22c55e;
  }

  .pr-link {
    display: inline-block;
    margin-top: 12px;
    background: #22c55e;
    color: var(--color-text-inverted);
    padding: 8px 16px;
    text-decoration: none;
    border-radius: 4px;
    font-weight: 500;
  }

  .pr-link:hover {
    background: #16a34a;
    color: var(--color-text-inverted);
  }

  .pr-link-missing {
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    padding: 8px 12px;
    border-radius: 4px;
    margin-top: 12px;
  }

  .pr-link-missing p {
    margin: 0;
    color: #f59e0b;
    font-size: 0.9em;
  }

  .error-message {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
    padding: 16px;
    border-radius: 4px;
    text-align: center;
  }

  .error-message h4 {
    margin: 0 0 8px 0;
    color: #ef4444;
  }

  .error-message button {
    background: #ef4444;
    color: var(--color-text-inverted);
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 8px;
  }

  .error-message button:hover {
    background: #dc2626;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px 20px;
    border-top: 1px solid var(--color-border-light);
  }

  .cancel-button {
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-medium);
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s ease;
  }

  .cancel-button:hover:not(:disabled) {
    background: var(--color-bg-tertiary);
    border-color: var(--color-border-dark);
  }

  .cancel-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .submit-button {
    background: var(--color-bg-accent);
    color: var(--color-text-inverted);
    border: none;
    padding: 8px 20px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .submit-button:hover:not(:disabled) {
    background: #2563eb;
  }

  .submit-button:disabled {
    background: var(--color-text-secondary);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .close-button-success {
    background: #22c55e;
    color: var(--color-text-inverted);
    border: none;
    padding: 8px 20px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top: 2px solid currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .existing-pr-section {
    margin-bottom: 20px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 6px;
    padding: 16px;
  }

  .existing-pr-section h4 {
    margin: 0 0 12px 0;
    color: var(--color-bg-accent);
    font-size: 1.1em;
  }

  .pr-branch-section {
    margin-bottom: 20px;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 6px;
    padding: 16px;
  }

  .pr-branch-section h4 {
    margin: 0 0 12px 0;
    color: #f59e0b;
    font-size: 1.1em;
  }

  .pr-info {
    background: var(--color-bg-primary);
    border-radius: 4px;
    padding: 12px;
    border: 1px solid var(--color-border-light);
  }

  .pr-title-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-accent);
    text-decoration: none;
    font-size: 1em;
  }

  .pr-title-link:hover {
    color: var(--color-bg-accent);
    text-decoration: underline;
  }

  .pr-description {
    margin: 8px 0 0 0;
    color: var(--color-text-secondary);
    font-size: 0.9em;
  }

  .pr-actions {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--color-border-light);
  }

  .view-pr-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--color-bg-accent);
    color: var(--color-text-inverted);
    text-decoration: none;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 0.9em;
    font-weight: 500;
    transition: background-color 0.2s ease;
  }

  .view-pr-button:hover {
    background: #2563eb;
    color: var(--color-text-inverted);
    text-decoration: none;
  }

  .find-pr-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #f59e0b;
    color: var(--color-text-inverted);
    border: none;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 0.9em;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }

  .find-pr-button:hover:not(:disabled) {
    background: #d97706;
  }

  .find-pr-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .recent-commits-section {
    margin-bottom: 20px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border-light);
    border-radius: 6px;
    padding: 16px;
  }

  .recent-commits-section h4 {
    margin: 0 0 12px 0;
    color: var(--color-text-primary);
    font-size: 1.1em;
  }

  .commits-list {
    background: var(--color-bg-primary);
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--color-border-light);
  }

  .commit-item {
    display: grid;
    grid-template-columns: 80px 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border-light);
    font-size: 0.85em;
  }

  .commit-item:last-child {
    border-bottom: none;
  }

  .commit-hash {
    font-family: var(--font-mono);
    background: var(--color-bg-secondary);
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--color-text-secondary);
    font-size: 0.8em;
  }

  .commit-message {
    color: var(--color-text-primary);
    font-weight: 500;
  }

  .commit-author {
    color: var(--color-text-secondary);
    font-size: 0.8em;
    text-align: right;
  }

  .more-commits {
    padding: 8px 12px;
    text-align: center;
    color: var(--color-text-secondary);
    font-style: italic;
    background: var(--color-bg-secondary);
    font-size: 0.85em;
  }

  .submit-button.commit-mode {
    background: #22c55e;
  }

  .submit-button.commit-mode:hover:not(:disabled) {
    background: #16a34a;
  }

  .submit-button.pr-mode {
    background: var(--color-bg-accent);
  }

  .submit-button.pr-mode:hover:not(:disabled) {
    background: #2563eb;
  }
</style>
