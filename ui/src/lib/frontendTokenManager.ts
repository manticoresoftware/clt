import { authStore, fetchAuthState } from '../stores/authStore';

/**
 * Frontend token manager - handles token expiration on client side
 */
class FrontendTokenManager {
  constructor() {
    this.originalFetch = window.fetch.bind(window);
    this.retryQueue = new Map();
    this.isRefreshing = false;
  }

  /**
   * Intercept fetch requests to handle token expiration
   */
  async fetchWithTokenHandling(url, options = {}) {
    const requestId = Math.random().toString(36).substr(2, 9);
    
    try {
      const response = await this.originalFetch(url, {
        ...options,
        credentials: 'include'
      });

      // Check for authentication errors
      if (response.status === 401) {
        const data = await response.json().catch(() => ({}));
        
        if (data.requiresReauth) {
          console.log('[FrontendTokenManager] Authentication expired, redirecting to login');
          this.handleAuthExpiration();
          throw new Error('Authentication expired');
        }
      }

      return response;
    } catch (error) {
      if (error.message.includes('Authentication expired')) {
        throw error;
      }
      
      throw error;
    }
  }

  /**
   * Handle authentication expiration
   */
  handleAuthExpiration() {
    authStore.update(state => ({
      ...state,
      isAuthenticated: false,
      user: null,
      error: 'Your session has expired. Please log in again.'
    }));

    sessionStorage.removeItem('auth_state');
    localStorage.removeItem('auth_state');

    console.log('[FrontendTokenManager] User logged out due to token expiration');
  }

  /**
   * Check authentication status periodically
   */
  startAuthCheck(intervalMs = 5 * 60 * 1000) {
    setInterval(async () => {
      try {
        await fetchAuthState();
      } catch (error) {
        console.warn('[FrontendTokenManager] Auth check failed:', error);
      }
    }, intervalMs);
  }
}

// Create singleton instance
const frontendTokenManager = new FrontendTokenManager();

// Override global fetch ONLY for API calls to avoid recursion
const originalFetch = frontendTokenManager.originalFetch;
window.fetch = async (url, options) => {
  // Only intercept API calls to our backend
  if (typeof url === 'string' && url.includes('/api/')) {
    return frontendTokenManager.fetchWithTokenHandling(url, options);
  }
  
  // Use original fetch for other requests
  return originalFetch(url, options);
};

// Start periodic auth checking
frontendTokenManager.startAuthCheck();

export default frontendTokenManager;