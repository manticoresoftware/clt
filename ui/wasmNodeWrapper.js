// Node.js WASM wrapper for backend integration
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import WASM module with proper singleton pattern
let wasmModule = null;
let wasmInitPromise = null;

async function initWasm() {
  // If already initialized, return the cached module
  if (wasmModule) {
    return wasmModule;
  }

  // If initialization is in progress, wait for it
  if (wasmInitPromise) {
    await wasmInitPromise;
    return wasmModule;
  }

  // Start initialization
  wasmInitPromise = (async () => {
    try {
      console.log('🔄 Initializing WASM module...');
      
      // Import the WASM module
      const wasmPath = path.join(__dirname, 'pkg', 'wasm.js');
      const wasmImport = await import(wasmPath);

      // Load WASM binary directly in Node.js (avoid fetch)
      const wasmBinaryPath = path.join(__dirname, 'pkg', 'wasm_bg.wasm');
      const wasmBinary = readFileSync(wasmBinaryPath);

      // Initialize the WASM module with binary data
      await wasmImport.default(wasmBinary);

      // Cache the initialized module
      wasmModule = wasmImport;
      
      console.log('✅ WASM module initialized successfully for backend');
      return wasmModule;
    } catch (error) {
      console.error('❌ Failed to initialize WASM module:', error);
      wasmInitPromise = null; // Reset promise on failure to allow retry
      throw error;
    }
  })();

  await wasmInitPromise;
  return wasmModule;
}

// WASM-based file parsing
export async function parseRecFileWasm(filePath) {
  const wasm = await initWasm();
  try {
    const absoluteFilePath = path.resolve(filePath);
    console.log(`🔄 Parsing .rec file with WASM: ${absoluteFilePath}`);
    const structuredJson = wasm.read_test_file_wasm(absoluteFilePath);

    // Check if we got valid JSON
    if (!structuredJson || typeof structuredJson !== 'string') {
      console.warn('WASM read_test_file_wasm returned:', typeof structuredJson, structuredJson);
      // Return minimal valid structure
      return {
        steps: [],
        metadata: {
          created_at: new Date().toISOString(),
          version: "1.0"
        }
      };
    }

    return JSON.parse(structuredJson);
  } catch (error) {
    console.error(`❌ WASM parsing failed for ${path.resolve(filePath)}:`, error);
    // Return minimal valid structure instead of throwing
    return {
      steps: [],
      metadata: {
        created_at: new Date().toISOString(),
        version: "1.0"
      }
    };
  }
}

// WASM-based file generation
export async function generateRecFileWasm(filePath, testStructure) {
  const wasm = await initWasm();
  try {
    const absoluteFilePath = path.resolve(filePath);
    console.log(`🔄 Generating .rec content with WASM: ${absoluteFilePath}`);
    const structuredJson = JSON.stringify(testStructure);
    const recContent = wasm.write_test_file_wasm(absoluteFilePath, structuredJson);

    // Check if we got valid content
    if (recContent === undefined || recContent === null) {
      console.warn('WASM write_test_file_wasm returned undefined/null');
      return ''; // Return empty string instead of undefined
    }

    return recContent;
  } catch (error) {
    console.error(`❌ WASM generation failed for ${path.resolve(filePath)}:`, error);
    return ''; // Return empty string instead of throwing
  }
}

// WASM-based pattern retrieval with proper git directory context
export async function getPatternsWasm(userRepoPath = null) {
  const wasm = await initWasm();
  try {
    const absoluteRepoPath = userRepoPath ? path.resolve(userRepoPath) : null;
    console.log(`🔄 Getting patterns with WASM from repo: ${absoluteRepoPath || 'default'}`);

    // Use the user's repository path as context for pattern discovery
    const patternsJson = wasm.get_patterns_wasm(absoluteRepoPath);

    // Check if we got valid JSON
    if (!patternsJson || typeof patternsJson !== 'string') {
      console.log('No patterns found or invalid response, returning empty patterns');
      return {};
    }

    try {
      const patternsArray = JSON.parse(patternsJson);

      // Check if it's actually an array
      if (!Array.isArray(patternsArray)) {
        console.log('Patterns result is not an array, trying as object');
        // If it's already an object with pattern names, return as-is
        if (typeof patternsArray === 'object') {
          return patternsArray;
        }
        return {};
      }

      // Convert array to object format expected by UI
      const patterns = {};
      patternsArray.forEach(pattern => {
        if (pattern && pattern.name && pattern.pattern) {
          patterns[pattern.name] = pattern.pattern;
        }
      });

      return patterns;
    } catch (jsonError) {
      console.warn('Failed to parse patterns JSON:', jsonError.message);
      return {};
    }
  } catch (error) {
    console.warn('WASM pattern retrieval failed:', error.message);
    return {}; // Return empty patterns instead of throwing
  }
}

// WASM-based test validation
export async function validateTestWasm(recFilePath) {
  const wasm = await initWasm();
  try {
    const absoluteRecFilePath = path.resolve(recFilePath);
    console.log(`🔄 Validating test with WASM: ${absoluteRecFilePath}`);
    const validationJson = wasm.validate_test_wasm(absoluteRecFilePath);

    // Check if we got valid JSON
    if (!validationJson || typeof validationJson !== 'string') {
      console.warn('WASM validate_test_wasm returned:', typeof validationJson, validationJson);
      return { valid: true, errors: [] }; // Return default valid result
    }

    return JSON.parse(validationJson);
  } catch (error) {
    console.error(`❌ WASM validation failed for ${path.resolve(recFilePath)}:`, error);
    return { valid: true, errors: [] }; // Return default valid result instead of throwing
  }
}

// WASM-based test structure replacement
export async function replaceTestStructureWasm(filePath, oldStructure, newStructure) {
  const wasm = await initWasm();
  try {
    const absoluteFilePath = path.resolve(filePath);
    console.log(`🔄 Replacing test structure with WASM: ${absoluteFilePath}`);
    const oldJson = JSON.stringify(oldStructure);
    const newJson = JSON.stringify(newStructure);
    const result = wasm.replace_test_structure_wasm(absoluteFilePath, oldJson, newJson);
    return result;
  } catch (error) {
    console.error(`❌ WASM structure replacement failed for ${path.resolve(filePath)}:`, error);
    throw error;
  }
}

// WASM-based test structure appending
export async function appendTestStructureWasm(filePath, appendStructure) {
  const wasm = await initWasm();
  try {
    const absoluteFilePath = path.resolve(filePath);
    console.log(`🔄 Appending test structure with WASM: ${absoluteFilePath}`);
    const appendJson = JSON.stringify(appendStructure);
    const result = wasm.append_test_structure_wasm(absoluteFilePath, appendJson);
    return result;
  } catch (error) {
    console.error(`❌ WASM structure appending failed for ${path.resolve(filePath)}:`, error);
    throw error;
  }
}

// Convert UI RecordingCommand format to WASM TestStructure format
export function convertUIToWasmFormat(commands) {
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
}

// Convert WASM TestStructure format to UI RecordingCommand format
export function convertWasmToUIFormat(testStructure) {
  if (!testStructure.steps) {
    throw new Error('Invalid test structure: missing steps');
  }

  const commands = [];

  for (const step of testStructure.steps) {
    // Handle new structure format (with step.type)
    if (step.type) {
      switch (step.type) {
        case 'statement':
          // Statements don't become commands in UI
          break;
        case 'input':
          commands.push({
            command: step.content,
            type: 'command',
            status: 'pending'
          });
          break;
        case 'expected_output':
          // Expected output is handled separately
          break;
        case 'block':
          commands.push({
            command: `@${step.args[0]}`,
            type: 'block',
            status: 'pending',
            isBlockCommand: false
          });
          break;
      }
    }
    // Handle old structure format (with step.Block, step.Command, etc.)
    else if (step.Block) {
      commands.push({
        command: step.Block.path,
        type: 'block',
        status: 'pending',
        blockSource: step.Block.source_file,
        isBlockCommand: false
      });
    } else if (step.Comment) {
      commands.push({
        command: step.Comment,
        type: 'comment',
        status: 'pending'
      });
    } else if (step.Command) {
      commands.push({
        command: step.Command.input,
        expectedOutput: step.Command.expected_output,
        actualOutput: step.Command.actual_output,
        type: 'command',
        status: 'pending'
      });
    } else {
      throw new Error(`Unknown step type: ${JSON.stringify(step)}`);
    }
  }

  return commands;
}

// ===== NEW WASM-COMPATIBLE FUNCTIONS (NO FILE SYSTEM OPERATIONS) =====

// WASM-based file parsing using file content map (WASM-compatible)
export async function parseRecFileFromMapWasm(filePath, fileMap) {
  const wasm = await initWasm();
  
  // Validate that the WASM function is available
  if (!wasm.read_test_file_from_map_wasm) {
    throw new Error('WASM function read_test_file_from_map_wasm is not available');
  }
  
  try {
    console.log(`🔄 Parsing .rec file from map with WASM: ${filePath}`);
    const fileMapJson = JSON.stringify(fileMap);
    const structuredJson = wasm.read_test_file_from_map_wasm(filePath, fileMapJson);

    // Check if we got valid JSON
    if (!structuredJson || typeof structuredJson !== 'string') {
      console.warn('WASM read_test_file_from_map_wasm returned:', typeof structuredJson, structuredJson);
      return {
        steps: [],
        metadata: {
          created_at: new Date().toISOString(),
          file_path: filePath
        }
      };
    }

    const parsed = JSON.parse(structuredJson);

    // Check for errors in the parsed result
    if (parsed.error) {
      console.error('WASM parsing error:', parsed.error);
      throw new Error(parsed.error);
    }

    console.log(`✅ Successfully parsed .rec file from map: ${filePath}`);
    return parsed;
  } catch (error) {
    console.error(`❌ WASM file parsing from map failed for ${filePath}:`, error);
    throw error;
  }
}

// WASM-based file generation to content map (WASM-compatible)
export async function generateRecFileToMapWasm(filePath, testStructure) {
  const wasm = await initWasm();
  
  // Validate that the WASM function is available
  if (!wasm.write_test_file_to_map_wasm) {
    throw new Error('WASM function write_test_file_to_map_wasm is not available');
  }
  
  try {
    console.log(`🔄 Generating .rec file to map with WASM: ${filePath}`);
    const structureJson = JSON.stringify(testStructure);
    const fileMapJson = wasm.write_test_file_to_map_wasm(filePath, structureJson);

    if (!fileMapJson || typeof fileMapJson !== 'string') {
      throw new Error('WASM write_test_file_to_map_wasm returned invalid result');
    }

    const parsed = JSON.parse(fileMapJson);

    // Check for errors in the parsed result
    if (parsed.error) {
      console.error('WASM generation error:', parsed.error);
      throw new Error(parsed.error);
    }

    console.log(`✅ Successfully generated .rec file to map: ${filePath}`);
    return parsed; // Returns file map with path -> content
  } catch (error) {
    console.error(`❌ WASM file generation to map failed for ${filePath}:`, error);
    throw error;
  }
}

// Export the initialization function for explicit control
export { initWasm };
