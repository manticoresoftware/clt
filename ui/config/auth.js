// Authentication configuration
export default {
  // GitHub OAuth configuration
  github: {
    clientID: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    callbackURL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3000/auth/github/callback',
    scope: ['user:email'],
  },
  // List of allowed GitHub usernames
  allowedUsers: (process.env.ALLOWED_GITHUB_USERS || '').split(',').filter(Boolean),
  // Skip authentication if this is set to 'true'
  skipAuth: process.env.SKIP_AUTH === 'true',
};