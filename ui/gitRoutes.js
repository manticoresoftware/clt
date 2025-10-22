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
import { getDefaultBranch, checkExistingPR, isPRBranch, isOnDefaultBranch } from './helpers.js';
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

          // Only add to modifiedFiles if in test directory (for file explorer display)
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

        // For PR creation: show button if we're not on default branch and no existing PR
        // Don't check for changes - user should be able to create PR from any branch
        const hasChanges = currentBranch !== defaultBranch;

        // Extract repository URL from git remotes
        let repoUrl = null;
        try {
          const remotes = await git.getRemotes(true);
          console.log('Git remotes found:', remotes);
          
          const originRemote = remotes.find(remote => remote.name === 'origin');
          if (originRemote && originRemote.refs && originRemote.refs.fetch) {
            let fetchUrl = originRemote.refs.fetch;
            
            // Convert SSH format to HTTPS for GitHub URLs
            if (fetchUrl.startsWith('git@github.com:')) {
              fetchUrl = fetchUrl.replace('git@github.com:', 'https://github.com/');
            }
            
            // Remove .git suffix if present
            if (fetchUrl.endsWith('.git')) {
              fetchUrl = fetchUrl.slice(0, -4);
            }
            
            repoUrl = fetchUrl;
            console.log('Processed repo URL:', repoUrl);
          }
        } catch (error) {
          console.warn('Failed to get repository URL:', error.message);
        }

        return res.json({
          success: true,
          currentBranch,
          isPrBranch,
          existingPr, // Add the existing PR data to the response
          hasChanges, // True if not on default branch (can create PR)
          modifiedFiles, // Files in test directory only (for file explorer)
          modifiedDirs: Array.from(modifiedDirs),
          testPath: relativeTestPath,
          repoUrl: repoUrl
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

  // Create and checkout new branch endpoint
  app.post('/api/create-branch', isAuthenticated, async (req, res) => {
    try {
      const { branch } = req.body;

      if (!branch) {
        return res.status(400).json({ error: 'Branch name is required' });
      }

      // Validate branch name (basic validation)
      if (!/^[a-zA-Z0-9/_-]+$/.test(branch)) {
        return res.status(400).json({ error: 'Invalid branch name. Use only letters, numbers, hyphens, underscores, and forward slashes.' });
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

      const git = simpleGit(userRepo);

      try {
        // Check if branch already exists locally
        const branches = await git.branchLocal();
        if (branches.all.includes(branch)) {
          return res.status(400).json({ error: `Branch '${branch}' already exists locally` });
        }

        // Check if branch exists on remote
        try {
          await git.fetch();
          const remoteBranches = await git.branch(['-r']);
          const remoteBranchName = `origin/${branch}`;
          
          if (remoteBranches.all.includes(remoteBranchName)) {
            // Branch exists on remote, checkout and track it
            await git.checkoutBranch(branch, remoteBranchName);
            return res.json({
              success: true,
              currentBranch: branch,
              message: `Checked out existing remote branch '${branch}'`,
              created: false
            });
          }
        } catch (fetchError) {
          console.log('Could not fetch remote branches, proceeding with local branch creation');
        }

        // Create new branch from current branch
        await git.checkoutLocalBranch(branch);
        
        // Push the new branch with upstream tracking
        try {
          await git.push(['-u', 'origin', branch]);
          console.log(`Successfully pushed new branch '${branch}' with upstream tracking`);
        } catch (pushError) {
          console.log(`Warning: Could not push new branch '${branch}' to remote:`, pushError.message);
          // Continue anyway - the branch was created locally
        }
        
        return res.json({
          success: true,
          currentBranch: branch,
          message: `Created and checked out new branch '${branch}'`,
          created: true
        });

      } catch (gitError) {
        console.error('Git operation error:', gitError);
        return res.status(500).json({
          error: 'Git operation failed',
          details: gitError.message || 'Unknown error during git operation'
        });
      }
    } catch (error) {
      console.error('Error in create-branch:', error);
      res.status(500).json({ error: `Failed to create branch: ${error.message}` });
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

    // Check if on default branch - block commits
    const branchCheck = await isOnDefaultBranch(userRepo);
    if (branchCheck.isDefault) {
      return res.status(403).json({ 
        error: `Cannot commit changes on default branch (${branchCheck.defaultBranch}). Please create a new branch before committing.`,
        currentBranch: branchCheck.currentBranch,
        defaultBranch: branchCheck.defaultBranch,
        isDefaultBranch: true
      });
    }

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

  // API endpoint to trigger CI by removing [skip ci] from last commit
  app.post('/api/trigger-ci', isAuthenticated, async (req, res) => {
    try {
      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepo).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      const git = simpleGit({ baseDir: userRepo });
      await ensureGitRemoteWithToken(git, req.user.token, REPO_URL);

      // Get current branch and verify it's a PR branch
      const status = await git.status();
      const currentBranch = status.current;
      const defaultBranch = await getDefaultBranch(git, userRepo);

      // Check if current branch has an existing PR
      const existingPr = await checkExistingPR(currentBranch, defaultBranch, userRepo, req.user.token);
      const isPrBranch = isPRBranch(currentBranch, defaultBranch, existingPr);

      if (!isPrBranch) {
        return res.status(400).json({
          error: 'Can only trigger CI for PR branches (branches with existing pull requests)'
        });
      }

      // Get the last commit message
      const log = await git.log({ maxCount: 1 });
      if (!log.latest) {
        return res.status(400).json({ error: 'No commits found' });
      }

      const lastCommitMessage = log.latest.message;
      
      // Check if commit message contains [skip ci]
      const skipCiPattern = /\[skip ci\]/gi;
      if (!skipCiPattern.test(lastCommitMessage)) {
        return res.json({
          success: true,
          message: 'No [skip ci] found in last commit - CI will run normally',
          commitMessage: lastCommitMessage,
          changed: false
        });
      }

      // Remove [skip ci] from commit message
      const newCommitMessage = lastCommitMessage.replace(skipCiPattern, '').trim();
      
      // Amend the last commit with new message
      await git.commit(newCommitMessage, undefined, ['--amend']);
      
      // Force push with lease for safety
      await git.push(['--force-with-lease', 'origin', currentBranch]);

      res.json({
        success: true,
        message: 'Removed [skip ci] and force-pushed - CI will now run',
        originalMessage: lastCommitMessage,
        newMessage: newCommitMessage,
        changed: true,
        branch: currentBranch
      });

    } catch (error) {
      console.error('Error triggering CI:', error);
      res.status(500).json({ error: `Failed to trigger CI: ${error.message}` });
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

      // Check if on default branch - block file checkout (discarding changes)
      const branchCheck = await isOnDefaultBranch(userRepo);
      if (branchCheck.isDefault) {
        return res.status(403).json({ 
          error: `Cannot discard file changes on default branch (${branchCheck.defaultBranch}). Please create a new branch before editing.`,
          currentBranch: branchCheck.currentBranch,
          defaultBranch: branchCheck.defaultBranch,
          isDefaultBranch: true
        });
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

  // API endpoint to get git history and diff for a specific file
  app.get('/api/file-git-history', isAuthenticated, async (req, res) => {
    try {
      const { filePath } = req.query;

      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
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

      // Initialize simple-git with the user's repo path
      const git = simpleGit({ baseDir: userRepo });

      // Check if we're in a git repository
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return res.status(400).json({ error: 'Not a git repository' });
      }

      // Get current branch and default branch
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      const defaultBranch = await getDefaultBranch(git, userRepo);

      // Get the test directory relative path for the file
      const testDir = getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const absoluteFilePath = path.join(testDir, filePath);
      const relativeToRepo = path.relative(userRepo, absoluteFilePath);

      // Check if file exists
      const fileExists = await fs.access(absoluteFilePath).then(() => true).catch(() => false);
      if (!fileExists) {
        return res.status(404).json({ error: 'File not found' });
      }

      try {
        // Get file history (last 10 commits)
        const logOptions = {
          file: relativeToRepo,
          maxCount: 10,
          format: {
            hash: '%H',
            date: '%ai',
            message: '%s',
            author_name: '%an',
            author_email: '%ae'
          }
        };
        
        const history = await git.log(logOptions);

        // Get repository remote URL for GitHub links
        let repoUrl = null;
        try {
          const remotes = await git.getRemotes(true);
          console.log('Git remotes found:', remotes);
          const origin = remotes.find(remote => remote.name === 'origin');
          if (origin && origin.refs && origin.refs.fetch) {
            let fetchUrl = origin.refs.fetch;
            console.log('Original fetch URL:', fetchUrl);
            // Convert SSH URL to HTTPS if needed
            if (fetchUrl.startsWith('git@github.com:')) {
              fetchUrl = fetchUrl.replace('git@github.com:', 'https://github.com/').replace('.git', '');
            } else if (fetchUrl.endsWith('.git')) {
              fetchUrl = fetchUrl.replace('.git', '');
            }
            
            // SECURITY: Remove access tokens from URL before sending to frontend
            const cleanRepoUrl = fetchUrl.replace(/https:\/\/[^@]+@/, 'https://');
            repoUrl = cleanRepoUrl;
            console.log('Processed repo URL (tokens removed):', repoUrl);
          }
        } catch (remoteError) {
          console.warn('Could not get repository URL:', remoteError.message);
        }

        // Get diff against default branch (if not on default branch)
        let diff = null;
        if (currentBranch !== defaultBranch) {
          try {
            diff = await git.diff([`${defaultBranch}..HEAD`, '--', relativeToRepo]);
          } catch (diffError) {
            console.warn('Could not get diff against default branch:', diffError.message);
            diff = null;
          }
        }

        // Get current file status
        const status = await git.status([relativeToRepo]);
        const fileStatus = status.files.find(f => f.path === relativeToRepo);

        res.json({
          success: true,
          filePath: filePath,
          relativeToRepo: relativeToRepo,
          currentBranch: currentBranch,
          defaultBranch: defaultBranch,
          history: history.all,
          diff: diff,
          status: fileStatus || null,
          isOnDefaultBranch: currentBranch === defaultBranch,
          repoUrl: repoUrl
        });

      } catch (gitError) {
        console.error('Git operation failed:', gitError);
        res.status(500).json({ 
          error: 'Git operation failed',
          details: gitError.message 
        });
      }

    } catch (error) {
      console.error('Error in file-git-history endpoint:', error);
      res.status(500).json({ error: 'Failed to get file git history' });
    }
  });

  // Helper function to analyze commit history for undo/redo state (file-specific)
  // Helper function to analyze commit history for undo/redo state (file-specific)
  async function analyzeCommitHistory(git, filePath = null) {
    try {
      const defaultBranch = await getDefaultBranch(git, git.baseDir);
      const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

      // On default branch nothing to undo/redo
      if (currentBranch === defaultBranch) {
        return { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 };
      }

      const relPath = filePath || null;
      const revertPattern = /^Revert "(.+)"$/;

      // 1) canUndo via diff (file since default branch), with origin/<default> fallback
      let canUndo = false;
      if (relPath) {
        const ranges = [
          `${defaultBranch}..HEAD`,
          `origin/${defaultBranch}..HEAD`,
        ];
        for (const range of ranges) {
          try {
            const diff = await git.diff([range, '--', relPath]);
            if (diff && diff.trim().length > 0) {
              canUndo = true;
              break;
            }
          } catch (_) {
            // Continue to next range
          }
        }
      }

      // 2) Count commits since default for this file to compute counts and canRedo
      // Use raw git to avoid simple-git range/path ordering quirks that produced "master..HEAD..."
      let undoCount = 0;
      let redoCount = 0;
      if (relPath) {
        const buildArgs = (range) => [
          'log',
          '--pretty=format:%s',
          '--max-count=100',
          range,
          '--follow',
          '--',
          relPath,
        ];
        let logOutput = '';
        try {
          logOutput = await git.raw(buildArgs(`${defaultBranch}..HEAD`));
        } catch (e1) {
          try {
            logOutput = await git.raw(buildArgs(`origin/${defaultBranch}..HEAD`));
          } catch (e2) {
            console.error('[Undo/Redo] git log failed:', e2?.message || e2);
          }
        }
        if (logOutput) {
          const lines = logOutput.split('\n').map(s => s.trim()).filter(Boolean);
          for (const msg of lines) {
            if (revertPattern.test(msg)) {
              redoCount++;
            } else {
              // regular and Reapply commits are considered undoable
              undoCount++;
            }
          }
        }
      }

      if (!canUndo && undoCount > 0) canUndo = true;

      return { canUndo, canRedo: redoCount > 0, undoCount, redoCount };
    } catch (error) {
      console.error('Error analyzing commit history:', error);
      return { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 };
    }
  }

  // API endpoint to get undo/redo state (file-specific)
  app.get('/api/git-undo-redo-state', isAuthenticated, async (req, res) => {
    try {
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      const filePath = req.query.filePath;
      if (!filePath) {
        return res.json({ canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 });
      }

      const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepo).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      const git = simpleGit({ baseDir: userRepo });
      const isRepo = await git.checkIsRepo();
      
      if (!isRepo) {
        return res.json({ canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 });
      }

      // Normalize file path to repo-relative
      const relPath = path.isAbsolute(filePath) ? path.relative(userRepo, filePath) : filePath;
      const state = await analyzeCommitHistory(git, relPath);
      res.json(state);

    } catch (error) {
      console.error('Error getting undo/redo state:', error);
      res.status(500).json({ error: 'Failed to get undo/redo state' });
    }
  });

  // API endpoint to undo (revert) last commit
  app.post('/api/git-undo', isAuthenticated, async (req, res) => {
    try {
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepo).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      // Check if on default branch - block undo operations
      const branchCheck = await isOnDefaultBranch(userRepo);
      if (branchCheck.isDefault) {
        return res.status(403).json({ 
          error: `Cannot undo changes on default branch (${branchCheck.defaultBranch}). Please create a new branch before editing.`,
          currentBranch: branchCheck.currentBranch,
          defaultBranch: branchCheck.defaultBranch,
          isDefaultBranch: true
        });
      }

      const git = simpleGit({ baseDir: userRepo });
      const isRepo = await git.checkIsRepo();
      
      if (!isRepo) {
        return res.status(400).json({ error: 'Not a git repository' });
      }

      const { filePath } = req.body || {};
      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }

      const relPath = path.isAbsolute(filePath) ? path.relative(userRepo, filePath) : filePath;

      // Block if local changes exist for this file
      const status = await git.status([relPath]);
      const hasLocalChanges = (status.files || []).some(f => f.path === relPath);
      if (hasLocalChanges) {
        return res.status(400).json({ error: 'File has local changes. Commit or stash them first.' });
      }

      // Check state for this file
      const currentState = await analyzeCommitHistory(git, relPath);
      if (!currentState.canUndo) {
        return res.status(400).json({ error: 'Nothing to undo for this file' });
      }

      // Find latest non-revert commit for this file since default branch
      const defaultBranch = await getDefaultBranch(git, userRepo);
      // Use raw git log to ensure correct ordering of range and path
      const buildArgs = (range) => [
        'log', '--pretty=format:%H%x1f%s', '--max-count=100', range, '--follow', '--', relPath,
      ];
      let logOutput = '';
      try {
        logOutput = await git.raw(buildArgs(`${defaultBranch}..HEAD`));
      } catch (e1) {
        try {
          logOutput = await git.raw(buildArgs(`origin/${defaultBranch}..HEAD`));
        } catch (e2) {
          console.error('[GIT-UNDO] git log failed:', e2?.message || e2);
        }
      }
      const commits = [];
      if (logOutput) {
        for (const line of logOutput.split('\n')) {
          if (!line) continue;
          const [hash, subject] = line.split('\x1f');
          if (hash) commits.push({ hash, message: subject || '' });
        }
      }
      const revertPattern = /^Revert \"(.+)\"$/;

      let targetCommit = null;
      for (const commit of commits) {
        const message = (commit.message || '').trim();
        if (!revertPattern.test(message)) {
          targetCommit = commit;
          break;
        }
      }

      if (!targetCommit) {
        return res.status(400).json({ error: 'No commit found to undo for this file' });
      }

      console.log(`🔄 [GIT-UNDO] Reverting commit: ${targetCommit.hash} - "${targetCommit.message}" for file: ${relPath}`);

      // Perform git revert
      await git.revert(targetCommit.hash, ['--no-edit']);

      // Push the revert commit (keep existing behavior)
      console.log('🚀 [GIT-UNDO] Pushing revert commit...');
      try {
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        await git.push('origin', currentBranch);
        console.log('✅ [GIT-UNDO] Revert commit pushed successfully');
      } catch (pushError) {
        console.error('❌ [GIT-UNDO] Failed to push revert commit:', pushError);
        // Continue anyway - the revert was successful locally
      }

      // Get updated state for this file
      const newState = await analyzeCommitHistory(git, relPath);

      res.json({
        success: true,
        revertedCommit: {
          hash: targetCommit.hash,
          message: targetCommit.message
        },
        ...newState
      });

    } catch (error) {
      console.error('Error during git undo:', error);
      
      // Handle git conflicts or other git errors
      if (error.message && error.message.includes('conflict')) {
        res.status(409).json({ 
          error: 'Git conflict occurred during undo. Please resolve conflicts manually.',
          details: error.message 
        });
      } else {
        res.status(500).json({ 
          error: 'Failed to undo commit',
          details: error.message 
        });
      }
    }
  });

  // API endpoint to redo (revert the revert) (file-specific)
  app.post('/api/git-redo', isAuthenticated, async (req, res) => {
    try {
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      const { filePath } = req.body;
      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }

      const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepo).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      // Check if on default branch - block redo operations
      const branchCheck = await isOnDefaultBranch(userRepo);
      if (branchCheck.isDefault) {
        return res.status(403).json({ 
          error: `Cannot redo changes on default branch (${branchCheck.defaultBranch}). Please create a new branch before editing.`,
          currentBranch: branchCheck.currentBranch,
          defaultBranch: branchCheck.defaultBranch,
          isDefaultBranch: true
        });
      }

      const git = simpleGit({ baseDir: userRepo });
      const isRepo = await git.checkIsRepo();
      
      if (!isRepo) {
        return res.status(400).json({ error: 'Not a git repository' });
      }

      // Normalize file path first
      const relPath = path.isAbsolute(filePath) ? path.relative(userRepo, filePath) : filePath;

      // Get current state to check if redo is possible for this file
      const currentState = await analyzeCommitHistory(git, relPath);
      if (!currentState.canRedo) {
        return res.status(400).json({ error: 'Nothing to redo for this file' });
      }

      // Block if local changes exist for this file
      const status = await git.status([relPath]);
      const hasLocalChanges = (status.files || []).some(f => f.path === relPath);
      if (hasLocalChanges) {
        return res.status(400).json({ error: 'File has local changes. Commit or stash them first.' });
      }

      const defaultBranch = await getDefaultBranch(git, userRepo);
      // Use raw git log to avoid malformed range
      const buildArgs = (range) => [
        'log', '--pretty=format:%H%x1f%s', '--max-count=100', range, '--follow', '--', relPath,
      ];
      let logOutput = '';
      try {
        logOutput = await git.raw(buildArgs(`${defaultBranch}..HEAD`));
      } catch (e1) {
        try {
          logOutput = await git.raw(buildArgs(`origin/${defaultBranch}..HEAD`));
        } catch (e2) {
          console.error('[GIT-REDO] git log failed:', e2?.message || e2);
        }
      }
      const commits = [];
      if (logOutput) {
        for (const line of logOutput.split('\n')) {
          if (!line) continue;
          const [hash, subject] = line.split('\x1f');
          if (hash) commits.push({ hash, message: subject || '' });
        }
      }
      const revertPattern = /^Revert \"(.+)\"$/;

      let targetRevertCommit = null;
      let originalMessage = null;
      for (const commit of commits) {
        const message = (commit.message || '').trim();
        const m = message.match(revertPattern);
        if (m) {
          targetRevertCommit = commit;
          originalMessage = m[1];
          break;
        }
      }

      if (!targetRevertCommit) {
        return res.status(400).json({ error: 'No revert commit found to redo for this file' });
      }

      console.log(`🔄 [GIT-REDO] Reverting revert commit: ${targetRevertCommit.hash} - "${targetRevertCommit.message}" for file: ${relPath}`);

      // Perform git revert on the revert commit (this reapplies the original)
      await git.revert(targetRevertCommit.hash, ['--no-edit']);

      // Amend the message to Reapply "<original>"
      if (originalMessage) {
        try {
          await git.raw(['commit', '--amend', '-m', `Reapply "${originalMessage}"`]);
        } catch (amendErr) {
          console.warn('Failed to amend commit message to Reapply:', amendErr.message);
        }
      }

      // Push the reapply commit
      console.log('🚀 [GIT-REDO] Pushing reapply commit...');
      try {
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        await git.push('origin', currentBranch);
        console.log('✅ [GIT-REDO] Reapply commit pushed successfully');
      } catch (pushError) {
        console.error('❌ [GIT-REDO] Failed to push reapply commit:', pushError);
        // Continue anyway - the reapply was successful locally
      }

      // Get updated state for this file
      const newState = await analyzeCommitHistory(git, relPath);

      return res.json({
        success: true,
        reappliedCommit: {
          hash: targetRevertCommit.hash,
          message: targetRevertCommit.message
        },
        ...newState
      });
    } catch (error) {
      console.error('Error during git redo:', error);
      
      // Handle git conflicts or other git errors
      if (error.message && error.message.includes('conflict')) {
        return res.status(409).json({ 
          error: 'Git conflict occurred during redo. Please resolve conflicts manually.',
          details: error.message 
        });
      } else {
        return res.status(500).json({ 
          error: 'Failed to redo commit',
          details: error.message 
        });
      }
    }
  });

}
