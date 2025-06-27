import path from 'path';
import fs from 'fs/promises';
import simpleGit from 'simple-git';
import {
  getUserRepoPath,
  getUserTestPath,
  ensureGitRemoteWithToken,
  slugify
} from './routes.js';
import { getDefaultBranch } from './helpers.js';

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
        
        // Check for existing PR on this branch
        let existingPr = null;
        if (currentBranch && currentBranch !== defaultBranch) {
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

            const prListCmd = `gh pr list --state open --head ${currentBranch} --json url,title,number`;
            const prListOutput = await execPromise(prListCmd);
            
            if (prListOutput && prListOutput.trim() && prListOutput.trim() !== '[]') {
              const prs = JSON.parse(prListOutput);
              if (Array.isArray(prs) && prs.length > 0) {
                existingPr = prs[0];
              }
            }
          } catch (error) {
            console.log('Error checking for existing PR:', error.message);
          }
        }

        // Determine if this is a PR branch: tool-created OR has existing PR
        const isPrBranch = (currentBranch && currentBranch !== defaultBranch) &&
                          (currentBranch.startsWith('clt-ui-') || existingPr !== null);
        console.log(`Is PR branch: ${isPrBranch}`);

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
        // Initialize simple-git with the user's repo path
        const git = simpleGit(userRepo);
        await ensureGitRemoteWithToken(git, req.user.token, REPO_URL);

        // Get current status to check for changes
        const status = await git.status();
        let stashMessage = '';

        // Stash changes if needed
        if (!status.isClean()) {
          const timestamp = new Date().toISOString();
          stashMessage = `Auto-stashed by CLT-UI for ${req.user.username} at ${timestamp}`;
          await git.stash(['push', '-m', stashMessage]);
          console.log(`Stashed current changes: ${stashMessage}`);
        }

        // Fetch latest from remote
        await git.fetch(['--all']);
        console.log('Fetched latest updates from remote');

        // Get the list of branches to check if the requested branch exists
        const branches = await git.branch();
        const branchExists = branches.all.includes(branch);

        if (branchExists) {
          // Local branch exists, checkout and reset to remote
          await git.checkout(branch);
          console.log(`Switched to branch: ${branch}`);

          // Reset to origin's version of the branch
          await git.reset(['--hard', `origin/${branch}`]);
          console.log(`Reset to origin/${branch}`);
        } else {
          // Local branch doesn't exist, create tracking branch
          await git.checkout(['-b', branch, `origin/${branch}`]);
          console.log(`Created and checked out branch ${branch} tracking origin/${branch}`);
        }

        return res.json({
          success: true,
          branch,
          repository: status.tracking,
          stashed: status.isClean() ? null : stashMessage,
          message: `Successfully reset to branch: ${branch}`
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
        // Initialize simple-git with the user's repo path
        const git = simpleGit(userRepo);
        await ensureGitRemoteWithToken(git, req.user.token, REPO_URL);

        // Fetch latest from remote
        await git.fetch(['--all']);
        console.log('Fetched latest updates from remote');

        // Get the list of branches to check if the requested branch exists
        const branches = await git.branch();
        const localBranchExists = branches.all.includes(branch);
        const remoteBranchExists = branches.all.includes(`remotes/origin/${branch}`);

        if (localBranchExists) {
          // Local branch exists, checkout and pull
          await git.checkout(branch);
          console.log(`Switched to existing branch: ${branch}`);

          try {
            await git.pull('origin', branch);
            console.log(`Pulled latest changes for branch: ${branch}`);
          } catch (pullError) {
            console.warn(`Warning: Could not pull latest changes for ${branch}:`, pullError.message);
            // Continue anyway - the checkout was successful
          }
        } else if (remoteBranchExists) {
          // Remote branch exists, create local tracking branch
          await git.checkout(['-b', branch, `origin/${branch}`]);
          console.log(`Created and checked out branch ${branch} tracking origin/${branch}`);
        } else {
          return res.status(400).json({
            error: `Branch '${branch}' not found locally or on remote`
          });
        }

        // Get current status to confirm
        const status = await git.status();
        const currentBranch = status.current;

        return res.json({
          success: true,
          currentBranch: currentBranch,
          message: `Successfully checked out and pulled branch: ${currentBranch}`
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


      const { spawn } = await import('child_process');

      // Helper to run gh commands safely with spawn (no shell injection)
      const execGhCommand = (args) => new Promise((resolve, reject) => {
        console.log('Running gh command with args:', args);
        const gh = spawn('gh', args, {
          cwd: userRepo,
          env: { ...process.env, GH_TOKEN: req.user.token },
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

        gh.on('close', (code) => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            console.error(`gh command failed with code ${code}: ${stderr}`);
            reject(new Error(stderr || `gh command failed with code ${code}`));
          }
        });

        gh.on('error', (error) => {
          console.error('gh command error:', error);
          reject(error);
        });
      });

      if (branchExists) {
        // check if there's an OPEN PR for that head using safe spawn
        const prArgs = ['pr', 'list', '--state', 'open', '--head', branchName, '--json', 'url'];
        const prList = await execGhCommand(prArgs).catch(() => '');

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
      const currentBranch = status.current;

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
      const prOutput = await execGhCommand(prArgs).catch(e => { throw e });
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
      let isPrBranch = false;
      let existingPr = null;
      let recentCommits = [];

      const { exec } = await import('child_process');
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

      // Check for existing PR for current branch using GitHub CLI
      // Check for any non-default branch to detect existing PRs
      if (currentBranch && currentBranch !== defaultBranch) {
        try {
          console.log('🔍 Checking for existing PR on branch:', currentBranch);

          // Method 1: Use gh pr list to find PRs for this specific branch
          const prListCmd = `gh pr list --state open --head ${currentBranch} --json url,title,number`;
          console.log('Running command:', prListCmd);

          const prListOutput = await execPromise(prListCmd);
          console.log('gh pr list result:', prListOutput);

          if (prListOutput && prListOutput.trim() && prListOutput.trim() !== '[]') {
            const prs = JSON.parse(prListOutput);
            console.log('Parsed PRs:', prs);

            if (Array.isArray(prs) && prs.length > 0) {
              existingPr = {
                url: prs[0].url,
                title: prs[0].title,
                number: prs[0].number
              };
              console.log('✅ Found existing PR:', existingPr);
            }
          } else {
            console.log('❌ No PR found for branch:', currentBranch);
          }
        } catch (error) {
          console.log('❌ Error checking for PR:', error.message);

          // Fallback: try gh pr view (if we're currently on the PR branch)
          try {
            console.log('Trying fallback: gh pr view');
            const prViewOutput = await execPromise('gh pr view --json url,title,number');
            console.log('gh pr view result:', prViewOutput);

            if (prViewOutput && prViewOutput.trim()) {
              const prData = JSON.parse(prViewOutput);
              existingPr = {
                url: prData.url,
                title: prData.title,
                number: prData.number
              };
              console.log('✅ Found existing PR via gh pr view:', existingPr);
            }
          } catch (viewError) {
            console.log('❌ gh pr view also failed:', viewError.message);
          }
        }
      } else {
        console.log('ℹ️ Not on a PR branch, skipping PR detection');
      }

      // Determine if this is a PR branch:
      // 1. Branch created by our tool (starts with clt-ui-)
      // 2. Any branch with an existing PR
      isPrBranch = (currentBranch && currentBranch !== defaultBranch) &&
                   (currentBranch.startsWith('clt-ui-') || existingPr !== null);

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
      // Get current branch and verify it's a PR branch
      const status = await git.status();
      const currentBranch = status.current;

      if (!currentBranch?.startsWith('clt-ui-')) {
        return res.status(400).json({
          error: 'Can only commit to PR branches (branches starting with clt-ui-)'
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
      const { exec } = await import('child_process');
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

      let prUrl = null;
      try {
        const prList = await execPromise(
          `gh pr list --state open --head ${currentBranch} --json url`
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
