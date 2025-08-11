import path from 'path';
import fs from 'fs/promises';
import simpleGit from 'simple-git';
import {
  getUserRepoPath,
  getUserTestPath,
  ensureGitRemoteWithToken,
  slugify
} from './routes.js';
import { ensureRepositoryCheckout } from './repositoryManager.js';
import { getDefaultBranch, checkExistingPR, isPRBranch } from './helpers.js';
import tokenManager from './tokenManager.js';

// Setup Git routes
export function setupGitRoutes(app, isAuthenticated, dependencies) {
  const {
    WORKDIR,
    ROOT_DIR,
    REPO_URL,
    getAuthConfig,
    ensureUserRepo
  } = dependencies;

  // API endpoint to get git status information
  app.get('/api/git-status', isAuthenticated, async (req, res) => {
    try {
      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      // Get the user's repo path
      const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepo).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        // Initialize simple-git with the user's repo path
        const git = simpleGit({ baseDir: userRepo });

        // Get current branch
        const branchSummary = await git.branch();
        const currentBranch = branchSummary.current;
        console.log(`Current branch: ${currentBranch}`);

        // Get default branch to determine if this is a PR branch
        const defaultBranch = await getDefaultBranch(git, userRepo);

        // Check for existing PR on this branch (excluding forks)
        const existingPr = await checkExistingPR(currentBranch, defaultBranch, userRepo, req.user.token);

        // Determine if this is a PR branch: tool-created OR has existing PR
        const isPrBranch = isPRBranch(currentBranch, defaultBranch, existingPr);

        // Get status information
        const status = await git.status();
        console.log('Git status:', status);

        // Parse the status to get modified files
        const modifiedFiles = [];
        const modifiedDirs = new Set();

        const testDir = getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
        // Get the relative path to the test directory from the repo root
        const relativeTestPath = path.relative(userRepo, testDir);
        console.log(`Relative test path: ${relativeTestPath}`);

        // Process modified, created, and deleted files
        const allChangedFiles = [
          ...status.modified,
          ...status.created,
          ...status.deleted,
          ...status.not_added
        ];

        for (const filePath of allChangedFiles) {
          console.log(`Checking file: ${filePath}`);

          // Check if this file is in the test directory
          if (filePath.startsWith(relativeTestPath)) {
            // Determine the status code
            let statusCode = '';
            if (status.modified.includes(filePath)) statusCode = 'M';
            else if (status.created.includes(filePath)) statusCode = 'A';
            else if (status.deleted.includes(filePath)) statusCode = 'D';
            else if (status.not_added.includes(filePath)) statusCode = '??';

            modifiedFiles.push({
              path: filePath,
              status: statusCode
            });

            // Add all parent directories to modifiedDirs set
            // Start with the file's directory
            let dirPath = path.dirname(filePath);
            while (dirPath && dirPath !== '.' && dirPath !== '/') {
              modifiedDirs.add(dirPath);
              dirPath = path.dirname(dirPath);
            }
          }
        }

        // Check if there are any changes to commit in the test directory
        const hasChanges = modifiedFiles.length > 0;

        return res.json({
          success: true,
          currentBranch,
          isPrBranch,
          existingPr, // Add the existing PR data to the response
          hasChanges,
          modifiedFiles,
          modifiedDirs: Array.from(modifiedDirs),
          testPath: relativeTestPath
        });
      } catch (gitError) {
        console.error('Git operation error:', gitError);
        return res.status(500).json({
          error: 'Git operation failed',
          details: gitError.message
        });
      }
    } catch (error) {
      console.error('Error getting git status:', error);
      res.status(500).json({ error: `Failed to get git status: ${error.message}` });
    }
  });

  // API endpoint to check repository status
  app.get('/api/repo-status', isAuthenticated, async (req, res) => {
    try {
      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      // Get the user's repo path
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.json({
          isInitialized: false,
          message: 'Repository not found - needs initialization'
        });
      }

      // Check if it's a valid git repository with test directory
      const testDir = getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const testDirExists = await fs.access(testDir).then(() => true).catch(() => false);

      if (!testDirExists) {
        return res.json({
          isInitialized: false,
          message: 'Repository exists but test directory not found - needs sync'
        });
      }

      // Check if git repository is properly initialized
      try {
        const git = simpleGit({ baseDir: userRepoPath });
        await git.status(); // This will throw if not a git repo

        return res.json({
          isInitialized: true,
          message: 'Repository is properly initialized',
          lastSyncTime: Date.now()
        });
      } catch (gitError) {
        return res.json({
          isInitialized: false,
          message: 'Repository exists but git is not properly initialized'
        });
      }
    } catch (error) {
      console.error('Error checking repository status:', error);
      res.status(500).json({ error: `Failed to check repository status: ${error.message}` });
    }
  });

  // API endpoint to sync/initialize repository
  app.post('/api/sync-repository', isAuthenticated, async (req, res) => {
    try {
      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      const username = req.user.username;
      console.log(`Starting repository sync for user: ${username}`);

      // Use the global ensureUserRepo function
      const result = await ensureUserRepo(username);

      if (!result) {
        return res.status(500).json({
          error: 'Failed to initialize repository. Please check your GitHub token and repository permissions.'
        });
      }

      console.log(`Repository sync completed for user: ${username}`);

      return res.json({
        success: true,
        message: 'Repository synchronized successfully',
        userDir: result.userDir,
        testDir: result.testDir,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error syncing repository:', error);
      res.status(500).json({ error: `Failed to sync repository: ${error.message}` });
    }
  });

  // API endpoint to get current branch information
  app.get('/api/current-branch', isAuthenticated, async (req, res) => {
    try {
      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      // Get the user's repo path
      const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepo).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        // Initialize simple-git with the user's repo path
        const git = simpleGit({ baseDir: userRepo });

        // Get branch information
        const branchSummary = await git.branch();
        const currentBranch = branchSummary.current;
        console.log(`Current branch: ${currentBranch}`);

        // Get remote repository URL
        const remoteUrl = await git.remote(['get-url', 'origin']);
        const cleanRemoteUrl = remoteUrl.replace(/https:\/\/[^@]+@/, 'https://');
        console.log(`Remote repository URL: ${cleanRemoteUrl}`);

        // Get default branch (cached)
        const defaultBranch = await getDefaultBranch(git, userRepo);
        console.log(`Default branch: ${defaultBranch}`);

        return res.json({
          success: true,
          currentBranch,
          defaultBranch,
          repository: cleanRemoteUrl
        });
      } catch (gitError) {
        console.error('Git operation error:', gitError);
        return res.status(500).json({
          error: 'Git operation failed',
          details: gitError.message
        });
      }
    } catch (error) {
      console.error('Error getting current branch:', error);
      res.status(500).json({ error: `Failed to get current branch: ${error.message}` });
    }
  });

  // API endpoint to get all branches
  app.get('/api/branches', isAuthenticated, async (req, res) => {
    try {
      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      // Get the user's repo path
      const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepo).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        // Initialize simple-git with the user's repo path
        const git = simpleGit({ baseDir: userRepo });

        // Fetch latest remote branches to ensure we have up-to-date branch list
        try {
          await git.fetch();
          console.log('Successfully fetched remote branches');
        } catch (fetchError) {
          console.warn('Warning: Failed to fetch remote branches:', fetchError.message);
          // Continue anyway - we'll work with what we have locally
        }

        // Get all branches (local and remote)
        const branchSummary = await git.branch(['-a']);
        console.log('Branch summary:', branchSummary);

        // Extract branch names, filtering out HEAD and remote tracking branches
        const branches = branchSummary.all
          .filter(branch => {
            // Filter out HEAD pointer and remote tracking branches
            return !branch.includes('HEAD') && 
                   !branch.startsWith('remotes/origin/HEAD') &&
                   branch !== 'HEAD';
          })
          .map(branch => {
            // Clean up branch names - remove 'remotes/origin/' prefix for remote branches
            if (branch.startsWith('remotes/origin/')) {
              return branch.replace('remotes/origin/', '');
            }
            return branch;
          })
          // Remove duplicates (local and remote versions of same branch)
          .filter((branch, index, array) => array.indexOf(branch) === index)
          // Sort branches alphabetically
          .sort();

        console.log(`Found ${branches.length} branches:`, branches);

        return res.json({
          success: true,
          branches: branches
        });
      } catch (gitError) {
        console.error('Git operation error:', gitError);
        return res.status(500).json({
          error: 'Git operation failed',
          details: gitError.message
        });
      }
    } catch (error) {
      console.error('Error getting branches:', error);
      res.status(500).json({ error: `Failed to get branches: ${error.message}` });
    }
  });

  // API endpoint to reset and sync to a specific branch
  app.post('/api/reset-to-branch', isAuthenticated, async (req, res) => {
    try {
      const { branch } = req.body;

      if (!branch) {
        return res.status(400).json({ error: 'Branch name is required' });
      }

      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      // Get the user's repo path
      const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepo).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        const result = await ensureRepositoryCheckout({
          username: req.user.username,
          userToken: req.user.token,
          repoUrl: REPO_URL,
          workdir: WORKDIR,
          branch,
          operation: 'reset',
          forceReset: true
        });

        return res.json({
          success: true,
          branch: result.branch,
          repository: REPO_URL,
          stashed: result.stashed,
          message: result.message
        });
      } catch (gitError) {
        console.error('Git operation error:', gitError);
        return res.status(500).json({
          error: 'Git operation failed',
          details: gitError.message || 'Unknown error during git operation'
        });
      }
    } catch (error) {
      console.error('Error resetting to branch:', error);
      res.status(500).json({ error: `Failed to reset to branch: ${error.message}` });
    }
  });

  // Checkout and pull branch endpoint
  app.post('/api/checkout-and-pull', isAuthenticated, async (req, res) => {
    try {
      const { branch } = req.body;

      if (!branch) {
        return res.status(400).json({ error: 'Branch name is required' });
      }

      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      // Get the user's repo path
      const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepo).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        const result = await ensureRepositoryCheckout({
          username: req.user.username,
          userToken: req.user.token,
          repoUrl: REPO_URL,
          workdir: WORKDIR,
          branch,
          operation: 'checkout'
        });

        return res.json({
          success: true,
          currentBranch: result.branch,
          stashed: result.stashed,
          message: result.message
        });
      } catch (gitError) {
        console.error('Git operation error:', gitError);
        return res.status(500).json({
          error: 'Git operation failed',
          details: gitError.message || 'Unknown error during git operation'
        });
      }
    } catch (error) {
      console.error('Error in checkout-and-pull:', error);
      res.status(500).json({ error: `Failed to checkout and pull branch: ${error.message}` });
    }
  });

  app.post('/api/create-pr', isAuthenticated, async (req, res) => {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: 'PR title is required' });

    const username = req.user.username;
    const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);

    // slugify title for branch name
    const branchName = `clt-ui-${slugify(title)}`;

    const git = simpleGit({ baseDir: userRepo });
    await ensureGitRemoteWithToken(git, req.user.token, REPO_URL);

    try {
      // First check if we're already on a branch with an existing PR
      const currentStatus = await git.status();
      const currentBranch = currentStatus.current;
      const defaultBranch = await getDefaultBranch(git, userRepo);

      // Check for existing PR on current branch
      if (currentBranch && currentBranch !== defaultBranch) {
        const { exec } = await import('child_process');
        const execPromise = (cmd) => new Promise((resolve, reject) => {
          exec(cmd, { cwd: userRepo, env: { ...process.env, GH_TOKEN: req.user.token } },
            (err, stdout, stderr) => {
              if (err) reject(stderr || err);
              else resolve(stdout.trim());
            }
          );
        });

        try {
          const prListCmd = `gh pr list --state open --base ${currentBranch} --json url,title,number`;
          const prListOutput = await execPromise(prListCmd);

          if (prListOutput && prListOutput.trim() && prListOutput.trim() !== '[]') {
            const prs = JSON.parse(prListOutput);
            if (Array.isArray(prs) && prs.length > 0) {
              // We're on a branch with existing PR - just commit to it
              console.log('Already on PR branch, committing to existing PR:', prs[0]);

              await git.add('.');
              const commit = await git.commit(title);
              await git.push('origin', currentBranch);

              return res.json({
                success: true,
                branch: currentBranch,
                commit: commit.commit,
                pr: prs[0].url,
                message: `Committed to existing PR: ${prs[0].title}`
              });
            }
          }
        } catch (error) {
          console.log('Error checking for existing PR on current branch:', error.message);
          // Continue with normal flow if PR check fails
        }
      }

      // fetch all
      await git.fetch(['--all']);

      // list local + remote branches
      const local  = await git.branchLocal();
      const remote = await git.branch(['-r']);
      const existsLocally = local.all.includes(branchName);
      const existsRemote  = remote.all.includes(`origin/${branchName}`);
      const branchExists  = existsLocally || existsRemote;

      const { exec } = await import('child_process');

      // helper to run gh commands
      const execPromise = (cmd) => new Promise((resolve, reject) => {
        exec(cmd, { cwd: userRepo, env: { ...process.env, GH_TOKEN: req.user.token } },
          (err, stdout, stderr) => {
            if (err) {
              reject(stderr || err);
            } else {
              resolve(stdout.trim());
            }
          }
        );
      });


/**
 * Helper to execute GitHub CLI commands with token validation and retry
 */
async function executeGitHubCommand(args, userRepo, username, retryCount = 0) {
  const MAX_RETRIES = 1;
  
  try {
    // Get valid token
    const validToken = await tokenManager.getValidToken(username);
    if (!validToken) {
      throw new Error('No valid GitHub token available');
    }

    const { spawn } = await import('child_process');
    
    return new Promise((resolve, reject) => {
      console.log(`[GitHubCommand] Running gh command with args:`, args);
      const gh = spawn('gh', args, {
        cwd: userRepo,
        env: { ...process.env, GH_TOKEN: validToken },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      gh.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      gh.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      gh.on('close', async (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          console.error(`[GitHubCommand] Command failed with code ${code}: ${stderr}`);
          
          // Check if it's an authentication error
          if ((code === 1 || code === 4) && stderr.includes('authentication') && retryCount < MAX_RETRIES) {
            console.log(`[GitHubCommand] Authentication error, invalidating token and retrying...`);
            
            // Remove invalid token
            tokenManager.removeTokens(username);
            
            // Retry once
            try {
              const result = await executeGitHubCommand(args, userRepo, username, retryCount + 1);
              resolve(result);
            } catch (retryError) {
              reject(new Error(`GitHub command failed after retry: ${retryError.message}`));
            }
          } else {
            reject(new Error(stderr || `GitHub command failed with code ${code}`));
          }
        }
      });

      gh.on('error', (error) => {
        console.error('[GitHubCommand] Command error:', error);
        reject(error);
      });
    });
  } catch (error) {
    if (retryCount < MAX_RETRIES && error.message.includes('token')) {
      console.log(`[GitHubCommand] Token error, retrying...`);
      return executeGitHubCommand(args, userRepo, username, retryCount + 1);
    }
    throw error;
  }
}

      if (branchExists) {
        // check if there's an OPEN PR for that head using safe spawn
        const prArgs = ['pr', 'list', '--state', 'open', '--head', branchName, '--json', 'url'];
        const prList = await executeGitHubCommand(prArgs, userRepo, username).catch(() => '');

        if (prList && prList.trim() && prList.trim() !== '[]') {
          // PROPERLY check if we have actual PRs
          let actualPrs = [];
          try {
            actualPrs = JSON.parse(prList);
          } catch (e) {
            console.log('Failed to parse PR list:', e);
            actualPrs = [];
          }

          if (Array.isArray(actualPrs) && actualPrs.length > 0) {
            // Branch AND PR both exist → just commit & push to existing PR
            console.log('Found existing PR, committing to existing branch');
            await git.checkout(branchName);
            await git.add('.');
            const commit = await git.commit(title);
            await git.push('origin', branchName);

            return res.json({
              success: true,
              branch: branchName,
              commit: commit.commit,
              pr: actualPrs[0]?.url,
              message: 'Committed and pushed to existing PR branch.'
            });
          }
        }

        // If we get here, branch exists but NO PR → checkout existing branch and create PR
        console.log('Branch exists but no PR found, checking out existing branch to create PR');

        // Check current status before checkout
        const preCheckoutStatus = await git.status();
        if (!preCheckoutStatus.isClean()) {
          // Stash changes before checkout to avoid conflicts
          const timestamp = new Date().toISOString();
          const stashMessage = `Auto-stash before checkout to ${branchName} at ${timestamp}`;
          await git.stash(['push', '-m', stashMessage]);
          console.log(`Stashed changes: ${stashMessage}`);
        }

        await git.checkout(branchName);

        // If we stashed changes, pop them back
        if (!preCheckoutStatus.isClean()) {
          try {
            await git.stash(['pop']);
            console.log('Restored stashed changes');
          } catch (stashError) {
            console.warn('Could not restore stashed changes:', stashError.message);
            // Continue anyway - the stash is still available
          }
        }

        // Check for changes after checkout and stash restore
        const postCheckoutStatus = await git.status();
        if (!postCheckoutStatus.isClean()) {
          await git.add('.');
          const commit = await git.commit(title);
          await git.push('origin', branchName);
          console.log('Committed to existing branch, now creating PR');
        } else {
          console.log('No new changes to commit on existing branch');
        }
      } else {
        // branch does not exist → create it, commit & push, open PR
        console.log('Branch does not exist, creating new branch');
        await git.checkoutLocalBranch(branchName);
        await git.add('.');

        try {
          const commit = await git.commit(title);
          await git.push('origin', branchName, ['--set-upstream']);
          console.log('Successfully created branch and pushed changes');
        } catch (commitError) {
          console.error('Failed to commit changes:', commitError);
          return res.status(400).json({
            error: 'Failed to commit changes. This might happen if there are no changes to commit or if there are conflicts.'
          });
        }
      }

      // At this point, we have a branch with committed changes, now create the PR
      // Get the commit info for response
      const commitInfo = await git.log({ maxCount: 1 });
      const latestCommit = commitInfo.latest;

      // Get the current status to determine base branch
      const status = await git.status();
      const finalBranch = status.current;

      // Determine base branch using cached helper
      const baseBranch = await getDefaultBranch(git, userRepo);

      // Build gh pr create arguments safely (no shell injection possible)
      const prArgs = [
        'pr', 'create',
        '--title', title,
        '--head', branchName,
        '--base', baseBranch
      ];

      if (description && description.trim()) {
        prArgs.push('--body', description);
      } else {
        return res.status(400).json({ error: 'Description is required for PR creation' });
      }

      console.log('Creating PR with args:', prArgs);
      const prOutput = await executeGitHubCommand(prArgs, userRepo, username);
      console.log('PR creation output:', prOutput);

      const prUrlMatch = prOutput.match(/https:\/\/github\.com\/[^\s]+/);
      const prUrl = prUrlMatch?.[0] || null;

      if (!prUrl) {
        // PR creation failed - don't return success
        console.error('PR creation failed - no URL found in output:', prOutput);
        return res.status(500).json({
          error: 'Pull request creation failed. No PR URL returned by GitHub CLI. Check your permissions and try again.'
        });
      }

      return res.json({
        success: true,
        branch: branchName,
        commit: latestCommit?.hash || 'unknown',
        pr: prUrl,
        message: 'Pull request created successfully.'
      });
    }
    catch (err) {
      console.error('create-pr error:', err);
      return res.status(500).json({ error: err.toString() });
    }
  });

  // API endpoint to check PR status for current branch
  app.get('/api/pr-status', isAuthenticated, async (req, res) => {
    const username = req.user.username;
    const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);

    const git = simpleGit({ baseDir: userRepo });
    await ensureGitRemoteWithToken(git, req.user.token, REPO_URL);

    try {
      // Get current branch
      const status = await git.status();
      const currentBranch = status.current;

      // Get default branch (cached)
      const defaultBranch = await getDefaultBranch(git, userRepo);
      console.log(`Default branch: ${defaultBranch}`);

      // Initialize PR detection
      let recentCommits = [];

      // Check for existing PR for current branch (excluding forks)
      const existingPr = await checkExistingPR(currentBranch, defaultBranch, userRepo, req.user.token);

      // Determine if this is a PR branch: tool-created OR has existing PR
      const isPrBranch = isPRBranch(currentBranch, defaultBranch, existingPr);

      // Get recent commits for current branch (last 5)
      try {
        const logOutput = await git.log({ maxCount: 5 });
        recentCommits = logOutput.all.map(commit => ({
          hash: commit.hash.substring(0, 8),
          message: commit.message,
          author: commit.author_name,
          date: commit.date,
          authorEmail: commit.author_email
        }));
      } catch (error) {
        console.log('Error getting commit history:', error.message);
      }

      res.json({
        currentBranch,
        isPrBranch,
        existingPr,
        recentCommits,
        hasChanges: !status.isClean(),
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('Error checking PR status:', error);
      res.status(500).json({ error: `Failed to check PR status: ${error.message}` });
    }
  });

  // API endpoint to commit changes to existing PR branch
  app.post('/api/commit-changes', isAuthenticated, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Commit message is required' });

    const username = req.user.username;
    const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);

    const git = simpleGit({ baseDir: userRepo });
    await ensureGitRemoteWithToken(git, req.user.token, REPO_URL);

    try {
      // Get current branch and verify it's a PR branch (has existing PR)
      const status = await git.status();
      const currentBranch = status.current;
      const defaultBranch = await getDefaultBranch(git, userRepo);

      // Check if current branch has an existing PR (excluding forks)
      const existingPr = await checkExistingPR(currentBranch, defaultBranch, userRepo, req.user.token);

      // Allow commits to: tool-created branches OR branches with existing PRs
      const isPrBranch = isPRBranch(currentBranch, defaultBranch, existingPr);

      if (!isPrBranch) {
        return res.status(400).json({
          error: 'Can only commit to PR branches (branches with existing pull requests)'
        });
      }

      // Check if there are changes to commit
      if (status.isClean()) {
        return res.status(400).json({ error: 'No changes to commit' });
      }

      // Commit and push changes
      await git.add('.');
      const commit = await git.commit(message);
      await git.push('origin', currentBranch);

      // Get PR URL if exists
      let prUrl = null;
      try {
        const { exec } = await import('child_process');
        const execPromise = (cmd) => new Promise((resolve, reject) => {
          exec(cmd, { cwd: userRepo, env: { ...process.env, GH_TOKEN: req.user.token } },
            (err, stdout, stderr) => {
              if (err) reject(stderr || err);
              else resolve(stdout.trim());
            }
          );
        });

        const prList = await execPromise(
          `gh pr list --state open --base ${currentBranch} --json url`
        );
        if (prList) {
          const prs = JSON.parse(prList);
          if (prs.length > 0) {
            prUrl = prs[0].url;
          }
        }
      } catch (error) {
        console.log('Could not get PR URL:', error.message);
      }

      res.json({
        success: true,
        branch: currentBranch,
        commit: commit.commit,
        commitHash: commit.commit.substring(0, 8),
        pr: prUrl,
        message: 'Changes committed and pushed to PR successfully'
      });

    } catch (error) {
      console.error('Error committing changes:', error);
      res.status(500).json({ error: `Failed to commit changes: ${error.message}` });
    }
  });

  // Checkout a single file to discard changes
  app.post('/api/checkout-file', isAuthenticated, async (req, res) => {
    try {
      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      const { filePath } = req.body;
      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }

      // Get the user's repo path
      const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepo).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        // Initialize simple-git with the user's repo path
        const git = simpleGit(userRepo);

        // Check if file exists and has changes
        const status = await git.status();
        const fileHasChanges = status.modified.includes(filePath) ||
                              status.not_added.includes(filePath) ||
                              status.deleted.includes(filePath);

        if (!fileHasChanges) {
          return res.status(400).json({ error: 'File has no changes to discard' });
        }

        // Checkout the file to discard changes
        await git.checkout(['HEAD', '--', filePath]);

        console.log(`Successfully checked out file: ${filePath}`);

        return res.json({
          success: true,
          message: `Successfully discarded changes to ${filePath}`,
          filePath: filePath
        });

      } catch (gitError) {
        console.error('Git checkout error:', gitError);
        return res.status(500).json({
          error: 'Failed to checkout file',
          details: gitError.message
        });
      }

    } catch (error) {
      console.error('Error in checkout-file endpoint:', error);
      res.status(500).json({ error: 'Failed to checkout file' });
    }
  });
}
