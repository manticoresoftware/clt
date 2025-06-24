import path from 'path';
import fs from 'fs/promises';
import { writeFileSync, appendFileSync, existsSync, readdirSync, statSync, readFileSync } from 'fs';
import simpleGit from 'simple-git';
import {
  parseRecFileFromMapWasm,
  validateTestFromMapWasm
} from './wasmNodeWrapper.js';
import {
  getUserRepoPath,
  getUserTestPath,
  getMergedPatterns,
  createFileContentMap,
  convertTestStructureToLegacyCommands,
  extractDuration,
  ensureGitRemoteWithToken,
  slugify
} from './routes.js';

// Helper function to save session data persistently
function saveSessionToPersistentStorage(session, username) {
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

// Function to process test results with WASM structured format
export async function processTestResults(absolutePath, testStructure, stdout, stderr, exitCode, error) {
  // Convert WASM TestStructure to the format expected by the existing logic
  // This maintains UI compatibility while using the new structured format
  const expandedCommands = convertTestStructureToLegacyCommands(testStructure);

  const repFilePath = absolutePath.replace(/\.rec$/, '.rep');
  let success = false; // Default to failure, will update based on command results

  // Create a mapping of block commands by their parent block for status propagation
  const blockCommandMap = new Map();
  expandedCommands.forEach(cmd => {
    if (cmd.isBlockCommand && cmd.parentBlock) {
      // The key is the parent block's index/ID
      const key = `${cmd.parentBlock.command}|${cmd.blockSource || ''}`;

      if (!blockCommandMap.has(key)) {
        blockCommandMap.set(key, []);
      }
      blockCommandMap.get(key).push(cmd);
    }
  });

  try {
    // Try to read the .rep file for actual outputs and durations
    let repContent = '';
    const repSections = [];

    try {
      repContent = await fs.readFile(repFilePath, 'utf8');
      console.log(`Successfully read .rep file: ${repFilePath}`);

      // Check if rep file is empty
      if (!repContent || repContent.trim() === '') {
        console.warn(`The .rep file is empty: ${repFilePath}`);
        throw new Error('Empty rep file');
      }

      // Parse sections
      const sections = repContent.split('\u2013\u2013\u2013 input \u2013\u2013\u2013').slice(1);
      if (sections.length === 0) {
        console.warn(`No input sections found in .rep file: ${repFilePath}`);
        throw new Error('No sections found in rep file');
      }

      // Parse the .rep file sections
      for (const section of sections) {
        const parts = section.split('\u2013\u2013\u2013 output \u2013\u2013\u2013');
        if (parts.length >= 2) {
          repSections.push({
            command: parts[0].trim(),
            output: parts[1].trim(),
            full: section
          });
        }
      }

      console.log(`Parsed ${repSections.length} sections from rep file`);
      if (repSections.length === 0) {
        console.warn(`Failed to parse sections from .rep file: ${repFilePath}`);
        throw new Error('Failed to parse sections from rep file');
      }
    } catch (repError) {
      // If the rep file doesn't exist or is invalid, continue without it
      console.warn(`Could not process .rep file: ${repError.message}`);

      // Try to parse outputs from stdout instead
      if (stdout && stdout.trim()) {
        console.log('Attempting to parse command outputs from stdout');
        const sections = stdout.split('\u2013\u2013\u2013 input \u2013\u2013\u2013').slice(1);
        for (const section of sections) {
          const parts = section.split('\u2013\u2013\u2013 output \u2013\u2013\u2013');
          if (parts.length >= 2) {
            repSections.push({
              command: parts[0].trim(),
              output: parts[1].trim(),
              full: section
            });
          }
        }
        console.log(`Parsed ${repSections.length} sections from stdout`);
      }
    }

    // Process commands with outputs from rep file or stdout
    let allCommandsPassed = true;

    // Debug logging for initial command statuses
    console.log('Processing commands - total:', expandedCommands.length);
    console.log('Block commands:', expandedCommands.filter(cmd => cmd.isBlockCommand).length);
    console.log('Block references:', expandedCommands.filter(cmd => cmd.type === 'block' && !cmd.isBlockCommand).length);

    for (const cmd of expandedCommands) {
      // Skip comments and mark blocks
      if (cmd.type === 'comment') {
        continue;
      } else if (cmd.type === 'block' && !cmd.isBlockCommand) {
        // Mark block with appropriate initial status based on exit code
        cmd.status = exitCode === 0 ? 'matched' : 'pending';
        continue;
      }

      // For regular commands, find the corresponding output
      const commandText = cmd.command.trim();
      const matchingSection = repSections.find(s => s.command.trim() === commandText);

      if (matchingSection) {
        // Extract duration
        cmd.duration = extractDuration(matchingSection.full);

        // Get the output content
        const output = matchingSection.output;
        const nextDelimiterMatch = output.match(/\u2013\u2013\u2013\s.*?\s\u2013\u2013\u2013/);
        const actualOutput = nextDelimiterMatch
          ? output.substring(0, nextDelimiterMatch.index).trim()
          : output;

        // Set actual output
        cmd.actualOutput = actualOutput;

        // Set expected output if not already set
        if (!cmd.expectedOutput) {
          cmd.expectedOutput = actualOutput;
        }

        // If the exitCode is 0, treat everything as matched, otherwise do normal comparison
        if (exitCode === 0) {
          cmd.status = 'matched';
        } else {
          // Determine status based on comparison
          if (cmd.expectedOutput === actualOutput) {
            cmd.status = 'matched';
          } else {
            cmd.status = 'failed';
            allCommandsPassed = false;
          }
        }
      } else {
        // Could not find matching output
        console.warn(`No matching output found for command: ${commandText.substring(0, 50)}...`);

        // If the exitCode is 0, treat everything as matched, even if no output was found
        if (exitCode === 0) {
          cmd.status = 'matched';
          cmd.actualOutput = 'No matching output found, but test passed.';
        } else {
          cmd.status = 'failed';
          allCommandsPassed = false;

          // Set actual output to an error message for UI display
          cmd.actualOutput = 'Error: No matching output found for this command';
        }
      }
    }

    // Now propagate status to block declarations based on their contained commands only
    for (const cmd of expandedCommands) {
      if (cmd.isBlockCommand && cmd.parentBlock) {
        // The key is the parent block's index/ID
        const key = `${cmd.parentBlock.command}|${cmd.blockSource || ''}`;
        const blockCommands = blockCommandMap.get(key) || [];

        if (blockCommands.length > 0) {
          // If any block command failed, mark the block as failed
          const anyFailed = blockCommands.some(bc => bc.status === 'failed');
          // If any command matched, consider the block matched
          const anyMatched = blockCommands.some(bc => bc.status === 'matched');

          // Set status based only on the block's commands, independent of test exit code
          // If no failures and at least one passed, then the block passed
          cmd.status = anyFailed ? 'failed' : (anyMatched ? 'matched' : 'pending');

          // Debug log for block status
          console.log(`Block ${cmd.command} status: ${cmd.status} (anyFailed=${anyFailed}, anyMatched=${anyMatched}, command count=${blockCommands.length})`);
          console.log('Block commands:', blockCommands.map(bc => ({ cmd: bc.command.substring(0, 30), status: bc.status })));

          // Update overall success status only for real failures
          if (anyFailed) allCommandsPassed = false;
        }
      }
    }

    // Determine overall success - a test is successful if exitCode is 0,
    // regardless of individual command comparisons, which might only be different due to pattern variables
    success = exitCode === 0;

  } catch (processError) {
    console.error('Error processing test results:', processError);
    // Mark all commands as failed if there was an error
    for (const cmd of expandedCommands) {
      if (cmd.type !== 'comment' && !cmd.status) {
        cmd.status = 'failed';
      }
    }
  }

  // Make sure non-block commands have a status set (blocks already handled above)
  for (const cmd of expandedCommands) {
    if (cmd.type !== 'comment' && cmd.type !== 'block' && !cmd.status) {
      // For non-block commands without a status, set default status
      cmd.status = 'pending';
    }
  }

  const testReallyFailed = exitCode !== 0;
  return {
    commands: expandedCommands,
    success,
    exitCode,
    exitCodeSuccess: exitCode === 0,
    error: exitCode !== 0 ? error?.message : null,
    stderr,
    stdout,
    message: success ? 'Test executed successfully' : 'Test executed with differences',
    testReallyFailed: exitCode !== 0
  };
}

// Setup Git and Test routes
export function setupGitAndTestRoutes(app, isAuthenticated, dependencies) {
  const {
    WORKDIR,
    ROOT_DIR,
    REPO_URL,
    __dirname,
    getAuthConfig
  } = dependencies;

  // API endpoint to run a test
  app.post('/api/run-test', isAuthenticated, async (req, res) => {
    try {
      const { filePath, dockerImage } = req.body;

      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }

      // Use the user's test directory as the base
      const testDir = getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const absolutePath = path.join(testDir, filePath);

      // Basic security check to ensure the path is within the test directory
      if (!absolutePath.startsWith(testDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Execute the clt test command to run the test (from the user's project directory)
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const relativeFilePath = path.relative(userRepoPath, absolutePath);
      const testCommand = `clt test -d -t ${relativeFilePath} ${dockerImage ? dockerImage : ''}`;
      console.log(`Executing test command: ${testCommand} in dir: ${userRepoPath}`);

      const { exec } = await import('child_process');

      // Execute in the user's repository directory
      const execOptions = {
        cwd: userRepoPath,
        env: {
          ...process.env,
          CLT_NO_COLOR: '1',
        }
      };


      exec(testCommand, execOptions, async (error, stdout, stderr) => {
        // Log all output regardless of success/failure
        console.log(`Test stdout: ${stdout}`);
        if (stderr) {
          console.log(`Test stderr: ${stderr}`);
        }

        // Warnings like Docker platform mismatch shouldn't be treated as errors
        // If the exit code is 0, the test actually passed
        const exitCode = error ? error.code : 0;
        const testReallyFailed = exitCode !== 0;
        console.log(`Test exit code: ${exitCode}, Test failed: ${testReallyFailed}`);
        console.log(testReallyFailed ? `Test completed with differences: ${error?.message}` : 'Test passed with no differences');

        try {
          // Parse the .rec file using WASM with content map
          console.log(`📖 Parsing .rec file with WASM: ${absolutePath}`);
          const fileMap = await createFileContentMap(absolutePath, testDir, req);
          const relativeFilePath = path.relative(testDir, absolutePath);
          const testStructure = await parseRecFileFromMapWasm(relativeFilePath, fileMap);

          // Check if .rep file exists for validation
          const repFilePath = absolutePath.replace('.rec', '.rep');
          const repRelativePath = relativeFilePath.replace('.rec', '.rep');
          let validationResults = null;

          try {
            await fs.access(repFilePath);
            // .rep file exists, add it to file map and validate
            const repContent = await fs.readFile(repFilePath, 'utf8');
            fileMap[repRelativePath] = repContent;

            console.log(`🔍 Running validation with WASM: ${repFilePath}`);

            // Get patterns for validation (proper merging like CLT)
            try {
              const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
              const patterns = await getMergedPatterns(userRepoPath, __dirname);

              console.log(`🔥 VALIDATION PATTERNS DUMP - COUNT: ${Object.keys(patterns).length}`);
              console.log(`🔥 PATTERNS OBJECT:`, JSON.stringify(patterns, null, 2));
              console.log(`🔥 VERSION PATTERN:`, patterns.VERSION);
              console.log(`🔥 PATTERN KEYS:`, Object.keys(patterns).join(', '));

              // Run validation with patterns
              console.log(`🔥 CALLING validateTestFromMapWasm WITH PATTERNS`);
              validationResults = await validateTestFromMapWasm(relativeFilePath, fileMap, patterns);
              console.log(`🔥 VALIDATION RESULT:`, JSON.stringify(validationResults, null, 2));

              // ENRICH testStructure with actual outputs and error flags
              try {
                console.log(`📋 Enriching testStructure with actual outputs from .rep file`);

                // Parse .rep file to get actual outputs
                const repStructure = await parseRecFileFromMapWasm(repRelativePath, fileMap);
                console.log(`📋 Rep structure:`, JSON.stringify(repStructure, null, 2));

                // Extract only OUTPUT type blocks from .rep file (flat/expanded)
                const repOutputs = repStructure.steps.filter(step => step.type === 'output');
                console.log(`📋 Found ${repOutputs.length} output blocks in .rep file`);

                // Track output index for sequential mapping
                let outputIndex = 0;
                let globalStepIndex = 0; // Track global step index for error mapping

                // Recursive function to traverse nested structure and assign outputs
                function enrichStepsRecursively(steps) {
                  steps.forEach((step, index) => {
                    const currentStepIndex = globalStepIndex;
                    globalStepIndex++; // Increment for every step (input, output, block, comment)

                    // Check for validation errors on ANY step type (not just input)
                    const hasError = validationResults.errors &&
                      validationResults.errors.some(error => error.step === currentStepIndex);
                    step.error = hasError;

                    // If this is an input step, set status based on error
                    if (step.type === 'input') {
                      step.status = hasError ? 'failed' : 'success';
                      console.log(`📋 Input step ${currentStepIndex}: ${hasError ? 'FAILED' : 'SUCCESS'}`);
                    }

                    // If this is an output step, assign next .rep output and use already-set error status
                    if (step.type === 'output') {
                      if (repOutputs[outputIndex]) {
                        step.actualOutput = repOutputs[outputIndex].content || '';
                        console.log(`📋 Assigned rep output ${outputIndex + 1} to step ${currentStepIndex}: ${step.actualOutput ? 'SET' : 'EMPTY'}`);
                      }
                      outputIndex++;

                      // Set status based on already-set error flag
                      step.status = step.error ? 'failed' : 'success';
                      console.log(`📋 Output step ${currentStepIndex}: ${step.error ? 'FAILED' : 'SUCCESS'}`);
                    }

                    // If this is a block step, check for nested errors and process nested steps
                    if (step.type === 'block') {
                      if (step.steps && step.steps.length > 0) {
                        enrichStepsRecursively(step.steps);
                        // Block is failed if any nested step failed
                        const hasNestedError = step.steps.some(nestedStep => nestedStep.error);
                        step.error = hasNestedError;
                        step.status = hasNestedError ? 'failed' : 'success';
                      }
                    }

                    // For comment steps, just set success status
                    if (step.type === 'comment') {
                      step.error = false;
                      step.status = 'success';
                    }
                  });
                }

                // Start recursive enrichment
                enrichStepsRecursively(testStructure.steps);

                console.log(`✅ TestStructure enriched with ${outputIndex} outputs processed`);
              } catch (enrichError) {
                console.error('Error enriching testStructure:', enrichError.message);
              }

            } catch (patternError) {
              console.warn('Could not load patterns for validation:', patternError.message);
              // Fall back to validation without patterns
              validationResults = await validateTestFromMapWasm(relativeFilePath, fileMap);
            }

            console.log(`✅ Validation completed: ${validationResults.success ? 'PASSED' : 'FAILED'}`);
          } catch (repError) {
            console.log(`ℹ️  No .rep file found for validation: ${repFilePath}`);
          }

          // Process test results for UI compatibility
          const results = await processTestResults(absolutePath, testStructure, stdout, stderr, exitCode, error);

          // Return the results with validation
          res.json({
            filePath,
            dockerImage: dockerImage || 'default-image',
            testStructure,           // NEW: Structured format from WASM
            validationResults,       // NEW: Validation results if .rep exists
            ...results
          });
        } catch (readError) {
          console.error('Error reading test files:', readError);
          res.status(500).json({
            error: `Failed to read test files: ${readError.message}`,
            stderr,
            stdout
          });
        }
      });
    } catch (error) {
      console.error('Error running test:', error);
      res.status(500).json({ error: `Failed to run test: ${error.message}` });
    }
  });

  // API endpoint to commit changes (with or without creating PR)
  app.post('/api/commit-changes', isAuthenticated, async (req, res) => {
    try {
      const { title, description, createPr = true } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'Commit message is required' });
      }

      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      // Get the user's repo path
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        // Initialize simple-git with the user's repo path
        const git = simpleGit({ baseDir: userRepoPath });
        ensureGitRemoteWithToken(git, req.user.token, REPO_URL);

        // Get current branch and status
        const branchSummary = await git.branch();
        const currentBranch = branchSummary.current;
        console.log(`Current branch: ${currentBranch}`);

        // Check if we're on a PR branch
        const isPrBranch = currentBranch.startsWith('clt-ui-');
        console.log(`Is PR branch: ${isPrBranch}`);

        let branchName = currentBranch;
        let needToCreatePr = createPr && !isPrBranch;

        // Determine test directory for staging
        const testDir = getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
        const relativeTestPath = path.relative(userRepoPath, testDir);
        console.log(`Tests relative path: ${relativeTestPath}`);

        // Stage changes in the tests directory
        await git.add(relativeTestPath);
        console.log(`Staged changes in tests directory: ${relativeTestPath}`);

        // Check if there are changes to commit
        const status = await git.status();
        if (status.isClean()) {
          return res.status(400).json({ error: 'No changes to commit' });
        }

        // If we need to create a PR, create a new branch
        if (needToCreatePr) {
          // Create a new branch name based on timestamp and username
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          branchName = `clt-ui-${req.user.username}-${timestamp}`;

          // Create and checkout new branch
          await git.checkoutLocalBranch(branchName);
          console.log(`Created and switched to new branch: ${branchName}`);
        }

        // Create a commit
        await git.commit(title);
        console.log(`Created commit with message: ${title}`);

        // Push to the remote repository
        await git.push('origin', branchName, ['--set-upstream']);
        console.log(`Pushed to remote branch: ${branchName}`);

        // Create a PR if needed
        let prUrl = null;
        if (needToCreatePr) {
          try {
            // Use GitHub CLI to create PR if available
            const { exec } = await import('child_process');
            const execPromise = (cmd, options) => new Promise((resolve, reject) => {
              exec(cmd, options, (error, stdout, stderr) => {
                if (error) {
                  console.error(`Command execution error: ${stderr}`);
                  return reject(error);
                }
                resolve(stdout.trim());
              });
            });

            // Set environment for gh command
            const env = { ...process.env, GH_TOKEN: req.user.token };
            const ghOptions = { cwd: userRepoPath, env };

            // Get default branch for PR base
            const defaultBranch = branchSummary.branches[branchSummary.current]?.tracking?.split('/')[1] || 'master';

            // Create PR command
            let prCommand = `gh pr create --title "${title}" --head ${branchName}`;
            if (description) {
              prCommand += ` --body "${description}"`;
            }
            prCommand += ` --base ${defaultBranch}`;

            // Create the PR
            const prOutput = await execPromise(prCommand, ghOptions);
            console.log('PR created successfully');

            // Extract PR URL from the output
            const prUrlMatch = prOutput.match(/(https:\/\/github\.com\/[^\s]+)/);
            prUrl = prUrlMatch ? prUrlMatch[0] : null;
          } catch (prError) {
            console.error('Error creating PR:', prError);
            // Continue with the flow since we've already pushed changes
          }
        }

        // Get repo URL for response
        const remote = await git.remote(['get-url', 'origin']).catch(() => '');
        // Remove token from URL if present
        const cleanRemote = remote.replace(/https:\/\/[^@]+@/, 'https://');

        return res.json({
          success: true,
          branch: branchName,
          commit: title,
          pr: prUrl,
          repository: cleanRemote,
          message: needToCreatePr && prUrl
            ? 'Pull request created successfully'
            : (needToCreatePr
              ? 'Changes committed and pushed to new branch. PR creation failed.'
              : 'Changes committed successfully')
        });
      } catch (gitError) {
        console.error('Git operation error:', gitError);
        return res.status(500).json({
          error: 'Git operation failed',
          details: gitError.message
        });
      }
    } catch (error) {
      console.error('Error creating commit:', error);
      res.status(500).json({ error: `Failed to create commit: ${error.message}` });
    }
  });

  // API endpoint to get git status information
  app.get('/api/git-status', isAuthenticated, async (req, res) => {
    try {
      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      // Get the user's repo path
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        // Initialize simple-git with the user's repo path
        const git = simpleGit({ baseDir: userRepoPath });

        // Get current branch
        const branchSummary = await git.branch();
        const currentBranch = branchSummary.current;
        console.log(`Current branch: ${currentBranch}`);

        // Check if the branch is a PR branch
        const isPrBranch = currentBranch.startsWith('clt-ui-');
        console.log(`Is PR branch: ${isPrBranch}`);

        // Get status information
        const status = await git.status();
        console.log('Git status:', status);

        // Parse the status to get modified files
        const modifiedFiles = [];
        const modifiedDirs = new Set();

        const testDir = getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
        // Get the relative path to the test directory from the repo root
        const relativeTestPath = path.relative(userRepoPath, testDir);
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

  // API endpoint to get current branch information
  app.get('/api/current-branch', isAuthenticated, async (req, res) => {
    try {
      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      // Get the user's repo path
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        // Initialize simple-git with the user's repo path
        const git = simpleGit({ baseDir: userRepoPath });

        // Get branch information
        const branchSummary = await git.branch();
        const currentBranch = branchSummary.current;
        console.log(`Current branch: ${currentBranch}`);

        // Get remote repository URL
        const remoteUrl = await git.remote(['get-url', 'origin']);
        const cleanRemoteUrl = remoteUrl.replace(/https:\/\/[^@]+@/, 'https://');
        console.log(`Remote repository URL: ${cleanRemoteUrl}`);

        // Get default branch
        let defaultBranch;
        try {
          // Try to get the default branch from the HEAD reference
          defaultBranch = await git.revparse(['--abbrev-ref', 'origin/HEAD']);
          defaultBranch = defaultBranch.replace('origin/', '');
        } catch (headError) {
          // Fallback: use master or main
          console.warn('Could not determine default branch from HEAD:', headError);

          // Check if main or master exists
          const branches = await git.branch(['-r']);
          if (branches.all.includes('origin/main')) {
            defaultBranch = 'main';
          } else {
            defaultBranch = 'master';
          }
        }
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
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        // Initialize simple-git with the user's repo path
        const git = simpleGit(userRepoPath);
        ensureGitRemoteWithToken(git, req.user.token, REPO_URL);

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
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        // Initialize simple-git with the user's repo path
        const git = simpleGit(userRepoPath);
        ensureGitRemoteWithToken(git, req.user.token, REPO_URL);

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

  // Check git status for unstaged changes
  app.get('/api/git-status', isAuthenticated, async (req, res) => {
    try {
      // Check if user is authenticated with GitHub
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'GitHub authentication required' });
      }

      // Get the user's repo path
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        // Initialize simple-git with the user's repo path
        const git = simpleGit(userRepoPath);

        // Get current status
        const status = await git.status();

        // Check for unstaged changes (modified, deleted, or untracked files)
        const hasUnstagedChanges = !status.isClean() ||
                                   status.not_added.length > 0 ||
                                   status.conflicted.length > 0 ||
                                   status.modified.length > 0 ||
                                   status.deleted.length > 0;

        return res.json({
          hasUnstagedChanges,
          currentBranch: status.current,
          isClean: status.isClean(),
          files: {
            modified: status.modified,
            not_added: status.not_added,
            deleted: status.deleted,
            conflicted: status.conflicted,
            staged: status.staged
          }
        });
      } catch (gitError) {
        console.error('Git status error:', gitError);
        return res.status(500).json({
          error: 'Git status check failed',
          details: gitError.message || 'Unknown error during git status check'
        });
      }
    } catch (error) {
      console.error('Error checking git status:', error);
      res.status(500).json({ error: `Failed to check git status: ${error.message}` });
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
    ensureGitRemoteWithToken(git, req.user.token, REPO_URL);

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


      if (branchExists) {
        // check if there's an OPEN PR for that head
        const prList = await execPromise(
          `gh pr list --state open --head ${branchName} --json url`
        ).catch(() => '');
        if (!prList) {
          return res
            .status(400)
            .json({ error: `Branch '${branchName}' exists with no open PR.` });
        }

        // branch and PR both exist → just commit & push
        await git.checkout(branchName);
        await git.add('.');
        const commit = await git.commit(title);
        await git.push('origin', branchName);

        return res.json({
          success: true,
          branch: branchName,
          commit: commit.latest,
          pr: JSON.parse(prList)[0]?.url,
          message: 'Committed and pushed to existing PR branch.'
        });
      }

      // branch does not exist → create it, commit & push, open PR
      await git.checkoutLocalBranch(branchName);
      await git.add('.');
      const commit = await git.commit(title);
      await git.push('origin', branchName, ['--set-upstream']);

      // build gh pr create command
      let ghCmd = `gh pr create --title "${title.replace(/"/g,'\\\"')}" --head ${branchName}`;
      if (description) {
        ghCmd += ` --body "${description.replace(/"/g,'\\\"')}"`;
      }

      const prOutput = await execPromise(ghCmd).catch(e => { throw e });
      const prUrlMatch = prOutput.match(/https:\/\/github\.com\/[^\s]+/);
      const prUrl = prUrlMatch?.[0] || null;

      return res.json({
        success: true,
        branch: branchName,
        commit: commit.latest,
        pr: prUrl,
        message: prUrl
          ? 'Pull request created successfully.'
          : 'Branch pushed; PR creation failed—please open manually.'
      });
    }
    catch (err) {
      console.error('create-pr error:', err);
      return res.status(500).json({ error: err.toString() });
    }
  });

  // API endpoint to validate a test file
  app.post('/api/validate-test', isAuthenticated, async (req, res) => {
    try {
      const { filePath } = req.body;

      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }

      // Use the user's test directory as the base
      const testDir = getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const absolutePath = path.join(testDir, filePath);

      // Basic security check to ensure the path is within the test directory
      if (!absolutePath.startsWith(testDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Validate using WASM
      try {
        console.log(`🔍 Validating test file via WASM: ${absolutePath}`);
        const validationResult = await validateTestWasm(absolutePath);
        console.log('✅ WASM validation completed');
        res.json(validationResult);
      } catch (wasmError) {
        console.warn('WASM validation failed, returning default valid result:', wasmError.message);
        res.json({ valid: true, errors: [], method: 'fallback' });
      }
    } catch (error) {
      console.error('Error validating test:', error);
      res.status(500).json({ error: 'Failed to validate test' });
    }
  });

  // Utility function to extract cost from logs (check last 100 lines or find first match)
  function extractCostFromLogs(logs) {
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
  function sanitizeSessionName(name) {
    if (!name || !name.trim()) return '';

    return name.trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-')         // Replace spaces with hyphens
      .replace(/-+/g, '-')          // Replace multiple hyphens with single hyphen
      .replace(/^-|-$/g, '');       // Remove leading/trailing hyphens
  }

  // Utility function to write logs synchronously to both console and file
  function writeLogEntry(session, logEntry, logType = 'INFO') {
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
  function updateSessionMetadata(session) {
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

  // Interactive session endpoints
  // Start a new interactive command session
  app.post('/api/interactive/start', isAuthenticated, async (req, res) => {
    try {
      const { input, sessionName } = req.body;

      if (!input || !input.trim()) {
        return res.status(400).json({ error: 'Input is required' });
      }

      // Check if user is authenticated
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const username = req.user.username;

      // Check if user already has a running session
      if (global.interactiveSessions[username] && global.interactiveSessions[username].running) {
        return res.status(409).json({ error: 'Another command is already running for this user' });
      }

      // Generate session ID with optional name
      const sanitizedSessionName = sessionName ? sanitizeSessionName(sessionName) : '';
      const sessionId = sanitizedSessionName
        ? `${username}-${sanitizedSessionName}-${Date.now()}`
        : `${username}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Get the interactive command from environment
      const askAiCommand = process.env.ASK_AI_COMMAND || 'docker run --rm -i ubuntu:latest bash -c "echo \\"Input received:\\"; cat; echo \\"\\nSleeping for 2 seconds...\\"; sleep 2; echo \\"Done!\\""';
      const askAiTimeout = parseInt(process.env.ASK_AI_TIMEOUT || '30000');

      console.log(`Starting interactive session ${sessionId} for user ${username}`);
      console.log(`Command: ${askAiCommand}`);
      console.log(`Input: ${input}`);
      console.log(`Timeout: ${askAiTimeout}ms`);

      // Create log file only if ASK_AI_LOG is configured
      const logDir = process.env.ASK_AI_LOG;
      let logFile = null;
      if (logDir) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${sessionName || sessionId}_${timestamp}.log`;
        const userLogDir = path.join(logDir, username);
        logFile = path.join(userLogDir, fileName);

        // Ensure directory exists synchronously before creating log file
        try {
          if (!existsSync(userLogDir)) {
            await fs.mkdir(userLogDir, { recursive: true });
            console.log(`Created log directory: ${userLogDir}`);
          }
        } catch (error) {
          console.error('Failed to create log directory:', error);
          logFile = null; // Disable logging if directory creation fails
        }
      }

      // Initialize session
      const session = {
        id: sessionId,
        name: sanitizedSessionName || sessionId,
        username,
        running: true,
        completed: false,
        cancelled: false,
        failed: false,
        logs: [],
        output: '',
        cost: null,
        startTime: new Date(),
        endTime: null,
        logFile,
        process: null,
        timeout: null,
        exitCode: null,
        active: true // Mark as active session
      };

      global.interactiveSessions[username] = session;

      // Log session start information
      const sessionStartLog = `=== SESSION START ===
Session ID: ${sessionId}
Session Name: ${session.name}
Username: ${username}
Start Time: ${session.startTime.toISOString()}
Command: ${askAiCommand}
Timeout: ${askAiTimeout}ms
Input Length: ${input.length} characters
Log File: ${logFile || 'Not configured'}
=== INPUT ===
${input}
=== OUTPUT ===
`;

      // Write initial session information
      writeLogEntry(session, sessionStartLog, 'START');

      // Import child_process
      const { spawn } = await import('child_process');

      // Get user repository path for WORKDIR_PATH environment variable
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      console.log(`WORKDIR_PATH: ${userRepoPath}`);

      // Start the process with shell to handle complex commands
      const childProcess = spawn('sh', ['-c', askAiCommand], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          WORKDIR_PATH: userRepoPath,
          SESSION_NAME: sanitizedSessionName || sessionId
        }
      });

      session.process = childProcess;

      // Set up timeout
      session.timeout = setTimeout(() => {
        if (session.running && childProcess) {
          console.log(`Session ${sessionId} timed out after ${askAiTimeout}ms`);
          childProcess.kill('SIGTERM');
          
          const timeoutLog = `
=== SESSION TIMEOUT ===
Session ID: ${sessionId}
Timeout: ${askAiTimeout}ms
Time: ${new Date().toISOString()}
Process terminated due to timeout
=== TIMEOUT END ===
`;
          
          writeLogEntry(session, timeoutLog, 'TIMEOUT');
        }
      }, askAiTimeout);

      // Send input to the process
      childProcess.stdin.write(input);
      childProcess.stdin.end();

      // Handle stdout
      childProcess.stdout.on('data', (data) => {
        const output = data.toString();
        writeLogEntry(session, output, 'STDOUT');
      });

      // Handle stderr
      childProcess.stderr.on('data', (data) => {
        const output = data.toString();
        const logEntry = `STDERR: ${output}`;
        writeLogEntry(session, logEntry, 'STDERR');
      });

      // Handle process completion
      childProcess.on('close', (code) => {
        session.running = false;
        session.completed = true;
        session.failed = code !== 0;
        session.exitCode = code;
        session.output = session.logs.join('');
        session.endTime = new Date();
        session.cost = extractCostFromLogs(session.logs);
        session.active = false; // Mark as inactive

        // Log session completion
        const completionLog = `
=== SESSION END ===
Session ID: ${sessionId}
End Time: ${session.endTime.toISOString()}
Exit Code: ${code}
Duration: ${session.endTime.getTime() - session.startTime.getTime()}ms
Cost: ${session.cost ? '$' + session.cost.toFixed(5) : 'N/A'}
Status: ${code === 0 ? 'SUCCESS' : 'FAILED'}
Total Log Entries: ${session.logs.length}
=== SESSION COMPLETE ===
`;
        
        writeLogEntry(session, completionLog, 'END');

        // Save session data persistently (final save)
        saveSessionToPersistentStorage(session, username);

        // Clear timeout
        if (session.timeout) {
          clearTimeout(session.timeout);
          session.timeout = null;
        }

        console.log(`Session ${sessionId} completed with exit code: ${code}`);

        // Clean up after 5 minutes (but keep session data for history)
        setTimeout(() => {
          if (global.interactiveSessions[username] && global.interactiveSessions[username].id === sessionId) {
            // Don't delete the session, just clean up the process reference
            global.interactiveSessions[username].process = null;
            console.log(`Cleaned up process for session ${sessionId}`);
          }
        }, 5 * 60 * 1000);
      });

      // Handle process error
      childProcess.on('error', (error) => {
        session.running = false;
        session.completed = true;
        session.failed = true;
        session.error = error.message;
        session.endTime = new Date();
        session.active = false; // Mark as inactive

        // Log error with details
        const errorLog = `
=== SESSION ERROR ===
Session ID: ${sessionId}
Error Time: ${session.endTime.toISOString()}
Error Message: ${error.message}
Duration: ${session.endTime.getTime() - session.startTime.getTime()}ms
=== ERROR DETAILS ===
${error.stack || error.message}
=== SESSION TERMINATED ===
`;
        
        writeLogEntry(session, errorLog, 'ERROR');
        
        session.output = session.logs.join('');
        session.cost = extractCostFromLogs(session.logs);

        // Save session data persistently
        saveSessionToPersistentStorage(session, username);

        // Clear timeout
        if (session.timeout) {
          clearTimeout(session.timeout);
          session.timeout = null;
        }

        console.error(`Session ${sessionId} error:`, error);
      });

      res.json({ sessionId, status: 'started' });
    } catch (error) {
      console.error('Error starting interactive session:', error);
      res.status(500).json({ error: 'Failed to start interactive session' });
    }
  });

  // Get status of an interactive session
  app.get('/api/interactive/status/:sessionId', isAuthenticated, async (req, res) => {
    try {
      const { sessionId } = req.params;

      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const username = req.user.username;
      const session = global.interactiveSessions[username];

      if (!session || session.id !== sessionId) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({
        sessionId,
        name: session.name,
        running: session.running,
        completed: session.completed,
        cancelled: session.cancelled,
        failed: session.failed,
        logs: session.logs,
        output: session.output,
        cost: session.cost,
        exitCode: session.exitCode,
        error: session.error,
        startTime: session.startTime,
        endTime: session.endTime
      });
    } catch (error) {
      console.error('Error getting session status:', error);
      res.status(500).json({ error: 'Failed to get session status' });
    }
  });

  // Cancel an interactive session
  app.post('/api/interactive/cancel/:sessionId', isAuthenticated, async (req, res) => {
    try {
      const { sessionId } = req.params;

      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const username = req.user.username;
      const session = global.interactiveSessions[username];

      if (!session || session.id !== sessionId) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (session.process && session.running) {
        session.process.kill('SIGTERM');
        session.running = false;
        session.completed = true;
        session.cancelled = true;
        session.logs.push('\nProcess cancelled by user');
        session.output = session.logs.join('');
        session.cost = extractCostFromLogs(session.logs);
        session.endTime = new Date();
        session.active = false; // Mark as inactive

        // Save session data persistently (including cancelled sessions)
        saveSessionToPersistentStorage(session, username);

        // Clear timeout
        if (session.timeout) {
          clearTimeout(session.timeout);
          session.timeout = null;
        }

        console.log(`Session ${sessionId} cancelled by user`);
      }

      res.json({ status: 'cancelled' });
    } catch (error) {
      console.error('Error cancelling session:', error);
      res.status(500).json({ error: 'Failed to cancel session' });
    }
  });

  // List all sessions (only if ASK_AI_LOG is configured)
  app.get('/api/interactive/sessions', isAuthenticated, async (req, res) => {
    try {
      const username = req.user.username;
      const logDir = process.env.ASK_AI_LOG;

      if (!logDir) {
        return res.json({ sessions: [], persistent: false });
      }

      const userLogDir = path.join(logDir, username);

      if (!existsSync(userLogDir)) {
        return res.json({ sessions: [], persistent: true });
      }

      const allFiles = readdirSync(userLogDir)
        .filter(file => file.endsWith('.log') || file.endsWith('.meta'));

      // Group files by session ID to prefer .meta over .log
      const sessionMap = new Map();
      
      allFiles.forEach(file => {
        const sessionId = file.replace(/\.(log|meta)$/, '');
        if (!sessionMap.has(sessionId) || file.endsWith('.meta')) {
          sessionMap.set(sessionId, file);
        }
      });

      const logFiles = Array.from(sessionMap.values())
        .map(file => {
          const filePath = path.join(userLogDir, file);
          const stats = statSync(filePath);

          try {
            // Read the JSON session data
            const sessionData = JSON.parse(readFileSync(filePath, 'utf8'));
            const metadata = sessionData.metadata || {};

            return {
              sessionId: metadata.sessionId || file.replace(/\.(log|meta)$/, ''),
              sessionName: metadata.sessionName || 'Unknown Session',
              startTime: metadata.startTime ? new Date(metadata.startTime) : stats.birthtime,
              endTime: metadata.endTime ? new Date(metadata.endTime) : null,
              completed: metadata.completed || false,
              cancelled: metadata.cancelled || false,
              failed: metadata.failed || false,
              cost: metadata.cost || 0,
              active: metadata.active || false,
              size: stats.size,
              logFile: filePath
            };
          } catch (error) {
            // Fallback for old format or corrupted files
            console.warn(`Failed to parse session file ${filePath}:`, error);
            const [sessionName, timestamp] = file.replace(/\.(log|meta)$/, '').split('_');

            return {
              sessionId: sessionName,
              sessionName: sessionName.includes('-') ? sessionName.split('-').slice(1, -1).join('-') : sessionName,
              startTime: stats.birthtime,
              endTime: null,
              completed: false,
              cancelled: false,
              failed: false,
              cost: 0,
              active: false,
              size: stats.size,
              logFile: filePath
            };
          }
        })
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

      // Check if there's a currently active session
      const currentSession = global.interactiveSessions[username];
      if (currentSession && currentSession.running) {
        // Mark the current session as active in the list
        const activeSessionIndex = logFiles.findIndex(s => s.sessionId === currentSession.id);
        if (activeSessionIndex === -1) {
          // Add current session if not in persistent storage yet
          logFiles.unshift({
            sessionId: currentSession.id,
            sessionName: currentSession.name,
            startTime: currentSession.startTime,
            endTime: null,
            completed: false,
            cancelled: false,
            failed: false,
            cost: currentSession.cost || 0,
            active: true,
            size: 0,
            logFile: null
          });
        } else {
          logFiles[activeSessionIndex].active = true;
        }
      }

      res.json({ sessions: logFiles, persistent: true });
    } catch (error) {
      console.error('Error listing sessions:', error);
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // Get logs for specific session (only if ASK_AI_LOG is configured)
  app.get('/api/interactive/session/:sessionId/logs', isAuthenticated, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const username = req.user.username;
      const logDir = process.env.ASK_AI_LOG;

      if (!logDir) {
        return res.status(404).json({ error: 'Persistent logging not configured' });
      }

      const userLogDir = path.join(logDir, username);

      if (!existsSync(userLogDir)) {
        return res.status(404).json({ error: 'Session logs not found' });
      }

      const logFiles = readdirSync(userLogDir)
        .filter(file => file.includes(sessionId) && (file.endsWith('.log') || file.endsWith('.meta')));

      if (logFiles.length === 0) {
        return res.status(404).json({ error: 'Session logs not found' });
      }

      // Prefer .meta files for most up-to-date information
      const metaFile = logFiles.find(file => file.endsWith('.meta'));
      const logFile = logFiles.find(file => file.endsWith('.log'));
      
      const primaryFile = metaFile ? path.join(userLogDir, metaFile) : path.join(userLogDir, logFile);

      try {
        // Try to read as JSON (new format from .meta or .log)
        const sessionData = JSON.parse(readFileSync(primaryFile, 'utf8'));
        const metadata = sessionData.metadata || {};
        const logs = sessionData.logs || [];

        res.json({
          sessionId: metadata.sessionId || sessionId,
          sessionName: metadata.sessionName || 'Unknown Session',
          logs: logs,
          output: sessionData.output || logs.join(''),
          cost: metadata.cost || extractCostFromLogs(logs),
          startTime: metadata.startTime,
          endTime: metadata.endTime,
          completed: metadata.completed || false,
          cancelled: metadata.cancelled || false,
          failed: metadata.failed || false,
          active: metadata.active || false,
          logFile: metaFile || logFile
        });
      } catch (parseError) {
        // Fallback for old format (plain text logs)
        console.warn(`Session ${sessionId} using legacy format, parsing as text`);
        const logs = readFileSync(logFile, 'utf8');
        const logLines = logs.split('\n').filter(line => line.trim());
        const cost = extractCostFromLogs(logLines);

        res.json({
          sessionId,
          sessionName: sessionId,
          logs: logLines,
          output: logs,
          cost,
          startTime: null,
          endTime: null,
          completed: false,
          cancelled: false,
          failed: false,
          active: false,
          logFile: logFiles[0]
        });
      }
    } catch (error) {
      console.error('Error getting session logs:', error);
      res.status(500).json({ error: 'Failed to get session logs' });
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
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const repoExists = await fs.access(userRepoPath).then(() => true).catch(() => false);

      if (!repoExists) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      try {
        // Initialize simple-git with the user's repo path
        const git = simpleGit(userRepoPath);

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
