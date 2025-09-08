// EditorLogic.js - WASM, patterns, and data conversion logic extracted from Editor.svelte

import { writable } from 'svelte/store';
import { filesStore } from '../stores/filesStore';
import { API_URL } from '../config.js';

// WASM and Pattern Management - using Svelte stores for reactivity
let wasmLoaded = false;
let patternMatcher = null;
let patterns = {};

// Create reactive stores for WASM state
export const wasmLoadedStore = writable(false);
export const patternMatcherStore = writable(null);

// Fetch patterns from server
export async function fetchPatterns() {
  try {
    const response = await fetch(`${API_URL}/api/get-patterns`, {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      patterns = data.patterns || {};
      console.log('Loaded patterns:', patterns);
      return patterns;
    } else {
      console.warn('Could not load patterns:', await response.text());
      return {};
    }
  } catch (err) {
    console.error('Error fetching patterns:', err);
    return {};
  }
}

// Initialize WASM module
export async function initWasm() {
  try {
    console.log('Initializing WASM diff module...');

    // Use dynamic import to avoid build-time issues
    const module = await import('../../pkg/wasm.js');

    // Initialize the WASM module properly for web target
    await module.default();

    // Default patterns if API fails
    const defaultPatterns = {
      "NUMBER": "[0-9]+",
      "DATE": "[0-9]{4}\\-[0-9]{2}\\-[0-9]{2}",
      "DATETIME": "[0-9]{4}\\-[0-9]{2}\\-[0-9]{2}\\s[0-9]{2}:[0-9]{2}:[0-9]{2}",
      "IPADDR": "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+",
      "PATH": "[A-Za-z0-9\\/\\.\\-\\_]+",
      "SEMVER": "[0-9]+\\.[0-9]+\\.[0-9]+",
      "TIME": "[0-9]{2}:[0-9]{2}:[0-9]{2}",
      "YEAR": "[0-9]{4}"
    };

    // Fetch patterns first
    let patternsData;
    try {
      patternsData = await fetchPatterns();
      // If patterns is empty, use default patterns
      if (Object.keys(patternsData).length === 0) {
        console.log('No patterns returned from API, using defaults');
        patternsData = defaultPatterns;
      }
    } catch (err) {
      console.error('Failed to fetch patterns, using defaults:', err);
      patternsData = defaultPatterns;
    }

    // Initialize pattern matcher with fetched or default patterns
    patternMatcher = new module.PatternMatcher(JSON.stringify(patternsData));
    window.patternMatcher = patternMatcher;
    wasmLoaded = true;
    
    // Update the reactive stores
    wasmLoadedStore.set(true);
    patternMatcherStore.set(patternMatcher);
    
    console.log('WASM diff module initialized successfully with patterns:', patternsData);
  } catch (err) {
    console.error('Failed to initialize WASM diff module:', err);
  }
}

// Export getters for WASM state
export function getWasmLoaded() {
  return wasmLoaded;
}

export function getPatternMatcher() {
  return patternMatcher;
}

// Convert structured data to legacy command format for UI compatibility
export function convertStructuredToCommands(testStructure) {
  if (!testStructure || !testStructure.steps) return [];

  const commands = [];
  let globalStepIndex = 0; // Track global step index across all levels

  // Process steps, including nested steps when blocks are expanded
  function processSteps(steps, level = 0, parentBlockPath = []) {
    let i = 0;
    while (i < steps.length) {
      const step = steps[i];
      const currentPath = level === 0 ? [i] : [...parentBlockPath, i];
      const currentGlobalIndex = globalStepIndex; // Capture current global index

      if (step.type === 'input') {
        // Create command from input step
        const command = {
          command: step.content || '',
          expectedOutput: '',
          actualOutput: step.actualOutput || '',
          status: step.status || 'pending',
          error: step.error || false,
          type: 'command',
          initializing: false,
          duration: step.duration,
          // Add metadata to track back to structured format
          stepIndex: currentGlobalIndex, // Use global step index
          stepPath: currentPath,
          isInputOutputPair: false,
          isNested: level > 0,
          nestingLevel: level,
          // Change tracking properties
          hasChanges: step.hasChanges || false,
          originalContent: step.originalContent,
          modifiedAt: step.modifiedAt
        };

        globalStepIndex++; // Increment global index

        // Look for following output step
        if (i + 1 < steps.length && steps[i + 1].type === 'output') {
          const outputStep = steps[i + 1];
          command.expectedOutput = outputStep.content || '';
          if (outputStep.actualOutput) {
            command.actualOutput = outputStep.actualOutput;
          }
          
          // For input-output pairs, combine error status from both steps
          const inputHasError = step.error || false;
          const outputHasError = outputStep.error || false;
          const combinedError = inputHasError || outputHasError;
          
          // Use the most severe status (failed > success)
          if (combinedError || outputStep.status === 'failed' || step.status === 'failed') {
            command.status = 'failed';
            command.error = true;
          } else {
            command.status = outputStep.status || step.status || 'success';
            command.error = false;
          }
          
          command.isInputOutputPair = true;
          globalStepIndex++; // Increment for the output step too
          i++; // Skip the output step since we processed it
        }

        commands.push(command);
      } else if (step.type === 'block') {
        const blockCommand = {
          command: step.args[0] || '',
          status: step.status || 'pending',
          error: step.error || false,
          type: 'block',
          initializing: false,
          isExpanded: step.isExpanded || false,
          duration: step.duration,
          // Add metadata to track back to structured format
          stepIndex: currentGlobalIndex, // Use global step index
          stepPath: currentPath,
          isInputOutputPair: false,
          isNested: level > 0,
          nestingLevel: level,
          // Store nested steps for expansion
          nestedSteps: step.steps,
          // Change tracking properties
          hasChanges: step.hasChanges || false,
          originalArgs: step.originalArgs,
          modifiedAt: step.modifiedAt
        };

        globalStepIndex++; // Increment global index for block

        commands.push(blockCommand);

        // If block is expanded, process its nested steps
        if (step.isExpanded && step.steps && step.steps.length > 0) {
          processSteps(step.steps, level + 1, currentPath);
        }
      } else if (step.type === 'comment') {
        commands.push({
          command: step.content || '',
          status: step.status || 'pending',
          error: step.error || false,
          type: 'comment',
          initializing: false,
          duration: step.duration,
          // Add metadata to track back to structured format
          stepIndex: currentGlobalIndex, // Use global step index
          stepPath: currentPath,
          isInputOutputPair: false,
          isNested: level > 0,
          nestingLevel: level,
          // Change tracking properties
          hasChanges: step.hasChanges || false,
          originalContent: step.originalContent,
          modifiedAt: step.modifiedAt
        });

        globalStepIndex++; // Increment global index for comment
      } else if (step.type === 'output') {
        // Increment global index for standalone output steps
        globalStepIndex++;
      }
      // Skip standalone output steps (they should be handled with input steps)

      i++;
    }
  }

  // Process all steps, including nested ones when expanded
  processSteps(testStructure.steps, 0);
  return commands;
}

// Update structured format when commands are modified
export function updateStructuredCommand(testStructure, commandIndex, commands, newValue) {
  if (!testStructure) {
    // Fallback to legacy method
    filesStore.updateCommand(commandIndex, newValue);
    return;
  }

  // Find the corresponding step in structured format
  const command = commands[commandIndex];
  if (!command) {
    console.error('Could not find command at index:', commandIndex);
    return;
  }

  // Create updated structure
  const updatedStructure = { ...testStructure };

  // Navigate to the correct location using stepPath
  let targetSteps = updatedStructure.steps;
  const stepPath = command.stepPath;

  // Navigate to the parent container
  for (let i = 0; i < stepPath.length - 1; i++) {
    targetSteps = targetSteps[stepPath[i]].steps;
  }

  // Get the final index and update the step
  const finalIndex = stepPath[stepPath.length - 1];

  if (finalIndex >= 0 && finalIndex < targetSteps.length) {
    const step = { ...targetSteps[finalIndex] };

    // Track original values before first modification
    if (!step.hasChanges) {
      if (step.type === 'input' || step.type === 'comment') {
        step.originalContent = step.content;
      } else if (step.type === 'block') {
        step.originalArgs = [...(step.args || [])];
      }
      step.modifiedAt = new Date();
    }

    // Update the content
    if (step.type === 'input') {
      step.content = newValue;
      step.hasChanges = step.originalContent !== newValue;
    } else if (step.type === 'block') {
      step.args = [newValue];
      step.hasChanges = step.originalArgs?.[0] !== newValue;
    } else if (step.type === 'comment') {
      step.content = newValue;
      step.hasChanges = step.originalContent !== newValue;
    }

    targetSteps[finalIndex] = step;

    // Update the store with new structure
    filesStore.updateTestStructure(updatedStructure);
  }
}

// Discard changes for a specific command in structured format
export function discardStructuredCommand(testStructure, commandIndex, commands) {
  if (!testStructure) {
    console.error('No test structure available for discard');
    return;
  }

  // Find the corresponding step in structured format
  const command = commands[commandIndex];
  if (!command || !command.hasChanges) {
    console.error('Command not found or has no changes to discard:', commandIndex);
    return;
  }

  // Create updated structure
  const updatedStructure = { ...testStructure };

  // Navigate to the correct location using stepPath
  let targetSteps = updatedStructure.steps;
  const stepPath = command.stepPath;

  // Navigate to the parent container
  for (let i = 0; i < stepPath.length - 1; i++) {
    targetSteps = targetSteps[stepPath[i]].steps;
  }

  // Get the final index and restore original values
  const finalIndex = stepPath[stepPath.length - 1];

  if (finalIndex >= 0 && finalIndex < targetSteps.length) {
    const step = { ...targetSteps[finalIndex] };

    // Restore original values
    if (step.type === 'input' || step.type === 'comment') {
      step.content = step.originalContent || null;
    } else if (step.type === 'block') {
      step.args = step.originalArgs ? [...step.originalArgs] : [];
    }

    // Clear change tracking
    delete step.originalContent;
    delete step.originalArgs;
    delete step.hasChanges;
    delete step.modifiedAt;

    targetSteps[finalIndex] = step;

    // Update the store with restored structure
    filesStore.updateTestStructure(updatedStructure);
  }
}

// Update expected output in structured format
export function updateStructuredExpectedOutput(testStructure, commandIndex, commands, newValue) {
  if (!testStructure) {
    // Fallback to legacy method
    filesStore.updateExpectedOutput(commandIndex, newValue);
    return;
  }

  // Find the corresponding step in structured format
  const command = commands[commandIndex];
  if (!command || !command.isInputOutputPair) {
    console.error('Could not find input/output pair for command index:', commandIndex);
    return;
  }

  // Update the command directly in the commands array to avoid re-rendering all components
  // IMPORTANT: Preserve isOutputExpanded state during updates
  commands[commandIndex] = { ...command, expectedOutput: newValue, isOutputExpanded: command.isOutputExpanded };

  // Also update the structured format for persistence
  const updatedStructure = { ...testStructure };

  // Navigate to the correct location using stepPath
  let targetSteps = updatedStructure.steps;
  const stepPath = command.stepPath;

  // Navigate to the parent container
  for (let i = 0; i < stepPath.length - 1; i++) {
    targetSteps = targetSteps[stepPath[i]].steps;
  }

  // Get the final index and update the output step (should be at finalIndex + 1)
  const finalIndex = stepPath[stepPath.length - 1];

  if (finalIndex + 1 >= 0 && finalIndex + 1 < targetSteps.length) {
    const outputStep = { ...targetSteps[finalIndex + 1] };

    if (outputStep.type === 'output') {
      outputStep.content = newValue;
      targetSteps[finalIndex + 1] = outputStep;

      // Update the store with new structure
      filesStore.updateTestStructure(updatedStructure);
    }
  }
}