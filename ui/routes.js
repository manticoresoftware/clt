import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import simpleGit from 'simple-git';
import {
  parseRecFileFromMapWasm,
  generateRecFileToMapWasm,
  validateTestFromMapWasm
} from './wasmNodeWrapper.js';

// Helper functions that were in server.js
export function getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig) {
  // Get fresh auth config
  const authConfig = getAuthConfig();
  
  // If auth is skipped, use a default user
  if (authConfig.skipAuth) {
    return path.join(WORKDIR, 'dev-mode');
  }

  // If user is authenticated, use their username
  if (req.isAuthenticated() && req.user && req.user.username) {
    return path.join(WORKDIR, req.user.username);
  }

  // Fallback to the root directory if no user is available
  return ROOT_DIR;
}

export function getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig) {
  const userRepo = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
  return path.join(userRepo, 'test', 'clt-tests');
}

// Helper function to merge patterns like CLT does (system + project patterns)
export async function getMergedPatterns(userRepoPath, __dirname) {
  const patterns = {};
  
  // First, load system patterns from global .clt/patterns (like CLT binary directory)
  const systemPatternsPath = path.join(__dirname, '.clt', 'patterns');
  try {
    const systemContent = await fs.readFile(systemPatternsPath, 'utf8');
    parsePatternContent(systemContent, patterns);
    console.log(`📋 Loaded ${Object.keys(patterns).length} system patterns from: ${systemPatternsPath}`);
  } catch (error) {
    console.log(`ℹ️  No system patterns file found: ${systemPatternsPath}`);
  }
  
  // Then, load project patterns from user repo (these override system patterns)
  const projectPatternsPath = path.join(userRepoPath, '.clt', 'patterns');
  try {
    const projectContent = await fs.readFile(projectPatternsPath, 'utf8');
    parsePatternContent(projectContent, patterns); // This will override system patterns
    console.log(`📋 Merged with ${Object.keys(patterns).length} total patterns after loading project patterns from: ${projectPatternsPath}`);
  } catch (error) {
    console.log(`ℹ️  No project patterns file found: ${projectPatternsPath}`);
  }
  
  return patterns;
}

// Helper function to parse pattern file content
function parsePatternContent(content, patterns) {
  for (const line of content.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const parts = trimmedLine.split(' ');
      if (parts.length >= 2) {
        const name = parts[0];
        const regex = parts.slice(1).join(' ');
        patterns[name] = regex;
      }
    }
  }
}

// Helper function to create file content map for WASM processing
export async function createFileContentMap(mainFilePath, baseDir, req = null) {
  const fileMap = {};
  
  try {
    // Read the main file
    const mainContent = await fs.readFile(mainFilePath, 'utf8');
    const relativePath = path.relative(baseDir, mainFilePath);
    fileMap[relativePath] = mainContent;
    
    // Find and read all .recb block files in the same directory and subdirectories
    const mainDir = path.dirname(mainFilePath);
    await findAndReadBlockFiles(mainDir, baseDir, fileMap);
    
    // Parse the main file content to find block references and resolve them
    await resolveBlockReferences(mainContent, mainFilePath, baseDir, fileMap);
    
    console.log(`📁 Created file content map with ${Object.keys(fileMap).length} files`);
    console.log(`📁 File map keys: ${Object.keys(fileMap).join(', ')}`);
    return fileMap;
  } catch (error) {
    console.error('Error creating file content map:', error);
    throw error;
  }
}

// Parse content and resolve block references
async function resolveBlockReferences(content, mainFilePath, baseDir, fileMap) {
  // Find all block references in the content (e.g., "––– block: ../base/start-searchd –––")
  const blockRegex = /–––\s*block:\s*([^–]+)\s*–––/g;
  let match;
  
  while ((match = blockRegex.exec(content)) !== null) {
    const blockPath = match[1].trim();
    console.log(`🔍 Found block reference: "${blockPath}"`);
    
    // Resolve the block file path relative to the main file's directory
    const mainFileDir = path.dirname(mainFilePath);
    let resolvedBlockPath;
    
    // Handle different block path formats
    if (blockPath.includes('/')) {
      // Path with directory (e.g., "../base/start-searchd" or "auth/login")
      const blockFileName = blockPath.endsWith('.recb') ? blockPath : `${blockPath}.recb`;
      resolvedBlockPath = path.resolve(mainFileDir, blockFileName);
    } else {
      // Simple block name (e.g., "login-sequence")
      const blockFileName = blockPath.endsWith('.recb') ? blockPath : `${blockPath}.recb`;
      resolvedBlockPath = path.join(mainFileDir, blockFileName);
    }
    
    console.log(`📂 Resolved block path: ${resolvedBlockPath}`);
    
    // Create the key that WASM expects (with .recb extension)
    const wasmExpectedKey = blockPath.endsWith('.recb') ? blockPath : `${blockPath}.recb`;
    
    // Check if we already have this block in the map
    if (!fileMap[wasmExpectedKey]) {
      try {
        console.log(`📄 Reading referenced block file: ${resolvedBlockPath}`);
        
        // Check if file exists first
        await fs.access(resolvedBlockPath);
        
        const blockContent = await fs.readFile(resolvedBlockPath, 'utf8');
        
        // Store with the key that WASM expects (with .recb extension)
        fileMap[wasmExpectedKey] = blockContent;
        console.log(`✅ Added referenced block file: ${wasmExpectedKey} (${blockContent.length} chars)`);
        
        // Recursively resolve block references in this block file
        await resolveBlockReferences(blockContent, resolvedBlockPath, baseDir, fileMap);
      } catch (error) {
        console.error(`❌ Could not read referenced block file ${resolvedBlockPath}:`, error.message);
        
        // Add error content to prevent WASM from failing
        fileMap[wasmExpectedKey] = `––– input –––\necho "Error: Block file not found: ${blockPath}"\n––– output –––\nError: Block file not found`;
        console.log(`⚠️  Added error placeholder for block: ${wasmExpectedKey}`);
      }
    } else {
      console.log(`ℹ️  Block ${wasmExpectedKey} already in file map`);
    }
  }
}

// Recursively find and read .recb files
async function findAndReadBlockFiles(dir, baseDir, fileMap) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // Skip hidden files
      
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively search subdirectories
        await findAndReadBlockFiles(fullPath, baseDir, fileMap);
      } else if (entry.name.endsWith('.recb')) {
        // Read block file
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const relativePath = path.relative(baseDir, fullPath);
          fileMap[relativePath] = content;
          console.log(`📄 Added block file to map: ${relativePath}`);
        } catch (error) {
          console.warn(`⚠️  Could not read block file ${fullPath}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️  Could not read directory ${dir}:`, error.message);
  }
}

// Convert WASM TestStructure to legacy command format for UI compatibility
export function convertTestStructureToLegacyCommands(testStructure, parentBlock = null, blockSource = null) {
  const commands = [];
  
  if (!testStructure || !testStructure.steps) {
    return commands;
  }
  
  for (const step of testStructure.steps) {
    switch (step.step_type) {
      case 'input':
        commands.push({
          command: step.content || '',
          type: 'command',
          status: 'pending',
          parentBlock,
          blockSource,
          isBlockCommand: !!parentBlock
        });
        break;
        
      case 'output':
        // Output steps are handled as expectedOutput in the previous input command
        if (commands.length > 0 && commands[commands.length - 1].type === 'command') {
          commands[commands.length - 1].expectedOutput = step.content || '';
        }
        break;
        
      case 'block':
        const blockPath = step.args && step.args.length > 0 ? step.args[0] : 'unknown-block';
        
        // Add the block reference
        commands.push({
          command: blockPath,
          type: 'block',
          status: 'pending',
          parentBlock,
          blockSource,
          isBlockCommand: false
        });
        
        // Add nested commands from the block
        if (step.steps && step.steps.length > 0) {
          const nestedCommands = convertTestStructureToLegacyCommands(
            { steps: step.steps }, 
            { command: blockPath }, 
            blockPath
          );
          commands.push(...nestedCommands);
        }
        break;
        
      case 'comment':
        commands.push({
          command: step.content || '',
          type: 'comment',
          status: 'pending',
          parentBlock,
          blockSource,
          isBlockCommand: !!parentBlock
        });
        break;
    }
  }
  
  return commands;
}

// Helper function to get a file tree
export async function buildFileTree(dir, basePath = '', followSymlinks = true) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const tree = [];

  for (const entry of entries) {
    // Skip hidden files/directories that start with a dot
    if (entry.name.startsWith('.')) continue;

    const relativePath = path.join(basePath, entry.name);
    const fullPath = path.join(dir, entry.name);

    let isDirectory = entry.isDirectory();
    let targetPath = fullPath;

    // Handle symlinks
    if (entry.isSymbolicLink() && followSymlinks) {
      try {
        // Get the symlink target
        const linkTarget = await fs.readlink(fullPath);

        // Resolve to absolute path if needed
        const resolvedTarget = path.isAbsolute(linkTarget)
          ? linkTarget
          : path.resolve(path.dirname(fullPath), linkTarget);

        // Attempt to get stats of the target
        const targetStats = await fs.stat(resolvedTarget);
        isDirectory = targetStats.isDirectory();
        targetPath = resolvedTarget;

        console.log(`Symlink ${fullPath} -> ${resolvedTarget} (is directory: ${isDirectory})`);
      } catch (error) {
        console.error(`Error processing symlink ${fullPath}:`, error);
        continue; // Skip this entry if we can't resolve the symlink
      }
    }

    if (isDirectory) {
      // For directories (or symlinks to directories), recursively build the tree
      let children = [];
      try {
        children = await buildFileTree(targetPath, relativePath, followSymlinks);
      } catch (error) {
        console.error(`Error reading directory ${targetPath}:`, error);
      }

      tree.push({
        name: entry.name,
        path: relativePath,
        isDirectory: true,
        isSymlink: entry.isSymbolicLink(),
        targetPath: entry.isSymbolicLink() ? targetPath : undefined,
        children
      });
    } else {
      // For files, check if they match our extensions
      if (entry.name.endsWith('.rec') || entry.name.endsWith('.recb')) {
        tree.push({
          name: entry.name,
          path: relativePath,
          isDirectory: false,
          isSymlink: entry.isSymbolicLink(),
          targetPath: entry.isSymbolicLink() ? targetPath : undefined
        });
      }
    }
  }

  return tree;
}

// Convert the title of PR into the branch
export function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[\s\_]+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-+/g, '-');
}

// Helper function to extract duration from rep file content
export function extractDuration(content) {
  const durationMatch = content.match(/––– duration: (\d+)ms/);
  return durationMatch ? parseInt(durationMatch[1], 10) : null;
}

// Make sure that we use the origin with the user's authentication token when connecting online
export async function ensureGitRemoteWithToken(gitInstance, token, REPO_URL) {
  if (!token) {
    console.warn('No token provided for git remote configuration');
    return;
  }

  try {
    // Use the REPO_URL variable directly for consistent base URL
    const tokenUrl = REPO_URL.replace('https://', `https://x-access-token:${token}@`);

    // Remove existing origin and add new one with token
    await gitInstance.removeRemote('origin').catch(() => {
      // Ignore error if remote doesn't exist
    });
    await gitInstance.addRemote('origin', tokenUrl);
    console.log('Git remote configured with authentication token');
  } catch (error) {
    console.warn('Error configuring git remote with token:', error.message);
    throw new Error(`Failed to configure git authentication: ${error.message}`);
  }
}

// Setup routes function
export function setupRoutes(app, isAuthenticated, dependencies) {
  const {
    WORKDIR,
    ROOT_DIR,
    REPO_URL,
    __dirname,
    getAuthConfig,
    ensureUserRepo
  } = dependencies;

  // API health check endpoint - can be used to verify authentication
  app.get('/api/health', isAuthenticated, (req, res) => {
    return res.json({
      status: 'ok',
      authenticated: req.isAuthenticated(),
      user: req.user ? req.user.username : null
    });
  });

  // API endpoint to get the file tree
  app.get('/api/get-file-tree', isAuthenticated, async (req, res) => {
    try {
      // Get fresh auth config
      const authConfig = getAuthConfig();
      
      // Ensure user repo exists
      const username = req.user?.username || (authConfig.skipAuth ? 'dev-mode' : null);
      if (username) {
        await ensureUserRepo(username);
      }

      // Get the user's test directory
      const testDir = getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const testDirExists = await fs.access(testDir).then(() => true).catch(() => false);

      if (!testDirExists) {
        return res.status(404).json({ error: 'Test directory not found' });
      }

      // Build the file tree with the user's test directory as the base
      const fileTree = await buildFileTree(testDir);

      // Return the file tree directly without wrapping in a virtual root node
      res.json({ fileTree });
    } catch (error) {
      console.error('Error getting file tree:', error);
      res.status(500).json({ error: 'Failed to get file tree' });
    }
  });

  // API endpoint to get file content
  app.get('/api/get-file', isAuthenticated, async (req, res) => {
    try {
      const { path: filePath } = req.query;

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

      // For .rec and .recb files, use WASM parsing to return structured content
      if (filePath.endsWith('.rec') || filePath.endsWith('.recb')) {
        try {
          console.log(`📖 Loading structured test file via WASM: ${absolutePath}`);
          
          // Get raw content first
          const rawContent = await fs.readFile(absolutePath, 'utf8');
          
          // Parse .rec file using WASM with file content map (NO file I/O in WASM)
          console.log(`📖 Parsing .rec file with WASM using content map: ${absolutePath}`);
          
          // Create file content map for WASM
          const fileMap = await createFileContentMap(absolutePath, testDir, req);
          const relativeFilePath = path.relative(testDir, absolutePath);
          
          // Call WASM with path + content map (NO FALLBACK)
          const testStructure = await parseRecFileFromMapWasm(relativeFilePath, fileMap);
          
          // Convert WASM structure to UI commands format
          const uiCommands = convertTestStructureToLegacyCommands(testStructure);
          
          res.json({ 
            content: rawContent,
            structuredData: testStructure,  // Keep for future use
            commands: uiCommands,          // For current UI compatibility
            wasmparsed: true
          });
        } catch (error) {
          console.error('WASM parsing failed:', error);
          // Return raw content if WASM fails
          const rawContent = await fs.readFile(absolutePath, 'utf8');
          res.json({ 
            content: rawContent,
            structuredData: null,
            commands: [],                  // Empty commands array
            wasmparsed: false,
            error: error.message
          });
        }
      } else {
        // For non-test files, return raw content
        const content = await fs.readFile(absolutePath, 'utf8');
        res.json({ content });
      }
    } catch (error) {
      console.error('Error reading file:', error);
      res.status(404).json({ error: 'File not found or could not be read' });
    }
  });

  // API endpoint to save file content
  app.post('/api/save-file', isAuthenticated, async (req, res) => {
    try {
      const { path: filePath, content, structuredData } = req.body;

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

      // Ensure directory exists
      const directory = path.dirname(absolutePath);
      await fs.mkdir(directory, { recursive: true });

      // For .rec and .recb files, try WASM generation if structured data is provided
      if ((filePath.endsWith('.rec') || filePath.endsWith('.recb')) && structuredData) {
        console.log(`💾 Saving structured test file via WASM: ${absolutePath}`);
        
        try {
          // Create file content map for any referenced block files (same as reading)
          const existingFileMap = await createFileContentMap(absolutePath, testDir, req).catch(() => ({}));
          
          // Use WASM to generate file content map from structured data
          const relativeFilePath = path.relative(testDir, absolutePath);
          const generatedFileContentMap = await generateRecFileToMapWasm(relativeFilePath, structuredData);
          
          // Get the generated content for the main file
          const generatedContent = generatedFileContentMap[relativeFilePath];
          
          if (generatedContent && generatedContent.length > 0) {
            // Write the generated content to disk
            await fs.writeFile(absolutePath, generatedContent, 'utf8');
            console.log('✅ File saved via WASM generation');
            res.json({ 
              success: true,
              method: 'wasm',
              generatedContent: generatedContent
            });
            return;
          } else {
            console.warn('WASM generation returned empty content, falling back to manual content');
          }
        } catch (error) {
          console.error('WASM generation failed:', error);
          console.warn('Falling back to manual content');
        }
      }
      
      // Fallback: save the manual content directly
      if (content !== undefined) {
        await fs.writeFile(absolutePath, content, 'utf8');
        console.log('✅ File saved via manual content');
        res.json({ 
          success: true,
          method: 'manual'
        });
      } else {
        return res.status(400).json({ error: 'File path and content (or structuredData) are required' });
      }
    } catch (error) {
      console.error('Error saving file:', error);
      res.status(500).json({ error: 'Failed to save file' });
    }
  });

  // API endpoint to move or rename a file
  app.post('/api/move-file', isAuthenticated, async (req, res) => {
    try {
      const { sourcePath, targetPath } = req.body;

      if (!sourcePath || !targetPath) {
        return res.status(400).json({ error: 'Source and target paths are required' });
      }

      // Use the user's test directory as the base
      const testDir = getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const absoluteSourcePath = path.join(testDir, sourcePath);
      const absoluteTargetPath = path.join(testDir, targetPath);

      // Basic security check to ensure both paths are within the test directory
      if (!absoluteSourcePath.startsWith(testDir) || !absoluteTargetPath.startsWith(testDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Ensure target directory exists
      const targetDir = path.dirname(absoluteTargetPath);
      await fs.mkdir(targetDir, { recursive: true });

      // Move/rename the file
      await fs.rename(absoluteSourcePath, absoluteTargetPath);

      res.json({ success: true });
    } catch (error) {
      console.error('Error moving file:', error);
      res.status(500).json({ error: 'Failed to move file' });
    }
  });

  // API endpoint to delete a file
  app.delete('/api/delete-file', isAuthenticated, async (req, res) => {
    try {
      const { path: filePath } = req.body;

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

      // Check if it's a file or directory
      const stats = await fs.stat(absolutePath);

      if (stats.isDirectory()) {
        // For directories, use recursive removal
        await fs.rm(absolutePath, { recursive: true });
      } else {
        // For individual files
        await fs.unlink(absolutePath);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting file:', error);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

  // API endpoint to create directory
  app.post('/api/create-directory', isAuthenticated, async (req, res) => {
    try {
      const { path: dirPath } = req.body;

      if (!dirPath) {
        return res.status(400).json({ error: 'Directory path is required' });
      }

      // Use the user's test directory as the base
      const testDir = getUserTestPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      const absolutePath = path.join(testDir, dirPath);

      // Basic security check to ensure the path is within the test directory
      if (!absolutePath.startsWith(testDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Create directory recursively
      await fs.mkdir(absolutePath, { recursive: true });

      res.json({ success: true, path: dirPath });
    } catch (error) {
      console.error('Error creating directory:', error);
      res.status(500).json({ error: 'Failed to create directory' });
    }
  });

  // API endpoint to get patterns file
  app.get('/api/get-patterns', isAuthenticated, async (req, res) => {
    try {
      console.log('🎯 Getting merged patterns for user repository');
      
      // Get the user's repository path for pattern context
      const authConfig = getAuthConfig();
      const username = req.user?.username || (authConfig.skipAuth ? 'dev-mode' : null);
      let userRepoPath = null;
      
      if (username) {
        userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
        console.log(`Using user repo path for patterns: ${userRepoPath}`);
      }
      
      // Get merged patterns (system + project)
      try {
        const patterns = await getMergedPatterns(userRepoPath || __dirname, __dirname);
        console.log(`✅ Found ${Object.keys(patterns).length} merged patterns`);
        return res.json({ patterns });
      } catch (patternError) {
        console.error('Pattern merging failed:', patternError);
        // Return empty patterns instead of failing
        return res.json({ patterns: {} });
      }
    } catch (error) {
      console.error('Error getting patterns:', error);
      res.status(500).json({ error: 'Failed to get patterns' });
    }
  });
}