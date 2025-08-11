import fs from 'fs/promises';
import {
  convertTestStructureToLegacyCommands,
  extractDuration
} from './routes.js';

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
      const sections = repContent.split('––– input –––').slice(1);
      if (sections.length === 0) {
        console.warn(`No input sections found in .rep file: ${repFilePath}`);
        throw new Error('No sections found in rep file');
      }

      // Parse the .rep file sections
      for (const section of sections) {
        const parts = section.split('––– output –––');
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
        const sections = stdout.split('––– input –––').slice(1);
        for (const section of sections) {
          const parts = section.split('––– output –––');
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
        const nextDelimiterMatch = output.match(/–––\s.*?\s–––/);
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

    // Enhanced block status propagation - handle both legacy block commands and new nested block steps
    function propagateBlockStatus(commands) {
      for (const cmd of commands) {
        // Handle legacy block commands (isBlockCommand)
        if (cmd.isBlockCommand && cmd.parentBlock) {
          const key = `${cmd.parentBlock.command}|${cmd.blockSource || ''}`;
          const blockCommands = blockCommandMap.get(key) || [];

          if (blockCommands.length > 0) {
            const anyFailed = blockCommands.some(bc => bc.status === 'failed');
            const anyMatched = blockCommands.some(bc => bc.status === 'matched');
            cmd.status = anyFailed ? 'failed' : (anyMatched ? 'matched' : 'pending');

            console.log(`Block ${cmd.command} status: ${cmd.status} (anyFailed=${anyFailed}, anyMatched=${anyMatched}, command count=${blockCommands.length})`);
            console.log('Block commands:', blockCommands.map(bc => ({ cmd: bc.command.substring(0, 30), status: bc.status })));

            if (anyFailed) allCommandsPassed = false;
          }
        }
        
        // Handle new nested block steps (block with internal steps)
        if (cmd.type === 'block' && cmd.steps && cmd.steps.length > 0) {
          // If test passed (exitCode === 0), mark all internal steps as matched
          if (exitCode === 0) {
            function markNestedStepsAsMatched(steps) {
              steps.forEach(step => {
                if (step.type === 'input' || step.type === 'output') {
                  step.status = 'matched';
                } else if (step.type === 'block' && step.steps) {
                  markNestedStepsAsMatched(step.steps);
                  step.status = 'matched';
                } else if (step.type === 'comment') {
                  step.status = 'matched';
                }
              });
            }
            markNestedStepsAsMatched(cmd.steps);
            cmd.status = 'matched';
          } else {
            // Test failed - propagate actual status from nested steps
            const hasFailedStep = cmd.steps.some(s => s.status === 'failed');
            const hasMatchedStep = cmd.steps.some(s => s.status === 'matched');
            const hasPendingStep = cmd.steps.some(s => s.status === 'pending');
            
            cmd.status = hasFailedStep ? 'failed' : (hasMatchedStep ? (hasPendingStep ? 'pending' : 'matched') : 'pending');
            
            if (hasFailedStep) allCommandsPassed = false;
          }
          
          console.log(`Nested Block ${cmd.command || 'unnamed'} status: ${cmd.status} (exitCode=${exitCode}, steps=${cmd.steps.length})`);
        }
      }
    }
    
    propagateBlockStatus(expandedCommands);

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