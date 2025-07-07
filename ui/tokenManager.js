/**
 * GitHub Token Manager - Handles token validation and cleanup
 * Simplified approach: validate tokens and logout users when tokens are invalid
 * (GitHub OAuth doesn't provide refresh tokens by default)
 */
class GitHubTokenManager {
  constructor() {
    this.tokenCache = new Map(); // username -> { accessToken, storedAt }
    this.validationCache = new Map(); // token -> { isValid, checkedAt }
    this.VALIDATION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    this.TOKEN_VALIDATION_URL = 'https://api.github.com/user';
  }

  /**
   * Store tokens for a user and update git remote
   */
  async storeTokens(username, accessToken, refreshToken = null) {
    this.tokenCache.set(username, {
      accessToken,
      storedAt: Date.now()
    });

    // Also update global.userTokens for backward compatibility
    if (!global.userTokens) global.userTokens = {};
    global.userTokens[username] = accessToken;

    // Update git remote in user repository with new token
    await this.updateUserRepoToken(username, accessToken);

    console.log(`[TokenManager] Stored token for user: ${username}`);
  }

  /**
   * Update git remote configuration for user repository with new token
   */
  async updateUserRepoToken(username, token) {
    try {
      const WORKDIR = process.cwd() + '/workdir';
      const REPO_URL = process.env.REPO_URL;
      const userDir = `${WORKDIR}/${username}`;
      
      // Check if user repository exists
      const fs = await import('fs/promises');
      const userRepoExists = await fs.access(userDir).then(() => true).catch(() => false);
      
      if (userRepoExists && token && REPO_URL) {
        const simpleGit = (await import('simple-git')).default;
        const git = simpleGit({ baseDir: userDir });
        
        // Use existing ensureGitRemoteWithToken function
        const { ensureGitRemoteWithToken } = await import('./routes.js');
        await ensureGitRemoteWithToken(git, token, REPO_URL);
        
        console.log(`[TokenManager] Updated git remote for user ${username} with new token`);
      }
    } catch (error) {
      console.warn(`[TokenManager] Failed to update git remote for user ${username}:`, error.message);
    }
  }

  /**
   * Get stored tokens for a user
   */
  getTokens(username) {
    // Check both internal cache and global storage
    const cached = this.tokenCache.get(username);
    if (cached) return cached;
    
    // Fallback to global storage
    if (global.userTokens && global.userTokens[username]) {
      return {
        accessToken: global.userTokens[username],
        storedAt: Date.now()
      };
    }
    
    return null;
  }

  /**
   * Remove tokens for a user (logout)
   */
  removeTokens(username) {
    this.tokenCache.delete(username);
    
    // Clear from global.userTokens
    if (global.userTokens && global.userTokens[username]) {
      delete global.userTokens[username];
    }

    // Clear validation cache for this user's tokens
    for (const [token, data] of this.validationCache.entries()) {
      if (data.username === username) {
        this.validationCache.delete(token);
      }
    }

    console.log(`[TokenManager] Removed tokens for user: ${username}`);
  }

  /**
   * Validate token by making a test API call to GitHub
   */
  async validateToken(accessToken, username = null) {
    // Check validation cache first
    const cached = this.validationCache.get(accessToken);
    if (cached && (Date.now() - cached.checkedAt) < this.VALIDATION_CACHE_TTL) {
      console.log(`[TokenManager] Using cached validation result for token`);
      return cached.isValid;
    }

    try {
      console.log(`[TokenManager] Validating token via GitHub API for user: ${username || 'unknown'}`);
      const response = await fetch(this.TOKEN_VALIDATION_URL, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'User-Agent': 'CLT-UI-App',
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 10000 // 10 second timeout
      });

      const isValid = response.status === 200;
      
      // Log token validation results with timestamp
      if (isValid) {
        console.log(`[TokenManager] ✅ Token validation successful for user: ${username || 'unknown'} at ${new Date().toISOString()}`);
        
        // Try to get rate limit info from headers for expiration insights
        const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
        const rateLimitReset = response.headers.get('x-ratelimit-reset');
        if (rateLimitReset) {
          const resetDate = new Date(parseInt(rateLimitReset) * 1000);
          console.log(`[TokenManager] Rate limit resets at: ${resetDate.toISOString()}, remaining: ${rateLimitRemaining}`);
        }
      } else {
        console.log(`[TokenManager] ❌ Token validation failed for user: ${username || 'unknown'} with status: ${response.status} at ${new Date().toISOString()}`);
        if (response.status === 401) {
          console.log(`[TokenManager] Token appears to be expired or revoked for user: ${username || 'unknown'}`);
        }
      }
      
      // Cache the result
      this.validationCache.set(accessToken, {
        isValid,
        checkedAt: Date.now(),
        username: username || 'unknown'
      });

      if (!isValid && response.status === 401 && username) {
        // Token is expired/invalid, remove it
        this.removeTokens(username);
      }

      return isValid;
    } catch (error) {
      console.error(`[TokenManager] ❌ Token validation error for user: ${username || 'unknown'} at ${new Date().toISOString()}:`, error.message);
      
      // On network errors, assume token might be valid but cache as invalid for short time
      this.validationCache.set(accessToken, {
        isValid: false,
        checkedAt: Date.now(),
        username: username || 'unknown'
      });
      
      return false;
    }
  }

  /**
   * Get valid token for user - validates and removes if invalid
   */
  async getValidToken(username) {
    const tokens = this.getTokens(username);
    if (!tokens) {
      console.log(`[TokenManager] No tokens found for user: ${username}`);
      return null;
    }

    // Validate current token
    const isValid = await this.validateToken(tokens.accessToken, username);
    if (isValid) {
      return tokens.accessToken;
    }

    // Token is invalid, remove it and return null
    console.log(`[TokenManager] Token invalid for user: ${username}, removing tokens`);
    this.removeTokens(username);
    return null;
  }

  /**
   * Middleware to ensure valid token for requests
   */
  async ensureValidToken(req, res, next) {
    if (!req.user || !req.user.username) {
      return next();
    }

    try {
      const validToken = await this.getValidToken(req.user.username);
      
      if (!validToken) {
        console.log(`[TokenManager] No valid token for user: ${req.user.username}, logging out`);
        
        // Clear session and redirect to login
        req.session.destroy((err) => {
          if (err) console.error('Session destroy error:', err);
        });
        
        return res.status(401).json({
          error: 'Authentication expired',
          message: 'Your GitHub authentication has expired. Please log in again.',
          requiresReauth: true
        });
      }

      // Update req.user.token with valid token
      req.user.token = validToken;
      next();
    } catch (error) {
      console.error(`[TokenManager] Error ensuring valid token:`, error);
      return res.status(500).json({
        error: 'Authentication error',
        message: 'Failed to validate authentication. Please try again.'
      });
    }
  }

  /**
   * Clean up expired validation cache entries
   */
  cleanupCache() {
    const now = Date.now();
    for (const [token, data] of this.validationCache.entries()) {
      if ((now - data.checkedAt) > this.VALIDATION_CACHE_TTL) {
        this.validationCache.delete(token);
      }
    }
  }
}

// Create singleton instance
const tokenManager = new GitHubTokenManager();

// Clean up cache every 10 minutes
setInterval(() => {
  tokenManager.cleanupCache();
}, 10 * 60 * 1000);

export default tokenManager;