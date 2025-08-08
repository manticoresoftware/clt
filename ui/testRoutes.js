import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import {
  parseRecFileFromMapWasm,
  validateTestFromMapWasm
} from './wasmNodeWrapper.js';
import {
  getUserRepoPath,
  getUserTestPath,
  getMergedPatterns,
  createFileContentMap
} from './routes.js';
import { processTestResults } from './testProcessor.js';

// Process tracking for concurrent test execution
const runningTests = new Map(); // jobId -> { process, userPath, startTime, filePath, dockerImage, username, absolutePath, testDir }
const userConcurrency = new Map(); // username -> count

// Helper to generate unique job ID
function generateJobId() {
  return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper to get username from request
function getUsername(req, getAuthConfig) {
  const authConfig = getAuthConfig();
  if (authConfig.skipAuth) {
    return 'dev-mode';
  }
  return req.user?.username || 'anonymous';
}

// Helper to check user concurrency limits
function canStartTest(username) {
  const maxConcurrency = parseInt(process.env.RUN_TEST_CONCURRENCY_PER_USER) || 3;
  const currentCount = userConcurrency.get(username) || 0;
  return currentCount < maxConcurrency;
}

// Helper to increment user concurrency
function incrementUserConcurrency(username) {
  const currentCount = userConcurrency.get(username) || 0;
  userConcurrency.set(username, currentCount + 1);
}

// Helper to decrement user concurrency
function decrementUserConcurrency(username) {
  const currentCount = userConcurrency.get(username) || 0;
  if (currentCount > 0) {
    userConcurrency.set(username, currentCount - 1);
  }
}

// Helper to clean up finished job
function cleanupJob(jobId, username) {
  runningTests.delete(jobId);
  decrementUserConcurrency(username);
}

// Helper to stop a running test
function stopRunningTest(jobId) {
  const testInfo = runningTests.get(jobId);
  if (!testInfo) return false;

  try {
    console.log(`🛑 Stopping test ${jobId} for user ${testInfo.username}`);
    
    if (testInfo.process && !testInfo.process.killed) {
      testInfo.process.kill('SIGTERM');
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (testInfo.process && !testInfo.process.killed) {
          console.log(`🔥 Force killing test ${jobId}`);
          testInfo.process.kill('SIGKILL');
        }
      }, 5000);
    }
    
    // Mark as stopped and finished
    testInfo.finished = true;
    testInfo.stopped = true;
    testInfo.exitCode = -1;
    testInfo.error = 'Test stopped by user';
    
    // Fix: Clean up job to decrement counter
    cleanupJob(jobId, testInfo.username);
    
    return true;

// Setup Test routes
export function setupTestRoutes(app, isAuthenticated, dependencies) {
  const {
    WORKDIR,
    ROOT_DIR,
    __dirname,
    getAuthConfig
  } = dependencies;

  // API endpoint to start a test (non-blocking)
  app.post('/api/start-test', isAuthenticated, async (req, res) => {
    try {
      const { filePath, dockerImage } = req.body;

      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }

      const username = getUsername(req, getAuthConfig);

      // Check concurrency limits
      if (!canStartTest(username)) {
        const maxConcurrency = parseInt(process.env.RUN_TEST_CONCURRENCY_PER_USER) || 3;
        return res.status(429).json({
          error: `Maximum concurrent tests reached (${maxConcurrency} per user)`
        });
      }

      // Use the user's test directory as the base
      const testDir = getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const absolutePath = path.join(testDir, filePath);

      // Basic security check to ensure the path is within the test directory
      if (!absolutePath.startsWith(testDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Clean up old .rep file before starting test to prevent old results
      const repFilePath = absolutePath.replace(/\.rec$/, '.rep');
      try {
        await fs.unlink(repFilePath);
        console.log(`🗑️ Cleaned up old rep file: ${repFilePath}`);
      } catch (error) {
        // File doesn't exist, which is fine
        console.log(`📝 No existing rep file to clean: ${repFilePath}`);
      }

      // Execute the clt test command to run the test (from the user's project directory)
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const relativeFilePath = path.relative(userRepoPath, absolutePath);

			// Use EXACT same command format as original working implementation
			const testCommand = `clt test -d -t ${relativeFilePath} ${dockerImage ? dockerImage : ''}`;
			console.log(`Starting test command: ${testCommand} in dir: ${userRepoPath}`);

			// Generate unique job ID
			const jobId = generateJobId();

			// Prepare spawn options - EXACT same as original working exec options
			const spawnOptions = {
				cwd: userRepoPath,
				env: {
					...process.env,
					CLT_NO_COLOR: '1',
					CLT_RUN_ARGS: process.env.CLT_RUN_ARGS || '',
				}
			};

			// Start the process directly without using sh -c
			const childProcess = spawn(testCommand, [], {
				...spawnOptions,
				shell: true
			});

      // Set up timeout if configured
      let timeoutId = null;
      const timeoutMs = parseInt(process.env.RUN_TEST_TIMEOUT) || 0;
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          console.log(`Test ${jobId} timed out after ${timeoutMs}ms, killing process`);
          childProcess.kill('SIGTERM');
          // Give it 5 seconds to terminate gracefully, then force kill
          setTimeout(() => {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL');
            }
          }, 5000);
        }, timeoutMs);
      }

      // Store process information
      const testInfo = {
        process: childProcess,
        userPath: userRepoPath,
        startTime: Date.now(),
        filePath,
        dockerImage,
        username,
        absolutePath,
        testDir,
        timeoutId,
        stdout: '',
        stderr: '',
        exitCode: null,
        finished: false
      };

      runningTests.set(jobId, testInfo);
      incrementUserConcurrency(username);

      // Collect stdout and stderr
      childProcess.stdout.on('data', (data) => {
        testInfo.stdout += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        testInfo.stderr += data.toString();
      });

      // Handle process completion
      childProcess.on('close', (code, signal) => {
        console.log(`Test ${jobId} completed with exit code: ${code}, signal: ${signal}`);
        testInfo.exitCode = code;
        testInfo.finished = true;

        // Clear timeout if set
        if (testInfo.timeoutId) {
          clearTimeout(testInfo.timeoutId);
        }

        // Don't remove from map immediately - let polling endpoint handle cleanup
      });

      childProcess.on('error', (error) => {
        console.error(`Test ${jobId} process error:`, error);
        testInfo.exitCode = 1;
        testInfo.finished = true;
        testInfo.error = error.message;

        // Clear timeout if set
        if (testInfo.timeoutId) {
          clearTimeout(testInfo.timeoutId);
        }
      });

      // Return job ID immediately
      res.json({
        jobId,
        message: 'Test started successfully',
        timeout: timeoutMs > 0 ? timeoutMs : null
      });

    } catch (error) {
      console.error('Error starting test:', error);
      res.status(500).json({ error: `Failed to start test: ${error.message}` });
    }
  });

  // API endpoint to poll test status and get partial results
  app.get('/api/poll-test/:jobId', isAuthenticated, async (req, res) => {
    try {
      const { jobId } = req.params;
      const testInfo = runningTests.get(jobId);

      console.log(`🔍 Polling test ${jobId}:`, testInfo ? {
        finished: testInfo.finished,
        exitCode: testInfo.exitCode,
        hasProcess: !!testInfo.process,
        processKilled: testInfo.process?.killed
      } : 'NOT_FOUND');

      if (!testInfo) {
        return res.status(404).json({ error: 'Test job not found' });
      }

      // Check if process is still running
      const isRunning = !testInfo.finished && testInfo.process && !testInfo.process.killed;
      console.log(`📊 Test ${jobId} status: running=${isRunning}, finished=${testInfo.finished}`);

      // If test is finished, process final results and clean up
      if (testInfo.finished) {
        // DEFENSIVE FIX: Check if test was stopped but not cleaned up
        if (testInfo.stopped && runningTests.has(jobId)) {
          console.log(`🔍 Detected stopped test ${jobId} that wasn't cleaned up, cleaning now`);
          cleanupJob(jobId, testInfo.username);
          return res.json({
            running: false,
            finished: true,
            status: 'stopped',
            success: false,
            exitCode: -1,
            error: 'Test was stopped by user'
          });
        }
        try {
          // Parse the .rec file using WASM with content map (same as original logic)
          console.log(`📖 Parsing .rec file with WASM: ${testInfo.absolutePath}`);
          const fileMap = await createFileContentMap(testInfo.absolutePath, testInfo.testDir, req);
          const relativeFilePath = path.relative(testInfo.testDir, testInfo.absolutePath);
          const testStructure = await parseRecFileFromMapWasm(relativeFilePath, fileMap);

          // Check if .rep file exists for validation (same as original logic)
          const repFilePath = testInfo.absolutePath.replace('.rec', '.rep');
          const repRelativePath = relativeFilePath.replace('.rec', '.rep');
          let validationResults = null;

          try {
            await fs.access(repFilePath);
            // .rep file exists, add it to file map and validate
            const repContent = await fs.readFile(repFilePath, 'utf8');
            fileMap[repRelativePath] = repContent;

            console.log(`🔍 Running validation with WASM: ${repFilePath}`);

            // Get patterns for validation (same as original logic)
            try {
              const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
              const patterns = await getMergedPatterns(userRepoPath, __dirname);

              // Run validation with patterns
              validationResults = await validateTestFromMapWasm(relativeFilePath, fileMap, patterns);

              // ENRICH testStructure with actual outputs and error flags (same as original logic)
              try {
                console.log(`📋 Enriching testStructure with actual outputs from .rep file`);

                // Parse .rep file to get actual outputs
                const repStructure = await parseRecFileFromMapWasm(repRelativePath, fileMap);

                // Extract only OUTPUT type blocks from .rep file
                const repOutputs = repStructure.steps.filter(step => step.type === 'output');

                // Track output index for sequential mapping
                let outputIndex = 0;
                let globalStepIndex = 0;

                // Recursive function to traverse nested structure and assign outputs (same as original)
                function enrichStepsRecursively(steps) {
                  steps.forEach((step, index) => {
                    const currentStepIndex = globalStepIndex;
                    globalStepIndex++;

                    // Check for validation errors on ANY step type
                    const hasError = validationResults.errors &&
                      validationResults.errors.some(error => error.step === currentStepIndex);
                    step.error = hasError;

                    // If this is an input step, set status based on error
                    if (step.type === 'input') {
                      step.status = hasError ? 'failed' : 'success';
                    }

                    // If this is an output step, assign next .rep output
                    if (step.type === 'output') {
                      if (repOutputs[outputIndex]) {
                        step.actualOutput = repOutputs[outputIndex].content || '';
                      }
                      outputIndex++;
                      step.status = step.error ? 'failed' : 'success';
                    }

                    // If this is a block step, process nested steps
                    if (step.type === 'block') {
                      if (step.steps && step.steps.length > 0) {
                        enrichStepsRecursively(step.steps);
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

              } catch (enrichError) {
                console.error('Error enriching testStructure:', enrichError.message);
              }

            } catch (patternError) {
              console.warn('Could not load patterns for validation:', patternError.message);
              // Fall back to validation without patterns
              validationResults = await validateTestFromMapWasm(relativeFilePath, fileMap);
            }

          } catch (repError) {
            console.log(`ℹ️  No .rep file found for validation: ${repFilePath}`);
          }

          // Process test results for UI compatibility (same as original logic)
          const results = await processTestResults(
            testInfo.absolutePath,
            testStructure,
            testInfo.stdout,
            testInfo.stderr,
            testInfo.exitCode,
            testInfo.error ? new Error(testInfo.error) : null
          );

          // Clean up
          cleanupJob(jobId, testInfo.username);

          // Determine overall status
          const hasValidationErrors = validationResults && validationResults.errors && validationResults.errors.length > 0;
          const hasProcessError = testInfo.exitCode !== 0;
          const overallStatus = hasValidationErrors || hasProcessError ? 'failed' : 'completed';

          // Return final results
          return res.json({
            running: false,
            finished: true,
            status: overallStatus,
            success: !hasValidationErrors && !hasProcessError,
            exitCode: testInfo.exitCode,
            filePath: testInfo.filePath,
            dockerImage: testInfo.dockerImage || 'default-image',
            testStructure,
            validationResults,
            ...results
          });

        } catch (readError) {
          console.error('Error reading test files:', readError);

          // Clean up on error
          cleanupJob(jobId, testInfo.username);

          return res.status(500).json({
            running: false,
            finished: true,
            status: 'failed',
            error: `Failed to read test files: ${readError.message}`,
            stderr: testInfo.stderr,
            stdout: testInfo.stdout
          });
        }
      }

      // Process is still running - try to get partial results
      try {
        // Try to read partial .rep file
        const repFilePath = testInfo.absolutePath.replace('.rec', '.rep');
        let partialResults = null;

        try {
          // Check if .rep file exists and has content
          const repStats = await fs.stat(repFilePath);
          if (repStats.size > 0) {
            // Read partial .rep file content
            const partialRepContent = await fs.readFile(repFilePath, 'utf8');

            // Create file map with partial .rep content
            const fileMap = await createFileContentMap(testInfo.absolutePath, testInfo.testDir, req);
            const relativeFilePath = path.relative(testInfo.testDir, testInfo.absolutePath);
            const repRelativePath = relativeFilePath.replace('.rec', '.rep');
            fileMap[repRelativePath] = partialRepContent;

            // Parse with WASM (same pattern as original)
            const testStructure = await parseRecFileFromMapWasm(relativeFilePath, fileMap);

            // Parse partial .rep structure to get completed outputs
            const repStructure = await parseRecFileFromMapWasm(repRelativePath, fileMap);
            const repOutputs = repStructure.steps.filter(step => step.type === 'output');

            // Mark steps as completed based on what's in partial .rep file
            let outputIndex = 0;
            let globalStepIndex = 0;

            function markPartialProgress(steps) {
              steps.forEach((step) => {
                const currentStepIndex = globalStepIndex;
                globalStepIndex++;

                if (step.type === 'input') {
                  // Mark as pending by default, will be updated if output exists
                  step.status = 'pending';
                }

                if (step.type === 'output') {
                  if (repOutputs[outputIndex]) {
                    // This output exists in partial .rep file - mark as completed
                    step.actualOutput = repOutputs[outputIndex].content || '';
                    step.status = 'matched'; // Use existing status

                    // Also mark the corresponding input as completed
                    if (outputIndex < steps.length && steps[outputIndex * 2] && steps[outputIndex * 2].type === 'input') {
                      steps[outputIndex * 2].status = 'matched';
                    }
                  } else {
                    // This output doesn't exist yet - still pending
                    step.status = 'pending';
                  }
                  outputIndex++;
                }

                if (step.type === 'block' && step.steps) {
                  markPartialProgress(step.steps);
                  // Block status based on nested steps
                  const hasCompleted = step.steps.some(s => s.status === 'matched');
                  const hasPending = step.steps.some(s => s.status === 'pending');
                  step.status = hasCompleted ? (hasPending ? 'pending' : 'matched') : 'pending';
                }

                if (step.type === 'comment') {
                  step.status = 'matched'; // Comments are always "completed"
                }
              });
            }

            markPartialProgress(testStructure.steps);

            partialResults = {
              testStructure,
              partialOutputCount: repOutputs.length,
              lastUpdate: Date.now()
            };
          }
        } catch (repError) {
          // .rep file doesn't exist yet or can't be read - that's fine for partial results
          console.log(`No partial .rep file available yet: ${repFilePath}`);
        }

        // Return current status
        res.json({
          running: true,
          finished: false,
          exitCode: null,
          startTime: testInfo.startTime,
          duration: Date.now() - testInfo.startTime,
          partialResults
        });

      } catch (error) {
        console.error('Error getting partial results:', error);
        res.json({
          running: true,
          finished: false,
          exitCode: null,
          error: `Error getting partial results: ${error.message}`
        });
      }

    } catch (error) {
      console.error('Error polling test:', error);
      res.status(500).json({ error: `Failed to poll test: ${error.message}` });
    }
  });

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
					CLT_RUN_ARGS: process.env.CLT_RUN_ARGS || '',
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

  // API endpoint to stop a running test
  app.post('/api/stop-test/:jobId', isAuthenticated, async (req, res) => {
    try {
      const { jobId } = req.params;
      const testInfo = runningTests.get(jobId);

      if (!testInfo) {
        return res.status(404).json({ error: 'Test job not found' });
      }

      const username = getUsername(req, getAuthConfig);

      // Security check - only allow stopping own tests (or in dev mode)
      const authConfig = getAuthConfig();
      if (!authConfig.skipAuth && testInfo.username !== username) {
        return res.status(403).json({ error: 'Access denied - can only stop your own tests' });
      }

      const stopped = stopRunningTest(jobId);

      if (stopped) {
        res.json({
          success: true,
          message: 'Test stopped successfully',
          jobId
        });
      } else {
        res.status(500).json({ error: 'Failed to stop test' });
      }
    } catch (error) {
      console.error('Error stopping test:', error);
      res.status(500).json({ error: `Failed to stop test: ${error.message}` });
    }
  });

  // DEBUG endpoint to check/reset user concurrency (dev mode only)
  app.get('/api/debug/concurrency/:username?', isAuthenticated, async (req, res) => {
    try {
      const authConfig = getAuthConfig();
      if (!authConfig.skipAuth) {
        return res.status(403).json({ error: 'Debug endpoints only available in dev mode' });
      }

      const { username } = req.params;
      const targetUser = username || getUsername(req, getAuthConfig);
      
      const currentCount = userConcurrency.get(targetUser) || 0;
      const maxConcurrency = parseInt(process.env.RUN_TEST_CONCURRENCY_PER_USER) || 3;
      const runningTestsForUser = Array.from(runningTests.entries())
        .filter(([_, testInfo]) => testInfo.username === targetUser);
      
      res.json({
        username: targetUser,
        currentCount,
        maxConcurrency,
        canStartTest: currentCount < maxConcurrency,
        runningTests: runningTestsForUser.map(([jobId, testInfo]) => ({
          jobId,
          filePath: testInfo.filePath,
          startTime: testInfo.startTime,
          finished: testInfo.finished,
          stopped: testInfo.stopped
        })),
        allUserCounts: Object.fromEntries(userConcurrency)
      });
    } catch (error) {
      console.error('Error getting concurrency debug info:', error);
      res.status(500).json({ error: `Failed to get debug info: ${error.message}` });
    }
  });

  // DEBUG endpoint to reset user concurrency (dev mode only)
  app.post('/api/debug/reset-concurrency/:username?', isAuthenticated, async (req, res) => {
    try {
      const authConfig = getAuthConfig();
      if (!authConfig.skipAuth) {
        return res.status(403).json({ error: 'Debug endpoints only available in dev mode' });
      }

      const { username } = req.params;
      const targetUser = username || getUsername(req, getAuthConfig);
      
      const oldCount = userConcurrency.get(targetUser) || 0;
      userConcurrency.set(targetUser, 0);
      
      // Also clean up any finished/stopped tests for this user
      const cleanedTests = [];
      for (const [jobId, testInfo] of runningTests.entries()) {
        if (testInfo.username === targetUser && (testInfo.finished || testInfo.stopped)) {
          runningTests.delete(jobId);
          cleanedTests.push(jobId);
        }
      }
      
      console.log(`🔧 Reset concurrency for ${targetUser}: ${oldCount} -> 0, cleaned ${cleanedTests.length} tests`);
      
      res.json({
        username: targetUser,
        oldCount,
        newCount: 0,
        cleanedTests,
        message: `Reset concurrency counter for ${targetUser}`
      });
    } catch (error) {
      console.error('Error resetting concurrency:', error);
      res.status(500).json({ error: `Failed to reset concurrency: ${error.message}` });
    }
  });
}
currency:', error);
      res.status(500).json({ error: `Failed to reset concurrency: ${error.message}` });
    }
  });
}
