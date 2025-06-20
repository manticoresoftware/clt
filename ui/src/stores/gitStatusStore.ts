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
  lastUpdated: null
};

function createGitStatusStore() {
  const { subscribe, set, update } = writable<GitStatusState>(initialState);

  let pollInterval: number | null = null;

  return {
    subscribe,
    
    // Fetch git status once
    fetchGitStatus: async () => {
      update(state => ({ ...state, isLoading: true, error: null }));
      
      try {
        const response = await fetch(`${API_URL}/api/git-status`, {
          credentials: 'include'
        });
        
        console.log('Git status response:', response.status, response.statusText);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch git status: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Git status data:', data);
        
        if (data.success) {
          update(state => ({
            ...state,
            isLoading: false,
            currentBranch: data.currentBranch,
            isPrBranch: data.isPrBranch,
            hasChanges: data.hasChanges,
            modifiedFiles: data.modifiedFiles || [],
            modifiedDirs: data.modifiedDirs || [],
            testPath: data.testPath || 'test/clt-tests',
            lastUpdated: Date.now(),
            error: null
          }));
        } else {
          throw new Error(data.error || 'Git status request failed');
        }
      } catch (error) {
        console.error('Error fetching git status:', error);
        update(state => ({
          ...state,
          isLoading: false,
          error: error.message
        }));
      }
    },
    
    // Start periodic polling
    startPolling: (intervalMs: number = 5000) => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      
      // Fetch immediately
      gitStatusStore.fetchGitStatus();
      
      // Then poll periodically
      pollInterval = setInterval(() => {
        gitStatusStore.fetchGitStatus();
      }, intervalMs);
    },
    
    // Stop polling
    stopPolling: () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
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
    }
  };
}

export const gitStatusStore = createGitStatusStore();