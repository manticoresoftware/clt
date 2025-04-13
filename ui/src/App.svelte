<script lang="ts">
  import Header from './components/Header.svelte';
  import FileExplorer from './components/FileExplorer.svelte';
  import Editor from './components/Editor.svelte';
  import { filesStore } from './stores/filesStore';
  import { onMount } from 'svelte';

  // File Explorer component now handles the initialization
  // So we don't need to set mock data here
</script>

<div class="app-container">
  <Header />
  
  <div class="main-content">
    <FileExplorer />
    <Editor />
  </div>
</div>