import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import authConfig from './config/auth.js';

// Configure Passport with GitHub strategy
export function setupPassport() {
  console.log('Setting up Passport with GitHub strategy');
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
    (accessToken, refreshToken, profile, done) => {
      // Debug logging
      console.log('GitHub OAuth callback executed');
      console.log('Profile:', profile.username);
      console.log('Allowed users:', authConfig.allowedUsers);
      
      // Check if the user is in the allowed list
      const username = profile.username;
      if (
        authConfig.allowedUsers.length === 0 ||
        authConfig.allowedUsers.includes(username)
      ) {
        // Store just the necessary user info
        const user = {
          id: profile.id,
          username: profile.username,
          displayName: profile.displayName || profile.username,
          avatarUrl: profile.photos?.[0]?.value || '',
        };
        console.log('User authenticated successfully:', username);
        return done(null, user);
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
  // Skip authentication if SKIP_AUTH is true
  if (authConfig.skipAuth) {
    return next();
  }

  // Check if the user is authenticated
  if (req.isAuthenticated()) {
    return next();
  }

  // Handle API requests differently from page requests
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // For server-rendered pages (not SPA routes handled by client)
  // we'll redirect to login
  if (req.path === '/login' || req.path.startsWith('/auth/') || req.path.startsWith('/public/')) {
    return next();
  }
  
  // For SPA routes, we'll just serve the index.html and let the client handle auth
  // The client-side code will show the login button when not authenticated
  next();
}

// Function to add auth routes to express app
export function addAuthRoutes(app) {
  // GitHub authentication routes
  app.get('/auth/github', (req, res, next) => {
    console.log('GitHub auth route accessed');
    passport.authenticate('github', { scope: authConfig.github.scope })(req, res, next);
  });

  app.get(
    '/auth/github/callback',
    (req, res, next) => {
      console.log('GitHub callback received', req.query);
      passport.authenticate('github', {
        // Redirect to the frontend URL after successful login
        successRedirect: process.env.FRONTEND_URL || `http://${process.env.HOST || 'localhost'}:${process.env.FRONTEND_PORT || 5173}`,
        // Redirect to the frontend login page on failure
        failureRedirect: (process.env.FRONTEND_URL || `http://${process.env.HOST || 'localhost'}:${process.env.FRONTEND_PORT || 5173}`) + 
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
    return res.status(401).json({ isAuthenticated: false });
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