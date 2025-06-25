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
  isCreating: boolean;
  isCommitting: boolean;
  showModal: boolean;
  error: string | null;
  success: boolean;
  prUrl: string | null;
  repoUrl: string | null;
  message: string | null;
  prStatus: PrStatus | null;
  isLoadingStatus: boolean;
}

const initialState: PrState = {
  isCreating: false,
  isCommitting: false,
  showModal: false,
  error: null,
  success: false,
  prUrl: null,
  repoUrl: null,
  message: null,
  prStatus: null,
  isLoadingStatus: false
};

function createGithubStore() {
  const { subscribe, set, update } = writable<PrState>(initialState);

  const store = {
    subscribe,
    showModal: () => {
      update(state => ({ ...state, showModal: true, error: null, success: false, prUrl: null, repoUrl: null, message: null }));
      // Fetch PR status when modal opens
      store.fetchPrStatus();
    },
    hideModal: () => update(state => ({ ...state, showModal: false })),
    
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
    createPullRequest: async (title: string, description: string) => {
      update(state => ({ ...state, isCreating: true, error: null, success: false, prUrl: null, repoUrl: null, message: null }));
      
      try {
        // Pre-flight check: ensure we have fresh git status
        await gitStatusStore.fetchGitStatus();
        const gitStatus = get(gitStatusStore);
        
        if (!gitStatus.hasChanges) {
          throw new Error('No changes detected. Please make some changes before creating a pull request.');
        }
        
        if (gitStatus.error) {
          throw new Error(`Git status error: ${gitStatus.error}`);
        }
        
        const response = await fetch(`${API_URL}/api/create-pr`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ title, description })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to create pull request');
        }
        
        update(state => ({
          ...state,
          isCreating: false,
          success: true,
          prUrl: data.pr || null,
          repoUrl: data.repository || data.repoUrl || null,
          message: data.message || 'Pull request created successfully'
        }));
        
        // Don't auto-refresh here - let the modal handle it
        
        return data;
      } catch (error) {
        update(state => ({
          ...state,
          isCreating: false,
          error: error.message || 'An error occurred while creating the pull request'
        }));
        throw error;
      }
    },
    reset: () => set(initialState)
  };
  
  return store;
}

export const githubStore = createGithubStore();