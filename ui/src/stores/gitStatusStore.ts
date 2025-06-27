import { writable } from 'svelte/store';
import { API_URL } from '../config.js';

export interface GitFileStatus {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '??' | string; // M=Modified, A=Added, D=Deleted, R=Renamed, C=Copied, U=Unmerged, ??=Untracked
}

export interface GitStatusState {
  currentBranch: string;
  isPrBranch: boolean;
  hasChanges: boolean;
  modifiedFiles: GitFileStatus[];
  modifiedDirs: string[];
  testPath: string;
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
  isPaused: boolean; // Flag to pause updates when modal is open
}

const initialState: GitStatusState = {
  currentBranch: 'master',
  isPrBranch: false,
  hasChanges: false,
  modifiedFiles: [],
  modifiedDirs: [],
  testPath: 'test/clt-tests',
  isLoading: false,
  error: null,
  lastUpdated: null,
  isPaused: false
};

function createGitStatusStore() {
  const { subscribe, set, update } = writable<GitStatusState>(initialState);

  let pollInterval: number | null = null;
  let isPollingActive = false;

  return {
    subscribe,
    
    // Fetch git status once
    fetchGitStatus: async () => {
      update(state => ({ ...state, isLoading: true, error: null }));
      
      try {
        console.log('Fetching git status from:', `${API_URL}/api/git-status`);
        
        const response = await fetch(`${API_URL}/api/git-status`, {
          credentials: 'include'
        });
        
        console.log('Git status response:', response.status, response.statusText);
        
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('GitHub authentication required');
          }
          if (response.status === 404) {
            throw new Error('Repository not found');
          }
          
          // Try to get error details from response
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorData = await response.json();
            if (errorData.error) {
              errorMessage = errorData.error;
            }
          } catch (e) {
            // Ignore JSON parsing error, use default message
          }
          
          throw new Error(errorMessage);
        }
        
        const data = await response.json();
        console.log('Git status data:', data);
        
        // Check if response contains error
        if (data.error) {
          throw new Error(data.error);
        }
        
        let hasChanges = false;
        let modifiedFiles: GitFileStatus[] = [];
        let modifiedDirs: string[] = [];
        let currentBranch = 'main';
        let isPrBranch = false;
        
        // Handle different response formats
        if (data.success !== undefined) {
          // Format from existing endpoint that returns { success: true, hasChanges, modifiedFiles, ... }
          hasChanges = data.hasChanges || false;
          modifiedFiles = data.modifiedFiles || [];
          modifiedDirs = data.modifiedDirs || [];
          currentBranch = data.currentBranch || 'main';
          isPrBranch = data.isPrBranch || false;
        } else if (data.files) {
          // Format from /api/git-status endpoint that returns { hasUnstagedChanges, files: { modified, not_added, ... } }
          hasChanges = data.hasUnstagedChanges || !data.isClean;
          
          // Convert backend file arrays to GitFileStatus format
          if (data.files.modified) {
            modifiedFiles.push(...data.files.modified.map(path => ({ path, status: 'M' as const })));
          }
          if (data.files.not_added) {
            modifiedFiles.push(...data.files.not_added.map(path => ({ path, status: '??' as const })));
          }
          if (data.files.deleted) {
            modifiedFiles.push(...data.files.deleted.map(path => ({ path, status: 'D' as const })));
          }
          if (data.files.conflicted) {
            modifiedFiles.push(...data.files.conflicted.map(path => ({ path, status: 'U' as const })));
          }
          if (data.files.staged) {
            modifiedFiles.push(...data.files.staged.map(path => ({ path, status: 'A' as const })));
          }
          
          // Extract unique directories from modified files
          modifiedDirs = [...new Set(
            modifiedFiles
              .map(file => file.path.split('/').slice(0, -1).join('/'))
              .filter(dir => dir.length > 0)
          )];
          
          currentBranch = data.currentBranch || 'main';
          // Let server determine isPrBranch based on branch name OR existing PR
          isPrBranch = data.isPrBranch || false;
        }

        update(state => ({
          ...state,
          isLoading: false,
          currentBranch,
          isPrBranch,
          hasChanges,
          modifiedFiles,
          modifiedDirs,
          testPath: 'test/clt-tests',
          lastUpdated: Date.now(),
          error: null
        }));
        
      } catch (error) {
        console.error('Error fetching git status:', error);
        update(state => ({
          ...state,
          isLoading: false,
          error: error.message
        }));
      }
    },
    
    // Start periodic polling (only allow one active polling instance)
    startPolling: (intervalMs: number = 5000) => {
      // If already polling, don't start another instance
      if (isPollingActive) {
        console.log('Git status polling already active, ignoring duplicate start request');
        return;
      }
      
      // Clear any existing interval
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      
      isPollingActive = true;
      console.log(`Starting git status polling with ${intervalMs}ms interval`);
      
      // Fetch immediately
      gitStatusStore.fetchGitStatus();
      
      // Then poll periodically
      pollInterval = setInterval(() => {
        // Check if polling is paused before fetching
        let currentState: GitStatusState;
        const unsubscribe = subscribe(state => {
          currentState = state;
        });
        unsubscribe();
        
        if (!currentState!.isPaused) {
          gitStatusStore.fetchGitStatus();
        }
      }, intervalMs);
    },
    
    // Stop polling
    stopPolling: () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      isPollingActive = false;
      console.log('Git status polling stopped');
    },
    
    // Force restart polling (useful when multiple components try to start)
    restartPolling: (intervalMs: number = 5000) => {
      gitStatusStore.stopPolling();
      isPollingActive = false; // Ensure flag is reset
      gitStatusStore.startPolling(intervalMs);
    },
    
    // Check if polling is currently active
    isPolling: () => isPollingActive,
    
    // Pause/resume polling (for when modal is open)
    pausePolling: () => {
      update(state => ({ ...state, isPaused: true }));
    },
    
    resumePolling: () => {
      update(state => ({ ...state, isPaused: false }));
    },
    
    // Get status for a specific file path
    getFileStatus: (filePath: string): string | null => {
      let currentState: GitStatusState;
      const unsubscribe = subscribe(state => {
        currentState = state;
      });
      unsubscribe();
      
      const fileStatus = currentState!.modifiedFiles.find(file => file.path === filePath);
      return fileStatus ? fileStatus.status : null;
    },
    
    // Check if a directory has changes
    isDirModified: (dirPath: string): boolean => {
      let currentState: GitStatusState;
      const unsubscribe = subscribe(state => {
        currentState = state;
      });
      unsubscribe();
      
      return currentState!.modifiedDirs.includes(dirPath);
    },
    
    // Check for unstaged changes and prompt user if they exist
    checkUnstagedChanges: async (): Promise<boolean> => {
      // First ensure we have fresh git status
      await gitStatusStore.fetchGitStatus();
      
      let currentState: GitStatusState;
      const unsubscribe = subscribe(state => {
        currentState = state;
      });
      unsubscribe();
      
      // If no changes, proceed
      if (!currentState!.hasChanges) {
        return true;
      }
      
      // If there are changes, prompt user
      const fileCount = currentState!.modifiedFiles.length;
      const fileList = currentState!.modifiedFiles
        .slice(0, 5) // Show first 5 files
        .map(file => `  ${file.status} ${file.path}`)
        .join('\n');
      
      const moreFiles = fileCount > 5 ? `\n  ... and ${fileCount - 5} more files` : '';
      
      const message = `You have ${fileCount} unstaged change${fileCount > 1 ? 's' : ''} in your working directory:\n\n${fileList}${moreFiles}\n\nProceeding will potentially affect these changes. Do you want to continue?`;
      
      return confirm(message);
    },
    
    // Checkout a single file to discard changes
    checkoutFile: async (filePath: string): Promise<boolean> => {
      try {
        const response = await fetch(`${API_URL}/api/checkout-file`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ filePath })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          console.error('Checkout file failed:', data.error);
          alert(`Failed to checkout file: ${data.error}`);
          return false;
        }
        
        console.log('File checked out successfully:', data.message);
        
        // Refresh git status after checkout
        await gitStatusStore.fetchGitStatus();
        
        return true;
      } catch (error) {
        console.error('Error checking out file:', error);
        alert(`Error checking out file: ${error.message}`);
        return false;
      }
    }
  };
}

export const gitStatusStore = createGitStatusStore();

// Export functions for direct import
export const checkUnstagedChanges = gitStatusStore.checkUnstagedChanges;
export const checkoutFile = gitStatusStore.checkoutFile;