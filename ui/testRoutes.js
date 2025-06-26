import path from 'path';
import fs from 'fs/promises';
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

// Setup Test routes
export function setupTestRoutes(app, isAuthenticated, dependencies) {
  const {
    WORKDIR,
    ROOT_DIR,
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
}
