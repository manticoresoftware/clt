<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { Fzf } from 'fzf';

  export let branches: string[] = [];
  export let value = '';
  export let placeholder = 'e.g., master, main, feature/xyz';
  export let disabled = false;

  const dispatch = createEventDispatcher();
  
  let inputElement: HTMLInputElement;
  let searchQuery = '';
  let searchResults: Array<{ item: string; score: number; positions: Set<number> }> = [];
  let selectedIndex = 0;
  let showDropdown = false;
  let fzf: Fzf<string>;
  let isSelecting = false; // Flag to completely disable dropdown logic
  let userInteracted = false; // Only show dropdown after user actually types or clicks

  // Initialize fzf when branches change
  $: if (branches.length > 0) {
    fzf = new Fzf(branches, {
      selector: (item) => item,
      casing: 'case-insensitive',
    });
  }

  // Perform search when query changes - ONLY if user interacted and not selecting
  $: if (!isSelecting && userInteracted && fzf && searchQuery.trim()) {
    performSearch();
  } else if (!isSelecting && userInteracted) {
    clearResults();
  }

  function performSearch() {
    if (!fzf || isSelecting || !userInteracted) return;
    
    const results = fzf.find(searchQuery.trim());
    searchResults = results.slice(0, 8).map(result => ({
      item: result.item,
      score: result.score,
      positions: result.positions
    }));
    selectedIndex = 0;
    showDropdown = searchResults.length > 0;
  }

  function clearResults() {
    if (isSelecting) return;
    searchResults = [];
    selectedIndex = 0;
    showDropdown = false;
  }

  // Handle input changes - mark as user interaction
  function handleInput(event: Event) {
    if (isSelecting) return; // Block all input during selection
    
    // Mark that user is actually typing
    userInteracted = true;
    
    const target = event.target as HTMLInputElement;
    searchQuery = target.value;
    value = target.value;
    dispatch('input', { value: target.value });
  }

  // Handle keyboard navigation
  function handleKeydown(event: KeyboardEvent) {
    if (!showDropdown) return;

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        closeDropdown();
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
          selectBranch(searchResults[selectedIndex].item);
        }
        break;
      case 'Tab':
        if (searchResults[selectedIndex]) {
          event.preventDefault();
          selectBranch(searchResults[selectedIndex].item);
        }
        break;
    }
  }

  // Select branch
  function selectBranch(branch: string) {
    // IMMEDIATELY disable all dropdown logic
    isSelecting = true;
    userInteracted = false; // Reset interaction flag
    
    // Force close dropdown
    showDropdown = false;
    searchResults = [];
    selectedIndex = 0;
    
    // Clear the input since branch is shown above
    value = '';
    searchQuery = '';
    
    // Update input and blur
    if (inputElement) {
      inputElement.value = '';
      inputElement.blur();
    }
    
    // Dispatch selection with the branch
    dispatch('select', { branch });
    
    // Keep selection flag active for longer
    setTimeout(() => {
      isSelecting = false;
    }, 1000);
  }

  // Close dropdown
  function closeDropdown() {
    showDropdown = false;
    searchResults = [];
    selectedIndex = 0;
  }

  // Handle focus - only show dropdown if user has interacted
  function handleFocus() {
    if (isSelecting || !userInteracted) return; // Don't show dropdown unless user typed
    if (searchQuery.trim() && searchResults.length > 0) {
      showDropdown = true;
    }
  }

  // Handle blur with delay to allow clicks
  function handleBlur() {
    if (isSelecting) return; // Don't close if selecting
    setTimeout(() => {
      if (!showDropdown || isSelecting) return;
      showDropdown = false;
      searchResults = [];
      selectedIndex = 0;
    }, 200);
  }

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

  // Get branch icon
  function getBranchIcon(branch: string): string {
    if (branch.includes('main') || branch.includes('master')) {
      return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="6" cy="6" r="3"></circle>
        <circle cx="18" cy="18" r="3"></circle>
        <path d="M6 9v6a3 3 0 0 0 3 3h6"></path>
      </svg>`;
    }
    return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="6" cy="6" r="3"></circle>
      <circle cx="18" cy="6" r="3"></circle>
      <circle cx="6" cy="18" r="3"></circle>
      <path d="M18 9v6a3 3 0 0 1-3 3H9"></path>
      <path d="M6 9v6"></path>
    </svg>`;
  }
</script>

<div class="branch-selector">
  <input
    bind:this={inputElement}
    type="text"
    bind:value={searchQuery}
    {placeholder}
    {disabled}
    class="branch-input"
    on:input={handleInput}
    on:keydown={handleKeydown}
    on:focus={handleFocus}
    on:click={handleClick}
    on:blur={handleBlur}
    autocomplete="off"
    spellcheck="false"
  />
  
  {#if showDropdown && searchResults.length > 0}
    <div class="branch-dropdown">
      {#each searchResults as result, index}
        <button
          class="branch-option {index === selectedIndex ? 'selected' : ''}"
          on:mousedown|preventDefault|stopPropagation={() => selectBranch(result.item)}
          on:click|preventDefault|stopPropagation={() => selectBranch(result.item)}
          on:mouseenter={() => selectedIndex = index}
        >
          <div class="branch-icon">
            {@html getBranchIcon(result.item)}
          </div>
          <div class="branch-name">
            {@html highlightMatches(result.item, result.positions)}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .branch-selector {
    position: relative;
    width: 100%;
  }

  .branch-input {
    width: 100%;
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-sm);
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
    font-size: 12px;
    font-family: var(--font-mono);
    outline: none;
    transition: var(--transition-fast);
  }

  .branch-input:focus {
    border-color: var(--color-bg-accent);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  }

  .branch-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .branch-input::placeholder {
    color: var(--color-text-tertiary);
    font-size: 11px;
  }

  .branch-dropdown {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    background-color: var(--color-bg-primary);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-md);
    max-height: 200px;
    overflow-y: auto;
    z-index: 1000;
    margin-bottom: var(--spacing-xs);
  }

  .branch-option {
    width: 100%;
    display: flex;
    align-items: center;
    padding: var(--spacing-sm) var(--spacing-md);
    border: none;
    background: none;
    color: var(--color-text-primary);
    cursor: pointer;
    transition: var(--transition-fast);
    text-align: left;
    font-size: 12px;
    font-family: var(--font-mono);
  }

  .branch-option:hover,
  .branch-option.selected {
    background-color: var(--color-bg-hover);
  }

  .branch-option.selected {
    background-color: var(--color-bg-selected);
  }

  .branch-icon {
    margin-right: var(--spacing-sm);
    color: var(--color-text-secondary);
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .branch-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .branch-name :global(mark) {
    background-color: var(--color-bg-accent);
    color: var(--color-text-inverted);
    padding: 0;
    border-radius: 0;
    font-weight: 600;
  }

  /* Scrollbar styling */
  .branch-dropdown::-webkit-scrollbar {
    width: 4px;
  }

  .branch-dropdown::-webkit-scrollbar-track {
    background: var(--color-bg-secondary);
  }

  .branch-dropdown::-webkit-scrollbar-thumb {
    background: var(--color-border-medium);
    border-radius: var(--radius-sm);
  }

  .branch-dropdown::-webkit-scrollbar-thumb:hover {
    background: var(--color-border-dark);
  }
</style>