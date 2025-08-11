import { writable, get } from 'svelte/store';
import { API_URL } from '../config.js';
import { gitStatusStore } from './gitStatusStore.ts';

interface PrStatus {
  currentBranch: string;
  isPrBranch: boolean;
  existingPr: {
    url: string;
    title: string;
    number: number;
  } | null;
  recentCommits: Array<{
    hash: string;
    message: string;
    author: string;
    date: string;
    authorEmail: string;
  }>;
  hasChanges: boolean;
  timestamp: number;
}

interface PrState {
  isCommitting: boolean;
  error: string | null;
  success: boolean;
  message: string | null;
  prStatus: PrStatus | null;
  isLoadingStatus: boolean;
}

const initialState: PrState = {
  isCommitting: false,
  error: null,
  success: false,
  message: null,
  prStatus: null,
  isLoadingStatus: false
};

function createGithubStore() {
  const { subscribe, set, update } = writable<PrState>(initialState);

  const store = {
    subscribe,
    
    // Fetch PR status for current branch
    fetchPrStatus: async () => {
      update(state => ({ ...state, isLoadingStatus: true, error: null }));
      
      try {
        const response = await fetch(`${API_URL}/api/pr-status`, {
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch PR status: ${response.statusText}`);
        }
        
        const prStatus = await response.json();
        
        update(state => ({
          ...state,
          isLoadingStatus: false,
          prStatus,
          error: null
        }));
        
        return prStatus;
      } catch (error) {
        update(state => ({
          ...state,
          isLoadingStatus: false,
          error: error.message || 'Failed to fetch PR status'
        }));
        throw error;
      }
    },
    
    // Commit changes to existing PR branch
    commitChanges: async (message: string) => {
      update(state => ({ ...state, isCommitting: true, error: null, success: false }));
      
      try {
        const response = await fetch(`${API_URL}/api/commit-changes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ message })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to commit changes');
        }
        
        update(state => ({
          ...state,
          isCommitting: false,
          success: true,
          prUrl: data.pr || null,
          message: data.message || 'Changes committed successfully'
        }));
        
        // Don't auto-refresh here - let the modal handle it
        
        return data;
      } catch (error) {
        update(state => ({
          ...state,
          isCommitting: false,
          error: error.message || 'An error occurred while committing changes'
        }));
        throw error;
      }
    },
    reset: () => set(initialState),
    
    // Update PR status from external source (called by gitStatusStore)
    updatePrStatus: (prStatusData: Partial<PrStatus>) => {
      update(state => ({
        ...state,
        prStatus: state.prStatus ? { ...state.prStatus, ...prStatusData } : {
          currentBranch: prStatusData.currentBranch || '',
          isPrBranch: prStatusData.isPrBranch || false,
          existingPr: prStatusData.existingPr || null,
          recentCommits: prStatusData.recentCommits || [],
          hasChanges: prStatusData.hasChanges || false,
          timestamp: Date.now()
        }
      }));
    },
    
    // Start automatic PR status polling
    startPrStatusPolling: (intervalMs: number = 10000) => {
      // Fetch immediately
      store.fetchPrStatus();
      
      // Then poll periodically (less frequently than git status)
      setInterval(() => {
        store.fetchPrStatus();
      }, intervalMs);
    }
  };
  
  return store;
}

export const githubStore = createGithubStore();