<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import SimpleCodeMirror from './SimpleCodeMirror.svelte';
  import OutputCodeMirror from './OutputCodeMirror.svelte';

  export let command: any;
  export let index: number;
  export let displayNumber: number;
  export let wasmLoaded: boolean = false;
  export let patternMatcher: any = null;

  const dispatch = createEventDispatcher();

  // CodeMirror refs for scroll sync
  let expectedCodeMirror: any;
  let actualCodeMirror: any;
  let expectedEditorView: EditorView | null = null;
  let actualEditorView: EditorView | null = null;

  // Update editor views when components are ready
  $: if (expectedCodeMirror?.getEditorView) {
    expectedEditorView = expectedCodeMirror.getEditorView();
  }

  $: if (actualCodeMirror?.getEditorView) {
    actualEditorView = actualCodeMirror.getEditorView();
  }

  // Auto-resize action for textareas
  function initTextArea(node: HTMLTextAreaElement) {
    // Initial auto-resize
    setTimeout(() => {
      if (node.value) {
        node.style.height = 'auto';
        node.style.height = Math.max(24, node.scrollHeight) + 'px';
      }
    }, 0);

    // Add scroll event listener for syncing
    const handleScroll = (e) => {
      if (!isScrollSyncing && node === expectedEl) {
        syncScroll(true);
      }
    };

    node.addEventListener('scroll', handleScroll);

    return {
      update() {
        // Update height when value changes externally
        node.style.height = 'auto';
        node.style.height = Math.max(24, node.scrollHeight) + 'px';
      },
      destroy() {
        node.removeEventListener('scroll', handleScroll);
      }
    };
  }

  function getStatusIcon(status: string | undefined) {
    // Create different status indicators for different item types
    if (status === 'matched' || status === 'success') {
      return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
      </svg>`;
    }
    if (status === 'failed') {
      return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
      </svg>`;
    }
    if (status === 'block' || status === 'pending') {
      // Use a different icon for blocks - file icon is more appropriate for blocks, clock for pending
      const isBlock = status === 'block';
      const isPending = status === 'pending';

      if (isBlock) {
        return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
          </svg>`;
      } else {
        return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />
          </svg>`;
      }
    }
  }

  // Escape HTML special characters
  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Highlight differences using the WASM module.
  async function highlightDifferences(actual: string, expected: string): Promise<string> {
    try {
      if (!wasmLoaded || !patternMatcher) {
        console.log('WASM module not loaded yet, showing plain text');
        return escapeHtml(actual); // Return plain text if WASM isn't ready
      }

      // Return simple escaped text if inputs are identical
      if (actual === expected) {
        // Style as matched - no need for diff
        if (actual && actual.trim() !== '') {
          // Split by newlines to render properly
          const lines = actual.split('\n');
          let resultHtml = '';

          lines.forEach((line, index) => {
            resultHtml += `<span class="diff-matched-line">${escapeHtml(line)}</span>`;
            if (index < lines.length - 1) {
              resultHtml += '<br>';
            }
          });

          return resultHtml;
        }
        return escapeHtml(actual);
      }

      // Get the diff result from the WASM module (returns a JSON string)
      let diffResult;
      try {
        diffResult = JSON.parse(patternMatcher.diff_text(expected, actual));
      } catch (diffErr) {
        console.error('Error during diff processing:', diffErr);
        return escapeHtml(actual);
      }

      if (!diffResult.has_diff) {
        // No differences found; return with success styling
        if (actual && actual.trim() !== '' && expected && expected.trim() !== '') {
          // Split by newlines to render properly
          const lines = actual.split('\n');
          let resultHtml = '';

          lines.forEach((line, index) => {
            resultHtml += `<span class="diff-matched-line">${escapeHtml(line)}</span>`;
            if (index < lines.length - 1) {
              resultHtml += '<br>';
            }
          });

          return resultHtml;
        }
        return escapeHtml(actual); // Simply escape if no meaningful content
      }

      let resultHtml = '';

      // Iterate over each diff line. (Assumes diffResult.diff_lines is in sequential order.)
      for (let i = 0; i < diffResult.diff_lines.length; i++) {
        const diffLine = diffResult.diff_lines[i];
        if (diffLine.line_type === "same") {
          resultHtml += `${escapeHtml(diffLine.content)}`;
          // Add a newline between content lines unless it's the last line
          if (i < diffResult.diff_lines.length - 1) {
            resultHtml += '<br>';
          }
        } else if (diffLine.line_type === "added") {
          // Render added lines with a plus sign.
          resultHtml += `<span class="diff-added-line">+ ${escapeHtml(diffLine.content)}</span>`;
        } else if (diffLine.line_type === "removed") {
          // Render removed lines with a minus sign.
          resultHtml += `<span class="diff-removed-line">− ${escapeHtml(diffLine.content)}</span>`;
        } else if (diffLine.line_type === "changed") {
          // For changed lines, show a "~" marker.
          if (diffLine.highlight_ranges && diffLine.highlight_ranges.length > 0) {
            let lineHtml = '<span class="highlight-line">~ ';
            let lastPos = 0;
            for (const range of diffLine.highlight_ranges) {
              // Append unchanged text
              lineHtml += escapeHtml(diffLine.content.substring(lastPos, range.start));
              // Append highlighted text
              lineHtml += `<span class="highlight-diff">${escapeHtml(diffLine.content.substring(range.start, range.end))}</span>`;
              lastPos = range.end;
            }
            // Append any remainder of the text.
            lineHtml += escapeHtml(diffLine.content.substring(lastPos));
            lineHtml += '</span>';
            resultHtml += lineHtml;
          } else {
            resultHtml += `<span class="highlight-line">~ ${escapeHtml(diffLine.content)}</span>`;
          }
        }
      }
      return resultHtml;
    } catch (err) {
      console.error('Error highlighting differences:', err);
      return escapeHtml(actual); // On error, return plain escaped text.
    }
  }

  function formatDuration(ms: number | null): string {
    if (ms === null) return '';
    return `${ms}ms`;
  }

  function parseActualOutputContent(actualOutput: string | undefined): string {
    if (!actualOutput) return '';

    // Handle the case when there's a duration section in the output.
    const durationMatch = actualOutput.match(/–––\s*duration/);
    if (durationMatch) {
      // Return everything before the duration marker.
      return actualOutput.substring(0, durationMatch.index).trim();
    }

    // If no duration marker found, return the whole output.
    return actualOutput.trim();
  }

  function handleCommandInput(e: any) {
    try {
      // Get value from CodeMirror dispatched event
      const newValue = e.detail?.target?.value || '';

      // Use a timeout to avoid reactive update cycles
      setTimeout(() => {
        dispatch('updateCommand', { index, newValue });
      }, 0);
    } catch (err) {
      console.error('Error updating command:', err);
    }
  }

  function handleExpectedOutputInput(e: any) {
    try {
      const newValue = e.target?.textContent || '';

      // Dispatch the update without direct mutation
      dispatch('updateExpectedOutput', { index, newValue });
    } catch (err) {
      console.error('Error updating expected output:', err);
    }
  }

  function handleToggleExpansion() {
    dispatch('toggleExpansion', { index });
  }

  function handleAddCommand(type: string) {
    dispatch('addCommand', { index: index + 1, type });
  }

  function handleDeleteCommand() {
    dispatch('deleteCommand', { index });
  }

  // Handle expansion on click (simple toggle)
  function handleExpectedOutputClick(event: MouseEvent) {
    const newExpanded = !command.isOutputExpanded;
    dispatch('toggleExpansion', { index, expanded: newExpanded });
  }

  // Handle expansion on actual output click
  function handleActualOutputClick(event: MouseEvent) {
    const newExpanded = !command.isOutputExpanded;
    dispatch('toggleExpansion', { index, expanded: newExpanded });
  }

  // Get actual output content without duration
  function getActualOutputContent(): string {
    if (!command.actualOutput) return '';

    // Handle the case when there's a duration section in the output.
    const durationMatch = command.actualOutput.match(/–––\s*duration/);
    if (durationMatch) {
      // Return everything before the duration marker.
      return command.actualOutput.substring(0, durationMatch.index).trim();
    }

    // If no duration marker found, return the whole output.
    return command.actualOutput.trim();
  }


</script>

<div class="command-card {((command.status === 'failed' || command.error) && !command.initializing) ? 'failed-command' : ''} {command.type === 'block' ? 'block-command' : ''} {command.isBlockCommand ? 'is-block-command' : ''} {command.isNested ? 'nested-command' : ''}" style={command.isNested ? `margin-left: ${command.nestingLevel * 20}px;` : ''}>
  <!-- Command header -->
  <div class="command-header">
    <div class="command-title">
      <span class="command-number">{displayNumber}</span>
      {#if command.type === 'block'}
        <span>Block Reference</span>
        <!-- Expand/Collapse button for blocks -->
        <button
          class="expand-button"
          on:click={handleToggleExpansion}
          title={command.isExpanded ? 'Collapse block' : 'Expand block'}
          aria-label={command.isExpanded ? 'Collapse block' : 'Expand block'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="expand-icon {command.isExpanded ? 'expanded' : ''}">
            <path d="M9 18l6-6-6-6"></path>
          </svg>
        </button>
      {:else if command.type === 'comment'}
        <span>Comment</span>
      {:else if command.isBlockCommand}
        <span>Block Command</span>
      {:else}
        <span>Command</span>
      {/if}
      {#if command.initializing}
        <span class="command-status pending-status">
          {@html getStatusIcon('pending')}
          <span>Pending</span>
        </span>
      {:else if command.status === 'matched'}
        <span class="command-status matched-status">
          {@html getStatusIcon('matched')}
          <span>Matched</span>
        </span>
      {:else if command.status === 'success'}
        <span class="command-status success-status">
          {@html getStatusIcon('success')}
          <span>Success</span>
        </span>
      {:else if command.status === 'failed'}
        <span class="command-status failed-status">
          {@html getStatusIcon('failed')}
          <span>Failed</span>
        </span>
      {:else if command.type === 'block'}
        <span class="command-status {command.status}-status">
          {@html getStatusIcon(command.status)}
          <span>{command.status.charAt(0).toUpperCase() + command.status.slice(1)}</span>
        </span>
      {:else if command.status}
        <span class="command-status {command.status}-status">
          {@html getStatusIcon(command.status)}
          <span>{command.status.charAt(0).toUpperCase() + command.status.slice(1)}</span>
        </span>
      {/if}
      {#if command.blockSource && command.isBlockCommand}
        <span class="block-source">From: {command.blockSource.split('/').pop()}</span>
      {/if}
      {#if command.duration}
        <span class="command-duration">{formatDuration(command.duration)}</span>
      {/if}
    </div>
    <div class="command-actions">
      <!-- Add Command Button -->
      <button
        class="action-button add-command"
        on:click={() => handleAddCommand('command')}
        title="Add command"
        aria-label="Add command"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>

      <!-- Add Block Button -->
      <button
        class="action-button add-block"
        on:click={() => handleAddCommand('block')}
        title="Add block reference"
        aria-label="Add block reference"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      </button>

      <!-- Add Comment Button -->
      <button
        class="action-button add-comment"
        on:click={() => handleAddCommand('comment')}
        title="Add comment"
        aria-label="Add comment"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>

      <div class="action-separator"></div>

      <!-- Delete Button -->
      <button
        class="action-button delete"
        on:click={handleDeleteCommand}
        title="Delete"
        aria-label="Delete command"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Command body -->
  <div class="command-body">
    {#if command.type === 'block'}
      <!-- Block reference input -->
      <SimpleCodeMirror
        placeholder="Enter path to file (without .recb extension)"
        bind:value={command.command}
        on:input={handleCommandInput}
      />
    {:else if command.type === 'comment'}
      <!-- Comment input -->
      <SimpleCodeMirror
        placeholder="Enter your comment here..."
        bind:value={command.command}
        on:input={handleCommandInput}
      />
    {:else}
      <!-- Standard command input with syntax highlighting -->
      <SimpleCodeMirror
        placeholder="Enter command..."
        bind:value={command.command}
        on:input={handleCommandInput}
      />

      <!-- Output section (only for regular commands) -->
      {#if !command.initializing}
      <div class="output-grid {command.isOutputExpanded ? 'has-expanded-outputs' : ''}">
        <div class="output-column">
          <div class="output-header">
            <span class="output-indicator expected-indicator"></span>
            <label for={`expected-output-${index}`}>Expected Output</label>
          </div>
          <div class="output-wrapper {command.isOutputExpanded ? 'expanded' : ''}">
            <div class="output-content" contenteditable="true" bind:textContent={command.expectedOutput} on:input={handleExpectedOutputInput}>
              {command.expectedOutput || ''}
            </div>
          </div>
        </div>
        <div class="output-column">
          <div class="output-header">
            <span class="output-indicator actual-indicator"></span>
            <label for={`actual-output-${index}`}>Actual Output</label>
          </div>
          <div class="output-wrapper {command.isOutputExpanded ? 'expanded' : ''}">
            <div class="output-content">
              {#if command.actualOutput}
                {#await highlightDifferences(getActualOutputContent(), command.expectedOutput || '')}
                  <pre class="plain-output">{getActualOutputContent()}</pre>
                {:then diffHtml}
                  <div class="wasm-diff">{@html diffHtml}</div>
                {/await}
              {:else}
                <span class="no-output-message">Empty output.</span>
              {/if}
            </div>
          </div>
        </div>
      </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  /* All the existing styles from Editor.svelte for command cards */
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

  .success-status {
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

  .block-status {
    background-color: var(--color-bg-info, #e0f2fe);
    color: var(--color-text-info, #0369a1);
  }

  .command-duration {
    font-size: 12px;
    color: var(--color-text-tertiary);
    margin-left: 8px;
    font-weight: normal;
  }

  .block-source {
    font-size: 11px;
    color: var(--color-text-info, #0369a1);
    background-color: rgba(186, 230, 253, 0.4); /* Very light blue */
    padding: 0 6px;
    border-radius: 4px;
    margin-left: 8px;
    display: inline-block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 150px;
  }

  @media (prefers-color-scheme: dark) {
    .block-source {
      background-color: rgba(186, 230, 253, 0.15); /* Darker very light blue */
      color: #7dd3fc; /* Lighter blue in dark mode */
    }
  }

  /* Command card with failed status */
  .command-card.failed-command {
    border: 2px solid var(--color-text-error, #dc2626);
    box-shadow: 0 0 8px rgba(220, 38, 38, 0.3);
  }

  /* Block command styling */
  .command-card.block-command {
    border-left: 5px solid var(--color-bg-info, #0ea5e9);
    background-color: rgba(224, 242, 254, 0.25); /* Light blue background */
  }

  /* Block command with failed status should have red border-left */
  .command-card.block-command.failed-command {
    border-left: 5px solid var(--color-text-error, #dc2626);
  }

  /* Command from a block (isBlockCommand) styling */
  .command-card.is-block-command {
    border-left: 3px solid var(--color-bg-info, #0ea5e9);
    margin-left: 12px;
    width: calc(100% - 12px);
  }

  /* Failed command from a block */
  .command-card.is-block-command.failed-command {
    border-left: 3px solid var(--color-text-error, #dc2626);
  }

  /* Output styling */
  .failed-output {
    white-space: pre-wrap;
  }

  /* WASM Diff specific styles */
  .wasm-diff {
    font-family: monospace;
    font-size: 12px;
    white-space: pre-wrap;
    line-height: 1;
  }

  /* Git-style diff highlighting */
  .highlight-diff {
    background-color: #fecaca; /* light red background */
    color: #991b1b; /* dark red text */
    padding: 1px 0;
    font-weight: bold;
    border-bottom: 1px dashed #dc2626;
  }

  .highlight-line {
    background-color: #fef2f2; /* very light red */
    display: block;
    width: 100%;
    border-left: 3px solid #ef4444;
    padding-left: 4px;
    margin-left: -7px;
  }

  .diff-added-line {
    background-color: #ecfdf5; /* green-50 */
    display: block;
    width: 100%;
    border-left: 3px solid #10b981;
    padding-left: 4px;
    margin-left: -7px;
  }

  .diff-matched-line {
    background-color: #f0fdf4; /* lighter green */
    display: block;
    width: 100%;
    border-left: 3px solid #22c55e;
    padding-left: 4px;
    margin-left: -7px;
    color: #15803d;
  }

  .diff-removed-line {
    background-color: #fee2e2; /* light red background */
    display: block;
    width: 100%;
    border-left: 3px solid #dc2626;
    padding-left: 4px;
    margin-left: -7px;
    color: #b91c1e;
  }

  .plain-output {
    font-family: monospace;
    font-size: 12px;
    white-space: pre-wrap;
    line-height: 1;
  }

  @media (prefers-color-scheme: dark) {
    .command-card.failed-command {
      border: 2px solid var(--color-text-error, #ef4444);
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
    }

    .diff-added-line {
      background-color: rgba(16, 185, 129, 0.1);
      border-left: 3px solid #10b981;
    }

    .diff-matched-line {
      background-color: rgba(34, 197, 94, 0.1);
      border-left: 3px solid #22c55e;
      color: #4ade80;
    }

    .diff-removed-line {
      background-color: rgba(220, 38, 38, 0.1);
      border-left: 3px solid #dc2626;
    }

    .highlight-diff {
      background-color: rgba(239, 68, 68, 0.25);
      color: #fca5a5;
      border-bottom: 1px dashed #ef4444;
    }

    .highlight-line {
      background-color: rgba(239, 68, 68, 0.1);
      border-left: 3px solid #ef4444;
    }
  }

  /* Simple auto-resize styles preserving original appearance */
  .command-input, .expected-output {
    width: 100%;
    resize: vertical;
    font-family: monospace;
    font-size: 12px;
    padding: 8px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background-color: var(--color-bg-textarea);
    color: var(--color-text-primary);
    transition: border-color 0.2s ease-in-out;
    line-height: 1;
    overflow-y: auto; /* Enable scrolling */
    max-height: 200px; /* Default max height */
    /* Disable all browser autocomplete features */
    autocomplete: off;
    autocorrect: off;
    autocapitalize: off;
    spellcheck: false;
  }

  .expected-output.expanded {
    max-height: 400px; /* Larger when expanded */
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
    font-size: 12px;
    padding: 8px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    line-height: 1;
    max-height: 200px;
    overflow-y: auto;
    cursor: pointer;
    transition: max-height 0.2s ease-in-out;
  }

  .actual-output.expanded {
    max-height: 400px; /* Larger when expanded */
  }

  .output-grid {
    display: flex;
    width: 100%;
    gap: 12px;
    margin-top: 12px;
  }

  .output-column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .codemirror-output-wrapper {
    min-height: 60px;
    max-height: 200px;
    overflow: visible;
    border-radius: 4px;
    transition: max-height 0.2s ease-in-out;
    cursor: pointer;
  }

  .codemirror-output-wrapper.expanded {
    max-height: 400px;
  }

  .codemirror-output-wrapper :global(.cm-editor) {
    min-height: 60px;
    max-height: inherit;
  }

  .codemirror-output-wrapper :global(.cm-scroller) {
    overflow-y: auto !important;
    max-height: inherit;
  }

  .codemirror-output-wrapper :global(.cm-content) {
    min-height: 60px;
  }

  .output-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .output-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .expected-indicator {
    background-color: var(--color-bg-pending, #e2e8f0);
  }

  .actual-indicator {
    background-color: var(--color-bg-accent, #5046e4);
  }

  .no-output-message {
    color: var(--color-text-tertiary);
    font-style: italic;
    font-size: 0.9em;
  }

  /* Nested command styling */
  .nested-command {
    border-left: 3px solid var(--color-bg-info, #0ea5e9);
    background-color: rgba(224, 242, 254, 0.15);
    position: relative;
  }

  .nested-command::before {
    content: '';
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 3px;
    background: linear-gradient(to bottom, var(--color-bg-info, #0ea5e9), rgba(224, 242, 254, 0.3));
  }

  /* Expand button styling */
  .expand-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    margin-left: 8px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    color: var(--color-text-secondary);
  }

  .expand-button:hover {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .expand-icon {
    transition: transform 0.2s ease;
  }

  .expand-icon.expanded {
    transform: rotate(90deg);
  }

  /* Enhanced block command styling for better nesting visualization */
  .command-card.block-command {
    border-left: 5px solid var(--color-bg-info, #0ea5e9);
    background-color: rgba(224, 242, 254, 0.25);
    position: relative;
  }

  .command-card.block-command.expanded {
    border-bottom: 2px solid var(--color-bg-info, #0ea5e9);
  }

  /* Nested command numbering adjustment */
  .nested-command .command-number {
    background-color: rgba(224, 242, 254, 0.8);
    color: var(--color-text-info, #0369a1);
    border: 1px solid var(--color-bg-info, #0ea5e9);
  }

  /* Base command card styles - matching Editor.svelte exactly */
  .command-card {
    background-color: var(--color-bg-primary);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    margin-bottom: 8px;
    transition: all 0.2s ease-in-out;
  }

  .command-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px 6px 12px;
    border-bottom: 1px solid var(--color-border-light);
  }

  .command-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }

  .command-number {
    background-color: var(--color-bg-accent);
    color: white;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .command-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .action-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    color: var(--color-text-secondary);
  }

  .action-button:hover {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .action-button.delete:hover {
    background-color: var(--color-bg-error);
    color: white;
  }

  .action-separator {
    width: 1px;
    height: 16px;
    background-color: var(--color-border-light);
    margin: 0 4px;
  }

  .command-body {
    padding: 0 12px 12px 12px;
  }

  /* WASM Diff Styles - Match CodeMirror exactly */
  .actual-output-content {
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-bg-secondary);
    font-family: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace";
    font-size: 12px;
    line-height: 1;
    min-height: 60px;
    overflow-y: auto;
    cursor: pointer;
    position: relative;
    display: flex;
    height: auto;
  }

  .actual-output-content::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 40px;
    background: transparent;
    border-right: 1px solid var(--color-border-light);
    z-index: 1;
  }

  .wasm-diff, .plain-output {
    font-family: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace";
    font-size: 12px;
    line-height: 1;
    white-space: pre-wrap;
    margin: 0;
    flex: 1;
    position: relative;
    z-index: 2;
    color: var(--color-text-primary);
  }

  .wasm-diff {
    position: relative;
  }

  .diff-line {
    position: relative;
    padding: 0;
    line-height: 1;
    font-family: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace";
    font-size: 12px;
  }

  .diff-line::before {
    content: attr(data-line);
    position: absolute;
    left: -44px;
    width: 32px;
    text-align: right;
    color: var(--color-text-tertiary);
    font-family: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace";
    font-size: 12px;
    line-height: 1;
    user-select: none;
    padding-right: 8px;
    background: transparent;
  }

  .plain-output {
    counter-reset: line;
  }

  .plain-output::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 8px;
    bottom: 8px;
    width: 32px;
    background: repeating-linear-gradient(
      to bottom,
      transparent,
      transparent calc(1.4em - 1px),
      var(--color-text-tertiary) calc(1.4em - 1px),
      var(--color-text-tertiary) 1.4em
    );
    opacity: 0.3;
  }

  .codemirror-output-wrapper.expanded .actual-output-content {
    max-height: none;
  }

  .codemirror-output-wrapper:not(.expanded) .actual-output-content {
    max-height: 200px;
  }

  .wasm-diff {
    font-family: monospace;
    white-space: pre-wrap;
    line-height: 1.4;
  }

  .plain-output {
    font-family: monospace;
    white-space: pre-wrap;
    line-height: 1.4;
    margin: 0;
  }

  .no-output-message {
    color: var(--color-text-tertiary);
    font-style: italic;
  }

  .diff-added-line {
    background-color: #f0fdf4; /* light green background */
    display: block;
    width: 100%;
    border-left: 3px solid #10b981;
    padding-left: 4px;
    margin-left: -7px;
    font-family: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace";
    font-size: 12px;
    line-height: 1;
  }

  .diff-matched-line {
    background-color: #f0fdf4; /* lighter green */
    display: block;
    width: 100%;
    border-left: 3px solid #22c55e;
    padding-left: 4px;
    margin-left: -7px;
    color: #15803d;
    font-family: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace";
    font-size: 12px;
    line-height: 1;
  }

  .diff-removed-line {
    background-color: #fee2e2; /* light red background */
    display: block;
    width: 100%;
    border-left: 3px solid #dc2626;
    padding-left: 4px;
    margin-left: -7px;
    color: #b91c1e;
    font-family: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace";
    font-size: 12px;
    line-height: 1;
  }

  .highlight-line {
    background-color: #fee2e2; /* light red background */
    display: block;
    width: 100%;
    border-left: 3px solid #ef4444;
    padding-left: 4px;
    margin-left: -7px;
    color: #b91c1e;
    font-family: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace";
    font-size: 12px;
    line-height: 1;
  }

  .highlight-diff {
    background-color: #fca5a5; /* highlighted diff */
    color: #991b1b;
    border-bottom: 1px dashed #ef4444;
    font-family: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace";
    font-size: 12px;
    line-height: 1;
  }

  /* Perfect alignment - identical structure for both sides */
  .output-wrapper {
    display: flex;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-bg-secondary);
    min-height: 60px;
    overflow: hidden;
  }

  .output-wrapper.expanded {
    max-height: none;
  }

  .output-wrapper:not(.expanded) {
    max-height: 200px;
  }

  .line-numbers-gutter {
    width: 40px;
    background: transparent;
    border-right: 1px solid var(--color-border-light);
    padding: 8px 0;
    font-family: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace";
    font-size: 12px;
    line-height: 1.5;
    color: var(--color-text-tertiary);
    user-select: none;
    overflow: hidden;
    flex-shrink: 0;
  }

  .line-number {
    text-align: right;
    padding: 0 8px 0 0;
    height: 1.5em;
    line-height: 1.5;
  }

  .output-content {
    flex: 1;
    padding: 8px 12px;
		font-family: var(--font-mono) !important;
		white-space: pre-wrap !important;
		line-height: 1.5 !important;
    font-size: 12px;
    color: var(--color-text-primary);
    white-space: pre-wrap;
    overflow: auto;
    outline: none;
    min-height: 44px;
  }

  .output-content[contenteditable="true"] {
    cursor: text;
  }

  .output-content[contenteditable="true"]:focus {
    background: var(--color-bg-textarea);
  }

  .wasm-diff, .plain-output {
    font-family: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace";
    font-size: 12px;
    line-height: 1.5;
    margin: 0;
    white-space: pre-wrap;
  }

  .no-output-message {
    color: var(--color-text-tertiary);
    font-style: italic;
  }

  /* Dark mode styles */
  @media (prefers-color-scheme: dark) {
    .actual-output-content {
      background: rgba(75, 85, 99, 0.2);
      border-color: #6b7280;
      color: #d1d5db;
    }

    .diff-added-line {
      background-color: rgba(16, 185, 129, 0.1);
      border-left: 3px solid #10b981;
      color: #4ade80;
    }

    .diff-matched-line {
      background-color: rgba(34, 197, 94, 0.1);
      border-left: 3px solid #22c55e;
      color: #4ade80;
    }

    .diff-removed-line {
      background-color: rgba(220, 38, 38, 0.1);
      border-left: 3px solid #dc2626;
      color: #fca5a5;
    }

    .highlight-line {
      background-color: rgba(239, 68, 68, 0.1);
      border-left: 3px solid #ef4444;
      color: #fca5a5;
    }

    .highlight-diff {
      background-color: rgba(239, 68, 68, 0.25);
      color: #fca5a5;
      border-bottom: 1px dashed #ef4444;
    }

    .no-output-message {
      color: #9ca3af;
    }
  }
</style>
