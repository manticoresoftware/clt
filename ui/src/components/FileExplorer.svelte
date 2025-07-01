<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { filesStore, type FileNode, addNodeToDirectory, updateChildPaths } from '../stores/filesStore';
  import { branchStore } from '../stores/branchStore';
  import { repoSyncStore } from '../stores/repoSyncStore';
  import { gitStatusStore, checkUnstagedChanges } from '../stores/gitStatusStore';
  import { API_URL } from '../config.js';

  // Default to tests directory
  let currentDirectory = 'tests';
  let fileTree: FileNode[] = [];
  let newFileName = '';
  let expandedFolders: Set<string> = new Set();
  let selectedFolder: string | null = null; // Track selected folder for creation context

  // Reset branch state
  let resetBranch = 'master';

  // Update resetBranch when default branch is loaded
  $: if ($branchStore.defaultBranch) {
    resetBranch = $branchStore.defaultBranch;
  }

  // Parse URL parameters
  function parseUrlParams(): {
    filePath?: string;
    testPath?: string;
    dockerImage?: string;
    branch?: string;
    failedTests?: string[];
  } {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    
    let filePath: string | undefined;
    
    // Check for hash-based file path (legacy support)
    if (hash && hash.startsWith('#file-')) {
      filePath = decodeURIComponent(hash.substring(6));
    }
    
    // Check for query parameter file path (preferred)
    if (params.has('file')) {
      filePath = params.get('file') || undefined;
    }
    
    return {
      filePath,
      testPath: params.get('test_path') || undefined,
      dockerImage: params.get('docker_image') || undefined,
      branch: params.get('branch') || undefined,
      failedTests: params.getAll('failed_tests[]')
    };
  }

  // Store failed tests for highlighting
  let failedTestPaths: Set<string> = new Set();

  // Handler for reset to branch with unstaged changes check
  async function handleResetToBranch() {
    if (!resetBranch) return;

    // Check for unstaged changes before proceeding
    const canProceed = await checkUnstagedChanges();
    if (!canProceed) {
      return; // User cancelled
    }

    try {
      await branchStore.resetToBranch(resetBranch);

      // Refresh the file tree after reset
      preserveExpandedState();
      await filesStore.refreshFileTree();

      // Re-expand default folders after reset
      if (fileTree) {
        const testsNode = fileTree.find(node => node.name === 'tests');
        if (testsNode && testsNode.isDirectory) {
          expandedFolders.add(testsNode.path);
        }
        expandedFolders = expandedFolders;
      }
    } catch (error) {
      console.error('Failed to reset to branch:', error);
      alert(`Failed to reset to branch ${resetBranch}: ${error.message}`);
    }
  }
  // Drag and drop state
  let draggedNode: FileNode | null = null;
  let dropTarget: FileNode | null = null;
  let dragOverRecycleBin = false;
  let showRecycleBin = false;

  // New file/folder creation state
  let isCreatingNew = false;
  let newItemType: 'file' | 'folder' | null = null;
  let newItemName = '';
  let newItemParentPath = '';
  let newItemInputElement: HTMLInputElement;

  // Store expanded folders state and preserve it during updates
  let preservedExpandedFolders: Set<string> = new Set();

  // Preserve expanded state when file tree updates
  $: {
    if ($filesStore.fileTree) {
      // If we have preserved state, restore it
      if (preservedExpandedFolders.size > 0) {
        expandedFolders = new Set(preservedExpandedFolders);
        preservedExpandedFolders.clear();
      }
      fileTree = $filesStore.fileTree;
    }
  }

  // Save expanded state before potential tree updates
  function preserveExpandedState() {
    preservedExpandedFolders = new Set(expandedFolders);
  }



  function toggleFolder(node: FileNode, event: MouseEvent) {
    event.stopPropagation();
    if (node.isDirectory) {
      if (expandedFolders.has(node.path)) {
        expandedFolders.delete(node.path);
      } else {
        expandedFolders.add(node.path);
      }
      expandedFolders = expandedFolders; // Trigger reactivity
    }
  }

  function selectFile(node: FileNode, event: MouseEvent) {
    event.stopPropagation();
    if (!node.isDirectory && (node.path.endsWith('.rec') || node.path.endsWith('.recb'))) {
      // Update URL with the file path
      updateUrlWithFilePath(node.path);

      // Load the file from the backend
      fetchFileContent(node.path);
    }
  }

  // Update URL with file path using query parameters
  function updateUrlWithFilePath(path: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('test_path', path);
    window.history.pushState({}, '', url.toString());
  }

  async function fetchFileContent(path: string) {
    try {
      // Use loadFile method from filesStore which now uses our new parsing function
      const success = await filesStore.loadFile(path);

      if (!success) {
        // Show error instead of creating file
        console.error(`File not found: ${path}`);
        alert(`Error: File "${path}" does not exist.`);
        // Clear the URL hash to remove the invalid file reference
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
        return;
      }
    } catch (error) {
      console.error('Error loading file:', error);
      alert(`Error loading file "${path}": ${error.message || error}`);
      // Clear the URL hash to remove the invalid file reference
      window.history.replaceState({}, '', window.location.pathname + window.location.search);
    }
  }

  // Get the context for creating new items (VSCode-style)
  function getCreationContext(): string {
    // Priority 1: If a folder is explicitly selected, use it
    if (selectedFolder) {
      return selectedFolder;
    }
    
    // Priority 2: If a file is selected, use its parent directory
    const selectedFile = $filesStore.currentFile;
    if (selectedFile) {
      // Find the selected node in the file tree
      function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
        for (const node of nodes) {
          if (node.path === path) return node;
          if (node.children) {
            const found = findNodeByPath(node.children, path);
            if (found) return found;
          }
        }
        return null;
      }
      
      const selectedNode = findNodeByPath(fileTree, selectedFile.path);
      
      if (selectedNode && !selectedNode.isDirectory) {
        // Selected a file - create in same directory as the file
        const parentPath = selectedNode.path.substring(0, selectedNode.path.lastIndexOf('/'));
        return parentPath;
      }
    }
    
    // Priority 3: Root level (empty string)
    return '';
  }

  // Clear folder selection
  function clearSelection() {
    console.log('Clearing selection...');
    console.log('Before clear - selectedFolder:', selectedFolder);
    console.log('Before clear - currentFile:', $filesStore.currentFile?.path);
    
    selectedFolder = null;
    
    // Clear file selection by clearing the URL hash and updating the store
    if ($filesStore.currentFile) {
      // Clear the URL to deselect the file
      window.history.pushState({}, '', window.location.pathname);
      
      // Clear the current file from the store
      filesStore.clearCurrentFile();
    }
    
    console.log('After clear - selectedFolder:', selectedFolder);
  }

  // Delete selected item with confirmation
  function deleteSelectedItem() {
    const itemToDelete = selectedFolder || $filesStore.currentFile?.path;
    
    if (!itemToDelete) return;
    
    const itemName = itemToDelete.split('/').pop();
    const isFolder = selectedFolder !== null;
    const itemType = isFolder ? 'folder' : 'file';
    
    const confirmed = confirm(`Are you sure you want to delete the ${itemType} "${itemName}"?\n\nThis action cannot be undone.`);
    
    if (confirmed) {
      filesStore.deleteFile(itemToDelete)
        .then(success => {
          if (success) {
            console.log(`${itemType} deleted:`, itemToDelete);
            // Clear selection after deletion
            clearSelection();
          } else {
            alert(`Failed to delete ${itemType}: ${itemName}`);
          }
        })
        .catch(error => {
          console.error(`Error deleting ${itemType}:`, error);
          alert(`Error deleting ${itemType}: ${error.message}`);
        });
    }
  }

  // VSCode-style new file/folder creation
  function startCreatingNewFile() {
    console.log('Starting to create new file...');
    cancelNewItem(); // Cancel any existing creation
    isCreatingNew = true;
    newItemType = 'file';
    newItemName = '';
    newItemParentPath = getCreationContext();
    console.log('New file context:', newItemParentPath);
    
    // Focus input after DOM update
    setTimeout(() => {
      if (newItemInputElement) {
        newItemInputElement.focus();
        newItemInputElement.select();
        console.log('Input focused');
      } else {
        console.log('Input element not found');
      }
    }, 50);
  }

  function startCreatingNewFolder() {
    console.log('Starting to create new folder...');
    cancelNewItem(); // Cancel any existing creation
    isCreatingNew = true;
    newItemType = 'folder';
    newItemName = '';
    newItemParentPath = getCreationContext();
    console.log('New folder context:', newItemParentPath);
    
    // Focus input after DOM update
    setTimeout(() => {
      if (newItemInputElement) {
        newItemInputElement.focus();
        newItemInputElement.select();
        console.log('Input focused');
      } else {
        console.log('Input element not found');
      }
    }, 50);
  }

  function cancelNewItem() {
    isCreatingNew = false;
    newItemType = null;
    newItemName = '';
    newItemParentPath = '';
  }

  function confirmNewItem() {
    if (!newItemName.trim()) {
      cancelNewItem();
      return;
    }

    let finalName = newItemName.trim();
    
    if (newItemType === 'file') {
      // Add .rec extension if none is provided
      if (!finalName.endsWith('.rec') && !finalName.endsWith('.recb')) {
        finalName += '.rec';
      }
      
      const path = newItemParentPath ? `${newItemParentPath}/${finalName}` : finalName;
      filesStore.createNewFile(path);
      updateUrlWithFilePath(path);
    } else if (newItemType === 'folder') {
      const path = newItemParentPath ? `${newItemParentPath}/${finalName}` : finalName;
      createDirectory(path);
    }

    cancelNewItem();
  }

  // Check if input should be shown at a specific location
  function shouldShowInputAt(nodePath: string): boolean {
    if (!isCreatingNew) return false;
    
    // Show at root level if no parent path
    if (!newItemParentPath && nodePath === 'root') return true;
    
    // Show inside the target directory
    return newItemParentPath === nodePath;
  }

  // Force reactivity when creation state changes
  $: {
    if (isCreatingNew) {
      // Trigger a re-render to ensure input appears
      fileTree = fileTree;
    }
  }

  function handleNewItemKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      confirmNewItem();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelNewItem();
    }
  }

  function handleNewItemBlur(event: FocusEvent) {
    // Small delay to allow for potential click on confirm button
    setTimeout(() => {
      if (isCreatingNew) {
        cancelNewItem();
      }
    }, 100);
  }

  // Handle clicks outside to cancel creation
  function handleDocumentClick(event: MouseEvent) {
    if (isCreatingNew && newItemInputElement) {
      const target = event.target as Element;
      const inputContainer = newItemInputElement.closest('.new-item-input-container');
      const headerActions = document.querySelector('.header-actions');
      
      // Don't cancel if clicking on input, header actions, or their children
      if (!inputContainer?.contains(target) && !headerActions?.contains(target)) {
        cancelNewItem();
      }
    }
  }

  // Legacy function - keep for compatibility but simplify
  function createNewFile() {
    if (!newFileName) return;

    // Check if this is a directory request (ends with /)
    const isDirectory = newFileName.endsWith('/');

    // For files, add .rec extension if none is provided
    if (!isDirectory && !newFileName.endsWith('.rec') && !newFileName.endsWith('.recb')) {
      newFileName += '.rec';
    }

    // Always create in the current directory
    const path = `${currentDirectory}/${newFileName}`;

    if (isDirectory) {
      // Create directory
      createDirectory(path);
    } else {
      // Create file and update URL
      filesStore.createNewFile(path);
      updateUrlWithFilePath(path);
    }

    newFileName = '';
  }

  // Function to create directory
  async function createDirectory(path: string) {
    try {
      // Remove trailing slash for consistency
      const cleanPath = path.replace(/\/$/, '');

      // Extract directory name and parent path
      const dirName = cleanPath.split('/').pop() || '';
      const parentPath = cleanPath.substring(0, cleanPath.lastIndexOf('/'));

      // Create a new node for the directory
      const newNode: FileNode = {
        name: dirName,
        path: cleanPath,
        isDirectory: true,
        children: []
      };

      // Update the file tree optimistically
      const state = $filesStore;
      const updatedTree = addNodeToDirectory([...state.fileTree], parentPath, newNode);
      filesStore.setFileTree(updatedTree);

      // Expand the newly created directory
      expandedFolders.add(cleanPath);
      expandedFolders = expandedFolders; // Trigger reactivity

      // Now do the actual server request
      const response = await fetch(`${API_URL}/api/create-directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ path })
      });

      if (!response.ok) {
        // If server operation fails, refresh the file tree to restore correct state
        await filesStore.refreshFileTree();
        throw new Error(`Failed to create directory: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error creating directory:', error);
      alert(`Failed to create directory: ${error.message}`);
    }
  }

  // Initialize file explorer
  onMount(async () => {
    // Parse URL parameters
    const urlParams = parseUrlParams();
    
    // If we have parameters that might affect git state, check for unstaged changes first
    const hasGitAffectingParams = urlParams.branch || urlParams.filePath;
    if (hasGitAffectingParams) {
      const canProceed = await checkUnstagedChanges();
      if (!canProceed) {
        // User cancelled, clear URL parameters and stop processing
        const url = new URL(window.location.href);
        url.searchParams.delete('branch');
        url.searchParams.delete('file');
        window.history.replaceState({}, '', url.toString());
        
        // Continue with normal initialization but skip git operations
        await filesStore.refreshFileTree();
        
        // Start git status polling only if not already active
        if (!gitStatusStore.isPolling()) {
          gitStatusStore.startPolling(5000);
        }
        
        // Start file tree polling
        const fileTreePollingInterval = setInterval(async () => {
          await filesStore.refreshFileTree();
        }, 10000);
        
        window.addEventListener('popstate', handleUrlChange);
        document.addEventListener('click', handleDocumentClick);
        
        return () => {
          clearInterval(fileTreePollingInterval);
        };
      } else {
        // User confirmed, clean up URL parameters immediately
        const url = new URL(window.location.href);
        if (urlParams.branch) {
          url.searchParams.delete('branch');
        }
        if (urlParams.filePath) {
          url.searchParams.delete('file');
        }
        window.history.replaceState({}, '', url.toString());
      }
    }
    
    // Set failed tests for highlighting
    if (urlParams.failedTests) {
      failedTestPaths = new Set(urlParams.failedTests);
    }

    // Set docker image if provided
    if (urlParams.dockerImage) {
      filesStore.setDockerImage(urlParams.dockerImage);
    }

    // Handle branch switching if needed
    if (urlParams.branch && urlParams.branch !== $branchStore.currentBranch) {
      try {
        await branchStore.checkoutAndPull(urlParams.branch);
        

        
      } catch (error) {
        console.error('Failed to switch branch:', error);
        alert(`Failed to switch to branch "${urlParams.branch}": ${error.message}`);
      }
    }

    // Fetch the file tree from the backend
    preserveExpandedState();
    await filesStore.refreshFileTree();

    // Start git status polling only if not already active
    if (!gitStatusStore.isPolling()) {
      gitStatusStore.startPolling(5000); // Poll every 5 seconds
    }
    
    // Start file tree polling for new files
    const fileTreePollingInterval = setInterval(async () => {
      await filesStore.refreshFileTree();
    }, 10000); // Poll every 10 seconds

    // If file path is specified in URL, open it
    if (urlParams.filePath) {
      // Expand all parent folders to the file
      const pathParts = urlParams.filePath.split('/');
      let currentPath = '';
      for (let i = 0; i < pathParts.length - 1; i++) {
        if (i > 0) currentPath += '/';
        currentPath += pathParts[i];
        expandedFolders.add(currentPath);
      }
      expandedFolders = expandedFolders; // Trigger reactivity

      // Load the file
      fetchFileContent(urlParams.filePath);
    }

    // Listen for URL parameter changes
    window.addEventListener('popstate', handleUrlChange);
    
    // Listen for clicks to cancel new item creation
    document.addEventListener('click', handleDocumentClick);

    // Cleanup function
    return () => {
      clearInterval(fileTreePollingInterval);
    };
  });

  // Cleanup on destroy
  onDestroy(() => {
    gitStatusStore.stopPolling();
    window.removeEventListener('popstate', handleUrlChange);
    document.removeEventListener('click', handleDocumentClick);
  });

  // Drag handlers
  function handleDragStart(event: DragEvent, node: FileNode) {
    // Allow both files and directories to be dragged
    draggedNode = node;
    showRecycleBin = true;

    // Set dragging data
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', node.path);
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  function handleDragOver(event: DragEvent, node: FileNode) {
    event.preventDefault();
    if (draggedNode && draggedNode !== node) {
      // Only allow dropping onto directories
      if (node.isDirectory) {
        // Prevent dropping a directory into one of its descendants (which would create recursion)
        if (draggedNode.isDirectory) {
          // Check if target node is a descendant of the dragged node
          if (node.path.startsWith(draggedNode.path + '/')) {
            // Can't drop a directory into its own descendant
            return;
          }
        }

        dropTarget = node;
        event.dataTransfer!.dropEffect = 'move';
      }
    }
  }

  function handleDragLeave() {
    dropTarget = null;
  }

  function handleDrop(event: DragEvent, node: FileNode) {
    event.preventDefault();
    if (draggedNode && node.isDirectory) {
      const sourcePath = draggedNode.path;
      const fileName = draggedNode.name;
      const targetPath = `${node.path}/${fileName}`;

      // Don't do anything if dropping onto itself
      if (sourcePath === targetPath) {
        // Reset drag state
        draggedNode = null;
        dropTarget = null;
        showRecycleBin = false;
        return;
      }

      // Prevent dropping a directory into one of its descendants
      if (draggedNode.isDirectory && node.path.startsWith(draggedNode.path + '/')) {
        // Reset drag state
        draggedNode = null;
        dropTarget = null;
        showRecycleBin = false;
        return;
      }

      // Move the file or directory
      filesStore.moveFile(sourcePath, targetPath)
        .then(success => {
          if (success) {
            console.log(`Item moved from ${sourcePath} to ${targetPath}`);
          } else {
            console.error('Failed to move item');
          }
        });
    }

    // Reset drag state
    draggedNode = null;
    dropTarget = null;
    showRecycleBin = false;
  }

  function handleRecycleBinDragOver(event: DragEvent) {
    event.preventDefault();
    if (draggedNode) {
      dragOverRecycleBin = true;
      event.dataTransfer!.dropEffect = 'move';
    }
  }

  function handleRecycleBinDragLeave() {
    dragOverRecycleBin = false;
  }

  function handleRecycleBinDrop(event: DragEvent) {
    event.preventDefault();
    if (draggedNode) {
      // Delete the file
      filesStore.deleteFile(draggedNode.path)
        .then(success => {
          if (success) {
            console.log(`File deleted: ${draggedNode!.path}`);
          } else {
            console.error('Failed to delete file');
          }
        });
    }

    // Reset drag state
    draggedNode = null;
    dragOverRecycleBin = false;
    showRecycleBin = false;
  }

  function handleDragEnd() {
    // Reset drag state
    draggedNode = null;
    dropTarget = null;
    dragOverRecycleBin = false;
    showRecycleBin = false;
  }

  // Handle URL parameter changes
  async function handleUrlChange() {
    const urlParams = parseUrlParams();
    
    // If we have parameters that might affect git state, check for unstaged changes first
    const hasGitAffectingParams = urlParams.branch || urlParams.filePath;
    if (hasGitAffectingParams) {
      const canProceed = await checkUnstagedChanges();
      if (!canProceed) {
        // User cancelled, stop processing
        return;
      }
    }
    
    if (urlParams.filePath) {
      // Load the file if it's different from the current file
      if (!$filesStore.currentFile || $filesStore.currentFile.path !== urlParams.filePath) {
        fetchFileContent(urlParams.filePath);
      }
    } else {
      // Clear current file if no test_path parameter
      filesStore.clearCurrentFile();
    }
    
    // Update failed tests highlighting
    if (urlParams.failedTests) {
      failedTestPaths = new Set(urlParams.failedTests);
    } else {
      failedTestPaths = new Set();
    }
    
    // Update docker image if provided
    if (urlParams.dockerImage) {
      filesStore.setDockerImage(urlParams.dockerImage);
    }
    
    // Handle branch switching if needed
    if (urlParams.branch && urlParams.branch !== $branchStore.currentBranch) {
      try {
        await branchStore.checkoutAndPull(urlParams.branch);
        
        // Clear the branch parameter from URL after successful switch
        const url = new URL(window.location.href);
        url.searchParams.delete('branch');
        window.history.replaceState({}, '', url.toString());
        
      } catch (error) {
        console.error('Failed to switch branch:', error);
        alert(`Failed to switch to branch "${urlParams.branch}": ${error.message}`);
      }
    }
  }

  // For development/testing purposes
  function useMockFileTree() {
    const mockFileTree = [
      {
        name: 'tests',
        path: 'tests',
        isDirectory: true,
        children: [
          {
            name: 'basic.rec',
            path: 'tests/basic.rec',
            isDirectory: false
          },
          {
            name: 'advanced',
            path: 'tests/advanced',
            isDirectory: true,
            children: [
              {
                name: 'feature1.rec',
                path: 'tests/advanced/feature1.rec',
                isDirectory: false
              },
              {
                name: 'feature2.rec',
                path: 'tests/advanced/feature2.rec',
                isDirectory: false
              }
            ]
          }
        ]
      }
    ];

    filesStore.setFileTree(mockFileTree);
  }

  function handleNodeClick(event: MouseEvent, node: FileNode) {
    if (node.isDirectory) {
      // Set this folder as selected for creation context
      selectedFolder = node.path;
      // Also expand/collapse the folder
      toggleFolder(node, event);
      // Update current directory when selecting a folder
      currentDirectory = node.path;
    } else {
      // Clear folder selection when selecting a file
      selectedFolder = null;
      selectFile(node, event);
    }
  }

  // Check if directory contains failed tests (same pattern as isDirModified)
  function isDirWithFailedTests(dirPath: string): boolean {
    // Check if any failed test is within this directory
    for (const failedTest of failedTestPaths) {
      if (failedTest.startsWith(dirPath + '/')) {
        return true;
      }
    }
    return false;
  }

  // Get git status for a file (reactive) with failed test highlighting
  function getFileGitStatus(filePath: string): string | null {
    // Check if file is in failed tests first
    if (failedTestPaths.has(filePath)) {
      return 'F'; // Special status for failed tests
    }
    
    // Check if this is a directory containing failed tests (same as isDirModified pattern)
    if (isDirWithFailedTests(filePath)) {
      return 'F'; // Mark directories with failed tests
    }
    
    // Try exact match first
    const exactMatch = $gitStatusStore.modifiedFiles.find(file => file.path === filePath);
    if (exactMatch) {
      return exactMatch.status;
    }
    
    // Git paths include testPath prefix (e.g., "test/clt-tests/buddy/file.rec")
    // File explorer paths are relative to testPath (e.g., "buddy/file.rec")
    // Strip the testPath prefix from git paths for comparison
    const testPath = $gitStatusStore.testPath || '';
    const testPathPrefix = testPath ? testPath + '/' : '';
    
    const matchWithPrefix = $gitStatusStore.modifiedFiles.find(file => {
      // Remove testPath prefix from git path
      const relativePath = file.path.startsWith(testPathPrefix) 
        ? file.path.substring(testPathPrefix.length)
        : file.path;
      return relativePath === filePath;
    });
    
    return matchWithPrefix ? matchWithPrefix.status : null;
  }

  // Check if directory has changes (reactive)
  function isDirModified(dirPath: string): boolean {
    // Git paths include testPath prefix, file explorer paths are relative to testPath
    const testPath = $gitStatusStore.testPath || '';
    const testPathPrefix = testPath ? testPath + '/' : '';
    
    // Try exact match first (with testPath prefix added)
    const fullDirPath = testPathPrefix + dirPath;
    if ($gitStatusStore.modifiedDirs.includes(fullDirPath)) {
      return true;
    }
    
    // Also try without prefix in case modifiedDirs already has relative paths
    if ($gitStatusStore.modifiedDirs.includes(dirPath)) {
      return true;
    }
    
    // Check if any modified files are within this directory
    const hasModifiedFilesInDir = $gitStatusStore.modifiedFiles.some(file => {
      // Remove testPath prefix from git file path
      const relativePath = file.path.startsWith(testPathPrefix) 
        ? file.path.substring(testPathPrefix.length)
        : file.path;
      
      // Check if file is within this directory
      return relativePath.startsWith(dirPath + '/');
    });
    
    return hasModifiedFilesInDir;
  }

  // Get git status display text
  function getGitStatusDisplay(status: string | null): string {
    if (!status) return '';
    switch (status) {
      case 'M': return 'M';
      case 'A': return 'A';
      case 'D': return 'D';
      case 'R': return 'R';
      case 'C': return 'C';
      case 'U': return 'U';
      case '??': return 'U'; // Untracked
      case 'F': return 'F'; // Failed test
      default: return status;
    }
  }

  // Get git status color class
  function getGitStatusClass(status: string | null): string {
    if (!status) return '';
    switch (status) {
      case 'M': return 'git-modified';
      case 'A': return 'git-added';
      case 'D': return 'git-deleted';
      case 'R': return 'git-renamed';
      case 'C': return 'git-copied';
      case 'U': return 'git-unmerged';
      case '??': return 'git-untracked';
      case 'F': return 'git-failed'; // Failed test
      default: return 'git-unknown';
    }
  }

  // Create a recursive component to render the file tree
  function renderNode(node: FileNode, depth: number = 0) {
    const paddingLeft = `${depth * 16}px`;
    const isSelected = node.path === $filesStore.currentFile?.path;
    const isExpanded = node.isDirectory && expandedFolders.has(node.path);

    return `
      <div class="file-node">
        <div class="tree-item ${isSelected ? 'selected' : ''}"
             role="button"
             tabindex="0"
             style="padding-left: ${paddingLeft};"
             on:click={(e) => handleNodeClick(e, node)}
             on:keydown={(e) => e.key === 'Enter' && handleNodeClick(e, node)}>
          <div class="tree-item-icon ${node.isDirectory ? (isExpanded ? 'tree-item-folder-open' : 'tree-item-folder') : ''}">
            ${node.isDirectory
              ? (isExpanded
                ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v1.5a1.5 1.5 0 01-3 0V6z" clip-rule="evenodd" /><path d="M6 12a2 2 0 012-2h8a2 2 0 012 2v2a2 2 0 01-2 2H2h2a2 2 0 002-2v-2z" /></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>')
              : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" /></svg>'}
          </div>
          <span class="tree-item-name">${node.name}</span>
          ${node.isDirectory ? `
            <div class="tree-item-arrow ${isExpanded ? 'expanded' : ''}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
              </svg>
            </div>
          ` : ''}
        </div>

        ${node.isDirectory && node.children && isExpanded ? `
          <div class="tree-children">
            ${node.children.map(child => renderNode(child, depth + 1)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }
</script>

<div class="file-explorer">
  <div class="file-explorer-header">
    <div class="header-left">
      <span>Files</span>
      {#if selectedFolder}
        <span class="creation-context">→ {selectedFolder.split('/').pop()}</span>
      {:else if $filesStore.currentFile}
        <span class="creation-context">→ {$filesStore.currentFile.path.split('/').slice(0, -1).pop() || 'root'}</span>
      {:else}
        <span class="creation-context">→ root</span>
      {/if}
    </div>
    <div class="header-actions">
      <!-- New File Button -->
      <button
        class="header-action-button"
        on:click|stopPropagation={startCreatingNewFile}
        title="New File"
        aria-label="Create new file"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="12" y1="18" x2="12" y2="12"></line>
          <line x1="9" y1="15" x2="15" y2="15"></line>
        </svg>
      </button>

      <!-- New Folder Button -->
      <button
        class="header-action-button"
        on:click|stopPropagation={startCreatingNewFolder}
        title="New Folder"
        aria-label="Create new folder"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          <line x1="12" y1="11" x2="12" y2="17"></line>
          <line x1="9" y1="14" x2="15" y2="14"></line>
        </svg>
      </button>

      <!-- Clear Selection Button -->
      {#if selectedFolder || $filesStore.currentFile}
        <button
          class="header-action-button"
          on:click|stopPropagation={clearSelection}
          title="Clear Selection (Create in Root)"
          aria-label="Clear selection"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <!-- Delete Selected Button (Last position) -->
        <button
          class="header-action-button delete-button"
          on:click|stopPropagation={deleteSelectedItem}
          title="Delete Selected Item"
          aria-label="Delete selected file or folder"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      {/if}

      {#if showRecycleBin}
        <div
          class="recycle-bin {dragOverRecycleBin ? 'recycle-bin-active' : ''}"
          on:dragover={handleRecycleBinDragOver}
          on:dragleave={handleRecycleBinDragLeave}
          on:drop={handleRecycleBinDrop}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </div>
      {/if}
    </div>
  </div>

  <div class="file-tree">
    {#if fileTree && fileTree.length > 0}
      <!-- Inline new item input at root level -->
      {#if shouldShowInputAt('root')}
        <div class="new-item-input-container">
          <div class="tree-item new-item-input">
            <div class="tree-item-icon">
              {#if newItemType === 'folder'}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                </svg>
              {/if}
            </div>
            <input
              type="text"
              class="new-item-name-input"
              bind:this={newItemInputElement}
              bind:value={newItemName}
              on:keydown={handleNewItemKeydown}
              on:blur={handleNewItemBlur}
              placeholder={newItemType === 'folder' ? 'Folder name' : 'File name'}
            />
          </div>
        </div>
      {/if}

      <!-- Render each file tree node recursively -->
      {#each fileTree as node}
        <div class="file-node">
          <div
            class="tree-item {node.path === $filesStore.currentFile?.path ? 'selected' : ''} {selectedFolder === node.path ? 'folder-selected' : ''} {dropTarget === node ? 'drop-target' : ''} {getFileGitStatus(node.path) || isDirModified(node.path) ? 'has-git-status' : ''} {getGitStatusClass(getFileGitStatus(node.path)) || (isDirModified(node.path) ? 'git-modified' : '')}"
            role="button"
            tabindex="0"
            draggable={true}
            on:dragstart={(e) => handleDragStart(e, node)}
            on:dragover={(e) => handleDragOver(e, node)}
            on:dragleave={handleDragLeave}
            on:drop={(e) => handleDrop(e, node)}
            on:dragend={handleDragEnd}
            on:click={(e) => handleNodeClick(e, node)}
            on:keydown={(e) => e.key === 'Enter' && handleNodeClick(e, node)}
          >
            <div class="tree-item-icon {node.isDirectory ? (expandedFolders.has(node.path) ? 'tree-item-folder-open' : 'tree-item-folder') : ''}">
              {#if node.isDirectory}
                {#if expandedFolders.has(node.path)}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v1.5a1.5 1.5 0 01-3 0V6z" clip-rule="evenodd" />
                    <path d="M6 12a2 2 0 012-2h8a2 2 0 012 2v2a2 2 0 01-2 2H2h2a2 2 0 002-2v-2z" />
                  </svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                {/if}
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                </svg>
              {/if}

              {#if node.isSymlink}
                <span class="symlink-indicator">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                  </svg>
                </span>
              {/if}
            </div>
            <span class="tree-item-name">{node.name}</span>
            
            <!-- Git status indicator -->
            {#if !node.isDirectory}
              {@const gitStatus = getFileGitStatus(node.path)}
              {#if gitStatus}
                <span class="git-status-indicator {getGitStatusClass(gitStatus)}">
                  {getGitStatusDisplay(gitStatus)}
                </span>
              {/if}
            {:else if isDirModified(node.path)}
              <span class="git-status-indicator git-modified">M</span>
            {/if}
            
            {#if node.isDirectory}
              <div class="tree-item-arrow {expandedFolders.has(node.path) ? 'expanded' : ''}">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                </svg>
              </div>
            {/if}
          </div>

          <!-- Recursive rendering of children -->
          {#if node.isDirectory && node.children && expandedFolders.has(node.path)}
            <div class="tree-children">
              <!-- Inline new item input inside this directory -->
              {#if shouldShowInputAt(node.path)}
                <div class="new-item-input-container">
                  <div class="tree-item new-item-input">
                    <div class="tree-item-icon">
                      {#if newItemType === 'folder'}
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                        </svg>
                      {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                        </svg>
                      {/if}
                    </div>
                    <input
                      type="text"
                      class="new-item-name-input"
                      bind:this={newItemInputElement}
                      bind:value={newItemName}
                      on:keydown={handleNewItemKeydown}
                      on:blur={handleNewItemBlur}
                      placeholder={newItemType === 'folder' ? 'Folder name' : 'File name'}
                    />
                  </div>
                </div>
              {/if}

              {#each node.children as childNode}
                <!-- Recursive File Node Template -->
                <div class="file-node">
                  <div
                    class="tree-item {childNode.path === $filesStore.currentFile?.path ? 'selected' : ''} {selectedFolder === childNode.path ? 'folder-selected' : ''} {dropTarget === childNode ? 'drop-target' : ''} {getFileGitStatus(childNode.path) || isDirModified(childNode.path) ? 'has-git-status' : ''} {getGitStatusClass(getFileGitStatus(childNode.path)) || (isDirModified(childNode.path) ? 'git-modified' : '')}"
                    role="button"
                    tabindex="0"
                    draggable={true}
                    on:dragstart={(e) => handleDragStart(e, childNode)}
                    on:dragover={(e) => handleDragOver(e, childNode)}
                    on:dragleave={handleDragLeave}
                    on:drop={(e) => handleDrop(e, childNode)}
                    on:dragend={handleDragEnd}
                    on:click={(e) => handleNodeClick(e, childNode)}
                    on:keydown={(e) => e.key === 'Enter' && handleNodeClick(e, childNode)}
                  >
                    <div class="tree-item-icon {childNode.isDirectory ? (expandedFolders.has(childNode.path) ? 'tree-item-folder-open' : 'tree-item-folder') : ''}">
                      {#if childNode.isDirectory}
                        {#if expandedFolders.has(childNode.path)}
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v1.5a1.5 1.5 0 01-3 0V6z" clip-rule="evenodd" />
                            <path d="M6 12a2 2 0 012-2h8a2 2 0 012 2v2a2 2 0 01-2 2H2h2a2 2 0 002-2v-2z" />
                          </svg>
                        {:else}
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                          </svg>
                        {/if}
                      {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                        </svg>
                      {/if}
                    </div>
                    <span class="tree-item-name">{childNode.name}</span>
                    
                    <!-- Git status indicator -->
                    {#if !childNode.isDirectory}
                      {@const gitStatus = getFileGitStatus(childNode.path)}
                      {#if gitStatus}
                        <span class="git-status-indicator {getGitStatusClass(gitStatus)}">
                          {getGitStatusDisplay(gitStatus)}
                        </span>
                      {/if}
                    {:else if isDirModified(childNode.path)}
                      <span class="git-status-indicator git-modified">M</span>
                    {/if}
                    
                    {#if childNode.isDirectory}
                      <div class="tree-item-arrow {expandedFolders.has(childNode.path) ? 'expanded' : ''}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                        </svg>
                      </div>
                    {/if}
                  </div>

                  <!-- Another level of recursion -->
                  {#if childNode.isDirectory && childNode.children && expandedFolders.has(childNode.path)}
                    <div class="tree-children">
                      <!-- Inline new item input inside this child directory -->
                      {#if shouldShowInputAt(childNode.path)}
                        <div class="new-item-input-container">
                          <div class="tree-item new-item-input">
                            <div class="tree-item-icon">
                              {#if newItemType === 'folder'}
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                                </svg>
                              {:else}
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                  <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                                </svg>
                              {/if}
                            </div>
                            <input
                              type="text"
                              class="new-item-name-input"
                              bind:this={newItemInputElement}
                              bind:value={newItemName}
                              on:keydown={handleNewItemKeydown}
                              on:blur={handleNewItemBlur}
                              placeholder={newItemType === 'folder' ? 'Folder name' : 'File name'}
                            />
                          </div>
                        </div>
                      {/if}

                      {#each childNode.children as grandChildNode}
                        <div class="file-node">
                          <div
                            class="tree-item {grandChildNode.path === $filesStore.currentFile?.path ? 'selected' : ''} {selectedFolder === grandChildNode.path ? 'folder-selected' : ''} {dropTarget === grandChildNode ? 'drop-target' : ''} {getFileGitStatus(grandChildNode.path) || isDirModified(grandChildNode.path) ? 'has-git-status' : ''} {getGitStatusClass(getFileGitStatus(grandChildNode.path)) || (isDirModified(grandChildNode.path) ? 'git-modified' : '')}"
                            role="button"
                            tabindex="0"
                            draggable={true}
                            on:dragstart={(e) => handleDragStart(e, grandChildNode)}
                            on:dragover={(e) => handleDragOver(e, grandChildNode)}
                            on:dragleave={handleDragLeave}
                            on:drop={(e) => handleDrop(e, grandChildNode)}
                            on:dragend={handleDragEnd}
                            on:click={(e) => handleNodeClick(e, grandChildNode)}
                            on:keydown={(e) => e.key === 'Enter' && handleNodeClick(e, grandChildNode)}
                          >
                            <div class="tree-item-icon {grandChildNode.isDirectory ? (expandedFolders.has(grandChildNode.path) ? 'tree-item-folder-open' : 'tree-item-folder') : ''}">
                              {#if grandChildNode.isDirectory}
                                {#if expandedFolders.has(grandChildNode.path)}
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v1.5a1.5 1.5 0 01-3 0V6z" clip-rule="evenodd" />
                                    <path d="M6 12a2 2 0 012-2h8a2 2 0 012 2v2a2 2 0 01-2 2H2h2a2 2 0 002-2v-2z" />
                                  </svg>
                                {:else}
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                                  </svg>
                                {/if}
                              {:else}
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                  <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                                </svg>
                              {/if}
                            </div>
                            <span class="tree-item-name">{grandChildNode.name}</span>
                            
                            <!-- Git status indicator -->
                            {#if !grandChildNode.isDirectory}
                              {@const gitStatus = getFileGitStatus(grandChildNode.path)}
                              {#if gitStatus}
                                <span class="git-status-indicator {getGitStatusClass(gitStatus)}">
                                  {getGitStatusDisplay(gitStatus)}
                                </span>
                              {/if}
                            {:else if isDirModified(grandChildNode.path)}
                              <span class="git-status-indicator git-modified">M</span>
                            {/if}
                            
                            {#if grandChildNode.isDirectory}
                              <div class="tree-item-arrow {expandedFolders.has(grandChildNode.path) ? 'expanded' : ''}">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                  <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                                </svg>
                              </div>
                            {/if}
                          </div>

                          <!-- Add more recursion if needed -->
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {:else}
      <div class="empty-tree-message">
        <p>No files found</p>
        <p>Default directory: tests</p>
      </div>
    {/if}
  </div>

  <div class="file-explorer-footer">
    <div class="branch-info">
      <span>
        {#if $branchStore.isLoading}
          <span class="loading-indicator-small">
            <svg class="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </span>
        {:else}
          <strong>{$branchStore.currentBranch}</strong>
        {/if}
      </span>
      {#if $branchStore.error}
        <div class="branch-error">{$branchStore.error}</div>
      {/if}
      <div class="branch-reset">
        <input
          type="text"
          bind:value={resetBranch}
          placeholder="e.g., master, main, feature/xyz"
          class="branch-input"
        />
        <button
          class="reset-button"
          on:click={handleResetToBranch}
          disabled={$branchStore.isResetting || !resetBranch}
        >
          {#if $branchStore.isResetting}
            <span class="loading-indicator-small">
              <svg class="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </span>
            Resetting...
          {:else}
            OK
          {/if}
        </button>
      </div>
      
      <!-- Repository Sync Section -->
      {#if $repoSyncStore.error || !$repoSyncStore.isInitialized}
        <div class="sync-section">
          <button
            class="sync-button"
            on:click={() => {
              repoSyncStore.syncRepository().then(() => {
                if (!$repoSyncStore.isInitialized) {
                  repoSyncStore.startSyncPolling();
                }
              });
            }}
            disabled={$repoSyncStore.isSyncing}
          >
            {#if $repoSyncStore.isSyncing}
              <span class="loading-indicator-small">
                <svg class="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </span>
              Syncing...
            {:else}
              🔄 Sync Repository
            {/if}
          </button>
          {#if $repoSyncStore.error}
            <div class="sync-error-small">
              Repository sync failed
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .file-explorer {
    display: flex;
    flex-direction: column;
    height: 100%;
    border-right: 1px solid var(--color-border);
    background-color: var(--color-bg-sidebar);
    overflow: hidden; /* Prevent content from flowing outside */
  }

  .file-explorer-header {
    padding: 8px 12px;
    font-weight: 600;
    font-size: 14px;
    border-bottom: 1px solid var(--color-border);
    background-color: var(--color-bg-header);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .creation-context {
    font-size: 12px;
    color: var(--color-text-tertiary);
    font-weight: normal;
    opacity: 0.8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .header-action-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    color: var(--color-text-secondary);
    width: 24px;
    height: 24px;
  }

  .header-action-button:hover {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .header-action-button svg {
    width: 16px;
    height: 16px;
  }

  .header-action-button.delete-button {
    /* Keep original color - no special styling */
  }

  .header-action-button.delete-button:hover {
    color: var(--color-text-error, #dc2626);
  }

  .recycle-bin {
    width: 28px;
    height: 28px;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: var(--color-bg-secondary);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .recycle-bin:hover {
    background-color: var(--color-bg-secondary-hover);
  }

  .recycle-bin-active {
    background-color: var(--color-text-error);
    color: white;
    transform: scale(1.1);
  }

  .drop-target {
    background-color: var(--color-bg-accent-light);
    border: 1px dashed var(--color-bg-accent);
    transition: all 0.2s ease;
    transform: scale(1.02);
    box-shadow: 0 0 5px rgba(0, 0, 0, 0.1);
  }

  /* Make dragged items semi-transparent */
  .tree-item[draggable="true"]:active {
    opacity: 0.7;
    cursor: grabbing;
  }

  /* Different cursors depending on context */
  .tree-item[draggable="true"] {
    cursor: grab;
  }

  .tree-item[draggable="true"]:hover {
    background-color: var(--color-bg-hover);
  }

  /* Special styling for directory drop targets */
  .tree-item.drop-target:not(:active) {
    outline: 2px dashed var(--color-bg-accent);
    outline-offset: -2px;
  }

  /* Add transition for smoother effects */
  .tree-item {
    transition: background-color 0.15s ease, border 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
  }

  .file-tree {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .file-explorer-footer {
    padding: 8px 12px;
    border-top: 1px solid var(--color-border);
    background-color: var(--color-bg-header);
    flex-shrink: 0; /* Prevent footer from shrinking */
  }

  .empty-tree-message {
    padding: var(--spacing-xl);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: 13px;
  }

  .empty-tree-message p:first-child {
    margin-bottom: var(--spacing-sm);
    font-weight: 500;
  }

  .new-file-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .current-directory {
    font-size: 12px;
    color: var(--color-text-tertiary);
    margin-bottom: 8px;
    padding: 0 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .branch-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 4px;
  }

  .branch-reset {
    display: flex;
    gap: 4px;
    margin-bottom: 4px;
  }

  .branch-input {
    flex: 1;
    padding: 3px 6px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: 12px;
  }

  .reset-button {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 12px;
  }

  .reset-button:not(:disabled):hover {
    background-color: var(--color-bg-secondary-hover);
  }

  .reset-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .loading-indicator-small {
    display: inline-flex;
    margin-left: 3px;
    margin-right: 3px;
    vertical-align: middle;
  }

  .branch-error {
    font-size: 11px;
    color: var(--color-text-error);
    margin-top: 2px;
    margin-bottom: 2px;
  }

  .branch-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 4px;
  }

  .branch-reset {
    display: flex;
    gap: 4px;
    margin-bottom: 4px;
  }

  .branch-input {
    flex: 1;
    padding: 3px 6px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: 12px;
  }

  .reset-button {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 12px;
  }

  .reset-button:not(:disabled):hover {
    background-color: var(--color-bg-secondary-hover);
  }

  .reset-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .loading-indicator-small {
    display: inline-flex;
    margin-left: 3px;
    margin-right: 3px;
    vertical-align: middle;
  }

  .branch-error {
    font-size: 11px;
    color: var(--color-text-error);
    margin-top: 2px;
    margin-bottom: 2px;
  }

  .new-file-form {
    display: flex;
    padding: 0 12px;
    margin-bottom: 8px;
    width: 100%;
    box-sizing: border-box;
    font-size: 0; /* Remove inline spacing */
  }

  .new-file-input {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--color-border);
    border-right: none; /* Remove right border to connect with button */
    border-radius: 4px 0 0 4px;
    font-size: 13px;
    min-width: 0; /* Prevents flex item from overflowing */
    width: 0; /* Allows flex to properly shrink with parent */
    margin: 0; /* Remove any margin */
    height: 30px; /* Fixed height */
    box-sizing: border-box; /* Include padding and border in height */
    display: block; /* Block display */
  }

  .new-file-input::placeholder {
    color: var(--color-text-tertiary);
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .new-file-button {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-bg-accent);
    color: var(--color-text-on-accent);
    border: none;
    border-radius: 0 4px 4px 0;
    padding: 0 8px;
    cursor: pointer;
    flex-shrink: 0; /* Prevent button from shrinking */
    margin-left: 0; /* Ensure no margin between input and button */
    line-height: normal; /* Reset line height */
    font-size: 16px; /* Reset font size */
    height: 30px; /* Match input height */
    box-sizing: border-box; /* Include padding and border in height */
  }

  :global(.tree-item-icon svg) {
    width: 18px;
    height: 18px;
    color: #6b7280; /* Gray color for all icons */
  }

  :global(.tree-item-arrow svg) {
    width: 16px;
    height: 16px;
    color: #6b7280; /* Gray color for arrows */
  }

  /* Git status indicators */
  .git-status-indicator {
    font-size: 11px;
    font-weight: 600;
    padding: 1px 4px;
    margin-left: auto;
    margin-right: 4px;
    min-width: 12px;
    text-align: center;
    line-height: 1.2;
    background-color: transparent;
  }

  .git-modified {
    color: #f59e0b;
  }

  .git-added {
    color: #10b981;
  }

  .git-deleted {
    color: #ef4444;
  }

  .git-renamed {
    color: #8b5cf6;
  }

  .git-copied {
    color: #06b6d4;
  }

  .git-unmerged {
    color: #f97316;
  }

  .git-untracked {
    color: #6b7280;
  }

  .git-unknown {
    color: #9ca3af;
  }

  .git-failed {
    color: #dc2626;
    font-weight: bold;
  }

  /* Tree item layout adjustments for git status */
  .tree-item {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 4px;
    margin: 1px 4px;
    position: relative;
    min-height: 24px;
  }

  .tree-item:hover {
    background-color: var(--color-bg-hover);
  }

  .tree-item.selected {
    background-color: var(--color-bg-accent);
    color: white;
  }

  .tree-item.selected:hover {
    background-color: var(--color-bg-accent);
    color: white;
  }

  .tree-item.selected .tree-item-name {
    color: white;
  }

  .tree-item.selected:hover .tree-item-name {
    color: white;
  }

  .tree-item.selected .tree-item-icon svg {
    color: white;
  }

  .tree-item.selected:hover .tree-item-icon svg {
    color: white;
  }

  .tree-item.selected .tree-item-arrow svg {
    color: white;
  }

  .tree-item.selected:hover .tree-item-arrow svg {
    color: white;
  }

  /* Highlight text color for modified files */
  .tree-item.has-git-status .tree-item-name {
    color: #f59e0b; /* Same as git-modified color */
  }

  .tree-item.has-git-status.git-added .tree-item-name {
    color: #10b981;
  }

  .tree-item.has-git-status.git-deleted .tree-item-name {
    color: #ef4444;
  }

  .tree-item.has-git-status.git-renamed .tree-item-name {
    color: #8b5cf6;
  }

  .tree-item.has-git-status.git-copied .tree-item-name {
    color: #06b6d4;
  }

  .tree-item.has-git-status.git-unmerged .tree-item-name {
    color: #f97316;
  }

  .tree-item.has-git-status.git-untracked .tree-item-name {
    color: #6b7280;
  }

  .tree-item.has-git-status.git-failed .tree-item-name {
    color: #dc2626;
    font-weight: bold;
  }

  /* Selected items override git status colors */
  .tree-item.selected.has-git-status .tree-item-name {
    color: white;
  }

  .tree-item.selected:hover.has-git-status .tree-item-name {
    color: white;
  }

  /* Folder selection styling */
  .tree-item.folder-selected {
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-bg-accent);
    border-radius: 4px;
  }

  .tree-item.folder-selected:hover {
    background-color: var(--color-bg-secondary);
  }

  .tree-item.folder-selected .tree-item-name {
    font-weight: 600;
    color: var(--color-bg-accent);
  }

  .tree-item-icon {
    margin-right: 6px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .tree-item-name {
    flex: 1;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-right: 4px;
  }

  .tree-item-arrow {
    margin-left: auto;
    display: flex;
    align-items: center;
    transition: transform 0.2s ease;
    flex-shrink: 0;
  }

  .tree-item-arrow.expanded {
    transform: rotate(90deg);
  }

  .tree-children {
    margin-left: 16px;
  }

  .file-node {
    user-select: none;
  }

  /* Repository Sync Styles */
  .sync-section {
    padding: 8px 12px;
    border-top: 1px solid var(--color-border);
    background-color: var(--color-bg-secondary);
  }

  .sync-button {
    width: 100%;
    padding: 6px 12px;
    background-color: #3498db;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background-color 0.2s;
  }

  .sync-button:hover:not(:disabled) {
    background-color: #2980b9;
  }

  .sync-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .sync-error-small {
    margin-top: 4px;
    font-size: 11px;
    color: #e74c3c;
    text-align: center;
  }

  /* VSCode-style inline new item input */
  .new-item-input-container {
    margin: 2px 4px;
  }

  .new-item-input {
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-bg-accent);
    border-radius: 4px;
  }

  .new-item-name-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 13px;
    color: var(--color-text-primary);
    padding: 0;
    margin: 0;
    font-family: inherit;
  }

  .new-item-name-input::placeholder {
    color: var(--color-text-tertiary);
    font-style: italic;
  }
</style>
