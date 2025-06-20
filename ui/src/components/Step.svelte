<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import SimpleCodeMirror from './SimpleCodeMirror.svelte';
  import OutputCodeMirror from './OutputCodeMirror.svelte';
  import { 
    ScrollSyncManager, 
    getStatusIcon, 
    highlightDifferences, 
    formatDuration, 
    parseActualOutputContent,
    getActualOutputContent 
  } from './StepLogic.js';

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

  // Output elements for scroll sync
  let expectedOutputEl: HTMLElement;
  let actualOutputEl: HTMLElement;

  // Initialize scroll sync manager
  const scrollSyncManager = new ScrollSyncManager();

  // Update editor views when components are ready
  $: if (expectedCodeMirror?.getEditorView) {
    expectedEditorView = expectedCodeMirror.getEditorView();
  }

  $: if (actualCodeMirror?.getEditorView) {
    actualEditorView = actualCodeMirror.getEditorView();
  }

  // Wrapper function for scroll sync
  function syncScroll(fromExpected: boolean) {
    scrollSyncManager.syncScroll(fromExpected, expectedOutputEl, actualOutputEl);
  }

  // Output scroll action wrapper
  function initOutputScroll(node: HTMLElement, isExpected: boolean) {
    return scrollSyncManager.initOutputScroll(node, isExpected, expectedOutputEl, actualOutputEl);
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

  // Enhanced input handler that also syncs scroll position
  function handleExpectedOutputInput(e: any) {
    try {
      const newValue = e.target?.textContent || '';

      // Dispatch the update without direct mutation
      dispatch('updateExpectedOutput', { index, newValue });
      
      // Also sync scroll position after content change
      setTimeout(() => {
        if (!scrollSyncManager.isScrollSyncing) {
          syncScroll(true);
        }
      }, 0);
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
    event.stopPropagation();
    if (!command.isOutputExpanded) {
      dispatch('toggleExpansion', { index, expanded: true });
    }
  }

  // Handle expansion on actual output click
  function handleActualOutputClick(event: MouseEvent) {
    event.stopPropagation();
    if (!command.isOutputExpanded) {
      dispatch('toggleExpansion', { index, expanded: true });
    }
  }

  // Handle focus to expand
  function handleOutputFocus(event: FocusEvent) {
    if (!command.isOutputExpanded) {
      dispatch('toggleExpansion', { index, expanded: true });
    }
  }

  // Handle click on content to expand
  function handleContentClick(event: MouseEvent) {
    event.stopPropagation();
    if (!command.isOutputExpanded) {
      dispatch('toggleExpansion', { index, expanded: true });
    }
  }

  // Handle copying actual output to expected output
  function handleUseActual(event: MouseEvent) {
    event.stopPropagation();
    const actualContent = getActualOutputContent(command.actualOutput);
    if (actualContent) {
      dispatch('updateExpectedOutput', { index, newValue: actualContent });
      
      // Add visual feedback
      const button = event.target as HTMLElement;
      button.style.transform = 'scale(0.9)';
      button.style.color = 'var(--color-bg-accent)';
      setTimeout(() => {
        button.style.transform = '';
        button.style.color = '';
      }, 150);
    }
  }

  // Handle blur to collapse when moving out
  function handleOutputBlur(event: FocusEvent) {
    // Small delay to check if focus moved to related element
    setTimeout(() => {
      if (command.isOutputExpanded) {
        const activeElement = document.activeElement;
        const outputGrid = activeElement?.closest('.output-grid');
        if (!outputGrid) {
          dispatch('toggleExpansion', { index, expanded: false });
        }
      }
    }, 100);
  }

  // Global click listener for clicking outside
  let outputGridEl: HTMLElement;

  onMount(() => {
    const handleGlobalClick = (event: Event) => {
      if (command.isOutputExpanded && outputGridEl) {
        const target = event.target as HTMLElement;
        const isInsideOutputGrid = outputGridEl.contains(target);
        if (!isInsideOutputGrid) {
          dispatch('toggleExpansion', { index, expanded: false });
        }
      }
    };

    // Use capture phase to ensure we catch clicks before they bubble
    document.addEventListener('click', handleGlobalClick, true);

    // Intersection Observer for performance optimization
    let observer: IntersectionObserver;
    if (outputGridEl) {
      observer = new IntersectionObserver(
        (entries) => {
          scrollSyncManager.setVisible(entries[0].isIntersecting);
        },
        { threshold: 0.1 }
      );
      observer.observe(outputGridEl);
    }

    return () => {
      document.removeEventListener('click', handleGlobalClick, true);
      if (observer) {
        observer.disconnect();
      }
    };
  });

  onDestroy(() => {
    scrollSyncManager.cleanup();
  });
</script>

<div class="command-card {((command.status === 'failed' || command.error) && !command.initializing) ? 'failed-command' : ''} {command.type === 'block' ? 'block-command' : ''} {command.isBlockCommand ? 'is-block-command' : ''} {command.isNested ? 'nested-command' : ''}\" style={command.isNested ? `margin-left: ${command.nestingLevel * 20}px;` : ''}>
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
      <div class="output-grid {command.isOutputExpanded ? 'has-expanded-outputs' : ''}" bind:this={outputGridEl}>
        <div class="output-column">
          <div class="output-header">
            <span class="output-indicator expected-indicator"></span>
            <label for={`expected-output-${index}`}>Expected Output</label>
            {#if command.actualOutput && getActualOutputContent(command.actualOutput)}
              <button class="use-actual-link" on:click={handleUseActual} title="Copy actual output to expected output">
                (use actual)
              </button>
            {/if}
          </div>
          <div class="output-wrapper {command.isOutputExpanded ? 'expanded' : ''}" on:click={handleExpectedOutputClick}>
            <div 
              class="output-content" 
              contenteditable="true" 
              bind:this={expectedOutputEl}
              on:input={handleExpectedOutputInput}
              on:blur={handleOutputBlur}
              on:focus={handleOutputFocus}
              on:click={handleContentClick}
              use:initOutputScroll={true}
            >
              {command.expectedOutput || ''}
            </div>
          </div>
        </div>
        <div class="output-column">
          <div class="output-header">
            <span class="output-indicator actual-indicator"></span>
            <label for={`actual-output-${index}`}>Actual Output</label>
          </div>
          <div class="output-wrapper {command.isOutputExpanded ? 'expanded' : ''}" on:click={handleActualOutputClick}>
            <div 
              class="output-content"
              bind:this={actualOutputEl}
              on:blur={handleOutputBlur}
              on:click={handleContentClick}
              use:initOutputScroll={false}
              tabindex="0"
              on:focus={handleOutputFocus}
            >
              {#if command.actualOutput}
                {#await highlightDifferences(getActualOutputContent(command.actualOutput), command.expectedOutput || '', wasmLoaded, patternMatcher)}
                  <pre class="plain-output">{getActualOutputContent(command.actualOutput)}</pre>
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
  /* All the existing styles from Step.svelte */
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

  .use-actual-link {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    transition: all 0.2s ease;
    margin-left: 4px;
  }

  .use-actual-link:hover {
    color: var(--color-bg-accent);
    background-color: rgba(var(--color-accent-rgb, 80, 70, 228), 0.1);
  }

  .use-actual-link:active {
    transform: scale(0.95);
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
    background-color: var(--color-bg-error, #fee2e2);
    color: var(--color-text-error, #dc2626);
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
    cursor: pointer;
    transition: max-height 0.3s ease-in-out;
  }

  .output-wrapper.expanded {
    max-height: none;
    cursor: default;
  }

  .output-wrapper:not(.expanded) {
    max-height: 72px; /* ~3 lines at 1.5 line-height + padding */
  }

  .output-wrapper:not(.expanded):hover {
    border-color: var(--color-bg-accent);
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
    overflow-y: auto;
    outline: none;
    min-height: 44px;
    position: relative;
    cursor: pointer;
  }

  .output-content[contenteditable="true"] {
    cursor: text;
  }

  .output-content[contenteditable="true"]:focus {
    background: var(--color-bg-textarea);
    cursor: text;
  }

  .output-content:focus {
    background: var(--color-bg-textarea);
  }

  /* Ensure actual output is focusable and clickable */
  .output-content[tabindex="0"] {
    cursor: pointer;
  }

  .output-content[tabindex="0"]:focus {
    background: var(--color-bg-textarea);
  }

  /* Show ellipsis when collapsed - but allow scrolling */
  .output-wrapper:not(.expanded) .output-content {
    max-height: 56px; /* ~3 lines at 1.5 line-height */
    overflow-y: auto;
    position: relative;
  }

  .output-wrapper:not(.expanded) .output-content::after {
    content: '';
    position: absolute;
    bottom: 0;
    right: 0;
    width: 100%;
    height: 1.5em;
    background: linear-gradient(to bottom, transparent, var(--color-bg-secondary));
    pointer-events: none;
  }

  /* Add expand indicator */
  .output-wrapper:not(.expanded)::before {
    content: '⌄';
    position: absolute;
    bottom: 4px;
    right: 8px;
    color: var(--color-text-tertiary);
    font-size: 14px;
    z-index: 10;
    pointer-events: none;
    opacity: 0.7;
  }

  .output-wrapper.expanded::before {
    content: '⌃';
    position: absolute;
    bottom: 4px;
    right: 8px;
    color: var(--color-text-tertiary);
    font-size: 14px;
    z-index: 10;
    pointer-events: none;
    opacity: 0.7;
  }

  .output-wrapper.expanded .output-content {
    overflow-y: auto;
    max-height: 400px;
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