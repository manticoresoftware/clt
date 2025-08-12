<script lang="ts">
  export let diffContent: string = '';
  export let className: string = 'diff-content';

  function highlightDiff(content: string): string {
    return content
      .replace(/^(diff --git .+)$/gm, '<span class="diff-header">$1</span>')
      .replace(/^(index .+)$/gm, '<span class="diff-index">$1</span>')
      .replace(/^(\+\+\+ .+)$/gm, '<span class="diff-file-new">$1</span>')
      .replace(/^(--- .+)$/gm, '<span class="diff-file-old">$1</span>')
      .replace(/^(@@ .+ @@)(.*)$/gm, '<span class="diff-hunk">$1</span><span class="diff-hunk-context">$2</span>')
      .replace(/^(\+.*)$/gm, '<span class="diff-line-added">$1</span>')
      .replace(/^(-.*)$/gm, '<span class="diff-line-removed">$1</span>')
      .replace(/^( .*)$/gm, '<span class="diff-line-context">$1</span>');
  }
</script>

<pre class={className}>{@html highlightDiff(diffContent)}</pre>

<style>
  :global(.diff-content) {
    font-family: var(--font-family-mono);
    font-size: 12px;
    line-height: 1.45;
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    border-radius: 6px;
    overflow: auto;
    max-height: 400px;
    padding: 12px;
    margin: 0;
    white-space: pre-wrap;
    border: 1px solid var(--color-border);
  }

  /* Theme-adaptive diff highlighting */
  :global(.diff-content .diff-header) {
    color: var(--color-text-accent, #3b82f6);
    font-weight: 600;
  }

  :global(.diff-content .diff-index) {
    color: var(--color-text-tertiary);
  }

  :global(.diff-content .diff-file-new) {
    color: var(--color-success, #22c55e);
    font-weight: 600;
  }

  :global(.diff-content .diff-file-old) {
    color: var(--color-danger, #ef4444);
    font-weight: 600;
  }

  :global(.diff-content .diff-hunk) {
    color: var(--color-text-accent, #3b82f6);
    font-weight: 600;
  }

  :global(.diff-content .diff-hunk-context) {
    color: var(--color-text-secondary);
  }

  :global(.diff-content .diff-line-added) {
    background: var(--color-bg-success, rgba(34, 197, 94, 0.1));
    color: var(--color-success, #22c55e);
    border-left: 3px solid var(--color-success, #22c55e);
    padding-left: 8px;
    margin-left: -8px;
  }

  :global(.diff-content .diff-line-removed) {
    background: var(--color-bg-danger, rgba(239, 68, 68, 0.1));
    color: var(--color-danger, #ef4444);
    border-left: 3px solid var(--color-danger, #ef4444);
    padding-left: 8px;
    margin-left: -8px;
  }

  :global(.diff-content .diff-line-context) {
    color: var(--color-text-primary);
  }

  /* Scrollbar styling */
  :global(.diff-content::-webkit-scrollbar) {
    width: 8px;
    height: 8px;
  }

  :global(.diff-content::-webkit-scrollbar-track) {
    background: var(--color-bg-secondary);
    border-radius: 4px;
  }

  :global(.diff-content::-webkit-scrollbar-thumb) {
    background: var(--color-border-medium, #6b7280);
    border-radius: 4px;
  }

  :global(.diff-content::-webkit-scrollbar-thumb:hover) {
    background: var(--color-border-dark, #4b5563);
  }
</style>