import { writable } from 'svelte/store';
import { API_URL } from '../config.js';

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
  initializing?: boolean; // Flag to hide output sections until test is run
  duration?: number; // Command execution duration
  isOutputExpanded?: boolean; // Track whether outputs are expanded
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
  let runModule: any; // Reference to the module itself for self-referencing

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
      const response = await fetch(`${API_URL}/api/save-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Add credentials for cookie passing
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
      const response = await fetch(`${API_URL}/api/run-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Add credentials for cookie passing
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
  const debouncedSave = (file: RecordingFile, shouldRunAfterSave: boolean = false) => {
    // Cancel any pending saves
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }

    // Always mark as dirty when there are changes
    update(state => ({
      ...state,
      currentFile: state.currentFile ? {
        ...state.currentFile,
        dirty: true
      } : null
    }));

    // Check if auto-save is enabled
    const storedValue = localStorage.getItem('autoSaveEnabled');
    const autoSaveEnabled = storedValue === null ? true : storedValue === 'true';

    // If auto-save is disabled and this isn't an explicit save request, don't proceed with save
    if (!autoSaveEnabled && !shouldRunAfterSave) {
      return;
    }

    // Use shorter debounce (500ms) for better responsiveness
    const debounceTime = 500;

    saveTimeout = setTimeout(async () => {
      update(state => ({ ...state, saving: true }));

      try {
        await saveFileToBackend(file);

        update(state => ({
          ...state,
          saving: false,
          currentFile: state.currentFile ? {
            ...state.currentFile,
            // Maintain the command structure - don't reset change flags!
            dirty: false,
            lastSaved: new Date()
          } : null
        }));

        // Run the test only if explicitly requested
        if (shouldRunAfterSave) {
          await runCurrentTest();
        }
      } catch (error) {
        update(state => ({ ...state, saving: false }));
        console.error('Failed to save file:', error);
      }
    }, debounceTime);
  };

  const runCurrentTest = async () => {
    const state = getState();
    if (!state.currentFile || state.running) return;

    update(state => ({ ...state, running: true }));

    try {
      const result = await runTest(state.currentFile.path, state.dockerImage);

      update(state => {
        if (!state.currentFile) return state;

        // Get the result commands
        const resultCommands = result.commands || [];

        // Preserve expected outputs by merging with current commands
        const mergedCommands = state.currentFile.commands.map((cmd, index) => {
          // Find matching command in results
          const matchingResultCmd = resultCommands.find(resultCmd =>
            resultCmd.command === cmd.command);

          if (!matchingResultCmd) {
            // If no matching command found, preserve original
            return cmd;
          }

          // Preserve expected output if it already exists
          return {
            ...cmd,
            actualOutput: matchingResultCmd.actualOutput, // This comes from the replay file
            status: matchingResultCmd.status,
            duration: matchingResultCmd.duration,
            initializing: false // Clear initializing flag once test is run
          };
        });

        // Determine overall file status
        const exitCodeSuccess = result.exitCodeSuccess === true;
        const allPassed = exitCodeSuccess || (
          typeof result.success !== 'undefined'
          ? result.success
          : mergedCommands.every(cmd => cmd.status !== 'failed')
        );

        const anyRun = mergedCommands.some(cmd => cmd.status !== 'pending');

        // Create updated file with commands
        const updatedFile = {
          ...state.currentFile,
          commands: mergedCommands,
          status: anyRun ? (allPassed ? 'passed' : 'failed') : 'pending',
        };

        return {
          ...state,
          running: false,
          currentFile: updatedFile
        };
      });
    } catch (error) {
      console.error('Failed to run test:', error);
      // Make sure we clear the running flag even if there's an error
      update(state => ({ ...state, running: false }));
    }
  };

  // Helper to get current state
  const getState = (): FilesState => {
    let currentState: FilesState = defaultState;
    subscribe(state => { currentState = state; })();
    return currentState;
  };
  
  // Helper function to find a node in the file tree
  const findNodeInTree = (tree: FileNode[], path: string): FileNode | null => {
    for (const node of tree) {
      if (node.path === path) {
        return node;
      }
      if (node.isDirectory && node.children) {
        const found = findNodeInTree(node.children, path);
        if (found) return found;
      }
    }
    return null;
  };
  
  // Helper function to remove a node from the file tree
  const removeNodeFromTree = (tree: FileNode[], path: string): FileNode[] => {
    return tree.filter(node => {
      if (node.path === path) {
        return false; // Remove this node
      }
      if (node.isDirectory && node.children) {
        node.children = removeNodeFromTree(node.children, path);
      }
      return true;
    });
  };
  
  // Helper function to optimistically add a node to the file tree
  const addNodeToDirectory = (tree: FileNode[], dirPath: string, newNode: FileNode): FileNode[] => {
    return tree.map(node => {
      if (node.path === dirPath && node.isDirectory) {
        // Found the directory, add the new node to its children
        return {
          ...node,
          children: [...(node.children || []), newNode]
        };
      }
      if (node.isDirectory && node.children) {
        // Recursively look in this directory's children
        return {
          ...node,
          children: addNodeToDirectory(node.children, dirPath, newNode)
        };
      }
      return node;
    });
  };

  // Create store instance
  const storeModule = {
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
    refreshFileTree: async () => {
      try {
        const response = await fetch(`${API_URL}/api/get-file-tree`, {
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch file tree: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Filter to only show the tests directory
        const testsNode = data.fileTree.find(node => node.name === 'tests');
        if (testsNode) {
          storeModule.setFileTree([testsNode]);
          return true;
        } else {
          storeModule.setFileTree([]);
          return false;
        }
      } catch (error) {
        console.error('Error refreshing file tree:', error);
        return false;
      }
    },
    moveFile: async (sourcePath: string, targetPath: string) => {
      try {
        // Get current state
        const state = getState();
        
        // Find the node to move
        const sourceNode = findNodeInTree(state.fileTree, sourcePath);
        if (!sourceNode) {
          throw new Error('Source file not found in file tree');
        }
        
        // Get target directory path (the parent folder)
        const targetDirPath = targetPath.substring(0, targetPath.lastIndexOf('/'));
        
        // Make a copy of the node to move
        const newNode = {
          ...sourceNode,
          path: targetPath,
          name: targetPath.split('/').pop() || ''
        };
        
        // Update the file tree optimistically
        update(state => {
          // Remove from its original location
          const newTree = removeNodeFromTree([...state.fileTree], sourcePath);
          
          // Add to the target directory
          const updatedTree = addNodeToDirectory(newTree, targetDirPath, newNode);
          
          return {
            ...state,
            fileTree: updatedTree
          };
        });
        
        // Now do the actual server request
        const response = await fetch(`${API_URL}/api/move-file`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            sourcePath,
            targetPath
          })
        });
        
        if (!response.ok) {
          // If server operation fails, refresh the file tree to restore correct state
          await storeModule.refreshFileTree();
          throw new Error(`Failed to move file: ${response.statusText}`);
        }
        
        // Update currentFile path if it was the moved file
        update(state => {
          if (state.currentFile && state.currentFile.path === sourcePath) {
            return {
              ...state,
              currentFile: {
                ...state.currentFile,
                path: targetPath
              }
            };
          }
          return state;
        });
        
        return true;
      } catch (error) {
        console.error('Error moving file:', error);
        return false;
      }
    },
    deleteFile: async (path: string) => {
      try {
        // Update UI optimistically
        update(state => {
          // Remove from file tree
          const newTree = removeNodeFromTree([...state.fileTree], path);
          
          // Update currentFile if it was the deleted file
          if (state.currentFile && state.currentFile.path === path) {
            return {
              ...state,
              fileTree: newTree,
              currentFile: null
            };
          }
          
          return {
            ...state,
            fileTree: newTree
          };
        });
        
        // Now do the actual server request
        const response = await fetch(`${API_URL}/api/delete-file`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ path })
        });
        
        if (!response.ok) {
          // If server operation fails, refresh the file tree to restore correct state
          await storeModule.refreshFileTree();
          throw new Error(`Failed to delete file: ${response.statusText}`);
        }
        
        return true;
      } catch (error) {
        console.error('Error deleting file:', error);
        return false;
      }
    },
    loadFile: async (path: string, commands: RecordingCommand[]) => {
      // Set initializing flag for all commands to hide output sections until test is run
      const commandsWithInitFlag = commands.map(cmd => ({
        ...cmd,
        status: cmd.status || 'pending', // Set default status to pending, not failed
        initializing: true
      }));

      // Update store first with the file data
      update(state => ({
        ...state,
        currentFile: {
          path,
          commands: commandsWithInitFlag,
          dirty: false,
          status: 'pending'
        }
      }));

      // Use a small delay to make sure the store update is complete
      // before running the test
      setTimeout(async () => {
        try {
          await runCurrentTest();
        } catch (error) {
          console.error('Error running test after file load:', error);
        }
      }, 100);
    },
    addCommand: (index: number, command: string) => update(state => {
      if (!state.currentFile) return state;

      const newCommands = [...state.currentFile.commands];
      newCommands.splice(index, 0, {
        command,
        expectedOutput: '',
        status: 'pending',
        changed: true,
        initializing: true // Mark as initializing to hide output sections until test is run
      });

      const updatedFile = {
        ...state.currentFile,
        commands: newCommands,
        dirty: true
      };

      // Trigger autosave
      debouncedSave(updatedFile, false);

      return {
        ...state,
        currentFile: updatedFile
      };
    }),
    updateCommand: (index: number, command: string) => {
      try {
        update(state => {
          if (!state.currentFile) return state;

          // Create a fresh copy of commands to avoid any reference issues
          const newCommands = state.currentFile.commands.map(cmd => ({...cmd}));

          // Only update if the index is valid
          if (index < 0 || index >= newCommands.length) {
            console.error('Invalid command index:', index);
            return state;
          }

          // Always mark as changed - this will force debouncedSave to trigger
          newCommands[index] = {
            ...newCommands[index],
            command,
            status: 'pending',
            changed: true
          };

          const updatedFile = {
            ...state.currentFile,
            commands: newCommands,
            dirty: true
          };

          // Always trigger autosave
          debouncedSave(updatedFile);

          return {
            ...state,
            currentFile: updatedFile
          };
        });
      } catch (error) {
        console.error('Error in updateCommand:', error);
      }
    },
    updateExpectedOutput: (index: number, expectedOutput: string) => {
      try {
        update(state => {
          if (!state.currentFile) return state;

          // Create a fresh copy of commands to avoid any reference issues
          const newCommands = state.currentFile.commands.map(cmd => ({...cmd}));

          // Only update if the index is valid
          if (index < 0 || index >= newCommands.length) {
            console.error('Invalid command index:', index);
            return state;
          }

          // Update the specific command
          newCommands[index] = {
            ...newCommands[index],
            expectedOutput,
            status: 'pending',
            changed: true
          };

          const updatedFile = {
            ...state.currentFile,
            commands: newCommands,
            dirty: true
          };

          // Trigger autosave with the updated file
          debouncedSave(updatedFile);

          return {
            ...state,
            currentFile: updatedFile
          };
        });
      } catch (error) {
        console.error('Error in updateExpectedOutput:', error);
      }
    },
    deleteCommand: (index: number) => update(state => {
      if (!state.currentFile) return state;

      const newCommands = [...state.currentFile.commands];
      newCommands.splice(index, 1);

      // Mark the file as having changes
      const updatedFile = {
        ...state.currentFile,
        commands: newCommands,
        dirty: true
      };

      // Immediately trigger autosave
      debouncedSave(updatedFile, false);

      return {
        ...state,
        currentFile: updatedFile
      };
    }),
    saveOnly: async () => {
      const state = getState();
      if (!state.currentFile) return;

      update(state => ({ ...state, saving: true }));

      try {
        await saveFileToBackend(state.currentFile);

        update(state => ({
          ...state,
          saving: false,
          currentFile: state.currentFile ? {
            ...state.currentFile, // Keep existing commands with their flags
            dirty: false,
            lastSaved: new Date()
          } : null
        }));
      } catch (error) {
        update(state => ({ ...state, saving: false }));
        console.error('Failed to save file:', error);
      }
    },
    toggleOutputExpansion: (index: number, isExpanded: boolean) => {
      update(state => {
        if (!state.currentFile) return state;

        // Create a fresh copy of commands to avoid any reference issues
        const newCommands = state.currentFile.commands.map(cmd => ({...cmd}));

        // Only update if the index is valid
        if (index < 0 || index >= newCommands.length) {
          console.error('Invalid command index:', index);
          return state;
        }

        // Update the specific command's expansion state
        newCommands[index] = {
          ...newCommands[index],
          isOutputExpanded: isExpanded
        };

        return {
          ...state,
          currentFile: {
            ...state.currentFile,
            commands: newCommands
          }
        };
      });
    },
    saveAndRun: async () => {
      const state = getState();
      if (!state.currentFile) return;

      update(state => ({ ...state, saving: true }));

      try {
        await saveFileToBackend(state.currentFile);

        update(state => ({
          ...state,
          saving: false,
          currentFile: state.currentFile ? {
            ...state.currentFile, // Keep existing commands with their flags
            dirty: false,
            lastSaved: new Date()
          } : null
        }));

        // Run test after saving
        await runCurrentTest();
      } catch (error) {
        update(state => ({ ...state, saving: false }));
        console.error('Failed to save file:', error);
      }
    },
    forceSave: async () => {
      // Keep for backward compatibility
      const state = getState();
      if (!state.currentFile) return;

      // Redirect to saveAndRun
      await storeModule.saveAndRun();
    },
    createNewFile: (path: string) => {
      const newFile = {
        path,
        commands: [],
        dirty: true,
        status: 'pending'
      };

      // Extract the file name and directory path
      const fileName = path.split('/').pop() || '';
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      
      // Create the file node for the file tree
      const newNode: FileNode = {
        name: fileName,
        path,
        isDirectory: false
      };
      
      // Update the file tree optimistically
      update(state => {
        // Add the new file to the directory
        const updatedTree = addNodeToDirectory([...state.fileTree], dirPath, newNode);
        
        return {
          ...state,
          fileTree: updatedTree,
          currentFile: newFile
        };
      });

      // Now do the actual save operation
      setTimeout(async () => {
        try {
          // Save the file
          await debouncedSave(newFile, false);
        } catch (err) {
          console.error('Error saving new file:', err);
          // If there's an error, refresh the file tree to restore correct state
          setTimeout(async () => {
            await storeModule.refreshFileTree();
          }, 100);
        }
      }, 0);
    },
    runTest: runCurrentTest
  };

  // Set the self-reference to allow calling other methods
  runModule = storeModule;

  return storeModule;
}

export const filesStore = createFilesStore();
export type { FileNode, RecordingCommand, RecordingFile };

// Helper functions for file tree manipulation
export function findNodeInTree(tree: FileNode[], path: string): FileNode | null {
  for (const node of tree) {
    if (node.path === path) {
      return node;
    }
    if (node.isDirectory && node.children) {
      const found = findNodeInTree(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

export function addNodeToDirectory(tree: FileNode[], dirPath: string, newNode: FileNode): FileNode[] {
  return tree.map(node => {
    if (node.path === dirPath && node.isDirectory) {
      // Found the directory, add the new node to its children
      return {
        ...node,
        children: [...(node.children || []), newNode]
      };
    }
    if (node.isDirectory && node.children) {
      // Recursively look in this directory's children
      return {
        ...node,
        children: addNodeToDirectory(node.children, dirPath, newNode)
      };
    }
    return node;
  });
}

export function removeNodeFromTree(tree: FileNode[], path: string): FileNode[] {
  return tree.filter(node => {
    if (node.path === path) {
      return false; // Remove this node
    }
    if (node.isDirectory && node.children) {
      node.children = removeNodeFromTree(node.children, path);
    }
    return true;
  });
}
