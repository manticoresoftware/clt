<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { Fzf } from 'fzf';
  import type { FileNode } from '../stores/filesStore';
  import { shouldIgnoreFile } from '../constants/fileFilters';

  export let isOpen = false;
  export let fileTree: FileNode[] = [];

  const dispatch = createEventDispatcher();

  let searchInput: HTMLInputElement;
  let searchQuery = '';
  let searchResults: Array<{ item: string; score: number; positions: Set<number> }> = [];
  let selectedIndex = 0;
  let fzf: Fzf<string>;
  let allFilePaths: string[] = [];

  // Extract all file paths from the file tree, filtering out ignored extensions
  function extractFilePaths(nodes: FileNode[]): string[] {
    const paths: string[] = [];

    for (const node of nodes) {
      if (!node.isDirectory) {
        // Filter out ignored file extensions (.rep, .cmp)
        if (!shouldIgnoreFile(node.path)) {
          // Use the node.path directly as it's already the correct relative path from backend
          paths.push(node.path);
        }
      }

      if (node.children && node.children.length > 0) {
        paths.push(...extractFilePaths(node.children));
      }
    }

    return paths;
  }

  // Initialize fzf when fileTree changes
  $: if (fileTree.length > 0) {
    allFilePaths = extractFilePaths(fileTree);
    fzf = new Fzf(allFilePaths, {
      selector: (item) => item,
      casing: 'case-insensitive',
    });
  }

  // Perform search when query changes
  $: if (fzf && searchQuery.trim()) {
    const results = fzf.find(searchQuery.trim());
    searchResults = results.slice(0, 10).map(result => ({
      item: result.item,
      score: result.score,
      positions: result.positions
    }));
    selectedIndex = 0;
  } else {
    searchResults = [];
    selectedIndex = 0;
  }

  // Handle keyboard navigation
  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return;

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        closeModal();
        break;
      case 'ArrowDown':
        event.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, searchResults.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Enter':
        event.preventDefault();
        if (searchResults[selectedIndex]) {
          selectFile(searchResults[selectedIndex].item);
        }
        break;
    }
  }

  // Select and open file
  function selectFile(filePath: string) {
    dispatch('fileSelected', { filePath });
    closeModal();
  }

  // Close modal
  function closeModal() {
    isOpen = false;
    searchQuery = '';
    searchResults = [];
    selectedIndex = 0;
    dispatch('close');
  }

  // Focus input when modal opens
  $: if (isOpen && searchInput) {
    setTimeout(() => {
      searchInput.focus();
    }, 10);
  }

  // Get file type icon based on extension
  function getFileIcon(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();

    switch (extension) {
      case 'rec':
      case 'recb':
				return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="svelte-1uxufd3"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" class="svelte-1uxufd3"></path></svg>`;
      case 'js':
      case 'ts':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14,2 14,8 20,8"></polyline>
          <path d="M12 18v-6l3 3-3 3z" fill="currentColor"></path>
        </svg>`;
      case 'json':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14,2 14,8 20,8"></polyline>
          <path d="M9 12h6M9 16h6M9 8h2" stroke-width="1.5"></path>
        </svg>`;
      case 'md':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14,2 14,8 20,8"></polyline>
          <path d="M7 13l3-3 3 3M7 17h10" stroke-width="1.5"></path>
        </svg>`;
      default:
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14,2 14,8 20,8"></polyline>
        </svg>`;
    }
  }

  // Format file path for better display
  function formatFilePath(filePath: string): { directory: string; filename: string } {
    const parts = filePath.split('/');
    const filename = parts.pop() || '';
    const directory = parts.length > 0 ? parts.join('/') + '/' : '';
    return { directory, filename };
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeydown);
  });

  // Highlight matching characters
  function highlightMatches(text: string, positions: Set<number>): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      if (positions.has(i)) {
        result += `<mark>${text[i]}</mark>`;
      } else {
        result += text[i];
      }
    }
    return result;
  }
</script>

{#if isOpen}
  <div class="fuzzy-search-overlay" on:click={closeModal} role="button" tabindex="0">
    <div class="fuzzy-search-modal" on:click|stopPropagation role="dialog">
      <div class="search-header">
        <div class="search-input-container">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
          </svg>
          <input
            bind:this={searchInput}
            bind:value={searchQuery}
            type="text"
            placeholder="Search files..."
            class="search-input"
            autocomplete="off"
            spellcheck="false"
          />
          <kbd class="shortcut-hint">ESC</kbd>
        </div>
      </div>

      <div class="search-results">
        {#if searchQuery.trim() && searchResults.length === 0}
          <div class="no-results">
            <span>No files found for "{searchQuery}"</span>
          </div>
        {:else if searchResults.length > 0}
          {#each searchResults as result, index}
            <button
              class="search-result-item {index === selectedIndex ? 'selected' : ''}"
              on:click={() => selectFile(result.item)}
              on:mouseenter={() => selectedIndex = index}
            >
              <div class="file-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14,2 14,8 20,8"></polyline>
                </svg>
              </div>
              <div class="file-path">
                {@html highlightMatches(result.item, result.positions)}
              </div>
            </button>
          {/each}
        {:else if !searchQuery.trim()}
          <div class="search-hint">
            <span>Start typing to search files...</span>
          </div>
        {/if}
      </div>

      <div class="search-footer">
        <div class="search-shortcuts">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .fuzzy-search-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    z-index: 1000;
  }

  .fuzzy-search-modal {
    background-color: var(--color-bg-primary);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    width: 90%;
    max-width: 600px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .search-header {
    padding: var(--spacing-lg);
    border-bottom: 1px solid var(--color-border-light);
  }

  .search-input-container {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: var(--spacing-md);
    color: var(--color-text-secondary);
    z-index: 1;
  }

  .search-input {
    width: 100%;
    padding: var(--spacing-md) var(--spacing-xl) var(--spacing-md) 40px;
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-md);
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
    font-size: 16px;
    font-family: var(--font-sans);
    outline: none;
    transition: var(--transition-fast);
  }

  .search-input:focus {
    border-color: var(--color-bg-accent);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .search-input::placeholder {
    color: var(--color-text-tertiary);
  }

  .shortcut-hint {
    position: absolute;
    right: var(--spacing-md);
    background-color: var(--color-bg-tertiary);
    color: var(--color-text-secondary);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-family: var(--font-mono);
    border: 1px solid var(--color-border-light);
  }

  .search-results {
    flex: 1;
    overflow-y: auto;
    max-height: 400px;
  }

  .search-result-item {
    width: 100%;
    display: flex;
    align-items: center;
    padding: var(--spacing-md) var(--spacing-lg);
    border: none;
    background: none;
    color: var(--color-text-primary);
    cursor: pointer;
    transition: var(--transition-fast);
    text-align: left;
  }

  .search-result-item:hover {
    background-color: var(--color-bg-hover);
  }

  .search-result-item.selected {
    background-color: var(--color-bg-selected);
  }

  .file-icon {
    margin-right: var(--spacing-md);
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }

  .file-path {
    font-family: var(--font-mono);
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-path :global(mark) {
    background-color: var(--color-bg-accent);
    color: var(--color-text-inverted);
    padding: 0;
    border-radius: 0;
    font-weight: 600;
  }

  .no-results,
  .search-hint {
    padding: var(--spacing-xl) var(--spacing-lg);
    text-align: center;
    color: var(--color-text-secondary);
    font-style: italic;
  }

  .search-footer {
    padding: var(--spacing-md) var(--spacing-lg);
    border-top: 1px solid var(--color-border-light);
    background-color: var(--color-bg-secondary);
  }

  .search-shortcuts {
    display: flex;
    gap: var(--spacing-lg);
    font-size: 12px;
    color: var(--color-text-secondary);
    justify-content: center;
  }

  .search-shortcuts kbd {
    background-color: var(--color-bg-tertiary);
    color: var(--color-text-secondary);
    padding: 2px var(--spacing-xs);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 11px;
    border: 1px solid var(--color-border-light);
    margin-right: var(--spacing-xs);
  }

  /* Scrollbar styling */
  .search-results::-webkit-scrollbar {
    width: 6px;
  }

  .search-results::-webkit-scrollbar-track {
    background: var(--color-bg-secondary);
  }

  .search-results::-webkit-scrollbar-thumb {
    background: var(--color-border-medium);
    border-radius: var(--radius-sm);
  }

  .search-results::-webkit-scrollbar-thumb:hover {
    background: var(--color-border-dark);
  }
</style>
