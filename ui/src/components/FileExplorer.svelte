<script lang="ts">
  import { onMount } from 'svelte';
  import { filesStore, type FileNode, addNodeToDirectory } from '../stores/filesStore';
  import { API_URL } from '../config.js';

  // Default to tests directory
  let currentDirectory = 'tests';
  let fileTree: FileNode[] = [];
  let newFileName = '';
  let expandedFolders: Set<string> = new Set();
  
  // Drag and drop state
  let draggedNode: FileNode | null = null;
  let dropTarget: FileNode | null = null;
  let dragOverRecycleBin = false;
  let showRecycleBin = false;
  
  $: {
    if ($filesStore.fileTree) {
      fileTree = $filesStore.fileTree;
    }
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

  // Update URL with file path without page reload
  function updateUrlWithFilePath(path: string) {
    // Create URL with hash fragment for file path
    const url = new URL(window.location.href);
    // Remove existing query parameters
    url.search = '';
    // Set hash to file-{path}
    url.hash = `file-${encodeURIComponent(path)}`;

    // Update the URL without reloading the page
    window.history.pushState({}, '', url);
  }

  async function fetchFileContent(path: string) {
    try {
      // First fetch the .rec file content
      const response = await fetch(`${API_URL}/api/get-file?path=${encodeURIComponent(path)}`, {
        credentials: 'include' // Add credentials for cookie passing
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const data = await response.json();

      // Parse the .rec file format into commands
      const commands = parseRecFile(data.content);

      // Try to fetch the .rep file if it exists
      try {
        // Replace .rec with .rep in the path
        const repPath = path.replace(/\.rec$/, '.rep');
        const repResponse = await fetch(`${API_URL}/api/get-file?path=${encodeURIComponent(repPath)}`, {
          credentials: 'include' // Add credentials for cookie passing
        });

        if (repResponse.ok) {
          const repData = await repResponse.json();

          // Parse the .rep file to get actual outputs
          const repContent = repData.content;
          const repSections = repContent.split('––– input –––').slice(1);

          // Update commands with actual outputs
          repSections.forEach((section, index) => {
            if (index < commands.length) {
              const repParts = section.split('––– output –––');
              if (repParts.length >= 2) {
                const actualOutputRaw = repParts[1].trim().split('\n\n')[0].trim();

                // Check if the output is exactly "OK" which means the test passed
                if (actualOutputRaw === 'OK') {
                  commands[index].status = 'matched';
                  commands[index].actualOutput = commands[index].expectedOutput; // Use expected when they match
                } else {
                  // If not OK, it's a diff format - use raw output from stdout
                  commands[index].status = 'failed';
                  commands[index].actualOutput = actualOutputRaw; // Use the diff output
                }
              }
            }
          });
        }
      } catch (repError) {
        // Ignore errors for the .rep file - it might not exist yet
        console.log('Could not load .rep file (this is normal for new tests)');
      }

      // Load the file into the editor with commands (possibly including actual outputs)
      filesStore.loadFile(path, commands);
    } catch (error) {
      console.error('Error loading file:', error);
      // If file doesn't exist, create it with empty content
      if (path.endsWith('.rec') || path.endsWith('.recb')) {
        filesStore.createNewFile(path);
      }
    }
  }

  // Parse .rec file format into commands
  function parseRecFile(content: string) {
    const commands = [];
    const sections = content.split('––– input –––').slice(1); // Skip first empty part

    for (const section of sections) {
      const parts = section.split('––– output –––');
      if (parts.length >= 2) {
        const command = parts[0].trim();
        const outputPart = parts[1].trim();
        // Extract output until next section or end
        const expectedOutput = outputPart.split('\n\n')[0].trim();

        commands.push({
          command,
          expectedOutput,
          status: 'pending', // Initialize as pending, not failed
          initializing: true, // Mark as initializing until first run
          actualOutput: '' // Initialize with empty actual output
        });
      }
    }

    return commands;
  }

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
    // Set the default config directory to point to the tests folder
    filesStore.setConfigDirectory('tests');

    // Check URL hash for file path
    const hash = window.location.hash;
    let filePath = null;

    if (hash && hash.startsWith('#file-')) {
      // Extract the file path from the hash
      filePath = decodeURIComponent(hash.substring(6)); // Remove '#file-' prefix
    }

    // Fetch the file tree from the backend
    await filesStore.refreshFileTree();

    // Open first level folders by default
    if (fileTree) {
      // Always open the tests folder
      const testsNode = fileTree.find(node => node.name === 'tests');
      if (testsNode && testsNode.isDirectory) {
        expandedFolders.add(testsNode.path);
      }

      expandedFolders = expandedFolders;
    }

    // If file path is specified in URL hash, open it
    if (filePath) {
      // Expand all parent folders to the file
      const pathParts = filePath.split('/');
      let currentPath = '';
      for (let i = 0; i < pathParts.length - 1; i++) {
        if (i > 0) currentPath += '/';
        currentPath += pathParts[i];
        expandedFolders.add(currentPath);
      }
      expandedFolders = expandedFolders; // Trigger reactivity

      // Load the file
      fetchFileContent(filePath);
    }

    // Listen for hash changes to load files when URL changes
    window.addEventListener('hashchange', handleHashChange);
  });
  
  // Drag handlers
  function handleDragStart(event: DragEvent, node: FileNode) {
    if (!node.isDirectory) {
      // Only files can be dragged
      draggedNode = node;
      showRecycleBin = true;
      
      // Set dragging data
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', node.path);
        event.dataTransfer.effectAllowed = 'move';
      }
    }
  }
  
  function handleDragOver(event: DragEvent, node: FileNode) {
    event.preventDefault();
    if (draggedNode && draggedNode !== node) {
      // Only allow dropping onto directories
      if (node.isDirectory) {
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
      
      // Move the file
      filesStore.moveFile(sourcePath, targetPath)
        .then(success => {
          if (success) {
            console.log(`File moved from ${sourcePath} to ${targetPath}`);
          } else {
            console.error('Failed to move file');
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

  // Handle URL hash changes
  function handleHashChange() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#file-')) {
      // Extract the file path from the hash
      const filePath = decodeURIComponent(hash.substring(6)); // Remove '#file-' prefix

      // Load the file if it's different from the current file
      if (!$filesStore.currentFile || $filesStore.currentFile.path !== filePath) {
        fetchFileContent(filePath);
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
      toggleFolder(node, event);
      // Update current directory when selecting a folder
      currentDirectory = node.path;
    } else {
      selectFile(node, event);
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
    <span>Files</span>
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

  <div class="file-tree">
    {#if fileTree && fileTree.length > 0}
      <!-- Render each file tree node recursively -->
      {#each fileTree as node}
        <div class="file-node">
          <div 
            class="tree-item {node.path === $filesStore.currentFile?.path ? 'selected' : ''} {dropTarget === node ? 'drop-target' : ''}"
            role="button"
            tabindex="0"
            draggable={!node.isDirectory}
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
            </div>
            <span class="tree-item-name">{node.name}</span>
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
              {#each node.children as childNode}
                <!-- Recursive File Node Template -->
                <div class="file-node">
                  <div 
                    class="tree-item {childNode.path === $filesStore.currentFile?.path ? 'selected' : ''} {dropTarget === childNode ? 'drop-target' : ''}"
                    role="button"
                    tabindex="0"
                    draggable={!childNode.isDirectory}
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
                      {#each childNode.children as grandChildNode}
                        <div class="file-node">
                          <div 
                            class="tree-item {grandChildNode.path === $filesStore.currentFile?.path ? 'selected' : ''} {dropTarget === grandChildNode ? 'drop-target' : ''}"
                            role="button"
                            tabindex="0"
                            draggable={!grandChildNode.isDirectory}
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
    <div class="current-directory">
      <span>Current directory: {currentDirectory}</span>
    </div>
    <div class="new-file-form">
      <input
        type="text"
        placeholder="File.rec or dir/"
        class="new-file-input"
        bind:value={newFileName}
        on:keydown={(e) => e.key === 'Enter' && createNewFile()}
      />
      <button
        class="new-file-button"
        on:click={createNewFile}
        disabled={!newFileName}
        aria-label="Create new file or directory"
        title="Create new file or directory (add / for directories)"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
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
    padding: 12px;
    font-weight: 600;
    font-size: 14px;
    border-bottom: 1px solid var(--color-border);
    background-color: var(--color-bg-header);
    display: flex;
    justify-content: space-between;
    align-items: center;
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
    padding-top: 8px;
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
  }

  :global(.tree-item-arrow svg) {
    width: 16px;
    height: 16px;
  }
</style>
