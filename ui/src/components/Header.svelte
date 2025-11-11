<script lang="ts">
  import { filesStore } from '../stores/filesStore';
  import { authStore, logout, fetchAuthState } from '../stores/authStore';
  import { githubStore } from '../stores/githubStore';
  import { gitStatusStore } from '../stores/gitStatusStore';
  import { branchStore } from '../stores/branchStore';
  import { onMount } from 'svelte';
  import { API_URL } from '../config.js';
  import InteractiveSession from './InteractiveSession.svelte';

  let interactiveSession: any;
  let dockerImage = $filesStore.dockerImage;
  
  // Subscribe to git status and GitHub store for smart button logic
  $: gitStatus = $gitStatusStore;
  $: github = $githubStore;
  $: hasGitChanges = gitStatus.hasChanges; // True if not on default branch
  $: gitStatusError = gitStatus.error;
  
  // Smart button logic based on PR status - prioritize fresh data from gitStatus
  $: isOnPrBranch = gitStatus.isPrBranch || github.prStatus?.isPrBranch || false;
  $: existingPr = github.prStatus?.existingPr || null;
  $: currentBranch = gitStatus.currentBranch || 'master';
  $: repoUrl = gitStatus.repoUrl;
  
  // GitHub compare URL for creating PR (reuse existing repoUrl from gitStatus)
  $: githubCompareUrl = repoUrl ? `${repoUrl}/compare/${currentBranch}?expand=1` : null;
  
  // Show Create PR link when: no existing PR AND not on default branch AND valid repo URL
  $: showCreatePrLink = !existingPr && hasGitChanges && githubCompareUrl;

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
    
  // Initialize git status polling with immediate fetch
  gitStatusStore.fetchGitStatus().then(() => {
    gitStatusStore.startPolling(10000); // Poll every 10 seconds after initial fetch
  });
    
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

  // Handle CI trigger
  async function handleTriggerCi() {
    if (github.isCommitting) return;
    
    console.log('🚀 Triggering CI...');
    
    try {
      const result = await githubStore.triggerCi();
      console.log('✅ CI trigger result:', result);
      
      // Show success message
      if (result.changed) {
        alert(`✅ ${result.message}\n\nOriginal: ${result.originalMessage}\nNew: ${result.newMessage}`);
      } else {
        alert(`ℹ️ ${result.message}`);
      }
    } catch (error) {
      console.error('❌ CI trigger failed:', error);
      alert(`❌ Failed to trigger CI: ${error.message}`);
    }
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
      
      <!-- Create PR Link - only show when no existing PR and has changes -->
      {#if showCreatePrLink}
        <a
          href={githubCompareUrl}
          target="_blank"
          class="create-pr-button"
          title="Create PR for branch {currentBranch}"
        >
          <!-- Create PR icon -->
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="18" r="3"></circle>
            <circle cx="6" cy="6" r="3"></circle>
            <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
            <line x1="6" y1="9" x2="6" y2="21"></line>
          </svg>
          Create PR
        </a>
      {/if}
      
      <!-- Show existing PR link if available -->
      {#if existingPr}
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
      
      <!-- CI Trigger Button - only show when on PR branch -->
      {#if isOnPrBranch}
        <button
          class="ci-button"
          on:click={handleTriggerCi}
          disabled={github.isCommitting}
          title="Trigger CI for this PR"
        >
          {#if github.isCommitting}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="loading-spinner">
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"></path>
            </svg>
          {/if}
          CI
        </button>
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
    background-color: var(--color-bg-primary-action, #007bff);
    color: white;
    border: none;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    margin-right: var(--spacing-md);
    text-decoration: none;
    transition: background-color var(--transition-fast);
    box-sizing: border-box;
    /* Ensure consistent height with interactive-button */
    min-height: 32px;
    line-height: 1.2;
  }

  .create-pr-button:hover {
    background-color: var(--color-bg-primary-action-hover, #0056b3);
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
    transition: background-color var(--transition-fast);
    box-sizing: border-box;
    /* Ensure consistent height with create-pr-button */
    min-height: 32px;
    line-height: 1.2;
  }

  .interactive-button:hover {
    background-color: var(--color-bg-info-hover, #0284c7);
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
    margin-right: 12px;
    transition: all 0.2s ease;
  }

  .existing-pr-link:hover {
    background: #e9ecef;
    color: #007bff;
    border-color: #007bff;
  }

  .ci-button {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    background-color: var(--color-accent, #28a745);
    color: white;
    border: none;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    margin-right: var(--spacing-md);
    transition: background-color var(--transition-fast);
    box-sizing: border-box;
    min-height: 32px;
    line-height: 1.2;
  }

  .ci-button:hover:not(:disabled) {
    background-color: var(--color-accent-hover, #218838);
  }

  .ci-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .ci-button svg {
    width: 16px;
    height: 16px;
  }

  .ci-button .loading-spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>