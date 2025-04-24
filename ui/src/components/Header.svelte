<script lang="ts">
  import { filesStore } from '../stores/filesStore';
  import { authStore, logout, fetchAuthState } from '../stores/authStore';
  import { githubStore } from '../stores/githubStore';
  import { branchStore } from '../stores/branchStore';
  import { onMount } from 'svelte';

  let dockerImage = $filesStore.dockerImage;
  let hasGitChanges = false;
  let isGitStatusLoading = false;

  function updateDockerImage() {
    filesStore.setDockerImage(dockerImage);

    // Run the test with new docker image if there's a file loaded
    if ($filesStore.currentFile) {
      filesStore.runTest();
    }
  }

  // Check git status periodically
  async function checkGitStatus() {
    if (isGitStatusLoading) return;
    
    isGitStatusLoading = true;
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/git-status`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        hasGitChanges = data.hasChanges || false;
      } else {
        console.error('Failed to check git status');
      }
    } catch (error) {
      console.error('Error checking git status:', error);
    } finally {
      isGitStatusLoading = false;
    }
  }

  // Fetch auth state when component mounts and check git status
  onMount(() => {
    fetchAuthState();
    checkGitStatus();

    // Set up interval to check git status every 10 seconds
    const interval = setInterval(checkGitStatus, 10000);
    
    // Clear interval on component unmount
    return () => clearInterval(interval);
  });

  function handleLogout() {
    logout();
  }

  function openCreatePrModal() {
    githubStore.showModal();
  }
</script>

<div class="header">
  <div class="app-title">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
    Manticore Test Editor
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
        class="create-pr-button {!hasGitChanges ? 'disabled' : ''}"
        on:click={openCreatePrModal}
        disabled={!hasGitChanges}
        title={hasGitChanges ? 'Create a pull request' : 'No changes to commit'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="18" r="3"></circle>
          <circle cx="6" cy="6" r="3"></circle>
          <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
          <line x1="6" y1="9" x2="6" y2="21"></line>
        </svg>
        Create PR
      </button>
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
    background-color: var(--color-bg-accent);
    color: white;
    border: none;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    margin-right: var(--spacing-md);
  }

  .create-pr-button:hover {
    color: var(--color-text-primary);
    background-color: var(--color-bg-accent-hover);
  }

  .create-pr-button.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .create-pr-button.disabled:hover {
    background-color: var(--color-bg-accent);
  }
</style>
