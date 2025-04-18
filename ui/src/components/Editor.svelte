<script lang="ts">
  import { filesStore, type RecordingCommand } from '../stores/filesStore';
  import { onMount } from 'svelte';

  let commands: RecordingCommand[] = [];
  let autoSaveEnabled = true;
  $: commands = $filesStore.currentFile ? $filesStore.currentFile.commands : [];

  // Auto-resize action for textareas
  function initTextArea(node: HTMLTextAreaElement) {
    // Initial auto-resize
    setTimeout(() => {
      if (node.value) {
        node.style.height = 'auto';
        node.style.height = Math.max(24, node.scrollHeight) + 'px';
      }
    }, 0);

    return {
      update() {
        // Update height when value changes externally
        node.style.height = 'auto';
        node.style.height = Math.max(24, node.scrollHeight) + 'px';
      }
    };
  }

  // Initialize autoSaveEnabled from localStorage
  onMount(() => {
    // Default to enabled if not set
    const storedValue = localStorage.getItem('autoSaveEnabled');
    autoSaveEnabled = storedValue === null ? true : storedValue === 'true';
  });

  // Update localStorage when checkbox changes
  function toggleAutoSave() {
    autoSaveEnabled = !autoSaveEnabled;
    localStorage.setItem('autoSaveEnabled', String(autoSaveEnabled));
    console.log('Auto-save set to:', autoSaveEnabled);
  }

  function addCommand(index: number) {
    filesStore.addCommand(index, '');
  }

  function deleteCommand(index: number) {
    filesStore.deleteCommand(index);
  }

  function saveFile() {
    filesStore.saveOnly();
  }

  function runTest() {
    if ($filesStore.currentFile && $filesStore.currentFile.dirty) {
      // If there are unsaved changes, save first then run
      filesStore.saveAndRun();
    } else {
      // If everything is already saved, just run
      filesStore.runTest();
    }
  }

  function formatTime(date: Date): string {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function getStatusIcon(status: string | undefined) {
    if (status === 'matched') {
      return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
      </svg>`;
    }
    if (status === 'failed') {
      return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
      </svg>`;
    }
    // Default pending/unknown status icon
    return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />
    </svg>`;
  }

  function getDiffHighlight(actual: string, expected: string): string {
    if (!actual || !expected) return actual || '';

    // Simple diff highlighting for now
    const actualLines = actual.split('\n');
    const expectedLines = expected.split('\n');

    // Find different lines
    let result = '';
    const maxLines = Math.max(actualLines.length, expectedLines.length);

    for (let i = 0; i < maxLines; i++) {
      const actualLine = actualLines[i] || '';
      const expectedLine = expectedLines[i] || '';

      if (actualLine === expectedLine) {
        result += actualLine + '\n';
      } else {
        result += `<span class="diff-highlight">${actualLine}</span>\n`;
      }
    }

    return result;
  }

	function formatDuration(ms: number | null): string {
		if (ms === null) return '';
		return `${ms}ms`;
	}

  function parseActualOutputContent(actualOutput: string | undefined): string {
    if (!actualOutput) return '';

    // Handle the case when there's a duration section in the output
    const durationMatch = actualOutput.match(/–––\s*duration/);
    if (durationMatch) {
      // Return everything before the duration marker
      return actualOutput.substring(0, durationMatch.index).trim();
    }
    
    // If no duration marker found, return the whole output
    return actualOutput.trim();
  }

  // Function to copy current URL with file hash to clipboard
  function copyShareUrl() {
    if (!$filesStore.currentFile) return;
    
    // Create URL with file hash
    const url = new URL(window.location.href);
    // Remove existing query parameters
    url.search = '';
    // Set hash to file-{path}
    url.hash = `file-${encodeURIComponent($filesStore.currentFile.path)}`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(url.toString())
      .then(() => {
        // Show temporary toast or notification
        alert('Shareable link copied to clipboard!');
      })
      .catch(err => {
        console.error('Could not copy text: ', err);
        // Fallback: show the URL and ask user to copy manually
        prompt('Copy this shareable link:', url.toString());
      });
  }
</script>

<div class="editor">
  <!-- Header -->
  <div class="editor-header">
    <div class="file-info">
      {#if $filesStore.currentFile}
        <span class="file-path">{$filesStore.currentFile.path}</span>
        {#if $filesStore.currentFile.status}
          <span class="file-status-badge {$filesStore.currentFile.status}-status">
            {@html getStatusIcon($filesStore.currentFile.status)}
            <span>{$filesStore.currentFile.status.charAt(0).toUpperCase() + $filesStore.currentFile.status.slice(1)}</span>
          </span>
        {/if}
        {#if $filesStore.currentFile.dirty}
          <span class="file-modified-indicator"></span>
          {#if $filesStore.saving}
            <span class="file-status-text">Saving...</span>
          {/if}
        {:else if $filesStore.currentFile.lastSaved}
          <span class="file-status-text">
            Saved at {formatTime($filesStore.currentFile.lastSaved)}
          </span>
        {/if}
      {:else}
        <span>No file selected</span>
      {/if}
    </div>

    <div class="header-actions">
      {#if $filesStore.running}
        <span class="running-indicator">
          <svg class="spinner" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <circle class="spinner-track" cx="12" cy="12" r="10" />
            <circle class="spinner-circle" cx="12" cy="12" r="10" />
          </svg>
          Running test...
        </span>
      {/if}
      {#if $filesStore.currentFile}
        <button class="share-button" on:click={copyShareUrl} title="Copy shareable link">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
          Share
        </button>
      {/if}
      <div class="auto-save-toggle">
        <label class="auto-save-label">
          <input
            type="checkbox"
            checked={autoSaveEnabled}
            on:click={() => {
              autoSaveEnabled = !autoSaveEnabled;
              localStorage.setItem('autoSaveEnabled', String(autoSaveEnabled));
              console.log('Auto-save toggled to:', autoSaveEnabled);
            }}
            id="auto-save-checkbox"
          />
          <span>Auto-Save</span>
        </label>
      </div>
      <div class="action-buttons">
        <button
          class="save-button"
          on:click={saveFile}
          disabled={!$filesStore.currentFile || !$filesStore.currentFile.dirty || $filesStore.saving}
        >
          Save
        </button>
        <button
          class="run-button"
          on:click={runTest}
          disabled={!$filesStore.currentFile || $filesStore.running}
        >
          Run
        </button>
      </div>
    </div>
  </div>

  <!-- Editor content -->
  <div class="editor-content">
    {#if !$filesStore.currentFile}
      <div class="editor-empty">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
          <path d="M10 9H8" />
        </svg>
        <p>Select a file from the sidebar or create a new one</p>
      </div>
    {:else}
      <div class="command-list">
        {#each commands as command, i}
          <div class="command-card">
            <!-- Command header -->
            <div class="command-header">
							<div class="command-title">
								<span class="command-number">{i + 1}</span>
								<span>Command</span>
								{#if command.status && command.status !== 'pending'}
									<span class="command-status {command.status}-status">
										{@html getStatusIcon(command.status)}
										<span>{command.status.charAt(0).toUpperCase() + command.status.slice(1)}</span>
									</span>
								{/if}
								{#if command.duration}
									<span class="command-duration">{formatDuration(command.duration)}</span>
								{/if}
							</div>
              <button
                class="delete-button"
                on:click={() => deleteCommand(i)}
                aria-label="Delete command"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
                Delete
              </button>
            </div>

            <!-- Command input -->
            <div class="command-body">
              <textarea
                class="command-input"
                placeholder="Enter command..."
                rows="1"
                bind:value={command.command}
                on:input={(e) => {
                  // Auto-resize textarea based on content
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.max(24, e.target.scrollHeight) + 'px';
                  
                  // Always mark as dirty regardless of previous state
                  $filesStore.currentFile.dirty = true;
                  command.changed = true;
                  filesStore.updateCommand(i, e.target.value);
                }}
                use:initTextArea
              ></textarea>

              <!-- Output section -->
              {#if !command.initializing}
              <div class="output-grid">
                <div class="output-column">
                  <div class="output-header">
                    <span class="output-indicator expected-indicator"></span>
                    <label for={`expected-output-${i}`}>Expected Output</label>
                  </div>
                <textarea
                  id={`expected-output-${i}`}
                  class="expected-output"
                  placeholder="Expected output..."
                  rows="1"
                  bind:value={command.expectedOutput}
                  on:input={(e) => {
                    // Auto-resize textarea based on content
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.max(24, e.target.scrollHeight) + 'px';
                    
                    // Always mark as dirty regardless of previous state
                    $filesStore.currentFile.dirty = true;
                    command.changed = true;
                    filesStore.updateExpectedOutput(i, e.target.value || '');
                  }}
                  use:initTextArea
                ></textarea>
                </div>
                <div class="output-column">
                  <div class="output-header">
                    <span class="output-indicator actual-indicator"></span>
                    <label for={`actual-output-${i}`}>Actual Output</label>
                  </div>
                  <div
                    id={`actual-output-${i}`}
                    class="actual-output {command.status === 'failed' ? 'failed-output' : ''}"
                    on:click={(e) => {
                      // Toggle expanded class on click
                      if (e.target.scrollHeight > e.target.clientHeight) {
                        e.target.classList.toggle('expanded');
                      }
                    }}
                  >
                    {#if command.status === 'failed' && command.actualOutput}
                      {@html getDiffHighlight(parseActualOutputContent(command.actualOutput), command.expectedOutput || '')}
                    {:else if command.actualOutput}
                      {parseActualOutputContent(command.actualOutput)}
                    {:else}
                      <span class="no-output-message">No actual output yet. Run validation to see results.</span>
                    {/if}
                  </div>
                </div>
              </div>
              {/if}
            </div>
          </div>

          <!-- Add command button between items -->
          <button
            class="add-command-button"
            on:click={() => addCommand(i + 1)}
            title="Add command"
            aria-label="Add command"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        {/each}

        <!-- Add first command button if no commands -->
        {#if commands.length === 0}
          <div class="no-commands">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <h3>No Commands Yet</h3>
            <p>Add your first command to start building your test</p>
            <button
              class="add-first-command-button"
              on:click={() => addCommand(0)}
              aria-label="Add first command"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Add First Command
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .file-status-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 500;
  }

  .file-status-text {
    font-size: 12px;
    color: var(--color-text-tertiary);
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .action-buttons {
    display: flex;
    gap: 8px;
  }

  .save-button, .run-button, .share-button {
    padding: 6px 12px;
    font-size: 14px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    border: none;
    transition: background-color 0.2s ease-in-out;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .save-button {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .run-button {
    background-color: var(--color-bg-accent);
    color: white;
  }
  
  .share-button {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .save-button:disabled, .run-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .save-button:not(:disabled):hover, .share-button:hover {
    background-color: var(--color-bg-secondary-hover);
  }

  .run-button:not(:disabled):hover {
    background-color: var(--color-bg-accent-hover);
  }

  .auto-save-toggle {
    display: flex;
    align-items: center;
    padding: 3px 6px;
    background-color: rgba(0, 0, 0, 0.05);
    border-radius: 4px;
  }

  .auto-save-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .auto-save-label input {
    cursor: pointer;
    margin: 0;
    width: 16px;
    height: 16px;
  }

  @media (prefers-color-scheme: dark) {
    .auto-save-toggle {
      background-color: rgba(255, 255, 255, 0.1);
    }
  }

  .file-modified-indicator {
    width: 8px;
    height: 8px;
    background-color: var(--color-bg-accent);
    border-radius: 50%;
  }

  .running-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--color-text-accent);
  }

  .spinner {
    width: 16px;
    height: 16px;
    animation: spin 1.5s linear infinite;
  }

  .spinner-track {
    fill: none;
    stroke: var(--color-border-light);
    stroke-width: 2px;
  }

  .spinner-circle {
    fill: none;
    stroke: var(--color-bg-accent);
    stroke-width: 2px;
    stroke-linecap: round;
    stroke-dasharray: 60;
    stroke-dashoffset: 20;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .command-status {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 12px;
    margin-left: 8px;
  }

  /* Status-specific styles */
  .pending-status {
    background-color: var(--color-bg-pending, #e2e8f0);
    color: var(--color-text-pending, #64748b);
  }

  .matched-status {
    background-color: var(--color-bg-success, #dcfce7);
    color: var(--color-text-success, #16a34a);
  }

  .failed-status {
    background-color: var(--color-bg-error, #fee2e2);
    color: var(--color-text-error, #dc2626);
  }

  .passed-status {
    background-color: var(--color-bg-success, #dcfce7);
    color: var(--color-text-success, #16a34a);
  }

  .command-duration {
    font-size: 12px;
    color: var(--color-text-tertiary);
    margin-left: 8px;
    font-weight: normal;
  }

  .failed-output {
    white-space: pre-wrap;
  }

  .diff-highlight {
    display: inline-block;
    width: 100%;
    background-color: #fee2e2;
    color: #b91c1c;
  }

  .no-output-message {
    color: var(--color-text-tertiary);
    font-style: italic;
    font-size: 0.9em;
  }

  .duration-footer {
    display: block;
    margin-top: 8px;
    padding-top: 4px;
    font-size: 12px;
    color: var(--color-text-tertiary);
    border-top: 1px solid var(--color-border-light);
    text-align: center;
  }

  @media (prefers-color-scheme: dark) {
    .diff-highlight {
      background-color: rgba(185, 28, 28, 0.2);
      color: #fca5a5;
    }
  }

  /* Simple auto-resize styles that preserve original appearance */
  .command-input, .expected-output {
    width: 100%;
    resize: vertical;
    font-family: monospace;
    padding: 8px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background-color: var(--color-bg-textarea);
    color: var(--color-text-primary);
    transition: border-color 0.2s ease-in-out;
    line-height: 1.5;
    overflow-y: hidden; /* For auto-resize */
  }

  .command-input:focus, .expected-output:focus {
    outline: none;
    border-color: var(--color-bg-accent);
    box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.2);
  }

  .actual-output {
    width: 100%;
    white-space: pre-wrap;
    font-family: monospace;
    padding: 8px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    line-height: 1.5;
    max-height: 200px;
    overflow-y: auto;
    cursor: pointer; /* Keep this for expanding functionality */
  }
  
  .actual-output.expanded {
    max-height: none;
  }
</style>
