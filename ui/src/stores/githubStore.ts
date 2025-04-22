import { writable } from 'svelte/store';
import { API_URL } from '../config.js';

interface PrState {
  isCreating: boolean;
  showModal: boolean;
  error: string | null;
  success: boolean;
  prUrl: string | null;
  repoUrl: string | null;
  message: string | null;
}

const initialState: PrState = {
  isCreating: false,
  showModal: false,
  error: null,
  success: false,
  prUrl: null,
  repoUrl: null,
  message: null
};

function createGithubStore() {
  const { subscribe, set, update } = writable<PrState>(initialState);

  return {
    subscribe,
    showModal: () => update(state => ({ ...state, showModal: true, error: null, success: false, prUrl: null, repoUrl: null, message: null })),
    hideModal: () => update(state => ({ ...state, showModal: false })),
    createPullRequest: async (title: string, description: string) => {
      update(state => ({ ...state, isCreating: true, error: null, success: false, prUrl: null, repoUrl: null, message: null }));
      
      try {
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
          message: data.message
        }));
        
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
}

export const githubStore = createGithubStore();