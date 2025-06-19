<script lang="ts">
  import { filesStore, type TestStep as TestStepType, type TestStructure } from '../stores/filesStore';
  import { onMount } from 'svelte';
  import { API_URL } from '../config.js';
  import SimpleCodeMirror from './SimpleCodeMirror.svelte';
  import Step from './Step.svelte';

  // Add global TypeScript interface for window
  declare global {
    interface Window {
      patternMatcher: any;
      lastPatternRefresh: number;
    }
  }

  let wasmLoaded = false;
  let patternMatcher: any = null;
  let patterns = {};

  // Fetch patterns from server
  async function fetchPatterns() {
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
  };

  // Initialize WASM module
  async function initWasm() {
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
      console.log('WASM diff module initialized successfully with patterns:', patternsData);
    } catch (err) {
      console.error('Failed to initialize WASM diff module:', err);
    }
  }

// Scroll sync is now handled in individual Step components

  let commands: any[] = [];
  let autoSaveEnabled = true;

  // Convert structured data to legacy command format for UI compatibility
  function convertStructuredToCommands(testStructure: TestStructure | null): any[] {
    if (!testStructure || !testStructure.steps) return [];

    const commands: any[] = [];
    let globalStepIndex = 0; // Track global step index across all levels

    // Process steps, including nested steps when blocks are expanded
    function processSteps(steps: TestStepType[], level = 0, parentBlockPath: number[] = []) {
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
            type: 'command',
            initializing: false,
            duration: step.duration,
            // Add metadata to track back to structured format
            stepIndex: currentGlobalIndex, // Use global step index
            stepPath: currentPath,
            isInputOutputPair: false,
            isNested: level > 0,
            nestingLevel: level
          };

          globalStepIndex++; // Increment global index

          // Look for following output step
          if (i + 1 < steps.length && steps[i + 1].type === 'output') {
            const outputStep = steps[i + 1];
            command.expectedOutput = outputStep.content || '';
            if (outputStep.actualOutput) {
              command.actualOutput = outputStep.actualOutput;
            }
            if (outputStep.status) {
              command.status = outputStep.status;
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
            nestedSteps: step.steps
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
            type: 'comment',
            initializing: false,
            duration: step.duration,
            // Add metadata to track back to structured format
            stepIndex: currentGlobalIndex, // Use global step index
            stepPath: currentPath,
            isInputOutputPair: false,
            isNested: level > 0,
            nestingLevel: level
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
  function updateStructuredCommand(commandIndex: number, newValue: string) {
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

      if (step.type === 'input') {
        step.content = newValue;
      } else if (step.type === 'block') {
        step.args = [newValue];
      } else if (step.type === 'comment') {
        step.content = newValue;
      }

      targetSteps[finalIndex] = step;

      // Update the store with new structure
      filesStore.updateTestStructure(updatedStructure);
    }
  }

  // Update expected output in structured format
  function updateStructuredExpectedOutput(commandIndex: number, newValue: string) {
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
    commands[commandIndex] = { ...command, expectedOutput: newValue };

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

        // Update the store with new structure but don't trigger reactive updates
        filesStore.updateTestStructureQuietly(updatedStructure);
      }
    }
  }

  // Define testStructure for template usage
  $: testStructure = $filesStore.currentFile?.testStructure;

  $: commands = $filesStore.currentFile?.testStructure
    ? convertStructuredToCommands($filesStore.currentFile.testStructure)
    : ($filesStore.currentFile?.commands || []);

  // Debug logging
  $: {
    console.log('DEBUG: currentFile:', $filesStore.currentFile);
    console.log('DEBUG: testStructure:', $filesStore.currentFile?.testStructure);
    console.log('DEBUG: converted commands:', commands);
  }

  function moveCommandUp(index: number) {
    if (!testStructure) {
      // Fallback to legacy method
      if (index > 0 && $filesStore.currentFile) {
        const command = commands[index];
        filesStore.deleteCommand(index);
        filesStore.addCommand(index - 1, command.command, command.type || 'command');
      }
      return;
    }

    if (index <= 0) return;

    const command = commands[index];
    if (!command || !command.stepPath) {
      console.error('Could not find step path for command index:', index);
      return;
    }

    const updatedStructure = { ...testStructure };
    const updatedSteps = [...updatedStructure.steps];
    const stepIndex = command.stepPath[0];

    if (stepIndex > 0 && stepIndex < updatedSteps.length) {
      // Handle input/output pairs
      if (updatedSteps[stepIndex].type === 'input' &&
          stepIndex + 1 < updatedSteps.length &&
          updatedSteps[stepIndex + 1].type === 'output') {
        // Move input/output pair
        const inputStep = updatedSteps[stepIndex];
        const outputStep = updatedSteps[stepIndex + 1];
        updatedSteps.splice(stepIndex, 2); // Remove both
        updatedSteps.splice(stepIndex - 1, 0, inputStep, outputStep); // Insert both at new position
      } else {
        // Move single step
        const step = updatedSteps[stepIndex];
        updatedSteps.splice(stepIndex, 1); // Remove
        updatedSteps.splice(stepIndex - 1, 0, step); // Insert at new position
      }

      updatedStructure.steps = updatedSteps;
      filesStore.updateTestStructure(updatedStructure);
    }
  }

  function moveCommandDown(index: number) {
    if (!testStructure) {
      // Fallback to legacy method
      if (index < commands.length - 1 && $filesStore.currentFile) {
        const command = commands[index];
        filesStore.deleteCommand(index);
        filesStore.addCommand(index + 1, command.command, command.type || 'command');
      }
      return;
    }

    if (index >= commands.length - 1) return;

    const command = commands[index];
    if (!command || !command.stepPath) {
      console.error('Could not find step path for command index:', index);
      return;
    }

    const updatedStructure = { ...testStructure };
    const updatedSteps = [...updatedStructure.steps];
    const stepIndex = command.stepPath[0];

    if (stepIndex >= 0 && stepIndex < updatedSteps.length - 1) {
      // Handle input/output pairs
      if (updatedSteps[stepIndex].type === 'input' &&
          stepIndex + 1 < updatedSteps.length &&
          updatedSteps[stepIndex + 1].type === 'output') {
        // Move input/output pair
        const inputStep = updatedSteps[stepIndex];
        const outputStep = updatedSteps[stepIndex + 1];
        updatedSteps.splice(stepIndex, 2); // Remove both
        updatedSteps.splice(stepIndex + 1, 0, inputStep, outputStep); // Insert both at new position
      } else {
        // Move single step
        const step = updatedSteps[stepIndex];
        updatedSteps.splice(stepIndex, 1); // Remove
        updatedSteps.splice(stepIndex + 1, 0, step); // Insert at new position
      }

      updatedStructure.steps = updatedSteps;
      filesStore.updateTestStructure(updatedStructure);
    }
  }

  function duplicateCommand(index: number) {
    if (!testStructure) {
      // Fallback to legacy method
      if ($filesStore.currentFile) {
        const command = commands[index];
        filesStore.addCommand(index + 1, command.command, command.type || 'command');
      }
      return;
    }

    const command = commands[index];
    if (!command || !command.stepPath) {
      console.error('Could not find step path for command index:', index);
      return;
    }

    const updatedStructure = { ...testStructure };
    const updatedSteps = [...updatedStructure.steps];
    const stepIndex = command.stepPath[0];

    if (stepIndex >= 0 && stepIndex < updatedSteps.length) {
      const step = updatedSteps[stepIndex];

      // Handle input/output pairs
      if (step.type === 'input' &&
          stepIndex + 1 < updatedSteps.length &&
          updatedSteps[stepIndex + 1].type === 'output') {
        // Duplicate input/output pair
        const inputStep = { ...step };
        const outputStep = { ...updatedSteps[stepIndex + 1] };
        updatedSteps.splice(stepIndex + 2, 0, inputStep, outputStep);
      } else {
        // Duplicate single step
        const duplicatedStep = { ...step };
        updatedSteps.splice(stepIndex + 1, 0, duplicatedStep);
      }

      updatedStructure.steps = updatedSteps;
      filesStore.updateTestStructure(updatedStructure);
    }
  }

  // Auto-resize is now handled in individual Step components

  // Initialize autoSaveEnabled from localStorage
  onMount(() => {
    // Default to enabled if not set
    const storedValue = localStorage.getItem('autoSaveEnabled');
    autoSaveEnabled = storedValue === null ? true : storedValue === 'true';

    // Initialize WASM module for highlighting differences in the output
    initWasm();

    // Define global window property for pattern refresh tracking
    if (typeof window !== 'undefined') {
      window.lastPatternRefresh = 0;
    }
  });

  // Update localStorage when checkbox changes
  function toggleAutoSave() {
    autoSaveEnabled = !autoSaveEnabled;
    localStorage.setItem('autoSaveEnabled', String(autoSaveEnabled));
    console.log('Auto-save set to:', autoSaveEnabled);
  }

  function addCommand(index: number, commandType: 'command' | 'block' | 'comment' = 'command') {
    if (!testStructure) {
      // Fallback to legacy method
      let defaultText = '';
      if (commandType === 'block') {
        defaultText = 'path/to/file';
      } else if (commandType === 'comment') {
        defaultText = 'Add your comment here';
      }
      filesStore.addCommand(index, defaultText, commandType);
      return;
    }

    // Handle structured format
    const updatedStructure = { ...testStructure };

    // Calculate the correct insertion position by walking through current steps
    let insertIndex;
    let targetSteps = updatedStructure.steps;
    let nestingPath: number[] = [];

    if (index === 0) {
      insertIndex = 0; // Insert at beginning of top level
    } else if (index >= commands.length) {
      insertIndex = targetSteps.length; // Insert at end of top level
    } else {
      // Find the command we're inserting after
      const targetCommand = commands[index - 1];

      if (targetCommand.isNested) {
        // We're inserting into a nested context
        nestingPath = targetCommand.stepPath.slice(0, -1); // Remove last index to get parent path

        // Navigate to the parent block's steps
        let currentSteps = updatedStructure.steps;
        for (const pathIndex of nestingPath) {
          currentSteps = currentSteps[pathIndex].steps;
        }
        targetSteps = currentSteps;

        // Calculate position within the nested steps
        insertIndex = targetCommand.stepPath[targetCommand.stepPath.length - 1] + 1;
        if (targetCommand.isInputOutputPair) {
          insertIndex += 1; // Account for output step
        }
      } else {
        // We're inserting at top level
        insertIndex = 0;
        for (let i = 0; i < index; i++) {
          if (i < commands.length) {
            const cmd = commands[i];
            if (!cmd.isNested) { // Only count top-level commands
              if (cmd.isInputOutputPair) {
                insertIndex += 2; // Skip input + output steps
              } else {
                insertIndex += 1; // Skip single step (block/comment)
              }
            }
          }
        }
      }
    }

    let newSteps: TestStepType[] = [];

    if (commandType === 'block') {
      newSteps = [{
        type: 'block',
        args: ['path/to/file'],
        content: null,
        steps: [],
        status: 'pending',
        isExpanded: false
      }];
    } else if (commandType === 'comment') {
      newSteps = [{
        type: 'comment',
        args: [],
        content: 'Add your comment here',
        steps: null,
        status: 'pending'
      }];
    } else {
      // Create input/output pair for command
      newSteps = [
        {
          type: 'input',
          args: [],
          content: '',
          steps: null,
          status: 'pending'
        },
        {
          type: 'output',
          args: [],
          content: '',
          steps: null,
          status: 'pending'
        }
      ];
    }

    // Insert the new steps at the correct location
    targetSteps.splice(insertIndex, 0, ...newSteps);
    filesStore.updateTestStructure(updatedStructure);
  }

  function deleteCommand(index: number) {
    if (!testStructure) {
      // Fallback to legacy method
      filesStore.deleteCommand(index);
      return;
    }

    // Handle structured format
    const command = commands[index];
    if (!command) {
      console.error('Could not find command at index:', index);
      return;
    }

    const updatedStructure = { ...testStructure };

    // Navigate to the correct location using stepPath
    let targetSteps = updatedStructure.steps;
    const stepPath = command.stepPath;

    // Navigate to the parent container
    for (let i = 0; i < stepPath.length - 1; i++) {
      targetSteps = targetSteps[stepPath[i]].steps;
    }

    // Get the final index within the target container
    const finalIndex = stepPath[stepPath.length - 1];

    if (finalIndex >= 0 && finalIndex < targetSteps.length) {
      if (command.isInputOutputPair) {
        // Remove both input and output steps
        targetSteps.splice(finalIndex, 2);
      } else {
        // Remove single step (block/comment)
        targetSteps.splice(finalIndex, 1);
      }

      filesStore.updateTestStructure(updatedStructure);
    }
  }

  // Toggle block expansion
  function toggleBlockExpansion(commandIndex: number) {
    if (!testStructure) return;

    const command = commands[commandIndex];
    if (!command || command.type !== 'block') {
      console.error('Command is not a block or not found:', commandIndex);
      return;
    }

    // Navigate to the correct step in the structure using stepPath
    const updatedStructure = { ...testStructure };
    let currentSteps = updatedStructure.steps;
    const stepPath = command.stepPath;

    // Navigate through the path to find the correct step
    let targetStep = null;
    let targetSteps = currentSteps;

    for (let i = 0; i < stepPath.length; i++) {
      const pathIndex = stepPath[i];
      if (i === stepPath.length - 1) {
        // This is the target step
        targetStep = { ...targetSteps[pathIndex] };
        targetStep.isExpanded = !targetStep.isExpanded;
        targetSteps[pathIndex] = targetStep;
      } else {
        // Navigate deeper into nested structure
        targetSteps = targetSteps[pathIndex].steps;
      }
    }

    filesStore.updateTestStructure(updatedStructure);
  }

  function saveFile() {
    filesStore.saveOnly();
  }

  function runTest() {
    if ($filesStore.currentFile && $filesStore.currentFile.dirty) {
      // If there are unsaved changes, save first then run
      filesStore.saveAndRun();
    } else {
      // If everything is already saved, just run
      filesStore.runTest();
    }
  }

  function formatTime(date: Date): string {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  // These functions are now handled in individual Step components

  // Function to copy current URL with file hash to clipboard.
  function copyShareUrl() {
    if (!$filesStore.currentFile) return;

    // Create URL with file hash.
    const url = new URL(window.location.href);
    // Remove existing query parameters.
    url.search = '';
    // Set hash to file-{path}.
    url.hash = `file-${encodeURIComponent($filesStore.currentFile.path)}`;

    // Copy to clipboard.
    navigator.clipboard.writeText(url.toString())
      .then(() => {
        // Show temporary notification.
        alert('Shareable link copied to clipboard!');
      })
      .catch(err => {
        console.error('Could not copy text: ', err);
        // Fallback: show the URL and ask user to copy manually.
        prompt('Copy this shareable link:', url.toString());
      });
  }
</script>

<div class="editor">
  <!-- Header -->
  <div class="editor-header">
    <div class="file-info">
      {#if $filesStore.currentFile}
        <span class="file-path">{$filesStore.currentFile.path}</span>
        {#if $filesStore.currentFile.status}
          <span class="file-status-badge {$filesStore.currentFile.status}-status">
            {@html getStatusIcon($filesStore.currentFile.status)}
            <span>{$filesStore.currentFile.status.charAt(0).toUpperCase() + $filesStore.currentFile.status.slice(1)}</span>
          </span>
        {/if}
        {#if $filesStore.currentFile.dirty}
          <span class="file-modified-indicator"></span>
          {#if $filesStore.saving}
            <span class="file-status-text">Saving...</span>
          {/if}
        {:else if $filesStore.currentFile.lastSaved}
          <span class="file-status-text">
            Saved at {formatTime($filesStore.currentFile.lastSaved)}
          </span>
        {/if}
      {:else}
        <span>No file selected</span>
      {/if}
    </div>

    <div class="header-actions">
      {#if $filesStore.running}
        <span class="running-indicator">
          <svg class="spinner" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <circle class="spinner-track" cx="12" cy="12" r="10" />
            <circle class="spinner-circle" cx="12" cy="12" r="10" />
          </svg>
          Running test...
        </span>
      {/if}
      {#if $filesStore.currentFile}
        <button class="share-button" on:click={copyShareUrl} title="Copy shareable link">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
          Share
        </button>
      {/if}
      <div class="auto-save-toggle">
        <label class="auto-save-label">
          <input
            type="checkbox"
            checked={autoSaveEnabled}
            on:click={() => {
              try {
                autoSaveEnabled = !autoSaveEnabled;
                localStorage.setItem('autoSaveEnabled', String(autoSaveEnabled));
                console.log('Auto-save toggled to:', autoSaveEnabled);
              } catch (err) {
                console.error('Error toggling auto-save:', err);
              }
            }}
            id="auto-save-checkbox"
          />
          <span>Auto-Save</span>
        </label>
      </div>
      <div class="action-buttons">
        <button
          class="save-button"
          on:click={saveFile}
          disabled={!$filesStore.currentFile || !$filesStore.currentFile.dirty || $filesStore.saving}
        >
          Save
        </button>
        <button
          class="run-button"
          on:click={runTest}
          disabled={!$filesStore.currentFile || $filesStore.running}
        >
          Run
        </button>
      </div>
    </div>
  </div>

  <!-- Editor content -->
  <div class="editor-content">
    {#if !$filesStore.currentFile}
      <div class="editor-empty">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
          <path d="M10 9H8" />
        </svg>
        <p>Select a file from the sidebar or create a new one</p>
      </div>
    {:else if testStructure}
      <!-- New structured format rendering -->
      <div class="test-structure">
        {#if testStructure.description}
          <div class="test-description">
            <h3>Description</h3>
            <p>{testStructure.description}</p>
          </div>
        {/if}

        <!-- Render the converted commands using the Step component -->
        <div class="command-list">
          {#each commands as command, i (command.stepIndex || i)}
            {@const displayNumber = command.isNested ?
              (commands.slice(0, i).filter(c => c.isNested && c.nestingLevel === command.nestingLevel && JSON.stringify(c.stepPath.slice(0, -1)) === JSON.stringify(command.stepPath.slice(0, -1))).length + 1) :
              (commands.slice(0, i).filter(c => !c.isNested).length + 1)
            }
            <Step 
              {command} 
              index={i} 
              {displayNumber}
              {wasmLoaded}
              {patternMatcher}
              on:updateCommand={(e) => updateStructuredCommand(e.detail.index, e.detail.newValue)}
              on:updateExpectedOutput={(e) => updateStructuredExpectedOutput(e.detail.index, e.detail.newValue)}
              on:toggleExpansion={(e) => toggleBlockExpansion(e.detail.index)}
              on:addCommand={(e) => addCommand(e.detail.index, e.detail.type)}
              on:deleteCommand={(e) => deleteCommand(e.detail.index)}
            />
          {/each}

          <!-- Add first command button if no commands -->
          {#if commands.length === 0}
            <div class="no-commands">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <h3>No Commands Yet</h3>
              <p>Add your first item to start building your test</p>
              <div class="first-command-buttons">
                <button
                  class="add-first-command-button"
                  on:click={() => addCommand(0, 'command')}
                  aria-label="Add first command"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  Add Command
                </button>

                <button
                  class="add-first-block-button"
                  on:click={() => addCommand(0, 'block')}
                  aria-label="Add first block reference"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                  </svg>
                  Add Block
                </button>

                <button
                  class="add-first-comment-button"
                  on:click={() => addCommand(0, 'comment')}
                  aria-label="Add first comment"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  Add Comment
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <!-- Fallback for files without structured data -->
      <div class="editor-empty">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
          <path d="M10 9H8" />
        </svg>
        <p>This file is not in the new structured format. Please reload or re-parse the file.</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .file-status-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 500;
  }

  .file-status-text {
    font-size: 12px;
    color: var(--color-text-tertiary);
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .action-buttons {
    display: flex;
    gap: 8px;
  }

  .save-button, .run-button, .share-button {
    padding: 6px 12px;
    font-size: 14px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    border: none;
    transition: background-color 0.2s ease-in-out;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .save-button {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .run-button {
    background-color: var(--color-bg-accent);
    color: white;
  }

  .share-button {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .save-button:disabled, .run-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .save-button:not(:disabled):hover, .share-button:hover {
    background-color: var(--color-bg-secondary-hover);
  }

  .run-button:not(:disabled):hover {
    color: var(--color-text-primary);
    background-color: var(--color-bg-accent-hover);
  }

  .auto-save-toggle {
    display: flex;
    align-items: center;
    padding: 3px 6px;
    background-color: rgba(0, 0, 0, 0.05);
    border-radius: 4px;
  }

  .auto-save-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .auto-save-label input {
    cursor: pointer;
    margin: 0;
    width: 16px;
    height: 16px;
  }

  @media (prefers-color-scheme: dark) {
    .auto-save-toggle {
      background-color: rgba(255, 255, 255, 0.1);
    }
  }

  .file-modified-indicator {
    width: 8px;
    height: 8px;
    background-color: var(--color-bg-accent);
    border-radius: 50%;
  }

  .running-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--color-text-accent);
  }

  .spinner {
    width: 16px;
    height: 16px;
    animation: spin 1.5s linear infinite;
  }

  .spinner-track {
    fill: none;
    stroke: var(--color-border-light);
    stroke-width: 2px;
  }

  .spinner-circle {
    fill: none;
    stroke: var(--color-bg-accent);
    stroke-width: 2px;
    stroke-linecap: round;
    stroke-dasharray: 60;
    stroke-dashoffset: 20;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .command-status {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 12px;
    margin-left: 8px;
  }

  /* Status-specific styles */
  .pending-status {
    background-color: var(--color-bg-pending, #e2e8f0);
    color: var(--color-text-pending, #64748b);
  }

  .matched-status {
    background-color: var(--color-bg-success, #dcfce7);
    color: var(--color-text-success, #16a34a);
  }

  .success-status {
    background-color: var(--color-bg-success, #dcfce7);
    color: var(--color-text-success, #16a34a);
  }

  .failed-status {
    background-color: var(--color-bg-error, #fee2e2);
    color: var(--color-text-error, #dc2626);
  }

  .passed-status {
    background-color: var(--color-bg-success, #dcfce7);
    color: var(--color-text-success, #16a34a);
  }

  .block-status {
    background-color: var(--color-bg-info, #e0f2fe);
    color: var(--color-text-info, #0369a1);
  }

  .command-duration {
    font-size: 12px;
    color: var(--color-text-tertiary);
    margin-left: 8px;
    font-weight: normal;
  }

  .block-source {
    font-size: 11px;
    color: var(--color-text-info, #0369a1);
    background-color: rgba(186, 230, 253, 0.4); /* Very light blue */
    padding: 0 6px;
    border-radius: 4px;
    margin-left: 8px;
    display: inline-block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 150px;
  }

  @media (prefers-color-scheme: dark) {
    .block-source {
      background-color: rgba(186, 230, 253, 0.15); /* Darker very light blue */
      color: #7dd3fc; /* Lighter blue in dark mode */
    }
  }

  /* Command card with failed status */
  .command-card.failed-command {
    border: 2px solid var(--color-text-error, #dc2626);
    box-shadow: 0 0 8px rgba(220, 38, 38, 0.3);
  }

  /* Block command styling */
  .command-card.block-command {
    border-left: 5px solid var(--color-bg-info, #0ea5e9);
    background-color: rgba(224, 242, 254, 0.25); /* Light blue background */
  }

  /* Block command with failed status should have red border-left */
  .command-card.block-command.failed-command {
    border-left: 5px solid var(--color-text-error, #dc2626);
  }

  /* Command from a block (isBlockCommand) styling */
  .command-card.is-block-command {
    border-left: 3px solid var(--color-bg-info, #0ea5e9);
    margin-left: 12px;
    width: calc(100% - 12px);
  }

  /* Failed command from a block */
  .command-card.is-block-command.failed-command {
    border-left: 3px solid var(--color-text-error, #dc2626);
  }

  /* Output styling */
  .failed-output {
    white-space: pre-wrap;
  }

  /* WASM Diff specific styles */
  .wasm-diff {
    font-family: monospace;
    white-space: pre-wrap;
    line-height: 1.5;
  }

  /* Git-style diff highlighting */
  .highlight-diff {
    background-color: #fecaca; /* light red background */
    color: #991b1b; /* dark red text */
    padding: 1px 0;
    font-weight: bold;
    border-bottom: 1px dashed #dc2626;
  }

  .highlight-line {
    background-color: #fef2f2; /* very light red */
    display: block;
    width: 100%;
    border-left: 3px solid #ef4444;
    padding-left: 4px;
    margin-left: -7px;
  }

  .diff-added-line {
    background-color: #ecfdf5; /* green-50 */
    display: block;
    width: 100%;
    border-left: 3px solid #10b981;
    padding-left: 4px;
    margin-left: -7px;
  }

  .diff-matched-line {
    background-color: #f0fdf4; /* lighter green */
    display: block;
    width: 100%;
    border-left: 3px solid #22c55e;
    padding-left: 4px;
    margin-left: -7px;
    color: #15803d;
  }

  .diff-removed-line {
    background-color: #fee2e2; /* light red background */
    display: block;
    width: 100%;
    border-left: 3px solid #dc2626;
    padding-left: 4px;
    margin-left: -7px;
    color: #b91c1e;
  }

  .plain-output {
    font-family: monospace;
    white-space: pre-wrap;
    line-height: 1.5;
  }

  /* Fallback diff note if needed */
  .diff-note {
    display: block;
    margin-top: 8px;
    padding: 4px 8px;
    background-color: #f3f4f6; /* gray-100 */
    border-left: 3px solid #6b7280;
    color: #4b5563;
    font-style: italic;
    border-radius: 0 4px 4px 0;
  }

  @media (prefers-color-scheme: dark) {
    .command-card.failed-command {
      border: 2px solid var(--color-text-error, #ef4444);
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
    }

    .diff-note {
      background-color: rgba(75, 85, 99, 0.2);
      border-left: 3px solid #6b7280;
      color: #d1d5db;
    }

    .diff-added-line {
      background-color: rgba(16, 185, 129, 0.1);
      border-left: 3px solid #10b981;
    }

    .diff-matched-line {
      background-color: rgba(34, 197, 94, 0.1);
      border-left: 3px solid #22c55e;
      color: #4ade80;
    }

    .diff-removed-line {
      background-color: rgba(220, 38, 38, 0.1);
      border-left: 3px solid #dc2626;
    }

    .highlight-diff {
      background-color: rgba(239, 68, 68, 0.25);
      color: #fca5a5;
      border-bottom: 1px dashed #ef4444;
    }

    .highlight-line {
      background-color: rgba(239, 68, 68, 0.1);
      border-left: 3px solid #ef4444;
    }
  }

  /* Simple auto-resize styles preserving original appearance */
  .command-input, .expected-output {
    width: 100%;
    resize: vertical;
    font-family: monospace;
    padding: 8px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background-color: var(--color-bg-textarea);
    color: var(--color-text-primary);
    transition: border-color 0.2s ease-in-out;
    line-height: 1.5;
    overflow-y: hidden;
  }

  .command-input:focus, .expected-output:focus {
    outline: none;
    border-color: var(--color-bg-accent);
    box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.2);
  }

  .actual-output {
    width: 100%;
    white-space: pre-wrap;
    font-family: monospace;
    padding: 8px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    line-height: 1.5;
    max-height: 200px;
    overflow-y: auto;
    cursor: pointer;
  }

  .actual-output.expanded {
    max-height: none;
  }

  .output-grid {
    display: flex;
    width: 100%;
    gap: 12px;
    margin-top: 12px;
  }

  .output-column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .output-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .output-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .expected-indicator {
    background-color: var(--color-bg-pending, #e2e8f0);
  }

  .actual-indicator {
    background-color: var(--color-bg-accent, #5046e4);
  }

  .no-output-message {
    color: var(--color-text-tertiary);
    font-style: italic;
    font-size: 0.9em;
  }

  .duration-footer {
    display: block;
    margin-top: 8px;
    padding-top: 4px;
    font-size: 12px;
    color: var(--color-text-tertiary);
    border-top: 1px solid var(--color-border-light);
    text-align: center;
  }
  .add-command-button, .add-block-button, .add-comment-button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--color-border);
    background-color: var(--color-bg-secondary);
    color: var(--color-text-secondary);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 12px;
  }

  .add-commands-row {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin: 8px 0;
  }

  .add-command-button:hover, .add-block-button:hover, .add-comment-button:hover {
    background-color: var(--color-bg-accent);
    color: white;
    border-color: var(--color-bg-accent);
  }

  .first-command-buttons {
    display: flex;
    gap: 10px;
    margin-top: 15px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .add-first-command-button, .add-first-block-button, .add-first-comment-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background-color: var(--color-bg-accent);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .add-first-command-button:hover, .add-first-block-button:hover, .add-first-comment-button:hover {
    background-color: var(--color-bg-accent-hover);
  }

  /* Structured format styles */
  .structured-format-note {
    font-size: 12px;
    color: var(--color-text-tertiary);
    font-style: italic;
  }

  .command-display {
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 8px;
    font-family: monospace;
    white-space: pre-wrap;
    line-height: 1.5;
  }

  .command-display.comment-display {
    background-color: var(--color-bg-comment, #f8f9fa);
    border-left: 4px solid var(--color-border-comment, #6c757d);
  }

  .expected-output-display {
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 8px;
    font-family: monospace;
    white-space: pre-wrap;
    line-height: 1.5;
    min-height: 24px;
  }

  .test-description {
    margin-bottom: 20px;
    padding: 16px;
    background-color: var(--color-bg-secondary);
    border-radius: 8px;
    border-left: 4px solid var(--color-bg-accent);
  }

  .test-description h3 {
    margin: 0 0 8px 0;
    color: var(--color-text-primary);
    font-size: 16px;
  }

  .test-description p {
    margin: 0;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  /* Nested command styling */
  .nested-command {
    border-left: 3px solid var(--color-bg-info, #0ea5e9);
    background-color: rgba(224, 242, 254, 0.15);
    position: relative;
  }

  .nested-command::before {
    content: '';
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 3px;
    background: linear-gradient(to bottom, var(--color-bg-info, #0ea5e9), rgba(224, 242, 254, 0.3));
  }

  /* Expand button styling */
  .expand-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    margin-left: 8px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    color: var(--color-text-secondary);
  }

  .expand-button:hover {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .expand-icon {
    transition: transform 0.2s ease;
  }

  .expand-icon.expanded {
    transform: rotate(90deg);
  }

  /* Enhanced block command styling for better nesting visualization */
  .command-card.block-command {
    border-left: 5px solid var(--color-bg-info, #0ea5e9);
    background-color: rgba(224, 242, 254, 0.25);
    position: relative;
  }

  .command-card.block-command.expanded {
    border-bottom: 2px solid var(--color-bg-info, #0ea5e9);
  }

  /* Nested command numbering adjustment */
  .nested-command .command-number {
    background-color: rgba(224, 242, 254, 0.8);
    color: var(--color-text-info, #0369a1);
    border: 1px solid var(--color-bg-info, #0ea5e9);
  }</style>
