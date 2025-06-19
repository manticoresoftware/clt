import { writable } from 'svelte/store';
import { API_URL } from '../config.js';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink?: boolean;
  targetPath?: string;
  children?: FileNode[];
}

// New WASM structured format interfaces
interface TestStep {
  type: string;           // "input" | "output" | "block" | "comment"
  args: string[];         // For blocks: [blockPath], for outputs: [checker]
  content: string | null; // Command/output content
  steps: TestStep[] | null; // For blocks: nested steps

  // Runtime properties (added by UI)
  status?: 'success' | 'failed';
  actualOutput?: string;
  duration?: number;
  isExpanded?: boolean;   // For block expansion
}

interface TestStructure {
  description: string | null;
  steps: TestStep[];
}

interface RecordingFile {
  path: string;
  // Structured format (WASM-based)
  testStructure?: TestStructure;
  dirty: boolean;
  lastSaved?: Date;
  status?: 'success' | 'failed';
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

// Helper function to parse commands from the content of a .rec file
const parseRecFileContent = (content: string): RecordingCommand[] => {
  const commands: RecordingCommand[] = [];
  const lines = content.split('\n');
  let currentSection = '';
  let currentCommand = '';
  let currentOutput = '';
  let commandType: 'command' | 'block' | 'comment' = 'command';

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Detect section markers
    if (line.startsWith('––– ') || line.startsWith('--- ')) {
      // Process completed section before starting a new one
      if (currentSection === 'input' && currentCommand) {
        // We have a command but no output section yet
        currentSection = ''; // Reset section
      } else if (currentSection === 'output') {
        // We've completed an input/output pair
        commands.push({
          command: currentCommand.trim(),
          expectedOutput: currentOutput, // Don't trim output to preserve whitespace
          type: 'command',
          status: 'pending',
        });

        // Reset for next command
        currentCommand = '';
        currentOutput = '';
        currentSection = '';
      } else if (currentSection === 'comment' && currentCommand) {
        // We've completed a comment section
        commands.push({
          command: currentCommand.trim(),
          type: 'comment',
          status: 'pending',
        });

        // Reset for next command
        currentCommand = '';
        currentSection = '';
      } else if (currentSection === 'block' && currentCommand) {
        // We've completed a block reference
        commands.push({
          command: currentCommand.trim(),
          type: 'block',
          status: 'pending',
        });

        // Reset for next command
        currentCommand = '';
        currentSection = '';
      }

      // Parse the marker to determine what section follows
      if (line.includes('input')) {
        currentSection = 'input';
        commandType = 'command';
      } else if (line.includes('output')) {
        currentSection = 'output';
      } else if (line.includes('comment')) {
        currentSection = 'comment';
        commandType = 'comment';
      } else if (line.includes('block:')) {
        currentSection = 'block';
        commandType = 'block';
        // Extract path from block marker: "--- block: path/to/file ---"
        const pathMatch = line.match(/block:\s*([^\s]+)/);
        if (pathMatch && pathMatch[1]) {
          currentCommand = pathMatch[1].trim();
        }
      }

      i++;
      continue;
    }

    // Process content based on current section
    if (currentSection === 'input') {
      if (currentCommand) currentCommand += '\n';
      currentCommand += lines[i];
    } else if (currentSection === 'output') {
      if (currentOutput) currentOutput += '\n';
      currentOutput += lines[i];
    } else if (currentSection === 'comment') {
      if (currentCommand) currentCommand += '\n';
      currentCommand += lines[i];
    } else if (currentSection === 'block' && !currentCommand) {
      // Only set the command if we haven't extracted it from the marker
      currentCommand = lines[i];
    }

    i++;
  }

  // Handle the last section if it wasn't closed properly
  if (currentSection === 'input' && currentCommand) {
    commands.push({
      command: currentCommand.trim(),
      type: 'command',
      status: 'pending',
    });
  } else if (currentSection === 'output' && currentCommand) {
    commands.push({
      command: currentCommand.trim(),
      expectedOutput: currentOutput, // Don't trim output to preserve whitespace
      type: 'command',
      status: 'pending',
    });
  } else if (currentSection === 'comment' && currentCommand) {
    commands.push({
      command: currentCommand.trim(),
      type: 'comment',
      status: 'pending',
    });
  } else if (currentSection === 'block' && currentCommand) {
    commands.push({
      command: currentCommand.trim(),
      type: 'block',
      status: 'pending',
    });
  }

  return commands;
};

// Helper function to determine if a file is loaded correctly
const checkFileLoaded = async (path: string) => {
  try {
    // We'll make the API call to get the file content
    const response = await fetch(`${API_URL}/api/get-file?path=${encodeURIComponent(path)}`, {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();

      // Check if we have structured data from backend (WASM-parsed)
      if (data.structuredData && data.wasmparsed) {
        console.log('✅ Using WASM-parsed structured data from backend');
        return {
          success: true,
          testStructure: data.structuredData,
          method: 'wasm'
        };
      } else if (data.structuredData) {
        console.log('✅ Using structured data from backend');
        return {
          success: true,
          testStructure: data.structuredData,
          method: 'structured'
        };
      } else {
        // Fallback to manual parsing for backward compatibility
        console.log('⚠️ Using manual parsing fallback');
        const fileContent = data.content;
        const commands = parseRecFileContent(fileContent);
        return { success: true, commands, method: 'manual' };
      }    } else {
      return { success: false, error: `Failed to load file: ${response.statusText}` };
    }
  } catch (error) {
    console.error('Error loading file:', error);
    return { success: false, error: `Failed to load file: ${error}` };
  }
};

function createFilesStore() {
  const { subscribe, set, update } = writable<FilesState>(defaultState);
  let runModule: any; // Reference to the module itself for self-referencing

  // Helper function to get patterns using WASM
  const getWasmPatterns = async (): Promise<Record<string, string>> => {
    try {
      const patternsArray = await getPatterns();
      const patterns: Record<string, string> = {};

      patternsArray.forEach(pattern => {
        patterns[pattern.name] = pattern.pattern;
      });

      return patterns;
    } catch (error) {
      console.warn('Failed to load patterns via WASM:', error);
      return {};
    }
  };

  const saveFileToBackend = async (file: RecordingFile) => {
    // Convert UI commands to structured format for WASM backend
    const convertUIToStructured = (commands: RecordingCommand[]) => {
      const testSteps = commands.map(cmd => {
        if (cmd.type === 'block') {
          return {
            Block: {
              path: cmd.command,
              source_file: cmd.blockSource || null
            }
          };
        } else if (cmd.type === 'comment') {
          return {
            Comment: cmd.command
          };
        } else {
          return {
            Command: {
              input: cmd.command,
              expected_output: cmd.expectedOutput || '',
              actual_output: cmd.actualOutput || null
            }
          };
        }
      });

      return {
        steps: testSteps,
        metadata: {
          created_at: new Date().toISOString(),
          version: "1.0"
        }
      };
    };

    // Format the file content according to the .rec format (manual fallback)
    let content = '';

    // Check if file has commands (legacy format) or testStructure (new format)
    if (!file.commands && !file.testStructure) {
      throw new Error('File has neither commands nor testStructure');
    }

    // For structured format files, we don't need to generate manual content
    if (file.testStructure) {
      try {
        const response = await fetch(`${API_URL}/api/save-file`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            path: file.path,
            structuredData: file.testStructure // Send structured data, let backend handle WASM
          })
        });

        if (!response.ok) {
          throw new Error(`Failed to save file: ${response.statusText}`);
        }

        const result = await response.json();
        console.log('✅ File saved with structured format');
        return result;
      } catch (error) {
        console.error('Error saving structured file:', error);
        throw error;
      }
    }

    // Handle legacy format with commands
    file.commands!.forEach((cmd, index) => {
      // Add newline before section if not the first command
      if (index > 0) {
        content += '\\n';
      }

      // Handle different command types
      if (cmd.type === 'block') {
        // Format as block reference - no extra newline after
        content += `––– block: ${cmd.command} –––`;
      } else if (cmd.type === 'comment') {
        // Format as comment - no extra newline after
        content += `––– comment –––\\n${cmd.command}`;
      } else {
        // Default - regular command (input/output format)
        content += '––– input –––\\n';
        content += cmd.command;

        // Don't add extra newline if command already ends with one
        if (!cmd.command.endsWith('\\n')) {
          content += '\\n';
        }

        // Add output section marker - no extra newline for empty outputs
        content += '––– output –––';

        // Use the expected output if provided, otherwise use actual output if available
        // Make sure to maintain all whitespace and newlines exactly as in the expected output
        const outputToSave = cmd.expectedOutput || cmd.actualOutput || '';

        // Only add a newline before the output if there's actual content
        if (outputToSave && outputToSave.trim() !== '') {
          content += '\\n' + outputToSave;
        }
      }
    });

    try {
      // Prepare structured data for WASM backend
      const structuredData = convertUIToStructured(file.commands!);

      const response = await fetch(`${API_URL}/api/save-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Add credentials for cookie passing
        body: JSON.stringify({
          path: file.path,
          content, // Manual format as fallback
          structuredData // Structured format for WASM
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to save file: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('✅ File saved via WASM backend');
      return result;
    } catch (error) {
      console.error('Error saving file:', error);
      throw error;
    }
  };

  // Fallback manual save function
  const saveFileToBackendManual = async (file: RecordingFile) => {
    // Format the file content according to the .rec format
    let content = '';

    file.commands.forEach((cmd, index) => {
      // Add newline before section if not the first command
      if (index > 0) {
        content += '\n';
      }

      // Handle different command types
      if (cmd.type === 'block') {
        // Format as block reference - no extra newline after
        content += `––– block: ${cmd.command} –––`;
      } else if (cmd.type === 'comment') {
        // Format as comment - no extra newline after
        content += `––– comment –––\n${cmd.command}`;
      } else {
        // Default - regular command (input/output format)
        content += '––– input –––\n';
        content += cmd.command;

        // Don't add extra newline if command already ends with one
        if (!cmd.command.endsWith('\n')) {
          content += '\n';
        }

        // Add output section marker - no extra newline for empty outputs
        content += '––– output –––';

        // Use the expected output if provided, otherwise use actual output if available
        // Make sure to maintain all whitespace and newlines exactly as in the expected output
        const outputToSave = cmd.expectedOutput || cmd.actualOutput || '';

        // Only add a newline before the output if there's actual content
        if (outputToSave && outputToSave.trim() !== '') {
          content += '\n' + outputToSave;
        }
      }
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

      console.log('Run test completed successfully');

      // Process enhanced testStructure (preferred method)
      if (result.testStructure) {
        console.log('🔍 Processing enriched testStructure with actual outputs');

        update(state => {
          if (!state.currentFile?.testStructure) return state;

          // Recursive function to process nested steps
          function processStepsRecursively(steps) {
            return steps.map(step => {
              const processedStep = {
                ...step,
                actualOutput: step.actualOutput || '', // From .rep file
                status: step.status || 'success', // Backend already set status
                error: step.error || false // Backend already set error flag
              };
              
              // Process nested steps if they exist
              if (step.steps && step.steps.length > 0) {
                processedStep.steps = processStepsRecursively(step.steps);
              }
              
              return processedStep;
            });
          }
          
          // Update the testStructure directly with enriched data (backend already enhanced)
          const enrichedSteps = processStepsRecursively(result.testStructure.steps);

          console.log(`📋 Updated ${enrichedSteps.length} steps with enriched data`);

          return {
            ...state,
            running: false,
            currentFile: {
              ...state.currentFile,
              testStructure: {
                ...state.currentFile.testStructure,
                steps: enrichedSteps
              },
              status: result.success ? 'success' : 'failed'
            }
          };
        });
      }
      else {
        // No validation results - just update running status
        update(state => ({
          ...state,
          running: false,
          currentFile: state.currentFile ? {
            ...state.currentFile,
            status: result.success ? 'success' : 'failed'
          } : null
        }));
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

        // Handle structured format with enhanced testStructure
        if (state.currentFile.testStructure && result.testStructure) {
          console.log('✅ Test completed for structured format file');
          console.log('Result:', result);

          // Use enhanced testStructure from backend (already has actualOutput, status, error)
          function processStepsRecursively(steps) {
            return steps.map(step => {
              const processedStep = {
                ...step,
                actualOutput: step.actualOutput || '',
                status: step.status || 'success',
                error: step.error || false
              };
              
              // Process nested steps if they exist
              if (step.steps && step.steps.length > 0) {
                processedStep.steps = processStepsRecursively(step.steps);
              }
              
              return processedStep;
            });
          }

          const enhancedSteps = processStepsRecursively(result.testStructure.steps);

          return {
            ...state,
            running: false,
            currentFile: {
              ...state.currentFile,
              testStructure: {
                ...state.currentFile.testStructure,
                steps: enhancedSteps
              },
              status: result.success ? 'success' : 'failed'
            }
          };
        } else {
          // Fallback - just update overall status
          return {
            ...state,
            running: false,
            currentFile: {
              ...state.currentFile,
              status: result.success ? 'success' : 'failed'
            }
          };
        }
      });
    } catch (error) {
      console.error('Failed to run test:', error);
      // Make sure we clear the running flag even if there's an error
      update(state => ({ ...state, running: false }));
    }
  };

  // Helper function to update all child paths when moving a directory
  const updateChildPaths = (children: FileNode[], oldParentPath: string, newParentPath: string): FileNode[] => {
    return children.map(child => {
      // Calculate the new path by replacing the old parent path with the new one
      const newPath = child.path.replace(oldParentPath, newParentPath);

      if (child.isDirectory && child.children) {
        // Recursively update children
        return {
          ...child,
          path: newPath,
          children: updateChildPaths(child.children, oldParentPath, newParentPath)
        };
      } else {
        // For files, just update the path
        return {
          ...child,
          path: newPath
        };
      }
    });
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
        // Use the file tree returned directly from the API
        if (data.fileTree) {
          storeModule.setFileTree(data.fileTree);
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

        // If it's a directory, we need to update all child paths
        if (sourceNode.isDirectory && sourceNode.children) {
          newNode.children = updateChildPaths(sourceNode.children, sourcePath, targetPath);
        }

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
          } else if (state.currentFile && state.currentFile.path.startsWith(sourcePath + '/')) {
            // If current file is inside moved directory, update its path too
            const relativePath = state.currentFile.path.substring(sourcePath.length);
            const newPath = targetPath + relativePath;
            return {
              ...state,
              currentFile: {
                ...state.currentFile,
                path: newPath
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
    loadFile: async (path: string) => {
      try {
        // Load the file content
        const result = await checkFileLoaded(path);

        if (result.success) {
          // Handle new structured format (preferred)
          if (result.testStructure) {
            console.log('✅ Using new structured format for file:', path);

            // Add runtime properties to all steps (status: pending, isExpanded: false)
            const processSteps = (steps: TestStep[]): TestStep[] => {
              return steps.map(step => ({
                ...step,
                status: 'pending',
                isExpanded: step.type === 'block' ? false : undefined,
                steps: step.steps ? processSteps(step.steps) : null
              }));
            };

            const processedTestStructure: TestStructure = {
              ...result.testStructure,
              steps: processSteps(result.testStructure.steps)
            };

            // Update store with the new structured data
            update(state => ({
              ...state,
              currentFile: {
                path,
                testStructure: processedTestStructure,
                dirty: false,
                status: 'pending'
              }
            }));

            return true;
          }
        } else {
          console.error('Failed to load file:', result.error);
          return false;
        }
      } catch (error) {
        console.error('Error in loadFile:', error);
        return false;
      }
    },
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
        testStructure: {
          description: null,
          steps: []
        },
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
    runTest: runCurrentTest,

    // Add validation function
    validateTest: async (filePath: string) => {
      try {
        const response = await fetch(`${API_URL}/api/validate-test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ filePath })
        });

        if (!response.ok) {
          throw new Error(`Validation failed: ${response.statusText}`);
        }

        const validationResult = await response.json();
        console.log('✅ Test validation completed via WASM backend');
        return validationResult;
      } catch (error) {
        console.error('Error validating test:', error);
        throw error;
      }
    },

    // Update test structure (for new structured format)
    updateTestStructure: (newStructure: TestStructure) => {
      update(state => {
        if (!state.currentFile) return state;

        return {
          ...state,
          currentFile: {
            ...state.currentFile,
            testStructure: newStructure,
            dirty: true
          }
        };
      });
    },

    // Clear current file selection
    clearCurrentFile: () => {
      update(state => ({
        ...state,
        currentFile: null
      }));
    }
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

export function updateChildPaths(children: FileNode[], oldParentPath: string, newParentPath: string): FileNode[] {
  return children.map(child => {
    // Calculate the new path by replacing the old parent path with the new one
    const newPath = child.path.replace(oldParentPath, newParentPath);

    if (child.isDirectory && child.children) {
      // Recursively update children
      return {
        ...child,
        path: newPath,
        children: updateChildPaths(child.children, oldParentPath, newParentPath)
      };
    } else {
      // For files, just update the path
      return {
        ...child,
        path: newPath
      };
    }
  });
}

// Export types for use in components
export type { TestStep, TestStructure, RecordingCommand, FileNode };
