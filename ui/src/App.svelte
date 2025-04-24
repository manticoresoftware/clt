<script lang="ts">
  import Header from './components/Header.svelte';
  import FileExplorer from './components/FileExplorer.svelte';
  import Editor from './components/Editor.svelte';
  import PullRequestModal from './components/PullRequestModal.svelte';
  import { filesStore } from './stores/filesStore';
  import { authStore, fetchAuthState } from './stores/authStore';
  import { branchStore } from './stores/branchStore';
  import { AUTH_GITHUB_URL } from './config.js';
  import { onMount } from 'svelte';

  let isLoading = true;
  let authError = false;

  // Fetch authentication state when the app loads
  onMount(async () => {
    try {
      await fetchAuthState();
      isLoading = false;
      authError = false;
      
      // Fetch current branch info after authentication
      if ($authStore.isAuthenticated) {
        await branchStore.fetchCurrentBranch();
      }
      
      // Set up periodic check of authentication status to keep in sync with backend
      const authCheckInterval = setInterval(async () => {
        // Only check if we think we're authenticated
        if ($authStore.isAuthenticated) {
          try {
            const result = await fetch(`${import.meta.env.VITE_API_URL}/api/health`, {
              credentials: 'include'
            });
            
            // If request fails or returns not authenticated, refresh auth state
            if (!result.ok) {
              await fetchAuthState();
            } else {
              const data = await result.json();
              if (!data.authenticated) {
                await fetchAuthState();
              }
            }
          } catch (error) {
            console.warn('Auth check failed, will retry later:', error);
          }
        }
      }, 60000); // Check every minute
      
      return () => {
        clearInterval(authCheckInterval);
      };
    } catch (err) {
      console.error('Failed to fetch auth state:', err);
      isLoading = false;
      authError = true;
    }
  });
</script>

<div class="app-container">
  {#if isLoading}
    <div class="loading-screen">
      <div class="spinner"></div>
      <p>Loading...</p>
    </div>
  {:else if $authStore.isAuthenticated || $authStore.skipAuth}
    <Header />

    <div class="main-content">
      <FileExplorer />
      <Editor />
    </div>
    
    <!-- Pull Request Modal -->
    <PullRequestModal />
  {:else}
    <div class="login-required">
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
      <h2>Authentication Required</h2>
      <p>You need to log in with GitHub to access CLT UI.</p>
      {#if authError || $authStore.error}
        <div class="auth-error">
          <p>Authentication error: {$authStore.error || 'Failed to connect to server'}. Please try again.</p>
        </div>
      {/if}
      <a href={AUTH_GITHUB_URL} class="login-button github-button">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="position: relative; top: 1px;">
          <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
        </svg>
        <span>Sign in with GitHub</span>
      </a>
    </div>
  {/if}
</div>

<style>
  .loading-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    width: 100%;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 4px solid rgba(0, 0, 0, 0.1);
    border-radius: 50%;
    border-top: 4px solid #3498db;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .login-required {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    text-align: center;
    padding: 2rem;
  }

  .login-required svg {
    color: #3498db;
  }

  .login-required h2 {
    margin-bottom: 0.5rem;
    font-size: 1.5rem;
  }

  .login-required p {
    margin-bottom: 2rem;
    color: #666;
  }

  .login-button {
    display: inline-block;
    background-color: #3498db;
    color: white;
    padding: 10px 20px;
    border-radius: 4px;
    text-decoration: none;
    font-weight: 500;
    transition: background-color 0.2s;
  }

  .login-button:hover {
    background-color: #2980b9;
  }

  .auth-error {
    margin-bottom: 20px;
    padding: 10px 15px;
    background-color: rgba(255, 0, 0, 0.1);
    border-left: 3px solid #e74c3c;
    color: #c0392b;
    border-radius: 3px;
    font-size: 0.9rem;
  }

  .github-button {
    display: inline-flex; /* Change to inline-flex */
    align-items: center;
    gap: 10px; /* Slightly increase spacing */
    background-color: #24292e;
    padding: 12px 24px;
    font-size: 1rem;
  }

  .github-button svg {
    flex-shrink: 0; /* Prevent SVG from shrinking */
    display: block; /* Ensure block rendering */
    vertical-align: text-bottom; /* Align with text bottom */
    width: 16px;
    height: 16px;
  }

  .github-button:hover {
    background-color: #1c2024;
  }
</style>
