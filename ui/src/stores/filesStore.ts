import { writable } from 'svelte/store';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

interface RecordingCommand {
  command: string;
  expectedOutput?: string;
  actualOutput?: string;
  status?: 'pending' | 'matched' | 'failed';
  changed?: boolean; // Track whether this command has been changed
}

interface RecordingFile {
  path: string;
  commands: RecordingCommand[];
  dirty: boolean;
  lastSaved?: Date;
  status?: 'pending' | 'passed' | 'failed';
}

interface FilesState {
  fileTree: FileNode[];
  currentFile: RecordingFile | null;
  configDirectory: string;
  dockerImage: string;
  saving: boolean;
  running: boolean;
}

const defaultState: FilesState = {
  fileTree: [],
  currentFile: null,
  configDirectory: '',
  dockerImage: 'ghcr.io/manticoresoftware/manticoresearch:test-kit-latest',
  saving: false,
  running: false
};

function createFilesStore() {
  const { subscribe, set, update } = writable<FilesState>(defaultState);

  const saveFileToBackend = async (file: RecordingFile) => {
    // Format the file content according to the .rec format
    let content = '';
    
    file.commands.forEach((cmd, index) => {
      // Add newline before input section if not the first command
      if (index > 0) {
        content += '\n';
      }
      
      content += '––– input –––\n';
      content += cmd.command + '\n';
      content += '––– output –––\n';
      
      // Use the expected output if provided, otherwise use actual output if available
      const outputToSave = cmd.expectedOutput || cmd.actualOutput || '';
      content += outputToSave;
      
      // Do not add extra trailing newlines
      // This ensures exact output matching without extra whitespace
    });
    
    try {
      const response = await fetch('/api/save-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          path: file.path,
          content
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to save file: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error saving file:', error);
      throw error;
    }
  };

  const runTest = async (filePath: string, dockerImage: string) => {
    try {
      const response = await fetch('/api/run-test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filePath,
          dockerImage
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to run test: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      // Update the commands with expected outputs if they don't already have them
      if (result.commands && result.commands.length > 0) {
        update(state => {
          if (!state.currentFile) return state;
          
          // Map the current commands with updated expected outputs from rep file if empty
          const updatedCommands = state.currentFile.commands.map((cmd, index) => {
            // Find matching command in rep file results
            const matchingRepCmd = result.commands.find(repCmd => repCmd.command === cmd.command);
            
            // Only use the rep file's expected output if the current one is empty
            const expectedOutput = cmd.expectedOutput || (matchingRepCmd ? matchingRepCmd.expectedOutput : '');
            
            // Check if the expected output was updated
            const wasUpdated = !cmd.expectedOutput && matchingRepCmd && matchingRepCmd.expectedOutput;
            
            return {
              ...cmd,
              expectedOutput
            };
          });
          
          // Create updated file with dirty flag if any outputs were updated
          const updatedFile = {
            ...state.currentFile,
            commands: updatedCommands,
            dirty: true
          };
          
          // Trigger autosave if outputs were updated
          debouncedSave(updatedFile);
          
          return {
            ...state,
            currentFile: updatedFile
          };
        });
      }
      
      return result;
    } catch (error) {
      console.error('Error running test:', error);
      throw error;
    }
  };

  // Debounce function for autosave
  let saveTimeout: number | null = null;
  const debouncedSave = (file: RecordingFile, forceRun: boolean = false) => {
    // Cancel any pending saves
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    
    // Check if any commands have actually changed
    const hasChanges = file.commands.some(cmd => cmd.changed);
    
    // Check if auto-save is enabled (default to true if not set)
    const storedValue = localStorage.getItem('autoSaveEnabled');
    const autoSaveEnabled = storedValue === null ? true : storedValue === 'true';
    
    // If nothing has changed and this isn't a forced save, just exit
    if (!hasChanges && !forceRun) {
      console.log('No changes detected, skipping save');
      return;
    }
    
    // If auto-save is disabled and this is not a forced save, just mark as dirty
    if (!autoSaveEnabled && !forceRun) {
      update(state => ({
        ...state,
        currentFile: state.currentFile ? {
          ...state.currentFile,
          dirty: true
        } : null
      }));
      return;
    }
    
    // Set a reasonable debounce to avoid too many saves
    saveTimeout = setTimeout(async () => {
      console.log('Saving file...', hasChanges ? 'Changes detected' : 'No changes but forced');
      update(state => ({ ...state, saving: true }));
      
      try {
        await saveFileToBackend(file);
        
        // After save completes, clear changed flags
        const resetCommands = file.commands.map(cmd => ({
          ...cmd,
          changed: false // Reset the changed flag after saving
        }));
        
        update(state => ({
          ...state,
          saving: false,
          currentFile: state.currentFile ? {
            ...state.currentFile,
            commands: resetCommands,
            dirty: false,
            lastSaved: new Date()
          } : null
        }));
        
        // After saving, run the test if auto-save is enabled or force run is requested
        if ((autoSaveEnabled || forceRun) && hasChanges) {
          await runCurrentTest();
        }
      } catch (error) {
        update(state => ({ ...state, saving: false }));
        console.error('Failed to save file:', error);
      }
    }, 500); // Shorter debounce time
  };
  
  const runCurrentTest = async () => {
    const state = getState();
    if (!state.currentFile || state.running) return;
    
    // Check if auto-save is enabled (default to true if not set)
    const storedValue = localStorage.getItem('autoSaveEnabled');
    const autoSaveEnabled = storedValue === null ? true : storedValue === 'true';
    
    // If auto-save is disabled, don't automatically run tests
    if (!autoSaveEnabled && !state.currentFile.dirty) return;
    
    update(state => ({ ...state, running: true }));
    
    try {
      const result = await runTest(state.currentFile.path, state.dockerImage);
      
      update(state => {
        if (!state.currentFile) return state;
        
        // If we have commands from the result, use them directly
        // They already have status and actual outputs from backend
        const commands = result.commands || [];
        
        // Determine overall file status - prioritize exit code success over command status
        const exitCodeSuccess = result.exitCodeSuccess === true;
        const allPassed = exitCodeSuccess || (
          typeof result.success !== 'undefined' 
          ? result.success 
          : commands.every(cmd => cmd.status !== 'failed')
        );
        
        console.log('File status determination:', { 
          exitCodeSuccess, 
          resultSuccess: result.success, 
          commandsAllPassed: commands.every(cmd => cmd.status !== 'failed')
        });
          
        const anyRun = commands.some(cmd => cmd.status !== 'pending');
        
        // Create updated file with commands and mark as dirty to ensure it gets saved
        const updatedFile = {
          ...state.currentFile,
          commands,
          status: anyRun ? (allPassed ? 'passed' : 'failed') : 'pending',
          dirty: true
        };
        
        // Trigger autosave to ensure outputs are saved to file
        debouncedSave(updatedFile);
        
        // Show any test execution errors as console warnings (not fatal errors)
        if (result.error) {
          console.warn('Test completed with differences:', result.error);
        }
        
        if (result.stderr) {
          console.warn('Test stderr:', result.stderr);
        }
        
        return {
          ...state,
          running: false,
          currentFile: updatedFile
        };
      });
    } catch (error) {
      console.error('Failed to run test:', error);
      update(state => ({ ...state, running: false }));
      // Even if the API call fails, we shouldn't block the UI
    }
  };
  
  // Helper to get current state
  const getState = (): FilesState => {
    let currentState: FilesState = defaultState;
    subscribe(state => { currentState = state; })();
    return currentState;
  };

  return {
    subscribe,
    setConfigDirectory: (directory: string) => update(state => ({
      ...state,
      configDirectory: directory
    })),
    setDockerImage: (image: string) => update(state => ({
      ...state,
      dockerImage: image
    })),
    setFileTree: (tree: FileNode[]) => update(state => ({
      ...state,
      fileTree: tree
    })),
    loadFile: async (path: string, commands: RecordingCommand[]) => {
      update(state => ({
        ...state,
        currentFile: {
          path,
          commands,
          dirty: false,
          status: 'pending'
        }
      }));
      
      // Run test immediately after loading
      await runCurrentTest();
    },
    addCommand: (index: number, command: string) => update(state => {
      if (!state.currentFile) return state;
      
      const newCommands = [...state.currentFile.commands];
      newCommands.splice(index, 0, { 
        command, 
        expectedOutput: '', 
        status: 'pending',
        changed: true // Mark as changed
      });
      
      const updatedFile = {
        ...state.currentFile,
        commands: newCommands,
        dirty: true
      };
      
      // Trigger autosave with forceRun=false
      debouncedSave(updatedFile, false);
      
      return {
        ...state,
        currentFile: updatedFile
      };
    }),
    updateCommand: (index: number, command: string) => update(state => {
      if (!state.currentFile) return state;
      
      const newCommands = [...state.currentFile.commands];
      // Check if the command has actually changed
      if (newCommands[index].command === command) return state;
      
      newCommands[index] = { 
        ...newCommands[index], 
        command, 
        status: 'pending',
        changed: true // Mark as changed
      };
      
      const updatedFile = {
        ...state.currentFile,
        commands: newCommands,
        dirty: true
      };
      
      // Trigger autosave with forceRun=false
      debouncedSave(updatedFile, false);
      
      return {
        ...state,
        currentFile: updatedFile
      };
    }),
    updateExpectedOutput: (index: number, expectedOutput: string) => update(state => {
      if (!state.currentFile) return state;
      
      const newCommands = [...state.currentFile.commands];
      // Check if the expected output has actually changed
      if (newCommands[index].expectedOutput === expectedOutput) return state;
      
      newCommands[index] = { 
        ...newCommands[index], 
        expectedOutput, 
        status: 'pending',
        changed: true // Mark as changed
      };
      
      const updatedFile = {
        ...state.currentFile,
        commands: newCommands,
        dirty: true
      };
      
      // Trigger autosave with forceRun=false
      debouncedSave(updatedFile, false);
      
      return {
        ...state,
        currentFile: updatedFile
      };
    }),
    deleteCommand: (index: number) => update(state => {
      if (!state.currentFile) return state;
      
      const newCommands = [...state.currentFile.commands];
      newCommands.splice(index, 1);
      
      // Mark the file as having changes
      const updatedFile = {
        ...state.currentFile,
        commands: newCommands,
        dirty: true,
        changed: true // Mark entire file as changed when deleting commands
      };
      
      // Trigger autosave with forceRun=false
      debouncedSave(updatedFile, true); // Force run since this is a significant change
      
      return {
        ...state,
        currentFile: updatedFile
      };
    }),
    forceSave: async () => {
      const state = getState();
      if (!state.currentFile) return;
      
      // Always force run when using the Save & Run button
      update(state => ({ ...state, saving: true }));
      
      try {
        // Mark all commands as changed
        const commandsWithChanged = state.currentFile.commands.map(cmd => ({
          ...cmd,
          changed: true
        }));
        
        const updatedFile = {
          ...state.currentFile,
          commands: commandsWithChanged,
          dirty: true
        };
        
        await saveFileToBackend(updatedFile);
        
        update(state => ({
          ...state,
          saving: false,
          currentFile: state.currentFile ? {
            ...state.currentFile,
            commands: state.currentFile.commands.map(cmd => ({
              ...cmd,
              changed: false // Reset changed flag
            })),
            dirty: false,
            lastSaved: new Date()
          } : null
        }));
        
        // Always run test after manual save
        await runCurrentTest();
      } catch (error) {
        update(state => ({ ...state, saving: false }));
        console.error('Failed to save file:', error);
      }
    },
    createNewFile: (path: string) => {
      const newFile = {
        path,
        commands: [],
        dirty: true,
        status: 'pending'
      };
      
      // New files should be saved immediately
      update(state => ({
        ...state,
        currentFile: newFile
      }));
      
      // Force save since this is a new file
      setTimeout(() => {
        debouncedSave(newFile, true);
      }, 0);
    },
    runTest: runCurrentTest
  };
}

export const filesStore = createFilesStore();
export type { FileNode, RecordingCommand, RecordingFile };