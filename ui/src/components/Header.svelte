<script lang="ts">
  import { filesStore } from '../stores/filesStore';
  import { authStore, logout, fetchAuthState } from '../stores/authStore';
  import { githubStore } from '../stores/githubStore';
  import { gitStatusStore } from '../stores/gitStatusStore';
  import { branchStore } from '../stores/branchStore';
  import { onMount } from 'svelte';
  import { API_URL } from '../config.js';
  import InteractiveSession from './InteractiveSession.svelte';

  let dockerImage = $filesStore.dockerImage;
  let interactiveSession: any;
  
  // Subscribe to git status and GitHub store for smart button logic
  $: gitStatus = $gitStatusStore;
  $: github = $githubStore;
  $: hasGitChanges = gitStatus.hasChanges && !gitStatus.isLoading;
  $: gitStatusError = gitStatus.error;
  
  // Smart button logic based on PR status
  $: isOnPrBranch = github.prStatus?.isPrBranch || gitStatus.isPrBranch;
  $: existingPr = github.prStatus?.existingPr;
  $: buttonText = isOnPrBranch && existingPr ? 'Commit' : 'Create PR';
  $: buttonTitle = gitStatus.isLoading 
    ? 'Checking git status...' 
    : !hasGitChanges 
      ? 'No changes to commit' 
      : isOnPrBranch && existingPr
        ? `Commit ${gitStatus.modifiedFiles.length} changes to existing PR`
        : `Create PR with ${gitStatus.modifiedFiles.length} changed files`;

  function updateDockerImage() {
    filesStore.setDockerImage(dockerImage);

    // Run the test with new docker image if there's a file loaded
    if ($filesStore.currentFile) {
      filesStore.runTest();
    }
  }

  // Fetch auth state when component mounts and initialize git status
  onMount(() => {
    fetchAuthState();
    
    // Initialize git status polling
    gitStatusStore.startPolling(10000); // Poll every 10 seconds
    
    return () => {
      gitStatusStore.stopPolling();
    };
  });

  // Stop polling when modal is open to prevent re-renders
  $: if (github.showModal) {
    gitStatusStore.pausePolling();
  } else if ($authStore.isAuthenticated) {
    gitStatusStore.resumePolling();
  }

  function handleLogout() {
    logout();
  }

  function openInteractiveSession() {
    interactiveSession?.openSession();
  }
</script>

<div class="header">
  <div class="app-title">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
    CLT Editor
  </div>

  <div class="docker-image-container">
    <label for="docker-image">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"></path>
        <polyline points="13 2 13 9 20 9"></polyline>
      </svg>
      Docker Image:
    </label>
    <input
      id="docker-image"
      type="text"
      placeholder="Docker image for test validation"
      bind:value={dockerImage}
      on:blur={updateDockerImage}
      disabled={$filesStore.running}
    />
    {#if $filesStore.running}
      <span class="loading-indicator">
        <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </span>
    {/if}
  </div>

  <div class="user-profile">
    {#if $authStore.isAuthenticated && !$authStore.isLoading}
      <button
        class="interactive-button"
        on:click={openInteractiveSession}
        title="Ask AI"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        Ask AI
      </button>
      
      <button
        on:click={() => {
          if (hasGitChanges) {
            githubStore.showModal();
          }
        }}
        disabled={!hasGitChanges || gitStatus.isLoading}
        class="create-pr-button {!hasGitChanges || gitStatus.isLoading ? 'disabled' : ''} {isOnPrBranch && existingPr ? 'commit-mode' : 'pr-mode'}"
        title={buttonTitle}
      >
        {#if gitStatus.isLoading}
          <span class="loading-spinner"></span>
        {/if}
        
        {#if isOnPrBranch && existingPr}
          <!-- Commit icon -->
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4"></circle>
            <path d="m1.05 12 10.5 10.5L23.95 12 13.45 1.5Z"></path>
          </svg>
        {:else}
          <!-- Create PR icon -->
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="18" r="3"></circle>
            <circle cx="6" cy="6" r="3"></circle>
            <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
            <line x1="6" y1="9" x2="6" y2="21"></line>
          </svg>
        {/if}
        
        {buttonText}
        {#if hasGitChanges}
          <span class="change-count">({gitStatus.modifiedFiles.length})</span>
        {/if}
      </button>
      
      <!-- Show existing PR link if available -->
      {#if existingPr && !gitStatus.isLoading}
        <a 
          href={existingPr.url} 
          target="_blank" 
          class="existing-pr-link"
          title="View existing PR: {existingPr.title}"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15,3 21,3 21,9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
          PR #{existingPr.number}
        </a>
      {/if}
      
      {#if gitStatusError}
        <div class="git-status-error">
          <span class="error-icon">⚠️</span>
          <span class="error-text">{gitStatusError}</span>
          <button 
            class="retry-button"
            on:click={() => gitStatusStore.fetchGitStatus()}
          >
            Retry
          </button>
        </div>
      {/if}
    {/if}

    {#if $authStore.isLoading}
      <span class="loading-indicator">
        <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </span>
    {:else if $authStore.isAuthenticated}
      <div class="user-info">
        {#if $authStore.skipAuth}
          <span class="dev-mode-badge">Dev Mode</span>
        {:else}
          <span class="username">
            {#if $authStore.user?.avatarUrl}
              <img src={$authStore.user.avatarUrl} alt="Profile" class="avatar" />
            {/if}
            {$authStore.user?.displayName || $authStore.user?.username || 'User'}
          </span>
        {/if}
        <button class="logout-button" on:click={handleLogout}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          Logout
        </button>
      </div>
    {/if}
  </div>
</div>

<!-- Interactive Session Modal -->
<InteractiveSession bind:this={interactiveSession} />

<style>
  .loading-indicator {
    margin-left: var(--spacing-sm);
    color: var(--color-text-accent);
  }

  .user-profile {
    display: flex;
    align-items: center;
    margin-left: auto;
    padding-left: var(--spacing-md);
  }

  .user-info {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
  }

  .username {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-weight: 500;
  }

  .avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
  }

  .logout-button {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    background: none;
    border: none;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }

  .logout-button:hover {
    background-color: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  .dev-mode-badge {
    background-color: var(--color-accent-light);
    color: var(--color-accent-dark);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .create-pr-button {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    background-color: #007bff;
    color: white;
    border: none;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    margin-right: var(--spacing-md);
    transition: background-color 0.2s ease;
  }

  .create-pr-button:hover:not(.disabled) {
    background-color: #0056b3;
  }

  .create-pr-button.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background-color: #6c757d !important;
  }

  .create-pr-button.commit-mode:not(.disabled) {
    background-color: #28a745;
  }

  .create-pr-button.commit-mode:hover:not(.disabled) {
    background-color: #218838;
  }

  .create-pr-button.pr-mode:not(.disabled) {
    background-color: #007bff;
  }

  .create-pr-button.pr-mode:hover:not(.disabled) {
    background-color: #0056b3;
  }

  .interactive-button {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    background-color: var(--color-bg-info, #0ea5e9);
    color: white;
    border: none;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    margin-right: var(--spacing-md);
  }

  .interactive-button:hover {
    background-color: var(--color-bg-info-hover, #0284c7);
  }

  .loading-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid #ccc;
    border-top: 2px solid #007bff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-right: 4px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .change-count {
    font-size: 0.8em;
    opacity: 0.8;
    margin-left: 4px;
  }

  .git-status-error {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #fff3cd;
    border: 1px solid #ffeaa7;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 0.85em;
    margin-left: 12px;
  }

  .error-icon {
    font-size: 1.1em;
  }

  .error-text {
    color: #856404;
  }

  .retry-button {
    background: #ffc107;
    color: #212529;
    border: none;
    padding: 4px 8px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.8em;
  }

  .retry-button:hover {
    background: #e0a800;
  }

  .existing-pr-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    color: #495057;
    padding: 6px 10px;
    border-radius: 4px;
    text-decoration: none;
    font-size: 0.85em;
    margin-left: 8px;
    transition: all 0.2s ease;
  }

  .existing-pr-link:hover {
    background: #e9ecef;
    color: #007bff;
    border-color: #007bff;
  }
</style>