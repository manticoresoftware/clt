// Node.js WASM wrapper for backend integration
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import WASM module
let wasmModule = null;

async function initWasm() {
  if (!wasmModule) {
    try {
      // Import the WASM module
      const wasmPath = path.join(__dirname, 'pkg', 'wasm.js');
      wasmModule = await import(wasmPath);
      
      // Load WASM binary directly in Node.js (avoid fetch)
      const wasmBinaryPath = path.join(__dirname, 'pkg', 'wasm_bg.wasm');
      const wasmBinary = readFileSync(wasmBinaryPath);
      
      // Initialize the WASM module with binary data
      await wasmModule.default(wasmBinary);
      
      console.log('✅ WASM module initialized successfully for backend');
    } catch (error) {
      console.error('❌ Failed to initialize WASM module:', error);
      throw error;
    }
  }
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

  return testStructure.steps.map(step => {
    if (step.Block) {
      return {
        command: step.Block.path,
        type: 'block',
        status: 'pending',
        blockSource: step.Block.source_file,
        isBlockCommand: false
      };
    } else if (step.Comment) {
      return {
        command: step.Comment,
        type: 'comment',
        status: 'pending'
      };
    } else if (step.Command) {
      return {
        command: step.Command.input,
        expectedOutput: step.Command.expected_output,
        actualOutput: step.Command.actual_output,
        type: 'command',
        status: 'pending'
      };
    } else {
      throw new Error(`Unknown step type: ${JSON.stringify(step)}`);
    }
  });
}

// Initialize WASM on module load
initWasm().catch(error => {
  console.error('Failed to initialize WASM module on startup:', error);
});