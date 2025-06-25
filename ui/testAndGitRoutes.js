import { setupTestRoutes } from './testRoutes.js';
import { setupGitRoutes } from './gitRoutes.js';
import { setupInteractiveRoutes } from './interactiveRoutes.js';

// Export the main setup function that combines all route modules
export function setupGitAndTestRoutes(app, isAuthenticated, dependencies) {
  // Setup all route modules
  setupTestRoutes(app, isAuthenticated, dependencies);
  setupGitRoutes(app, isAuthenticated, dependencies);
  setupInteractiveRoutes(app, isAuthenticated, dependencies);
}

// Re-export the processTestResults function for backward compatibility
export { processTestResults } from './testProcessor.js';