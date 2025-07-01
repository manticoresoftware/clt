// Authentication configuration
export function getAuthConfig() {
  return {
    // GitHub OAuth configuration
    github: {
      clientID: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      callbackURL: process.env.GITHUB_CALLBACK_URL || `http://${process.env.HOST || 'localhost'}:${process.env.BACKEND_PORT || 3000}/auth/github/callback`,
      scope: ['repo'], // Remove email scope, we'll just use the basic profile info
    },
    // List of allowed GitHub usernames
    allowedUsers: (process.env.ALLOWED_GITHUB_USERS || '').split(',').filter(Boolean),
    // Skip authentication if this is set to 'true'
    skipAuth: process.env.SKIP_AUTH === 'true',
  };
}

// For backward compatibility, also export default
export default getAuthConfig();
