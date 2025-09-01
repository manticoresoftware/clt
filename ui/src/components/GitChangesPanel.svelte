<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { filesStore } from '../stores/filesStore';
  import { gitOperationsStore } from '../stores/gitStatusStore';
  import { API_URL } from '../config.js';
  import DiffHighlighter from './DiffHighlighter.svelte';

  export let visible = false;
  export let currentFilePath: string | null = null;
  export let onClose: () => void = () => {};

  let gitData: any = null;
  let loading = false;
  let error: string | null = null;
  let refreshInterval: number | null = null;
  let repoUrl: string | null = null;

  // Reactive statement to fetch git data when file changes
  $: if (visible && currentFilePath) {
    fetchGitHistory();
  }

  // Reactive statement to refresh git history when git operations occur
  $: if (visible && currentFilePath && $gitOperationsStore.lastOperation) {
    console.log(`🔄 Git operation detected (${$gitOperationsStore.lastOperation}), refreshing git history...`);
    fetchGitHistory();
  }

  async function fetchGitHistory() {
    if (!currentFilePath) return;
    
    loading = true;
    error = null;
    
    try {
      const response = await fetch(`${API_URL}/api/file-git-history?filePath=${encodeURIComponent(currentFilePath)}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      gitData = await response.json();
      console.log('Git data received:', gitData);
      console.log('Repo URL:', gitData.repoUrl);
    } catch (err) {
      console.error('Failed to fetch git history:', err);
      error = err instanceof Error ? err.message : 'Failed to fetch git history';
      gitData = null;
    } finally {
      loading = false;
    }
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatCommitHash(hash: string): string {
    return hash.substring(0, 7);
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'M': return '#f59e0b'; // Modified - yellow
      case 'A': return '#10b981'; // Added - green
      case 'D': return '#ef4444'; // Deleted - red
      case 'R': return '#8b5cf6'; // Renamed - purple
      case 'C': return '#06b6d4'; // Copied - cyan
      case '??': return '#6b7280'; // Untracked - gray
      default: return '#9ca3af'; // Unknown - light gray
    }
  }

  function getStatusText(status: string): string {
    switch (status) {
      case 'M': return 'Modified';
      case 'A': return 'Added';
      case 'D': return 'Deleted';
      case 'R': return 'Renamed';
      case 'C': return 'Copied';
      case '??': return 'Untracked';
      default: return 'Unknown';
    }
  }

  // SECURITY: Sanitize repository URLs to remove any access tokens
  function sanitizeRepoUrl(url: string): string {
    if (!url) return '';
    // Remove tokens from URLs (defense-in-depth, backend should already handle this)
    return url.replace(/https:\/\/[^@]+@/, 'https://');
  }

  function getGitHubCommitUrl(repoUrl: string, commitHash: string): string {
    if (!repoUrl) return '';
    const cleanUrl = sanitizeRepoUrl(repoUrl);
    return `${cleanUrl}/commit/${commitHash}`;
  }

  function getGitHubFileUrl(repoUrl: string, commitHash: string, filePath: string): string {
    if (!repoUrl || !filePath) return '';
    const cleanUrl = sanitizeRepoUrl(repoUrl);
    return `${cleanUrl}/blob/${commitHash}/${filePath}`;
  }

  // Auto-refresh git data when files are saved
  onMount(() => {
    // Listen for file save events to refresh git data
    const unsubscribe = filesStore.subscribe((store) => {
      if (store.lastSaved && visible && currentFilePath) {
        // Debounce refresh to avoid too many requests
        if (refreshInterval) {
          clearTimeout(refreshInterval);
        }
        refreshInterval = setTimeout(() => {
          fetchGitHistory();
        }, 1000);
      }
    });

    return () => {
      unsubscribe();
      if (refreshInterval) {
        clearTimeout(refreshInterval);
      }
    };
  });

  onDestroy(() => {
    if (refreshInterval) {
      clearTimeout(refreshInterval);
    }
  });
</script>

<div class="git-changes-panel" class:visible>
  <div class="git-panel-header">
    <div class="header-left">
      <span>Git Changes</span>
      {#if currentFilePath}
        <span class="file-context">→ {currentFilePath.split('/').pop()}</span>
      {/if}
    </div>
    <div class="header-actions">
      <button
        class="header-action-button refresh-button"
        on:click={fetchGitHistory}
        disabled={loading || !currentFilePath}
        title="Refresh git data"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
          <path d="M21 3v5h-5"/>
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
          <path d="M3 21v-5h5"/>
        </svg>
      </button>
      <button
        class="header-action-button close-button"
        on:click={onClose}
        title="Close git panel"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  </div>

  <div class="git-panel-content">
    {#if loading}
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <span>Loading git data...</span>
      </div>
    {:else if error}
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <div class="error-message">{error}</div>
        <button class="retry-button" on:click={fetchGitHistory}>
          Retry
        </button>
      </div>
    {:else if !currentFilePath}
      <div class="empty-state">
        <div class="empty-icon">📄</div>
        <div class="empty-message">Select a file to view git changes</div>
      </div>
    {:else if gitData}
      <!-- Current Status -->
      {#if gitData.status}
        <div class="git-section">
          <div class="section-header">Current Status</div>
          <div class="status-item">
            <span 
              class="status-indicator" 
              style="color: {getStatusColor(gitData.status.working_dir || gitData.status.index)}"
            >
              {gitData.status.working_dir || gitData.status.index}
            </span>
            <span class="status-text">
              {getStatusText(gitData.status.working_dir || gitData.status.index)}
            </span>
          </div>
        </div>
      {/if}

      <!-- Branch Info -->
      <div class="git-section">
        <div class="section-header">Branch Info</div>
        <div class="branch-info">
          <div class="branch-item">
            <span class="branch-label">Current:</span>
            {#if gitData.repoUrl && !gitData.isOnDefaultBranch}
              <a 
                href={`${sanitizeRepoUrl(gitData.repoUrl)}/tree/${gitData.currentBranch}`} 
                target="_blank" 
                rel="noopener noreferrer"
                class="branch-name current-branch branch-link"
                title="View branch on GitHub"
              >
                {gitData.currentBranch}
              </a>
            {:else}
              <span class="branch-name current-branch">{gitData.currentBranch}</span>
            {/if}
          </div>
          <div class="branch-item">
            <span class="branch-label">Default:</span>
            {#if gitData.repoUrl}
              <a 
                href={`${sanitizeRepoUrl(gitData.repoUrl)}/tree/${gitData.defaultBranch}`} 
                target="_blank" 
                rel="noopener noreferrer"
                class="branch-name default-branch branch-link"
                title="View default branch on GitHub"
              >
                {gitData.defaultBranch}
              </a>
            {:else}
              <span class="branch-name default-branch">{gitData.defaultBranch}</span>
            {/if}
          </div>
          <div class="branch-item">
            <span class="branch-label">Repo:</span>
            {#if gitData.repoUrl}
              <a 
                href={sanitizeRepoUrl(gitData.repoUrl)} 
                target="_blank" 
                rel="noopener noreferrer"
                class="repo-url-link"
                title="View repository on GitHub"
              >
                {sanitizeRepoUrl(gitData.repoUrl).replace('https://github.com/', '')}
              </a>
            {:else}
              <span class="repo-url-missing">Not detected</span>
            {/if}
          </div>
          {#if !gitData.isOnDefaultBranch}
            <div class="branch-status">
              <span class="status-badge pr-branch">PR Branch</span>
              {#if gitData.repoUrl}
                <a 
                  href={`${sanitizeRepoUrl(gitData.repoUrl)}/compare/${gitData.defaultBranch}...${gitData.currentBranch}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  class="compare-link"
                  title="Compare branches on GitHub"
                >
                  Compare
                </a>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Diff Section -->
      {#if gitData.diff && !gitData.isOnDefaultBranch}
        <div class="git-section">
          <div class="section-header">Changes vs {gitData.defaultBranch}</div>
          <div class="diff-container">
            <DiffHighlighter diffContent={gitData.diff} className="diff-content" />
          </div>
        </div>
      {/if}

      <!-- History Section -->
      {#if gitData.history && gitData.history.length > 0}
        <div class="git-section">
          <div class="section-header">Recent Commits</div>
          <div class="history-list">
            {#each gitData.history as commit}
              <div class="commit-item">
                <div class="commit-header">
                  <span class="commit-hash-container">
                    {#if gitData.repoUrl}
                      <a 
                        href={getGitHubCommitUrl(gitData.repoUrl, commit.hash)} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        class="commit-hash-link"
                        title="View commit on GitHub"
                      >
                        {formatCommitHash(commit.hash)}
                      </a>
                    {:else}
                      <span class="commit-hash">{formatCommitHash(commit.hash)}</span>
                      <span class="no-repo-url" title="Repository URL not available">(no GitHub link)</span>
                    {/if}
                  </span>
                  <span class="commit-date">{formatDate(commit.date)}</span>
                </div>
                <div class="commit-message">{commit.message}</div>
                <div class="commit-author-row">
                  <span class="commit-author">{commit.author_name}</span>
                  {#if gitData.repoUrl && gitData.relativeToRepo}
                    <a 
                      href={getGitHubFileUrl(gitData.repoUrl, commit.hash, gitData.relativeToRepo)} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      class="file-link"
                      title="View file at this commit"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15,3 21,3 21,9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </a>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {:else if gitData.history}
        <div class="git-section">
          <div class="section-header">Recent Commits</div>
          <div class="empty-history">
            <span>No commits found for this file</span>
          </div>
        </div>
      {/if}
    {:else}
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-message">No git data available</div>
      </div>
    {/if}
  </div>
</div>

<style>
  .git-changes-panel {
    width: 400px;
    height: 100%;
    background-color: var(--color-bg-primary);
    border-left: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    font-family: var(--font-family-mono);
    font-size: 13px;
    position: absolute;
    top: 0;
    right: 0;
    z-index: 100;
    transform: translateX(100%);
    transition: transform 0.3s ease;
    box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  }

  .git-changes-panel.visible {
    transform: translateX(0);
  }

  .git-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background-color: var(--color-bg-header);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--color-text-primary);
    font-size: 13px;
  }

  .file-context {
    color: var(--color-text-tertiary);
    font-weight: normal;
    font-size: 12px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .header-action-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-text-secondary);
    transition: all 0.2s ease;
  }

  .header-action-button:hover:not(:disabled) {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .header-action-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .header-action-button svg {
    width: 16px;
    height: 16px;
  }

  .close-button:hover {
    background-color: var(--color-bg-danger, #fee2e2) !important;
    color: var(--color-text-danger, #dc2626) !important;
  }

  .git-panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }

  .git-section {
    border-bottom: 1px solid var(--color-border);
    padding: 12px;
  }

  .git-section:last-child {
    border-bottom: none;
  }

  .section-header {
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-indicator {
    font-weight: bold;
    font-family: monospace;
    font-size: 14px;
  }

  .status-text {
    color: var(--color-text-secondary);
  }

  .branch-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .branch-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .branch-label {
    color: var(--color-text-tertiary);
    font-size: 11px;
    min-width: 50px;
  }

  .branch-name {
    font-family: monospace;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 3px;
    background-color: var(--color-bg-secondary);
    text-decoration: none;
  }

  .branch-link {
    transition: all 0.2s ease;
  }

  .branch-link:hover {
    background-color: var(--color-bg-accent);
    color: white;
  }

  .current-branch {
    color: #3b82f6;
    border: 1px solid #3b82f6;
  }

  .default-branch {
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
  }

  .branch-status {
    margin-top: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .compare-link {
    font-size: 10px;
    color: #3b82f6;
    text-decoration: none;
    padding: 2px 6px;
    border: 1px solid #3b82f6;
    border-radius: 3px;
    transition: all 0.2s ease;
  }

  .compare-link:hover {
    background-color: #3b82f6;
    color: white;
  }

  .repo-url-link {
    font-family: monospace;
    font-size: 11px;
    color: #3b82f6;
    text-decoration: underline;
    transition: color 0.2s ease;
  }

  .repo-url-link:hover {
    color: #1d4ed8;
  }

  .repo-url-missing {
    font-size: 11px;
    color: #ef4444;
    font-style: italic;
  }

  .status-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .pr-branch {
    background-color: #10b981;
    color: white;
  }

  .diff-container {
    max-height: 400px;
    overflow: hidden;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .commit-item {
    padding: 8px;
    background-color: var(--color-bg-secondary);
    border-radius: 4px;
    border: 1px solid var(--color-border);
  }

  .commit-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .commit-hash {
    font-family: monospace;
    font-size: 11px;
    color: #6b7280;
    background-color: var(--color-bg-primary);
    padding: 1px 4px;
    border-radius: 2px;
  }

  .commit-hash-link {
    font-family: monospace;
    font-size: 11px;
    color: #3b82f6;
    background-color: var(--color-bg-primary);
    padding: 1px 4px;
    border-radius: 2px;
    text-decoration: underline;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .commit-hash-link:hover {
    background-color: #3b82f6;
    color: white;
    text-decoration: none;
  }

  .no-repo-url {
    font-size: 9px;
    color: #ef4444;
    margin-left: 4px;
    font-style: italic;
  }

  .commit-hash-container {
    display: flex;
    align-items: center;
  }

  .commit-date {
    font-size: 10px;
    color: var(--color-text-tertiary);
  }

  .commit-message {
    font-size: 12px;
    color: var(--color-text-primary);
    margin-bottom: 2px;
    line-height: 1.3;
  }

  .commit-author {
    font-size: 10px;
    color: var(--color-text-tertiary);
  }

  .commit-author-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .file-link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--color-text-tertiary);
    text-decoration: none;
    transition: color 0.2s ease;
  }

  .file-link:hover {
    color: #3b82f6;
  }

  .file-link svg {
    width: 12px;
    height: 12px;
  }

  .loading-state, .error-state, .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    text-align: center;
    color: var(--color-text-tertiary);
  }

  .loading-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--color-border);
    border-top: 2px solid var(--color-bg-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 12px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .error-icon, .empty-icon {
    font-size: 32px;
    margin-bottom: 12px;
  }

  .error-message, .empty-message {
    margin-bottom: 12px;
    font-size: 13px;
  }

  .retry-button {
    padding: 6px 12px;
    background-color: var(--color-bg-accent);
    color: var(--color-text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: background-color 0.2s;
  }

  .retry-button:hover {
    background-color: var(--color-bg-accent-hover);
  }

  .empty-history {
    text-align: center;
    color: var(--color-text-tertiary);
    font-style: italic;
    padding: 16px;
  }
</style>