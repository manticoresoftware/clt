import { writable } from 'svelte/store';
import { API_URL } from '../config.js';
import { filesStore } from './filesStore';

interface BranchState {
  currentBranch: string;
  defaultBranch: string;
  isResetting: boolean;
  isLoading: boolean;
  error: string | null;
  success: boolean;
  message: string | null;
}

const initialState: BranchState = {
  currentBranch: 'unknown', // Will be updated from the server
  defaultBranch: 'main', // Default branch name - will be updated from server
  isResetting: false,
  isLoading: false,
  error: null,
  success: false,
  message: null
};

function createBranchStore() {
  const { subscribe, set, update } = writable<BranchState>(initialState);

  return {
    subscribe,
    fetchCurrentBranch: async () => {
      update(state => ({ ...state, isLoading: true, error: null }));
      
      try {
        const response = await fetch(`${API_URL}/api/current-branch`, {
          credentials: 'include'
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to get current branch');
        }
        
        update(state => ({
          ...state,
          isLoading: false,
          currentBranch: data.currentBranch,
          defaultBranch: data.defaultBranch || 'master'
        }));
        
        return data;
      } catch (error) {
        update(state => ({
          ...state,
          isLoading: false,
          error: error.message || 'An error occurred while getting current branch'
        }));
        console.error('Error fetching current branch:', error);
      }
    },
    resetToBranch: async (branch: string) => {
      update(state => ({ ...state, isResetting: true, error: null, success: false, message: null }));
      
      try {
        const response = await fetch(`${API_URL}/api/reset-to-branch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ branch })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to reset to branch');
        }
        
        update(state => ({
          ...state,
          isResetting: false,
          success: true,
          currentBranch: branch,
          message: data.message
        }));
        
        // Refresh the file tree after successful reset
        await filesStore.refreshFileTree();
        
        return data;
      } catch (error) {
        update(state => ({
          ...state,
          isResetting: false,
          error: error.message || 'An error occurred while resetting to branch'
        }));
        throw error;
      }
    },
    checkoutAndPull: async (branch: string) => {
      update(state => ({ ...state, isResetting: true, error: null, success: false, message: null }));
      
      try {
        const response = await fetch(`${API_URL}/api/checkout-and-pull`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ branch })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to checkout and pull branch');
        }
        
        update(state => ({
          ...state,
          isResetting: false,
          success: true,
          currentBranch: branch,
          message: data.message
        }));
        
        // Refresh the file tree after successful checkout
        await filesStore.refreshFileTree();
        
        return data;
      } catch (error) {
        update(state => ({
          ...state,
          isResetting: false,
          error: error.message || 'An error occurred while checking out branch'
        }));
        throw error;
      }
    },
    setCurrentBranch: (branch: string) => update(state => ({ ...state, currentBranch: branch })),
    reset: () => set(initialState)
  };
}

export const branchStore = createBranchStore();