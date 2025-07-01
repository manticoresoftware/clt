import { writable } from 'svelte/store';
import { API_URL } from '../config.js';

interface RepoSyncState {
  isSyncing: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  progress: string | null;
  lastSyncTime: number | null;
}

const initialState: RepoSyncState = {
  isSyncing: false,
  isInitialized: false,
  isLoading: false,
  error: null,
  progress: null,
  lastSyncTime: null
};

function createRepoSyncStore() {
  const { subscribe, set, update } = writable<RepoSyncState>(initialState);

  return {
    subscribe,
    
    // Check if user's repository is initialized
    checkRepoStatus: async () => {
      update(state => ({ ...state, isLoading: true, error: null }));
      
      try {
        const response = await fetch(`${API_URL}/api/repo-status`, {
          credentials: 'include'
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to check repository status');
        }
        
        update(state => ({
          ...state,
          isLoading: false,
          isInitialized: data.isInitialized,
          lastSyncTime: data.lastSyncTime || null
        }));
        
        return data;
      } catch (error) {
        update(state => ({
          ...state,
          isLoading: false,
          error: error.message || 'Failed to check repository status'
        }));
        console.error('Error checking repository status:', error);
        throw error;
      }
    },
    
    // Initialize/sync the user's repository
    syncRepository: async () => {
      update(state => ({ 
        ...state, 
        isSyncing: true, 
        isLoading: true,
        error: null,
        progress: 'Initializing repository...'
      }));
      
      try {
        const response = await fetch(`${API_URL}/api/sync-repository`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to sync repository');
        }
        
        update(state => ({
          ...state,
          isSyncing: false,
          isLoading: false,
          isInitialized: true,
          progress: null,
          lastSyncTime: Date.now()
        }));
        
        return data;
      } catch (error) {
        update(state => ({
          ...state,
          isSyncing: false,
          isLoading: false,
          error: error.message || 'Failed to sync repository',
          progress: null
        }));
        console.error('Error syncing repository:', error);
        throw error;
      }
    },
    
    // Start polling for sync completion
    startSyncPolling: () => {
      updateAndSave(state => ({ 
        ...state, 
        isSyncing: true,
        progress: 'Setting up repository...'
      }));
      
      const pollInterval = setInterval(async () => {
        try {
          const status = await fetch(`${API_URL}/api/repo-status`, {
            credentials: 'include'
          });
          const data = await status.json();
          
          if (status.ok && data.isInitialized) {
            // Repository is ready!
            clearInterval(pollInterval);
            updateAndSave(state => ({
              ...state,
              isSyncing: false,
              isLoading: false,
              isInitialized: true,
              progress: null,
              lastSyncTime: Date.now()
            }));
            
            // Trigger file tree refresh
            if (typeof window !== 'undefined' && window.location.reload) {
              // Small delay to ensure state is saved
              setTimeout(() => window.location.reload(), 500);
            }
          }
        } catch (error) {
          console.warn('Polling error:', error);
          // Continue polling on errors
        }
      }, 2000); // Poll every 2 seconds
      
      // Stop polling after 2 minutes (timeout)
      setTimeout(() => {
        clearInterval(pollInterval);
        updateAndSave(state => ({
          ...state,
          isSyncing: false,
          isLoading: false,
          error: 'Repository setup timed out. Please try again.',
          progress: null
        }));
      }, 120000);
    },
    
    // Update progress during sync
    updateProgress: (progress: string) => {
      updateAndSave(state => ({ ...state, progress }));
    },
    
    // Reset the store
    reset: () => {
      const resetState = {
        isSyncing: false,
        isInitialized: false,
        isLoading: false,
        error: null,
        progress: null,
        lastSyncTime: null
      };
      set(resetState);
      saveState(resetState);
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('repoSyncState');
      }
    },
    
    // Set initialized state (for when repo already exists)
    setInitialized: (initialized: boolean) => {
      updateAndSave(state => ({ 
        ...state, 
        isInitialized: initialized,
        lastSyncTime: initialized ? Date.now() : null,
        isSyncing: false
      }));
    }
  };
}

export const repoSyncStore = createRepoSyncStore();