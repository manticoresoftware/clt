<script lang="ts">
  import { filesStore, type RecordingCommand } from '../stores/filesStore';
  import { onMount } from 'svelte';
  import { PatternMatcher } from '../../pkg/wasm_diff';
  import { API_URL } from '../config.js';
  import SimpleCodeMirror from './SimpleCodeMirror.svelte';

  // Add global TypeScript interface for window
  declare global {
    interface Window {
      patternMatcher: any;
      lastPatternRefresh: number;
    }
  }

  let wasmLoaded = false;
  let patternMatcher: any = null;
  let patterns = {};

  // Fetch patterns from server
  async function fetchPatterns() {
    try {
      const response = await fetch(`${API_URL}/api/get-patterns`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        patterns = data.patterns || {};
        console.log('Loaded patterns:', patterns);
        return patterns;
      } else {
        console.warn('Could not load patterns:', await response.text());
        return {};
      }
    } catch (err) {
      console.error('Error fetching patterns:', err);
      return {};
    }
  }

  // Initialize WASM module
  async function initWasm() {
    try {
      console.log('Initializing WASM diff module...');
      const module = await import('../../pkg/wasm_diff');
      await module.default();

      // Default patterns if API fails
      const defaultPatterns = {
        "NUMBER": "[0-9]+",
        "DATE": "[0-9]{4}\\-[0-9]{2}\\-[0-9]{2}",
        "DATETIME": "[0-9]{4}\\-[0-9]{2}\\-[0-9]{2}\\s[0-9]{2}:[0-9]{2}:[0-9]{2}",
        "IPADDR": "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+",
        "PATH": "[A-Za-z0-9\\/\\.\\-\\_]+",
        "SEMVER": "[0-9]+\\.[0-9]+\\.[0-9]+",
        "TIME": "[0-9]{2}:[0-9]{2}:[0-9]{2}",
        "YEAR": "[0-9]{4}"
      };

      // Fetch patterns first
      let patternsData;
      try {
        patternsData = await fetchPatterns();
        // If patterns is empty, use default patterns
        if (Object.keys(patternsData).length === 0) {
          console.log('No patterns returned from API, using defaults');
          patternsData = defaultPatterns;
        }
      } catch (err) {
        console.error('Failed to fetch patterns, using defaults:', err);
        patternsData = defaultPatterns;
      }

      // Initialize pattern matcher with fetched or default patterns
      patternMatcher = new PatternMatcher(JSON.stringify(patternsData));
      window.patternMatcher = patternMatcher;
      wasmLoaded = true;
      console.log('WASM diff module initialized successfully with patterns:', patternsData);
    } catch (err) {
      console.error('Failed to initialize WASM diff module:', err);
    }
  }

// arrays for our refs
  let expectedEls: HTMLElement[] = [];
  let actualEls: HTMLElement[] = [];

  /**
   * syncScroll
   * @param idx  index in the loop
   * @param fromExpected  if true, copy from expectedElems[idx] → actualElems[idx], else vice versa
   */
  function syncScroll(idx: number, fromExpected = true) {
    const from = fromExpected ? expectedEls[idx] : actualEls[idx];
    const to   = fromExpected ? actualEls[idx]   : expectedEls[idx];
    if (from && to) {
      to.scrollTop = from.scrollTop;
    }
  }

  let commands: RecordingCommand[] = [];
  let autoSaveEnabled = true;

  function duplicateCommand(index: number) {
    if ($filesStore.currentFile) {
      const command = commands[index];
      filesStore.addCommand(index + 1, command.command, command.type || 'command');
    }
  }

  function moveCommandUp(index: number) {
    if (index > 0 && $filesStore.currentFile) {
      const command = commands[index];
      filesStore.deleteCommand(index);
      filesStore.addCommand(index - 1, command.command, command.type || 'command');
    }
  }

  function moveCommandDown(index: number) {
    if (index < commands.length - 1 && $filesStore.currentFile) {
      const command = commands[index];
      filesStore.deleteCommand(index);
      filesStore.addCommand(index + 1, command.command, command.type || 'command');
    }
  }
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

    // Initialize WASM module for highlighting differences in the output
    initWasm();

    // Define global window property for pattern refresh tracking
    if (typeof window !== 'undefined') {
      window.lastPatternRefresh = 0;
    }
  });

  // Update localStorage when checkbox changes
  function toggleAutoSave() {
    autoSaveEnabled = !autoSaveEnabled;
    localStorage.setItem('autoSaveEnabled', String(autoSaveEnabled));
    console.log('Auto-save set to:', autoSaveEnabled);
  }

  function addCommand(index: number, commandType: 'command' | 'block' | 'comment' = 'command') {
    // Default placeholder text based on type
    let defaultText = '';

    if (commandType === 'block') {
      defaultText = 'path/to/file'; // Default placeholder for block references
    } else if (commandType === 'comment') {
      defaultText = 'Add your comment here'; // Default placeholder for comments
    }

    filesStore.addCommand(index, defaultText, commandType);
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
    // Create different status indicators for different item types
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
  // Now we iterate over diffResult.diff_lines directly so that each line is rendered:
  //   • unchanged lines are rendered as plain text
  //   • added lines are prefixed with a "+", styled with diff-added-line
  //   • removed lines are prefixed with a "−", styled with diff-removed-line
  //   • changed lines include character-level highlight spans if available.
  async function highlightDifferences(actual: string, expected: string): Promise<string> {
    try {
      if (!wasmLoaded || !patternMatcher) {
        console.log('WASM module not loaded yet, showing plain text');
        return escapeHtml(actual); // Return plain text if WASM isn't ready
      }

      // For real-time comparison, refresh patterns when showing the diff
      try {
        // Only refresh if we've gone more than 5 seconds since last refresh
        if (!window.lastPatternRefresh || (Date.now() - window.lastPatternRefresh > 5000)) {
          // Default patterns if API fails
          const defaultPatterns = {
            "NUMBER": "[0-9]+",
            "DATE": "[0-9]{4}\\-[0-9]{2}\\-[0-9]{2}",
            "DATETIME": "[0-9]{4}\\-[0-9]{2}\\-[0-9]{2}\\s[0-9]{2}:[0-9]{2}:[0-9]{2}",
            "IPADDR": "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+",
            "PATH": "[A-Za-z0-9\\/\\.\\-\\_]+",
            "SEMVER": "[0-9]+\\.[0-9]+\\.[0-9]+",
            "TIME": "[0-9]{2}:[0-9]{2}:[0-9]{2}",
            "YEAR": "[0-9]{4}"
          };

          let patternsData;
          try {
            patternsData = await fetchPatterns();
            // If patterns is empty, use default patterns
            if (Object.keys(patternsData).length === 0) {
              console.log('No patterns returned from API for refresh, using defaults');
              patternsData = defaultPatterns;
            }
          } catch (refreshErr) {
            console.warn('Could not refresh patterns, using defaults:', refreshErr);
            patternsData = defaultPatterns;
          }

          try {
            patternMatcher = new PatternMatcher(JSON.stringify(patternsData));
            window.patternMatcher = patternMatcher;
            window.lastPatternRefresh = Date.now();
            console.log('Refreshed patterns for real-time comparison:', patternsData);
          } catch (patternErr) {
            console.warn('Error creating pattern matcher:', patternErr);
          }
        }
      } catch (err) {
        console.warn('Error in pattern refresh logic:', err);
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

  // Function to copy current URL with file hash to clipboard.
  function copyShareUrl() {
    if (!$filesStore.currentFile) return;

    // Create URL with file hash.
    const url = new URL(window.location.href);
    // Remove existing query parameters.
    url.search = '';
    // Set hash to file-{path}.
    url.hash = `file-${encodeURIComponent($filesStore.currentFile.path)}`;

    // Copy to clipboard.
    navigator.clipboard.writeText(url.toString())
      .then(() => {
        // Show temporary notification.
        alert('Shareable link copied to clipboard!');
      })
      .catch(err => {
        console.error('Could not copy text: ', err);
        // Fallback: show the URL and ask user to copy manually.
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
              try {
                autoSaveEnabled = !autoSaveEnabled;
                localStorage.setItem('autoSaveEnabled', String(autoSaveEnabled));
                console.log('Auto-save toggled to:', autoSaveEnabled);
              } catch (err) {
                console.error('Error toggling auto-save:', err);
              }
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
          <div class="command-card {(command.status === 'failed' && !command.initializing) ? 'failed-command' : ''} {command.type === 'block' ? 'block-command' : ''} {command.isBlockCommand ? 'is-block-command' : ''}">
            <!-- Command header -->
            <div class="command-header">
              <div class="command-title">
                <span class="command-number">{i + 1}</span>
                {#if command.type === 'block'}
                  <span>Block Reference</span>
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
                <!-- Move Up Button -->
                <button
                  class="action-button move-up"
                  on:click={() => moveCommandUp(i)}
                  title="Move up"
                  aria-label="Move command up"
                  disabled={i === 0}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 15l-6-6-6 6"></path>
                  </svg>
                </button>

                <!-- Move Down Button -->
                <button
                  class="action-button move-down"
                  on:click={() => moveCommandDown(i)}
                  title="Move down"
                  aria-label="Move command down"
                  disabled={i === commands.length - 1}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 9l6 6 6-6"></path>
                  </svg>
                </button>

                <div class="action-separator"></div>

                <!-- Add Command Button -->
                <button
                  class="action-button add-command"
                  on:click={() => addCommand(i + 1, 'command')}
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
                  on:click={() => addCommand(i + 1, 'block')}
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
                  on:click={() => addCommand(i + 1, 'comment')}
                  title="Add comment"
                  aria-label="Add comment"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </button>

                <!-- Duplicate Button -->
                <button
                  class="action-button duplicate"
                  on:click={() => duplicateCommand(i)}
                  title="Duplicate"
                  aria-label="Duplicate command"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>

                <div class="action-separator"></div>

                <!-- Delete Button -->
                <button
                  class="action-button delete"
                  on:click={() => deleteCommand(i)}
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

            <!-- Command input -->
            <div class="command-body">
              {#if command.type === 'block'}
                <!-- Block reference input -->
                <SimpleCodeMirror
                  placeholder="Enter path to file (without .recb extension)"
                  bind:value={command.command}
                  on:input={(e) => {
                    try {
                      // Create a local copy of the value to avoid direct store manipulation
                      const newValue = e.target.value;

                      // Use a timeout to avoid reactive update cycles
                      setTimeout(() => {
                        filesStore.updateCommand(i, newValue);
                      }, 0);
                    } catch (err) {
                      console.error('Error updating block reference:', err);
                    }
                  }}
                />
              {:else if command.type === 'comment'}
                <!-- Comment input -->
                <SimpleCodeMirror
                  placeholder="Enter your comment here..."
                  bind:value={command.command}
                  on:input={(e) => {
                    try {
                      // Create a local copy of the value to avoid direct store manipulation
                      const newValue = e.target.value;

                      // Use a timeout to avoid reactive update cycles
                      setTimeout(() => {
                        filesStore.updateCommand(i, newValue);
                      }, 0);
                    } catch (err) {
                      console.error('Error updating comment:', err);
                    }
                  }}
                />
              {:else}
                <!-- Standard command input with syntax highlighting -->
                <SimpleCodeMirror
                  placeholder="Enter command..."
                  bind:value={command.command}
                  on:input={(e) => {
                    try {
                      // Create a local copy of the value to avoid direct store manipulation
                      const newValue = e.target.value;

                      // Use a timeout to avoid reactive update cycles
                      setTimeout(() => {
                        filesStore.updateCommand(i, newValue);
                      }, 0);
                    } catch (err) {
                      console.error('Error updating command:', err);
                    }
                  }}
                />

                <!-- Output section (only for regular commands) -->
                {#if !command.initializing}
                <div class="output-grid {command.isOutputExpanded ? 'has-expanded-outputs' : ''}">
                  <div class="output-column">
                    <div class="output-header">
                      <span class="output-indicator expected-indicator"></span>
                      <label for={`expected-output-${i}`}>Expected Output</label>
                    </div>
                    <textarea
                      id={`expected-output-${i}`}
                      class="expected-output {command.isOutputExpanded ? 'expanded' : ''}"
											bind:this={expectedEls[i]}
											on:scroll={() => syncScroll(i, true)}
                      placeholder="Expected output..."
                      rows="1"
                      bind:value={command.expectedOutput}
                      on:input={(e) => {
                        try {
                          // Auto-resize textarea based on content
                          e.target.style.height = 'auto';
                          e.target.style.height = Math.max(24, e.target.scrollHeight) + 'px';

                          // Use a local copy of the value to avoid direct store manipulation
                          const newValue = e.target.value || '';

                          // Use a timeout to avoid reactive update cycles
                          setTimeout(() => {
                            filesStore.updateExpectedOutput(i, newValue);

                            // Force a re-render of the diff - a small hack to make
                            // sure the diff updates in real-time as we type
                            if (command.actualOutput) {
                              const actualOutput = parseActualOutputContent(command.actualOutput);
                              const actualOutputElement = document.getElementById(`actual-output-${i}`);
                              if (actualOutputElement) {
                                highlightDifferences(actualOutput, newValue).then(diffHtml => {
                                  if (actualOutputElement.querySelector('.wasm-diff')) {
                                    actualOutputElement.querySelector('.wasm-diff').innerHTML = diffHtml;
                                  } else {
                                    actualOutputElement.innerHTML = `<div class="wasm-diff">${diffHtml}</div>`;
                                  }
                                });
                              }
                            }
                          }, 0);
                        } catch (err) {
                          console.error('Error updating expected output:', err);
                        }
                      }}
                      on:focus={() => {
                        // Expand both outputs when focusing on the expected output
                        filesStore.toggleOutputExpansion(i, true);
                      }}
                      on:click={() => {
                        // Also expand on click (helps with touch devices)
                        filesStore.toggleOutputExpansion(i, true);
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
                      class="actual-output {command.status === 'failed' ? 'failed-output' : ''} {command.isOutputExpanded ? 'expanded' : ''}"
											bind:this={actualEls[i]}
											on:scroll={() => syncScroll(i, false)}
                      role="region"
                      aria-label="Actual Output"
                      on:click={() => {
                        // Expand both outputs when clicking on actual output
                        filesStore.toggleOutputExpansion(i, true);
                      }}
                    >
                      {#if command.actualOutput}
                        {#await highlightDifferences(parseActualOutputContent(command.actualOutput), command.expectedOutput || '')}
                          <pre class="plain-output">{parseActualOutputContent(command.actualOutput)}</pre>
                        {:then diffHtml}
                          <div class="wasm-diff">{@html diffHtml}</div>
                        {/await}
                      {:else}
                        <span class="no-output-message">Empty output.</span>
                      {/if}
                    </div>
                  </div>
                </div>
                {/if}
              {/if}
            </div>
          </div>

        {/each}

        <!-- Add first command button if no commands -->
        {#if commands.length === 0}
          <div class="no-commands">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <h3>No Commands Yet</h3>
            <p>Add your first item to start building your test</p>
            <div class="first-command-buttons">
              <button
                class="add-first-command-button"
                on:click={() => addCommand(0, 'command')}
                aria-label="Add first command"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Add Command
              </button>

              <button
                class="add-first-block-button"
                on:click={() => addCommand(0, 'block')}
                aria-label="Add first block reference"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                Add Block
              </button>

              <button
                class="add-first-comment-button"
                on:click={() => addCommand(0, 'comment')}
                aria-label="Add first comment"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                Add Comment
              </button>
            </div>
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
    color: var(--color-text-primary);
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

  .block-status {
    background-color: var(--color-bg-info, #e0f2fe);
    color: var(--color-text-info, #0369a1);
  }

  /* Block command with its own status */
  .block-command .command-status.matched-status {
    border: 1px solid var(--color-text-success, #16a34a);
  }

  .block-command .command-status.failed-status {
    border: 1px solid var(--color-text-error, #dc2626);
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
    white-space: pre-wrap;
    line-height: 1.5;
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
    white-space: pre-wrap;
    line-height: 1.5;
  }

  /* Fallback diff note if needed */
  .diff-note {
    display: block;
    margin-top: 8px;
    padding: 4px 8px;
    background-color: #f3f4f6; /* gray-100 */
    border-left: 3px solid #6b7280;
    color: #4b5563;
    font-style: italic;
    border-radius: 0 4px 4px 0;
  }

  @media (prefers-color-scheme: dark) {
    .command-card.failed-command {
      border: 2px solid var(--color-text-error, #ef4444);
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
    }

    .diff-note {
      background-color: rgba(75, 85, 99, 0.2);
      border-left: 3px solid #6b7280;
      color: #d1d5db;
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
    padding: 8px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background-color: var(--color-bg-textarea);
    color: var(--color-text-primary);
    transition: border-color 0.2s ease-in-out;
    line-height: 1.5;
    overflow-y: hidden;
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
    cursor: pointer;
  }

  .actual-output.expanded {
    max-height: none;
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

  .duration-footer {
    display: block;
    margin-top: 8px;
    padding-top: 4px;
    font-size: 12px;
    color: var(--color-text-tertiary);
    border-top: 1px solid var(--color-border-light);
    text-align: center;
  }
  .add-command-button, .add-block-button, .add-comment-button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--color-border);
    background-color: var(--color-bg-secondary);
    color: var(--color-text-secondary);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 12px;
  }

  .add-commands-row {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin: 8px 0;
  }

  .add-command-button:hover, .add-block-button:hover, .add-comment-button:hover {
    background-color: var(--color-bg-accent);
    color: white;
    border-color: var(--color-bg-accent);
  }

  .first-command-buttons {
    display: flex;
    gap: 10px;
    margin-top: 15px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .add-first-command-button, .add-first-block-button, .add-first-comment-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background-color: var(--color-bg-accent);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .add-first-command-button:hover, .add-first-block-button:hover, .add-first-comment-button:hover {
    background-color: var(--color-bg-accent-hover);
  }</style>
