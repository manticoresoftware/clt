// StepLogic.js - Scroll synchronization, WASM diff highlighting, and utility functions

// Scroll synchronization logic
export class ScrollSyncManager {
  constructor() {
    this.isScrollSyncing = false;
    this.isVisible = true;
    this.scrollTimeout = null;
  }

  setVisible(visible) {
    this.isVisible = visible;
  }

  // Improved synchronized scroll function
  syncScroll(fromExpected, expectedOutputEl, actualOutputEl) {
    if (this.isScrollSyncing || !this.isVisible) return;
    
    this.isScrollSyncing = true;
    
    // Use requestAnimationFrame for smooth syncing
    requestAnimationFrame(() => {
      if (fromExpected && expectedOutputEl && actualOutputEl) {
        const maxScroll = expectedOutputEl.scrollHeight - expectedOutputEl.clientHeight;
        if (maxScroll > 0) {
          const scrollPercentage = expectedOutputEl.scrollTop / maxScroll;
          const targetMaxScroll = actualOutputEl.scrollHeight - actualOutputEl.clientHeight;
          actualOutputEl.scrollTop = scrollPercentage * Math.max(0, targetMaxScroll);
        }
      } else if (!fromExpected && actualOutputEl && expectedOutputEl) {
        const maxScroll = actualOutputEl.scrollHeight - actualOutputEl.clientHeight;
        if (maxScroll > 0) {
          const scrollPercentage = actualOutputEl.scrollTop / maxScroll;
          const targetMaxScroll = expectedOutputEl.scrollHeight - expectedOutputEl.clientHeight;
          expectedOutputEl.scrollTop = scrollPercentage * Math.max(0, targetMaxScroll);
        }
      }
      
      // Reset sync flag immediately after sync
      this.isScrollSyncing = false;
    });
  }

  // Throttled scroll handler for better performance
  createScrollHandler(isExpected, expectedOutputEl, actualOutputEl) {
    return () => {
      if (this.isScrollSyncing) return;
      
      // Cancel previous timeout
      if (this.scrollTimeout) {
        cancelAnimationFrame(this.scrollTimeout);
      }
      
      // Use requestAnimationFrame for smooth syncing
      this.scrollTimeout = requestAnimationFrame(() => {
        this.syncScroll(isExpected, expectedOutputEl, actualOutputEl);
        this.scrollTimeout = null;
      });
    };
  }

  // Output scroll action with comprehensive event handling
  initOutputScroll(node, isExpected, expectedOutputEl, actualOutputEl) {
    const handleScroll = this.createScrollHandler(isExpected, expectedOutputEl, actualOutputEl);
    
    // Also handle wheel events for immediate sync during fast scrolling
    const handleWheel = (e) => {
      if (!this.isScrollSyncing) {
        // Small delay to let the scroll happen first
        setTimeout(() => {
          if (!this.isScrollSyncing) {
            this.syncScroll(isExpected, expectedOutputEl, actualOutputEl);
          }
        }, 0);
      }
    };

    // Handle keyboard navigation that might cause scrolling
    const handleKeydown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
        setTimeout(() => {
          if (!this.isScrollSyncing) {
            this.syncScroll(isExpected, expectedOutputEl, actualOutputEl);
          }
        }, 0);
      }
    };

    node.addEventListener('scroll', handleScroll, { passive: true });
    node.addEventListener('wheel', handleWheel, { passive: true });
    node.addEventListener('keydown', handleKeydown, { passive: true });

    return {
      destroy: () => {
        node.removeEventListener('scroll', handleScroll);
        node.removeEventListener('wheel', handleWheel);
        node.removeEventListener('keydown', handleKeydown);
        if (this.scrollTimeout) {
          cancelAnimationFrame(this.scrollTimeout);
        }
      }
    };
  }

  cleanup() {
    if (this.scrollTimeout) {
      cancelAnimationFrame(this.scrollTimeout);
    }
  }
}

// Utility functions
export function getStatusIcon(status) {
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
  return '';
}

// Escape HTML special characters
export function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Highlight differences using the WASM module
export async function highlightDifferences(actual, expected, wasmLoaded, patternMatcher) {
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

export function formatDuration(ms) {
  if (ms === null) return '';
  return `${ms}ms`;
}

export function parseActualOutputContent(actualOutput) {
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

// Get actual output content without duration
export function getActualOutputContent(actualOutput) {
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