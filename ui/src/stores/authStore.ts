import { writable } from 'svelte/store';
import { AUTH_CURRENT_USER_URL, AUTH_LOGOUT_URL } from '../config.js';

// Define types
type User = {
  id?: string;
  username: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
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
      // Don't automatically redirect - just report the error
      throw new Error('Failed to fetch authentication state');
    }
    
    const data = await response.json();
    
    authStore.update(state => ({
      ...state,
      isAuthenticated: data.isAuthenticated, 
      user: data.user || null,
      skipAuth: data.skipAuth || false,
      isLoading: false
    }));

    return data;
  } catch (error) {
    console.error('Auth error:', error);
    authStore.update(state => ({
      ...state,
      isLoading: false,
      error: error instanceof Error ? error.message : 'An unknown error occurred'
    }));
  }
}

// Function to logout
export async function logout() {
  try {
    await fetch(AUTH_LOGOUT_URL, {
      method: 'GET',
      credentials: 'include'
    });
    // Clear the auth store
    authStore.set({
      ...initialState,
      isLoading: false
    });
    // Reload the current page instead of redirecting
    window.location.reload();
  } catch (error) {
    console.error('Logout failed:', error);
  }
}