<script lang="ts">
  import { githubStore } from '../stores/githubStore';
  import { fade, fly } from 'svelte/transition';
  import { authStore } from '../stores/authStore';

  let title = '';
  let description = '';
  let submitting = false;

  function closeModal() {
    githubStore.hideModal();
  }

  async function handleSubmit() {
    if (!title.trim()) return;

    submitting = true;
    try {
      await githubStore.createPullRequest(title, description);
    } catch (error) {
      console.error('Error creating PR:', error);
    } finally {
      submitting = false;
    }
  }

  function openPrUrl() {
    if ($githubStore.prUrl) {
      window.open($githubStore.prUrl, '_blank');
    }
  }
</script>

{#if $githubStore.showModal}
  <div class="modal-backdrop" transition:fade={{ duration: 150 }} on:click={closeModal}></div>
  
  <div class="modal" transition:fly={{ y: 20, duration: 200 }}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h2>{$githubStore.success ? 'Pull Request Created' : 'Create GitHub Pull Request'}</h2>
        <button class="close-button" on:click={closeModal}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="modal-body">
        {#if $githubStore.error}
          <div class="error-message">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{$githubStore.error}</span>
          </div>
        {/if}

        {#if $githubStore.success}
          <div class="success-message">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span>{$githubStore.message}</span>
          </div>

          {#if $githubStore.prUrl}
            <p class="mt-4">Your pull request has been created:</p>
            <div class="pr-link" on:click={openPrUrl}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              <span>{$githubStore.prUrl}</span>
            </div>
          {/if}

          {#if $githubStore.repoUrl}
            <p class="mt-4">Target Repository:</p>
            <div class="repo-info">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
              </svg>
              <span>{$githubStore.repoUrl}</span>
            </div>
          {/if}
        {:else}
          <p class="user-info">Creating PR as: <strong>{$authStore.user?.username || 'Anonymous'}</strong></p>

          <div class="form-group">
            <label for="pr-title">Pull Request Title *</label>
            <input
              id="pr-title"
              type="text"
              placeholder="e.g., Add new tests for feature XYZ"
              bind:value={title}
              disabled={$githubStore.isCreating}
              required
            />
          </div>

          <div class="form-group">
            <label for="pr-description">Description (optional)</label>
            <textarea
              id="pr-description"
              placeholder="Describe the changes you've made..."
              bind:value={description}
              disabled={$githubStore.isCreating}
              rows="4"
            ></textarea>
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        {#if $githubStore.success}
          <button class="modal-button close-button" on:click={closeModal}>Close</button>
          {#if $githubStore.prUrl}
            <button class="modal-button primary-button" on:click={openPrUrl}>Open PR</button>
          {/if}
        {:else}
          <button class="modal-button close-button" on:click={closeModal} disabled={$githubStore.isCreating}>Cancel</button>
          <button
            class="modal-button primary-button {$githubStore.isCreating ? 'loading' : ''}"
            on:click={handleSubmit}
            disabled={!title.trim() || $githubStore.isCreating}
          >
            {#if $githubStore.isCreating}
              <span class="spinner"></span>
              Creating...
            {:else}
              Create Pull Request
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
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 1000;
  }

  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1001;
    width: 100%;
    max-width: 550px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  }

  .modal-content {
    background-color: var(--color-bg-primary);
    border-radius: 6px;
    overflow: hidden;
  }

  .modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--color-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-header h2 {
    font-size: 18px;
    margin: 0;
    font-weight: 600;
  }

  .close-button {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-secondary);
    padding: 4px;
    border-radius: 4px;
  }

  .close-button:hover {
    background-color: var(--color-bg-hover);
  }

  .modal-body {
    padding: 20px;
  }

  .form-group {
    margin-bottom: 16px;
  }

  .form-group label {
    display: block;
    margin-bottom: 6px;
    font-weight: 500;
  }

  .form-group input,
  .form-group textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: 14px;
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .form-group input:focus,
  .form-group textarea:focus {
    outline: none;
    border-color: var(--color-bg-accent);
    box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.2);
  }

  .modal-footer {
    padding: 16px 20px;
    border-top: 1px solid var(--color-border);
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .modal-button {
    padding: 8px 16px;
    border-radius: 4px;
    border: none;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }

  .modal-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .close-button {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .primary-button {
    background-color: var(--color-bg-accent);
    color: white;
  }

  .primary-button:hover:not(:disabled) {
    color: var(--color-text-primary);
    background-color: var(--color-bg-accent-hover);
  }

  .error-message {
    padding: 12px 16px;
    background-color: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    border-radius: 4px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .success-message {
    padding: 12px 16px;
    background-color: rgba(34, 197, 94, 0.1);
    color: #22c55e;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pr-link {
    margin-top: 12px;
    padding: 12px 16px;
    background-color: var(--color-bg-secondary);
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .pr-link:hover {
    background-color: var(--color-bg-hover);
  }
  
  .repo-info {
    margin-top: 12px;
    padding: 12px 16px;
    background-color: var(--color-bg-secondary);
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: #fff;
    animation: spin 1s ease-in-out infinite;
    margin-right: 8px;
    display: inline-block;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .mt-4 {
    margin-top: 16px;
  }

  .user-info {
    margin-bottom: 16px;
    font-size: 14px;
    color: var(--color-text-tertiary);
  }

  .user-info strong {
    color: var(--color-text-primary);
  }
</style>