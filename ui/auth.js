import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { getAuthConfig } from './config/auth.js';
import tokenManager from './tokenManager.js';

// Configure Passport with GitHub strategy
export function setupPassport() {
  // Get fresh auth config after environment variables are loaded
  const authConfig = getAuthConfig();
  
  console.log('Setting up Passport with GitHub strategy');
	console.log('Env config', process.env);
  console.log('Auth config:', {
    clientID: authConfig.github.clientID ? 'Configured' : 'Not configured',
    callbackURL: authConfig.github.callbackURL,
    skipAuth: authConfig.skipAuth
  });

  // Serialize user to the session
  passport.serializeUser((user, done) => {
    console.log('Serializing user:', user.username);
    done(null, user);
  });

  // Deserialize user from the session
  passport.deserializeUser((user, done) => {
    console.log('Deserializing user:', user?.username || 'unknown');
    done(null, user);
  });

  // Create a custom GitHub strategy that doesn't require email scope
  const githubStrategy = new GitHubStrategy(
    authConfig.github,
    async (accessToken, refreshToken, profile, done) => {
      // Debug logging
      console.log('GitHub OAuth callback executed');
      console.log('Profile:', profile.username);
      console.log('Allowed users:', authConfig.allowedUsers);
      console.log('Has refresh token:', !!refreshToken);
      console.log('Access token received:', !!accessToken);
      
      // Log token expiration info (GitHub tokens typically don't expire but log anyway)
      if (accessToken) {
        console.log(`[AUTH] Token received for user ${profile.username} at ${new Date().toISOString()}`);
        console.log(`[AUTH] Token length: ${accessToken.length} characters`);
        // GitHub personal access tokens don't have expiration in OAuth response
        // but we log when we received it for tracking purposes
      }

      // Check if the user is in the allowed list
      const username = profile.username;
      if (
        authConfig.allowedUsers.length === 0 ||
        authConfig.allowedUsers.includes(username)
      ) {
        try {
          // CRITICAL: Store tokens using tokenManager (updates git remote with new token)
          console.log(`[AUTH] Storing fresh token for user ${username} via tokenManager`);
          await tokenManager.storeTokens(username, accessToken, refreshToken);
          console.log(`[AUTH] ✅ Token stored and git remote updated for user ${username}`);

          // Store just the necessary user info
          const user = {
            id: profile.id,
            username: profile.username,
            displayName: profile.displayName || profile.username,
            avatarUrl: profile.photos?.[0]?.value || '',
            token: accessToken,
          };
          console.log('User authenticated successfully:', username);
          return done(null, user);
        } catch (error) {
          console.error(`[AUTH] ❌ Failed to store token for user ${username}:`, error);
          // Continue with authentication even if token storage fails
          // Store tokens in global storage as fallback
          if (!global.userTokens) global.userTokens = {};
          global.userTokens[username] = accessToken;

          const user = {
            id: profile.id,
            username: profile.username,
            displayName: profile.displayName || profile.username,
            avatarUrl: profile.photos?.[0]?.value || '',
            token: accessToken,
          };
          console.log('User authenticated successfully (fallback token storage):', username);
          return done(null, user);
        }
      } else {
        // User not in the allowed list
        console.log('User not in allowed list:', username);
        return done(null, false, {
          message: 'You are not authorized to access this application.',
        });
      }
    }
  );

  // Override the strategy's userProfile method to skip the email fetch if scope doesn't include it
  // This patching prevents the 'Failed to fetch user emails' error
  const originalUserProfile = githubStrategy._userProfile;
  githubStrategy._userProfile = function(accessToken, done) {
    originalUserProfile.call(this, accessToken, (err, profile) => {
      if (err) { return done(err); }
      // Skip the email fetch by providing a complete profile
      return done(null, profile);
    });
  };

  passport.use(githubStrategy);

  return passport;
}

// Middleware to check if the user is authenticated
export function isAuthenticated(req, res, next) {
  // Get fresh auth config
  const authConfig = getAuthConfig();
  
  // Debug logging
  console.log(`[Auth Check] Path: ${req.path}`);
  console.log(`[Auth Check] Session ID: ${req.sessionID}`);
  console.log(`[Auth Check] Authenticated: ${req.isAuthenticated()}`);
  console.log(`[Auth Check] Skip Auth: ${authConfig.skipAuth}`);

  // Skip authentication if SKIP_AUTH is true
  if (authConfig.skipAuth) {
    console.log('[Auth Check] Skipping auth check - SKIP_AUTH enabled');
    return next();
  }

  // Check if the user is authenticated
  if (req.isAuthenticated()) {
    console.log('[Auth Check] User is authenticated, proceeding');
    return next();
  }

  // Handle API requests differently from page requests
  if (req.path.startsWith('/api/')) {
    console.log('[Auth Check] API request but not authenticated, returning 401');
    return res.status(401).json({ error: 'Unauthorized', message: 'You must be logged in to access this resource' });
  }

  // For server-rendered pages (not SPA routes handled by client)
  // we'll redirect to login
  if (req.path === '/login' || req.path.startsWith('/auth/') || req.path.startsWith('/public/')) {
    console.log('[Auth Check] Public path, allowing access');
    return next();
  }

  // For SPA routes, we'll just serve the index.html and let the client handle auth
  // The client-side code will show the login button when not authenticated
  console.log('[Auth Check] Non-API request, serving index.html and letting client handle auth');
  next();
}

// Function to add auth routes to express app
export function addAuthRoutes(app) {
  // Get fresh auth config
  const authConfig = getAuthConfig();
  
  // GitHub authentication routes
  app.get('/auth/github', (req, res, next) => {
    console.log('GitHub auth route accessed');
    // Capture returnTo parameter from query and pass it through OAuth state
    const returnTo = req.query.returnTo || req.session.returnTo;
    // Store in session for callback
    if (returnTo) {
      req.session.returnTo = returnTo;
    }
    passport.authenticate('github', {
      scope: authConfig.github.scope,
      state: returnTo || undefined
    })(req, res, next);
  });

  app.get(
    '/auth/github/callback',
    (req, res, next) => {
      console.log('GitHub callback received', req.query);
      passport.authenticate('github', {
        // Get returnTo from session (stored from state or query param)
        successRedirect: req.session.returnTo || process.env.GITHUB_SUCCESS_URL || `http://${process.env.HOST || 'localhost'}:${process.env.FRONTEND_PORT || 5173}`,
        // Redirect to the frontend login page on failure
        failureRedirect: (process.env.GITHUB_FAILURE_URL || `http://${process.env.HOST || 'localhost'}:${process.env.FRONTEND_PORT || 5173}`) +
          '?error=Authentication%20failed.%20You%20might%20not%20be%20authorized%20to%20access%20this%20application.',
      })(req, res, next);
    }
  );

  // Login page
  app.get('/login', (req, res) => {
    // Log to debug
    console.log("Serving login page");
    res.sendFile('auth/login.html', { root: './public' });
  });

  // Logout route
  app.get('/logout', (req, res, next) => {
    // Get the frontend URL for redirect
    const frontendUrl = process.env.FRONTEND_URL || `http://${process.env.HOST || 'localhost'}:${process.env.FRONTEND_PORT || 5173}`;

    // Remove tokens from global storage
    if (req.user && req.user.username) {
      if (global.userTokens && global.userTokens[req.user.username]) {
        delete global.userTokens[req.user.username];
      }
    }

    // Destroy the session completely
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
        return next(err);
      }

      // Clear the authentication cookies
      res.clearCookie('connect.sid');

      // Respond with a success status for AJAX calls
      res.status(200).json({ success: true, message: 'Logged out successfully' });
    });
  });

  // Route to get current user info (for client-side auth state)
  app.get('/api/current-user', (req, res) => {
    if (authConfig.skipAuth) {
      console.log('Auth skipped, returning dev-mode user');
      return res.json({
        isAuthenticated: true,
        skipAuth: true,
        user: { username: 'dev-mode' }
      });
    }

    // For debugging
    console.log('Session ID:', req.sessionID);
    console.log('Session:', req.session);
    console.log('Session Cookie:', req.headers.cookie);
    console.log('Authenticated:', req.isAuthenticated());
    console.log('User:', req.user);

    if (req.isAuthenticated() && req.user) {
      console.log('User is authenticated, returning user info');
      return res.json({
        isAuthenticated: true,
        user: req.user
      });
    }

    console.log('User not authenticated');
    return res.status(401).json({
      isAuthenticated: false,
      message: 'Authentication required. Please log in again.'
    });
  });

  // Debug route
  app.get('/api/auth-debug', (req, res) => {
    return res.json({
      session: req.session,
      isAuthenticated: req.isAuthenticated(),
      user: req.user,
      skipAuth: authConfig.skipAuth,
      allowedUsers: authConfig.allowedUsers
    });
  });
}
