import { writable } from 'svelte/store';
import { AUTH_CURRENT_USER_URL, AUTH_LOGOUT_URL } from '../config.js';

// Define types
type User = {
  id?: string;
  username: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
	token?: string;
};

type AuthState = {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  skipAuth: boolean;
  error: string | null;
};

// Create the initial state
const initialState: AuthState = {
  isAuthenticated: false,
  isLoading: true,
  user: null,
  skipAuth: false,
  error: null
};

// Create the store
export const authStore = writable<AuthState>(initialState);

// Function to fetch the current authentication state
export async function fetchAuthState() {
  try {
    authStore.update(state => ({ ...state, isLoading: true, error: null }));

    const response = await fetch(AUTH_CURRENT_USER_URL, {
      credentials: 'include', // Important for cookies/session
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      // Clear any stored state if the server says we're not authenticated
      sessionStorage.removeItem('auth_state');
      localStorage.removeItem('auth_state');
      
      throw new Error('Failed to fetch authentication state');
    }

    const data = await response.json();

    // Update auth store with the fresh data
    authStore.update(state => ({
      ...state,
      isAuthenticated: data.isAuthenticated,
      user: data.user || null,
      skipAuth: data.skipAuth || false,
      isLoading: false
    }));

    // If authenticated, store the auth state in sessionStorage (not localStorage)
    if (data.isAuthenticated && data.user) {
      // Store only until the window is closed - using sessionStorage
      sessionStorage.setItem('auth_state', JSON.stringify({
        isAuthenticated: data.isAuthenticated,
        user: data.user,
        skipAuth: data.skipAuth || false
      }));
    } else {
      // If not authenticated, clear any previously stored state
      sessionStorage.removeItem('auth_state');
    }

    return data;
  } catch (error) {
    console.error('Auth error:', error);
    authStore.update(state => ({
      ...state,
      isAuthenticated: false,
      user: null,
      isLoading: false,
      error: error instanceof Error ? error.message : 'An unknown error occurred'
    }));

    // Clear sessionStorage on authentication error
    sessionStorage.removeItem('auth_state');
  }
}

// Function to logout
export async function logout() {
  try {
    // First update the local store to prevent UI flicker
    authStore.set({
      ...initialState,
      isLoading: true
    });

    // Send the logout request to the server
    const response = await fetch(AUTH_LOGOUT_URL, {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Logout response not OK:', response.status);
    }

    // Clear the auth store completely
    authStore.set({
      ...initialState,
      isLoading: false
    });

    // Clear any auth-related localStorage/sessionStorage
    localStorage.removeItem('auth_state');
    sessionStorage.removeItem('auth_state');

    // Force a hard reload of the page to clear any cached state
    window.location.href = window.location.origin + window.location.pathname;
  } catch (error) {
    console.error('Logout failed:', error);
    // Even if the server request fails, reset the local state
    authStore.set({
      ...initialState,
      isLoading: false,
      error: 'Logout failed. Please try again.'
    });
  }
}
