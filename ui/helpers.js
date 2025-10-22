import path from 'path';
import fs from 'fs/promises';
import { writeFileSync, appendFileSync, existsSync, readdirSync, statSync, readFileSync } from 'fs';
import simpleGit from 'simple-git';

// Cache for default branch detection per repository
const defaultBranchCache = new Map();

/**
 * Get the default branch for a repository with caching
 * @param {Object} git - SimpleGit instance
 * @param {string} repoPath - Repository path for cache key
 * @returns {Promise<string>} Default branch name
 */
export async function getDefaultBranch(git, repoPath) {
  // Check cache first
  if (defaultBranchCache.has(repoPath)) {
    return defaultBranchCache.get(repoPath);
  }

  let defaultBranch;
  
  try {
    // Method 1: Try to get default branch from remote show origin
    const remoteInfo = await git.raw(['remote', 'show', 'origin']);
    const headBranchMatch = remoteInfo.match(/HEAD branch:\s*(.+)/);
    if (headBranchMatch && headBranchMatch[1].trim()) {
      defaultBranch = headBranchMatch[1].trim();
      console.log(`Default branch found via remote show: ${defaultBranch}`);
    }
  } catch (remoteError) {
    console.warn('Could not determine default branch from remote show, trying fallback methods:', remoteError.message);
  }

  if (!defaultBranch) {
    try {
      // Method 2: Try ls-remote to get HEAD reference
      const lsRemoteOutput = await git.raw(['ls-remote', '--symref', 'origin', 'HEAD']);
      const symrefMatch = lsRemoteOutput.match(/ref:\s*refs\/heads\/(.+)\s+HEAD/);
      if (symrefMatch && symrefMatch[1]) {
        defaultBranch = symrefMatch[1].trim();
        console.log(`Default branch found via ls-remote: ${defaultBranch}`);
      }
    } catch (lsRemoteError) {
      console.warn('Could not determine default branch from ls-remote:', lsRemoteError.message);
    }
  }

  if (!defaultBranch) {
    try {
      // Method 3: Check if origin/HEAD exists and try to resolve it
      defaultBranch = await git.revparse(['--abbrev-ref', 'origin/HEAD']);
      defaultBranch = defaultBranch.replace('origin/', '');
      console.log(`Default branch found via origin/HEAD: ${defaultBranch}`);
    } catch (headError) {
      console.warn('Could not determine default branch from origin/HEAD:', headError.message);
    }
  }

  if (!defaultBranch) {
    try {
      // Method 4: Fallback - Check remote branches and use common defaults
      const branches = await git.branch(['-r']);
      if (branches.all.includes('origin/main')) {
        defaultBranch = 'main';
        console.log('Default branch fallback: using main (found in remote branches)');
      } else if (branches.all.includes('origin/master')) {
        defaultBranch = 'master';
        console.log('Default branch fallback: using master (found in remote branches)');
      } else if (branches.all.length > 0) {
        // Use the first remote branch as fallback
        const firstRemote = branches.all.find(branch => branch.startsWith('origin/'));
        if (firstRemote) {
          defaultBranch = firstRemote.replace('origin/', '');
          console.log(`Default branch fallback: using first remote branch ${defaultBranch}`);
        }
      }
    } catch (branchError) {
      console.warn('Could not determine default branch from remote branches:', branchError.message);
    }
  }

  // Final fallback if all methods fail
  if (!defaultBranch) {
    defaultBranch = 'main';
    console.warn('All default branch detection methods failed, defaulting to main');
  }

  // Cache the result
  defaultBranchCache.set(repoPath, defaultBranch);
  console.log(`Default branch cached for ${repoPath}: ${defaultBranch}`);

  return defaultBranch;
}

/**
 * Clear the default branch cache (useful for testing or if repo changes)
 * @param {string} repoPath - Optional specific repo path to clear, or clear all if not provided
 */
export function clearDefaultBranchCache(repoPath = null) {
  if (repoPath) {
    defaultBranchCache.delete(repoPath);
  } else {
    defaultBranchCache.clear();
  }
}

/**
 * Create an exec promise wrapper for child_process.exec
 * @param {string} repoPath - Repository path for working directory
 * @param {string} token - GitHub token for authentication
 * @returns {Function} execPromise function
 */
async function createExecPromise(repoPath, token) {
  const { exec } = await import('child_process');
  return (cmd) => new Promise((resolve, reject) => {
    console.log(`[DEBUG] Executing: ${cmd} in ${repoPath}`);
    exec(cmd, { 
      cwd: repoPath, 
      env: { ...process.env, GH_TOKEN: token } 
    }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[DEBUG] Command failed: ${cmd}`);
        console.error(`[DEBUG] Error: ${stderr || err.message}`);
        reject(stderr || err);
      } else {
        console.log(`[DEBUG] Command success: ${stdout.trim()}`);
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Check if the current branch has an existing PR (excluding forks)
 * @param {string} currentBranch - Current branch name
 * @param {string} defaultBranch - Default branch name
 * @param {string} repoPath - Repository path
 * @param {string} token - GitHub token
 * @returns {Promise<Object|null>} PR object if found, null otherwise
 */
export async function checkExistingPR(currentBranch, defaultBranch, repoPath, token) {
  // Only check for PRs on non-default branches
  if (!currentBranch || currentBranch === defaultBranch) {
    return null;
  }

  const execPromise = await createExecPromise(repoPath, token);

  try {
    console.log('🔍 Checking for existing PR on branch:', currentBranch);

    // Method 1: Use gh pr list to find PRs FROM this branch TO default branch (excluding forks)
    const prListCmd = `gh pr list --state open --head ${currentBranch} --base ${defaultBranch} --json url,title,number,isCrossRepository`;
    console.log('Running command:', prListCmd);

    const prListOutput = await execPromise(prListCmd);
    console.log('gh pr list result:', prListOutput);

    if (prListOutput && prListOutput.trim() && prListOutput.trim() !== '[]') {
      const prs = JSON.parse(prListOutput);
      console.log('Parsed PRs:', prs);

      if (Array.isArray(prs) && prs.length > 0) {
        // Filter out cross-repository PRs (forks)
        const sameBranchPRs = prs.filter(pr => !pr.isCrossRepository);
        console.log('PRs from same repository (excluding forks):', sameBranchPRs);

        if (sameBranchPRs.length > 0) {
          const existingPr = {
            url: sameBranchPRs[0].url,
            title: sameBranchPRs[0].title,
            number: sameBranchPRs[0].number
          };
          console.log('✅ Found existing PR (same repo):', existingPr);
          return existingPr;
        } else {
          console.log('❌ All found PRs are from forks, ignoring');
        }
      }
    } else {
      console.log('❌ No PR found for branch:', currentBranch);
    }
  } catch (error) {
    console.log('❌ Error checking for PR:', error.message);

    // Fallback: try gh pr view (if we're currently on the PR branch)
    try {
      console.log('Trying fallback: gh pr view');
      const prViewOutput = await execPromise('gh pr view --json url,title,number,isCrossRepository');
      console.log('gh pr view result:', prViewOutput);

      if (prViewOutput && prViewOutput.trim()) {
        const prData = JSON.parse(prViewOutput);
        
        // Only return if it's not a cross-repository PR
        if (!prData.isCrossRepository) {
          const existingPr = {
            url: prData.url,
            title: prData.title,
            number: prData.number
          };
          console.log('✅ Found existing PR via gh pr view (same repo):', existingPr);
          return existingPr;
        } else {
          console.log('❌ PR found via gh pr view is from fork, ignoring');
        }
      }
    } catch (viewError) {
      console.log('❌ gh pr view also failed:', viewError.message);
    }
  }

  return null;
}

/**
 * Determine if current branch is a PR branch
 * @param {string} currentBranch - Current branch name
 * @param {string} defaultBranch - Default branch name
 * @param {Object|null} existingPr - Existing PR object if found
 * @returns {boolean} True if this is a PR branch
 */
export function isPRBranch(currentBranch, defaultBranch, existingPr) {
  return (currentBranch && currentBranch !== defaultBranch) &&
         (currentBranch.startsWith('clt-ui-') || existingPr !== null);
}

// Helper function to save session data persistently
export function saveSessionToPersistentStorage(session, username) {
  const logDir = process.env.ASK_AI_LOG;
  if (!logDir) {
    return; // No persistent storage configured
  }

  try {
    const userLogDir = path.join(logDir, username);

    // Create user directory if it doesn't exist
    if (!existsSync(userLogDir)) {
      fs.mkdir(userLogDir, { recursive: true }).catch(console.error);
    }

    // Create log file name with timestamp
    const timestamp = session.startTime ? session.startTime.toISOString().replace(/[:.]/g, '-') : new Date().toISOString().replace(/[:.]/g, '-');
    const logFileName = `${session.name || 'session'}_${timestamp}.log`;
    const logFilePath = path.join(userLogDir, logFileName);

    // Prepare session metadata
    const metadata = {
      sessionId: session.id,
      sessionName: session.name,
      startTime: session.startTime,
      endTime: session.endTime,
      completed: session.completed,
      cancelled: session.cancelled,
      failed: session.failed,
      exitCode: session.exitCode,
      error: session.error,
      cost: session.cost,
      active: session.active || false
    };

    // Save session data
    const sessionData = {
      metadata,
      logs: session.logs,
      output: session.output
    };

    writeFileSync(logFilePath, JSON.stringify(sessionData, null, 2));
    console.log(`Session ${session.id} saved to ${logFilePath}`);
  } catch (error) {
    console.error('Failed to save session to persistent storage:', error);
  }
}

// Utility function to extract cost from logs (check last 100 lines or find first match)
export function extractCostFromLogs(logs) {
  if (!logs || logs.length === 0) return null;

  const costRegex = /cost:\s*\$(\d+\.?\d*)/gi;

  // Check last 100 lines first for most recent cost
  const linesToCheck = logs.slice(-100);
  for (let i = linesToCheck.length - 1; i >= 0; i--) {
    const matches = [...linesToCheck[i].matchAll(costRegex)];
    if (matches.length > 0) {
      return parseFloat(matches[matches.length - 1][1]);
    }
  }

  // If no cost found in last 100 lines, check all logs for first occurrence
  for (let i = 0; i < logs.length; i++) {
    const matches = [...logs[i].matchAll(costRegex)];
    if (matches.length > 0) {
      return parseFloat(matches[0][1]);
    }
  }

  return null;
}

// Utility function to sanitize session names for file system compatibility
export function sanitizeSessionName(name) {
  if (!name || !name.trim()) return '';

  return name.trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, '') // Remove special characters except spaces, hyphens, and underscores
    .replace(/\s+/g, '-')         // Replace spaces with hyphens
    .replace(/-+/g, '-')          // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, '');       // Remove leading/trailing hyphens
}

// Utility function to write logs synchronously to both console and file
export function writeLogEntry(session, logEntry, logType = 'INFO') {
  const timestamp = new Date().toISOString();
  const formattedEntry = `[${timestamp}] [${logType}] ${logEntry}`;

  // Add to session logs array
  session.logs.push(logEntry);

  // Write to console (same as before)
  console.log(`Session ${session.id} ${logType.toLowerCase()}:`, logEntry);

  // Write to log file immediately if configured
  if (session.logFile) {
    try {
      appendFileSync(session.logFile, logEntry);
    } catch (error) {
      console.error(`Failed to write to log file ${session.logFile}:`, error);
    }
  }

  // Update cost in real-time
  session.cost = extractCostFromLogs(session.logs);

  // Update session metadata in persistent storage incrementally
  if (session.logFile) {
    updateSessionMetadata(session);
  }
}

// Utility function to update session metadata incrementally
export function updateSessionMetadata(session) {
  if (!session.logFile) return;

  try {
    const metadata = {
      sessionId: session.id,
      sessionName: session.name,
      startTime: session.startTime,
      endTime: session.endTime,
      completed: session.completed,
      cancelled: session.cancelled,
      failed: session.failed,
      exitCode: session.exitCode,
      error: session.error,
      cost: session.cost,
      active: session.active || false,
      lastUpdated: new Date().toISOString()
    };

    const sessionData = {
      metadata,
      logs: session.logs,
      output: session.output || session.logs.join('')
    };

    // Write metadata to a separate .meta file for incremental updates
    const metaFile = session.logFile.replace('.log', '.meta');
    writeFileSync(metaFile, JSON.stringify(sessionData, null, 2));
  } catch (error) {
    console.error('Failed to update session metadata:', error);
  }
}

/**
 * Check if current branch is a default branch (main/master)
 * Reuses logic from autoCommitAndPush to avoid duplication
 * @param {string} userRepoPath - Path to user repository
 * @returns {Promise<Object>} Object with isDefault boolean and branch names
 */
export async function isOnDefaultBranch(userRepoPath) {
  try {
    const git = simpleGit(userRepoPath);
    
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return { isDefault: false, currentBranch: null, defaultBranch: null };
    }

    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    const defaultBranch = await getDefaultBranch(git, userRepoPath);
    
    return {
      isDefault: currentBranch === defaultBranch,
      currentBranch,
      defaultBranch
    };
  } catch (error) {
    console.error('Error checking default branch:', error);
    return { isDefault: false, currentBranch: null, defaultBranch: null };
  }
}

/**
 * Auto-commit and push changes when not on default branch
 * @param {string} userRepoPath - Path to user repository
 * @param {string} filePath - Relative path of the saved file
 * @param {string} token - User's GitHub token (if available)
 * @returns {Promise<Object>} Result of git operations
 */
export async function autoCommitAndPush(userRepoPath, filePath, token = null) {
  console.log('🚀 [AUTO-COMMIT] Starting auto-commit process');
  console.log('🚀 [AUTO-COMMIT] Params:', { userRepoPath, filePath, hasToken: !!token });
  
  try {
    const git = simpleGit(userRepoPath);
    
    // Check if we're in a git repository
    console.log('🚀 [AUTO-COMMIT] Checking if directory is a git repository...');
    const isRepo = await git.checkIsRepo();
    console.log('🚀 [AUTO-COMMIT] Is git repo:', isRepo);
    if (!isRepo) {
      console.log('❌ [AUTO-COMMIT] Not a git repository, skipping');
      return { success: false, reason: 'Not a git repository' };
    }

    // Get current branch
    console.log('🚀 [AUTO-COMMIT] Getting current branch...');
    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    console.log('🚀 [AUTO-COMMIT] Current branch:', currentBranch);
    
    // Get default branch
    console.log('🚀 [AUTO-COMMIT] Getting default branch...');
    const defaultBranch = await getDefaultBranch(git, userRepoPath);
    console.log('🚀 [AUTO-COMMIT] Default branch:', defaultBranch);
    
    // Only commit and push if not on default branch
    if (currentBranch === defaultBranch) {
      console.log('❌ [AUTO-COMMIT] On default branch, skipping auto-commit');
      return { success: false, reason: `On default branch (${defaultBranch}), skipping auto-commit` };
    }
    
    console.log('✅ [AUTO-COMMIT] On non-default branch, proceeding with auto-commit');

    // Check if there are any changes to commit
    console.log('🚀 [AUTO-COMMIT] Checking git status...');
    const status = await git.status();
    console.log('🚀 [AUTO-COMMIT] Git status:', {
      files: status.files.length,
      modified: status.modified,
      created: status.created,
      deleted: status.deleted,
      staged: status.staged,
      not_added: status.not_added
    });
    
    if (status.files.length === 0) {
      console.log('❌ [AUTO-COMMIT] No changes to commit');
      return { success: false, reason: 'No changes to commit' };
    }

    // Get just the filename for the commit message
    const filename = path.basename(filePath);
    const commitMessage = `Updated ${filename} [skip ci]`;
    console.log('🚀 [AUTO-COMMIT] Commit message:', commitMessage);

    // Add the specific file to staging
    console.log('🚀 [AUTO-COMMIT] Adding file to staging:', filePath);
    try {
      await git.add(filePath);
      console.log('✅ [AUTO-COMMIT] File added to staging');
      
      // Verify the file was actually staged
      const statusAfterAdd = await git.status();
      console.log('🚀 [AUTO-COMMIT] Status after git add:', {
        staged: statusAfterAdd.staged,
        files: statusAfterAdd.files.length
      });
      
      if (statusAfterAdd.staged.length === 0) {
        console.log('⚠️ [AUTO-COMMIT] No files were staged, checking if file exists...');
        // Check if the file actually exists
        const fs = await import('fs/promises');
        const fullFilePath = path.join(userRepoPath, filePath);
        try {
          await fs.access(fullFilePath);
          console.log('✅ [AUTO-COMMIT] File exists at:', fullFilePath);
        } catch (fileError) {
          console.log('❌ [AUTO-COMMIT] File does not exist at:', fullFilePath);
          return { success: false, reason: `File does not exist: ${fullFilePath}` };
        }
      }
    } catch (addError) {
      console.error('❌ [AUTO-COMMIT] Failed to add file to staging:', addError);
      return { success: false, error: `Failed to stage file: ${addError.message}` };
    }
    
    // Commit the changes
    console.log('🚀 [AUTO-COMMIT] Committing changes...');
    const commitResult = await git.commit(commitMessage);
    console.log('✅ [AUTO-COMMIT] Commit successful:', {
      commit: commitResult.commit,
      summary: commitResult.summary
    });
    
    // Try to push to origin
    console.log('🚀 [AUTO-COMMIT] Pushing to origin...');
    try {
      await git.push('origin', currentBranch);
      console.log('✅ [AUTO-COMMIT] Push successful');
      return {
        success: true,
        branch: currentBranch,
        defaultBranch: defaultBranch,
        commitHash: commitResult.commit,
        commitMessage: commitMessage,
        pushed: true
      };
    } catch (pushError) {
      console.warn('⚠️ [AUTO-COMMIT] Failed to push changes:', pushError.message);
      console.warn('⚠️ [AUTO-COMMIT] Push error details:', pushError);
      return {
        success: true,
        branch: currentBranch,
        defaultBranch: defaultBranch,
        commitHash: commitResult.commit,
        commitMessage: commitMessage,
        pushed: false,
        pushError: pushError.message
      };
    }

  } catch (error) {
    console.error('❌ [AUTO-COMMIT] Auto-commit failed:', error);
    console.error('❌ [AUTO-COMMIT] Error stack:', error.stack);
    return {
      success: false,
      error: error.message
    };
  }
}
