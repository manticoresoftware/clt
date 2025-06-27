// Backend API URL configuration
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Auth related constants
const AUTH_GITHUB_URL = `${API_URL}/auth/github`;
const AUTH_LOGOUT_URL = `${API_URL}/logout`;
const AUTH_CURRENT_USER_URL = `${API_URL}/api/current-user`;

export { API_URL, AUTH_GITHUB_URL, AUTH_LOGOUT_URL, AUTH_CURRENT_USER_URL };
