import path from 'path';
import fs from 'fs/promises';
import simpleGit from 'simple-git';

/**
 * Unified repository checkout manager with sparse checkout support
 * Handles all git operations: clone, reset, checkout with consistent behavior
 */

/**
 * Configure sparse checkout if REPO_SPARSE_PATHS is set
 * @param {Object} git - Simple-git instance
 * @param {string} sparsePaths - Space-separated paths from environment
 */
async function configureSparseCheckout(git, sparsePaths) {
  if (!sparsePaths || sparsePaths.trim() === '') {
    console.log('No sparse paths configured, using full checkout');
    return;
  }
  
  const paths = sparsePaths.trim().split(/\s+/);
  console.log(`Configuring sparse checkout with paths: ${paths.join(', ')}`);
  
  try {
    await git.raw(['sparse-checkout', 'init', '--cone']);
    await git.raw(['sparse-checkout', 'set', ...paths]);
    console.log('Sparse checkout configured successfully');
  } catch (error) {
    console.warn('Failed to configure sparse checkout, falling back to full checkout:', error.message);
    // Continue with full checkout - don't fail the operation
  }
}

/**
 * Ensure repository is checked out with specified configuration
 * @param {Object} options - Checkout configuration
 * @param {string} options.username - User identifier
 * @param {string} options.userToken - GitHub authentication token
 * @param {string} options.repoUrl - Repository URL
 * @param {string} options.workdir - Working directory path
 * @param {string} [options.branch] - Target branch (optional, uses default if not specified)
 * @param {'clone'|'reset'|'checkout'} options.operation - Operation type
 * @param {boolean} [options.forceReset=false] - Force hard reset for reset operation
 * @returns {Promise<Object>} Result object with userDir, testDir, and operation details
 */
export async function ensureRepositoryCheckout(options) {
  const { username, userToken, repoUrl, workdir, branch, operation, forceReset = false } = options;
  
  if (!username || !repoUrl || !workdir) {
    throw new Error('Missing required parameters: username, repoUrl, workdir');
  }

  const userDir = path.join(workdir, username);
  const testDir = path.join(userDir, 'test', 'clt-tests');
  const sparsePaths = process.env.REPO_SPARSE_PATHS;
  
  try {
    const userRepoExists = await fs.access(userDir).then(() => true).catch(() => false);
    
    if (operation === 'clone' && !userRepoExists) {
      // Initial clone operation
      console.log(`Setting up repository for user ${username}`);
      await fs.mkdir(userDir, { recursive: true });
      
      if (!userToken) {
        console.log('Missing user token, skipping git clone');
        return null;
      }
      
      // Create authenticated URL
      let cloneUrl = repoUrl;
      if (repoUrl.startsWith('https://')) {
        cloneUrl = repoUrl.replace('https://', `https://x-access-token:${userToken}@`);
      }
      
      const git = simpleGit({ baseDir: workdir });
      console.log(`Cloning repository for user ${username} with authentication`);
      await git.clone(cloneUrl, userDir);
      
      // Configure sparse checkout after clone
      const userGit = simpleGit(userDir);
      await configureSparseCheckout(userGit, sparsePaths);
      
      // Set local repository configuration
      await userGit.addConfig('user.name', username, false, 'local');
      await userGit.addConfig('user.email', `${username}@users.noreply.github.com`, false, 'local');
      console.log(`Set local git config for ${username}`);
      
      console.log(`Cloned repository for user ${username}`);
    } else if ((operation === 'reset' || operation === 'checkout') && userRepoExists) {
      // Branch operations on existing repository
      const git = simpleGit(userDir);
      
      // Ensure remote has authentication token
      if (userToken) {
        let authenticatedUrl = repoUrl;
        if (repoUrl.startsWith('https://')) {
          authenticatedUrl = repoUrl.replace('https://', `https://x-access-token:${userToken}@`);
        }
        await git.remote(['set-url', 'origin', authenticatedUrl]);
      }
      
      // Get current status and handle dirty working directory
      const status = await git.status();
      let stashMessage = '';
      
      if (!status.isClean()) {
        const timestamp = new Date().toISOString();
        stashMessage = `Auto-stashed by CLT-UI for ${username} at ${timestamp}`;
        await git.stash(['push', '-m', stashMessage]);
        console.log(`Stashed current changes: ${stashMessage}`);
      }
      
      // Fetch latest from remote
      await git.fetch(['--all']);
      console.log('Fetched latest updates from remote');
      
      if (branch) {
        // Handle branch-specific operations
        const branches = await git.branch();
        const localBranchExists = branches.all.includes(branch);
        const remoteBranchExists = branches.all.includes(`remotes/origin/${branch}`);
        
        if (operation === 'reset') {
          if (localBranchExists) {
            await git.checkout(branch);
            console.log(`Switched to branch: ${branch}`);
            if (forceReset) {
              await git.reset(['--hard', `origin/${branch}`]);
              console.log(`Reset to origin/${branch}`);
            }
          } else if (remoteBranchExists) {
            await git.checkout(['-b', branch, `origin/${branch}`]);
            console.log(`Created and checked out branch ${branch} tracking origin/${branch}`);
          } else {
            throw new Error(`Branch '${branch}' not found locally or on remote`);
          }
        } else if (operation === 'checkout') {
          if (localBranchExists) {
            await git.checkout(branch);
            console.log(`Switched to existing branch: ${branch}`);
            try {
              await git.pull('origin', branch);
              console.log(`Pulled latest changes for branch: ${branch}`);
            } catch (pullError) {
              console.warn(`Warning: Could not pull latest changes for ${branch}:`, pullError.message);
            }
          } else if (remoteBranchExists) {
            await git.checkout(['-b', branch, `origin/${branch}`]);
            console.log(`Created and checked out branch ${branch} tracking origin/${branch}`);
          } else {
            throw new Error(`Branch '${branch}' not found locally or on remote`);
          }
        }
      }
      
      return {
        userDir,
        testDir,
        operation,
        branch: branch || status.current,
        stashed: stashMessage || null,
        message: `Successfully completed ${operation} operation${branch ? ` for branch: ${branch}` : ''}`
      };
    } else if (!userRepoExists) {
      throw new Error('Repository not found - needs initialization');
    }
    
    // Verify the repo is valid and the CLT tests folder exists
    const testDirExists = await fs.access(testDir).then(() => true).catch(() => false);
    
    if (!testDirExists) {
      console.error(`CLT tests directory not found for user ${username}. Expected at: ${testDir}`);
      return null;
    }
    
    return { userDir, testDir };
  } catch (error) {
    console.error(`Error in repository ${operation} operation:`, error);
    throw error;
  }
}