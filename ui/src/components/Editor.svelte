<script lang="ts">
  import { filesStore, validateTestContent, type TestStep as TestStepType, type TestStructure } from '../stores/filesStore';
  import { gitStatusStore } from '../stores/gitStatusStore';
  import { onMount, onDestroy } from 'svelte';
  import SimpleCodeMirror from './SimpleCodeMirror.svelte';
  import Step from './Step.svelte';
  import GitChangesPanel from './GitChangesPanel.svelte';
  import FileEditorModal from './FileEditorModal.svelte';
  import {
    initWasm,
    wasmLoadedStore,
    patternMatcherStore,
    convertStructuredToCommands,
    updateStructuredCommand,
    updateStructuredExpectedOutput
  } from './EditorLogic.js';

  // Add global TypeScript interface for window
  declare global {
    interface Window {
      patternMatcher: any;
      lastPatternRefresh: number;
    }
  }

  let commands: any[] = [];
  let autoSaveEnabled = true;
  let gitPanelVisible = false;
  let showFileEditor = false;

  // Reactive statement to check if current file is running
  $: isCurrentFileRunning = $filesStore.currentFile ? $filesStore.runningTests.has($filesStore.currentFile.path) : false;

  // Debug reactive statement
  $: {
    console.log('🔍 Reactive check:', {
      currentFile: $filesStore.currentFile?.path,
      runningTests: Array.from($filesStore.runningTests.keys()),
      isRunning: isCurrentFileRunning
    });
  }

  // Get WASM state from the reactive stores
  $: wasmLoaded = $wasmLoadedStore;
  $: patternMatcher = $patternMatcherStore;

  // Define testStructure for template usage
  $: testStructure = $filesStore.currentFile?.testStructure;

  // Preserve expanded states when commands are recreated
  function preserveExpandedStates(newCommands: any[], oldCommands: any[]) {
    return newCommands.map((newCmd, index) => {
      const oldCmd = oldCommands[index];
      if (oldCmd && oldCmd.isOutputExpanded !== undefined) {
        return { ...newCmd, isOutputExpanded: oldCmd.isOutputExpanded };
      }
      return newCmd;
    });
  }

  $: {
    const newCommands = $filesStore.currentFile?.testStructure
      ? convertStructuredToCommands($filesStore.currentFile.testStructure)
      : ($filesStore.currentFile?.commands || []);

    // Preserve expanded states from previous commands array
    commands = preserveExpandedStates(newCommands, commands || []);
  }

  // Debug logging
  $: {
    console.log('DEBUG: currentFile:', $filesStore.currentFile);
    console.log('DEBUG: testStructure:', $filesStore.currentFile?.testStructure);
    console.log('DEBUG: converted commands:', commands);
  }

  // Reactive validation state for Run button
  $: isValidTest = $filesStore.currentFile && validateTestContent($filesStore.currentFile.testStructure);

  // Wrapper functions to pass testStructure and commands to extracted logic
  function handleUpdateCommand(commandIndex: number, newValue: string) {
    updateStructuredCommand(testStructure, commandIndex, commands, newValue);
  }

  function handleUpdateExpectedOutput(commandIndex: number, newValue: string) {
    updateStructuredExpectedOutput(testStructure, commandIndex, commands, newValue);
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

    // Start git status polling only if not already active
    if (!gitStatusStore.isPolling()) {
      gitStatusStore.startPolling(5000); // Poll every 5 seconds
    }
  });

  onDestroy(() => {
    // Don't stop polling here since other components might need it
    // Let Header.svelte manage the main polling lifecycle
  });

  // Update localStorage when checkbox changes
  function toggleAutoSave() {
    autoSaveEnabled = !autoSaveEnabled;
    localStorage.setItem('autoSaveEnabled', String(autoSaveEnabled));
    console.log('Auto-save set to:', autoSaveEnabled);
  }

  function addCommand(index: number, commandType: 'command' | 'block' | 'comment' = 'command') {
    if (!testStructure) {
      filesStore.addCommand(index, '', commandType);
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
        args: [],
        content: null,
        steps: [],
        status: 'pending',
        isExpanded: false
      }];
    } else if (commandType === 'comment') {
      newSteps = [{
        type: 'comment',
        args: [],
        content: '',
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

  // Handle different types of toggle expansion
  function handleToggleExpansion(detail: { index: number; expanded?: boolean }) {
    const { index, expanded } = detail;

    console.log('EDITOR handleToggleExpansion', { index, expanded, currentState: commands[index]?.isOutputExpanded });

    if (expanded !== undefined) {
      // This is output expansion - update the command's isOutputExpanded property
      if (index >= 0 && index < commands.length) {
        commands[index] = { ...commands[index], isOutputExpanded: expanded };
        // Trigger reactivity
        commands = commands;
        console.log('EDITOR updated command expanded state', { index, expanded, newState: commands[index].isOutputExpanded });
      }
    } else {
      // This is block expansion
      toggleBlockExpansion(index);
    }
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
      filesStore.runCurrentTest();
    }
  }

  function stopTest() {
    try {
      filesStore.stopCurrentTest();
    } catch (error) {
      console.error('Error stopping test:', error);
    }
  }



  // Get git status for current file - make it reactive by accessing the store directly
  $: currentFileGitStatus = $filesStore.currentFile && $gitStatusStore.modifiedFiles
    ? (() => {
        const currentFilePath = $filesStore.currentFile.path;
        const testPath = $gitStatusStore.testPath || 'test/clt-tests';
        const fullFilePath = `${testPath}/${currentFilePath}`;

        // Try both the original path and the prefixed path
        const fileStatus = $gitStatusStore.modifiedFiles.find(file =>
          file.path === currentFilePath || file.path === fullFilePath
        );
        return fileStatus?.status || null;
      })()
    : null;

  function formatTime(date: Date): string {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

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

  function getStatusIcon(status: string | undefined) {
    // Create different status indicators for different item types
    if (status === 'matched' || status === 'success') {
      return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
      </svg>`;
    }
    if (status === 'failed') {
      return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
      </svg>`;
    }
    if (status === 'block' || status === 'pending') {
      // Use a different icon for blocks - file icon is more appropriate for blocks, clock for pending
      const isBlock = status === 'block';
      const isPending = status === 'pending';

      if (isBlock) {
        return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
          </svg>`;
      } else {
        return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />
          </svg>`;
      }
    }
    return ''; // Return empty string for unknown statuses
  }

  function openFileEditor() {
    if ($filesStore.currentFile) {
      showFileEditor = true;
    }
  }

  function closeFileEditor() {
    showFileEditor = false;
  }
</script>

<div class="editor">
  <div class="editor-main" class:with-git-panel={gitPanelVisible}>
    <!-- Header -->
    <div class="editor-header">
    <div class="file-info">
      {#if $filesStore.currentFile}
        <span class="file-path">{$filesStore.currentFile.path}</span>
        {#if $filesStore.currentFile.status}
          <span class="file-status-badge {$filesStore.currentFile.status}-status">
            {@html getStatusIcon($filesStore.currentFile.status)}
            <span>{$filesStore.currentFile.status.charAt(0).toUpperCase() + $filesStore.currentFile.status.slice(1)}</span>
            {#if isCurrentFileRunning}
              <svg class="status-spinner" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31.416" stroke-dashoffset="31.416">
                  <animate attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416" repeatCount="indefinite"/>
                  <animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416" repeatCount="indefinite"/>
                </circle>
              </svg>
            {/if}
          </span>
        {/if}
        {#if isCurrentFileRunning}
          <span class="running-status">
            <svg class="spinner" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <circle class="spinner-track" cx="12" cy="12" r="10" />
              <circle class="spinner-circle" cx="12" cy="12" r="10" />
            </svg>
            <span>Running...</span>
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
      {#if filesStore.isCurrentFileRunning()}
        <span class="running-indicator">
          <svg class="spinner" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <circle class="spinner-track" cx="12" cy="12" r="10" />
            <circle class="spinner-circle" cx="12" cy="12" r="10" />
          </svg>
          Running test...
        </span>
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
          class="edit-file-button"
          on:click={openFileEditor}
          disabled={!$filesStore.currentFile}
          title="Edit raw file content"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button
          class="git-panel-toggle"
          on:click={() => gitPanelVisible = !gitPanelVisible}
          class:active={gitPanelVisible}
          title="Toggle Git Changes Panel"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
          </svg>
        </button>
        <button
          class="save-button"
          on:click={saveFile}
          disabled={!$filesStore.currentFile || !$filesStore.currentFile.dirty || $filesStore.saving}
        >
          Save
        </button>

        {#if isCurrentFileRunning}
          <button
            class="stop-button"
            on:click={stopTest}
            disabled={!$filesStore.currentFile}
          >
            Stop Test
          </button>
        {:else}
          <button
            class="run-button"
            on:click={runTest}
            disabled={!$filesStore.currentFile || !isValidTest}
            title={!isValidTest ? "Test contains empty commands or invalid content" : "Run test"}
          >
            Run Test
          </button>
        {/if}
      </div>
    </div>
  </div>

  <!-- Editor content -->
  <div class="editor-content" class:running={isCurrentFileRunning}>
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
              isRunning={isCurrentFileRunning}
              on:updateCommand={(e) => handleUpdateCommand(e.detail.index, e.detail.newValue)}
              on:updateExpectedOutput={(e) => handleUpdateExpectedOutput(e.detail.index, e.detail.newValue)}
              on:toggleExpansion={(e) => handleToggleExpansion(e.detail)}
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

  <!-- Git Changes Panel -->
  <GitChangesPanel
    bind:visible={gitPanelVisible}
    currentFilePath={$filesStore.currentFile?.path || null}
    onClose={() => gitPanelVisible = false}
  />

  <!-- File Editor Modal -->
  <FileEditorModal
    bind:visible={showFileEditor}
    filePath={$filesStore.currentFile?.path || null}
    fileName={$filesStore.currentFile?.path ? $filesStore.currentFile.path.split('/').pop() : ''}
    on:close={closeFileEditor}
  />
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
    align-items: center;
  }

  .git-panel-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-text-secondary);
    transition: all 0.2s ease;
  }

  .git-panel-toggle:hover {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
    border-color: var(--color-bg-accent);
  }

  .git-panel-toggle.active {
    background-color: var(--color-bg-accent);
    color: white;
    border-color: var(--color-bg-accent);
  }

  .git-panel-toggle svg {
    width: 16px;
    height: 16px;
  }

  .save-button, .run-button, .checkout-button {
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

  .save-button, .checkout-button {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .run-button {
    background-color: var(--color-bg-accent);
    color: white;
  }

  .save-button:disabled, .run-button:disabled, .checkout-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .save-button:not(:disabled):hover, .checkout-button:not(:disabled):hover, .share-button:hover {
    background-color: var(--color-bg-secondary-hover);
  }

  .run-button:not(:disabled):hover {
    color: var(--color-text-primary);
    background-color: var(--color-bg-accent-hover);
  }

  .stop-button {
    padding: 6px 12px;
    background-color: #dc3545;
    color: white;
    border: 1px solid #dc3545;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .stop-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .stop-button:not(:disabled):hover {
    background-color: #c82333;
    border-color: #bd2130;
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

  .status-spinner {
    width: 12px;
    height: 12px;
    margin-left: 6px;
    opacity: 0.8;
  }

  .status-spinner circle {
    stroke: currentColor;
  }

  /* Simple running indicator */
  .running-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-bg-accent);
    font-weight: 500;
  }

  .running-status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-bg-accent);
    font-size: 13px;
    font-weight: 500;
  }

  .spinner {
    width: 16px;
    height: 16px;
    animation: spin 1.5s linear infinite;
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
  }

  .editor {
    display: flex;
    flex-direction: row;
    height: 100%;
    position: relative;
  }

  .editor-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    transition: margin-right 0.3s ease;
  }

  .editor-main.with-git-panel {
    margin-right: 400px;
  }

  .editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border);
    background-color: var(--color-bg-primary);
  }

  .editor-content {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
    transition: opacity 0.3s ease;
  }

  .editor-content.running {
    opacity: 0.6;
    pointer-events: none;
  }

  .editor-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--color-text-tertiary);
    text-align: center;
  }

  .editor-empty svg {
    width: 64px;
    height: 64px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  .file-path {
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .command-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .no-commands {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: var(--color-text-tertiary);
    text-align: center;
  }

  .no-commands svg {
    width: 48px;
    height: 48px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  .no-commands h3 {
    margin: 0 0 8px 0;
    font-size: 18px;
    color: var(--color-text-secondary);
  }

  .no-commands p {
    margin: 0 0 20px 0;
    font-size: 14px;
  }

  .edit-file-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-text-secondary);
    transition: all 0.2s ease;
  }

  .edit-file-button:hover:not(:disabled) {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .edit-file-button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .edit-file-button svg {
    width: 16px;
    height: 16px;
  }
</style>
