<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import SimpleCodeMirror from './SimpleCodeMirror.svelte';
  import { API_URL } from '../config.js';

  export let visible = false;
  export let filePath: string | null = null;
  export let fileName: string = '';

  const dispatch = createEventDispatcher();

  let fileContent = '';
  let loading = false;
  let error: string | null = null;
  let saving = false;
  let successMessage: string | null = null;

  // Load file content when modal opens
  $: if (visible && filePath) {
    loadFileContent();
  }

  async function loadFileContent() {
    if (!filePath) return;
    
    loading = true;
    error = null;
    
    try {
      const response = await fetch(`${API_URL}/api/get-file?path=${encodeURIComponent(filePath)}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      fileContent = data.content || '';
    } catch (err) {
      console.error('Failed to load file content:', err);
      error = err instanceof Error ? err.message : 'Failed to load file content';
      fileContent = '';
    } finally {
      loading = false;
    }
  }

  async function saveFile() {
    if (!filePath || !fileContent) return;
    
    saving = true;
    error = null;
    successMessage = null;
    
    try {
      const response = await fetch(`${API_URL}/api/save-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          path: filePath,
          content: fileContent
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Parse response to get git commit info
      const result = await response.json();
      console.log('File saved successfully:', result);
      
      // Log git commit result if available
      if (result.git) {
        console.log('Auto-commit result:', result.git);
        if (result.git.success) {
          successMessage = 'File saved and committed successfully!';
        }
      } else {
        successMessage = 'File saved successfully!';
      }
      
      // Show success message briefly before closing
      setTimeout(() => {
        closeModal();
      }, 1500);
    } catch (err) {
      console.error('Failed to save file:', err);
      error = err instanceof Error ? err.message : 'Failed to save file';
    } finally {
      saving = false;
    }
  }

  function downloadFile() {
    if (!fileContent || !fileName) return;
    
    // Determine MIME type based on file extension
    const extension = fileName.split('.').pop()?.toLowerCase();
    let mimeType = 'text/plain';
    
    switch (extension) {
      case 'json':
        mimeType = 'application/json';
        break;
      case 'js':
      case 'ts':
        mimeType = 'text/javascript';
        break;
      case 'html':
        mimeType = 'text/html';
        break;
      case 'css':
        mimeType = 'text/css';
        break;
      case 'md':
        mimeType = 'text/markdown';
        break;
      case 'xml':
        mimeType = 'text/xml';
        break;
      default:
        mimeType = 'text/plain';
    }
    
    const blob = new Blob([fileContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function closeModal() {
    visible = false;
    fileContent = '';
    error = null;
    successMessage = null;
    dispatch('close');
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeModal();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible}
  <div class="modal-overlay" on:click={closeModal}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-title">
          <span>Edit File</span>
          {#if fileName}
            <span class="file-name">→ {fileName}</span>
          {/if}
        </div>
        <div class="modal-actions">
          <button
            class="action-button download-button"
            on:click={downloadFile}
            disabled={loading || !fileContent}
            title="Download file"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button
            class="action-button save-button"
            on:click={saveFile}
            disabled={loading || saving}
            title="Save file"
          >
            {#if saving}
              <div class="spinner"></div>
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17,21 17,13 7,13 7,21"/>
                <polyline points="7,3 7,8 15,8"/>
              </svg>
            {/if}
          </button>
          <button
            class="action-button close-button"
            on:click={closeModal}
            title="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <div class="modal-body">
        {#if loading}
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <span>Loading file content...</span>
          </div>
        {:else if error}
          <div class="error-state">
            <div class="error-icon">⚠️</div>
            <div class="error-message">{error}</div>
            <button class="retry-button" on:click={loadFileContent}>
              Retry
            </button>
          </div>
        {:else if successMessage}
          <div class="success-state">
            <div class="success-icon">✅</div>
            <div class="success-message">{successMessage}</div>
          </div>
        {:else}
          <div class="editor-container">
            <SimpleCodeMirror
              bind:value={fileContent}
              placeholder="File content will appear here..."
            />
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }

  .modal-content {
    background-color: var(--color-bg-primary);
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
    width: 90vw;
    height: 80vh;
    max-width: 1200px;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background-color: var(--color-bg-header);
    border-bottom: 1px solid var(--color-border);
    border-radius: 8px 8px 0 0;
    flex-shrink: 0;
  }

  .modal-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--color-text-primary);
    font-size: 14px;
  }

  .file-name {
    color: var(--color-text-tertiary);
    font-weight: normal;
    font-size: 13px;
  }

  .modal-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .action-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-text-secondary);
    transition: all 0.2s ease;
  }

  .action-button:hover:not(:disabled) {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .action-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-button svg {
    width: 18px;
    height: 18px;
  }

  .download-button:hover:not(:disabled) {
    background-color: var(--color-bg-accent, #3b82f6);
    color: white;
  }

  .save-button:hover:not(:disabled) {
    background-color: var(--color-bg-success, #10b981);
    color: white;
  }

  .close-button:hover {
    background-color: var(--color-bg-danger, #fee2e2);
    color: var(--color-text-danger, #dc2626);
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid transparent;
    border-top: 2px solid currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .modal-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px;
    overflow: hidden;
  }

  .editor-container :global(.codemirror-wrapper) {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .editor-container :global(.codemirror-container) {
    flex: 1;
  }

  .loading-state, .error-state, .success-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    color: var(--color-text-tertiary);
    flex: 1;
  }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-border);
    border-top: 3px solid var(--color-bg-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
  }

  .error-icon, .success-icon {
    font-size: 48px;
    margin-bottom: 16px;
  }

  .error-message, .success-message {
    margin-bottom: 16px;
    font-size: 14px;
    max-width: 400px;
  }

  .success-state {
    color: var(--color-text-success, #10b981);
  }

  .retry-button {
    padding: 8px 16px;
    background-color: var(--color-bg-accent);
    color: var(--color-text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: background-color 0.2s;
  }

  .retry-button:hover {
    background-color: var(--color-bg-accent-hover);
  }
</style>