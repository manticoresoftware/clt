<script lang="ts">
  import { filesStore } from '../stores/filesStore';

  let dockerImage = $filesStore.dockerImage;

  function updateDockerImage() {
    filesStore.setDockerImage(dockerImage);
    
    // Run the test with new docker image if there's a file loaded
    if ($filesStore.currentFile) {
      filesStore.runTest();
    }
  }
</script>

<div class="header">
  <div class="app-title">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
    Manticore Test Editor
  </div>
  
  <div class="docker-image-container">
    <label for="docker-image">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"></path>
        <polyline points="13 2 13 9 20 9"></polyline>
      </svg>
      Docker Image:
    </label>
    <input
      id="docker-image"
      type="text"
      placeholder="Docker image for test validation"
      bind:value={dockerImage}
      on:blur={updateDockerImage}
      disabled={$filesStore.running}
    />
    {#if $filesStore.running}
      <span class="loading-indicator">
        <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </span>
    {/if}
  </div>
</div>

<style>
  .loading-indicator {
    margin-left: var(--spacing-sm);
    color: var(--color-text-accent);
  }
</style>