<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { API_URL } from '../config.js';

  let isOpen = false;
  let input = '';
  let logs: string[] = [];
  let isRunning = false;
  let sessionId: string | null = null;
  let pollingInterval: number | null = null;
  let lastRunOutput = '';
  let error = '';
  let lastCommand = '';
  let lastSessionTime = '';
  let currentCost: number | null = null;
  let lastSessionCost: number | null = null;
  let currentSessionName = '';
  let showNewSessionModal = false;
  let newSessionName = '';
  let persistentLoggingAvailable = false;
  let availableSessions: any[] = [];
  let showSessionSidebar = false;
  let loadingSessions = false;

  // Cost extraction and formatting functions
  function extractCostFromLogs(logs: string[]): number | null {
    if (!logs || logs.length === 0) return null;
    
    const costRegex = /cost:\s*\$(\d+\.?\d*)/gi;
    
    // Check last 100 lines first for most recent cost
    const linesToCheck = logs.slice(-100);
    for (let i = linesToCheck.length - 1; i >= 0; i--) {
      const matches = [...linesToCheck[i].matchAll(costRegex)];
      if (matches.length > 0) {
        return parseFloat(matches[matches.length - 1][1]);
      }
    }
    
    // If no cost found in last 100 lines, check all logs for first occurrence
    for (let i = 0; i < logs.length; i++) {
      const matches = [...logs[i].matchAll(costRegex)];
      if (matches.length > 0) {
        return parseFloat(matches[0][1]);
      }
    }
    
    return null;
  }

  function formatCost(cost: number | null): string {
    if (!cost) return '';
    return `$${cost.toFixed(5)}`;
  }

  // Sanitize session name for file system compatibility
  function sanitizeSessionName(name: string): string {
    if (!name || !name.trim()) return '';
    
    return name.trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-')         // Replace spaces with hyphens
      .replace(/-+/g, '-')          // Replace multiple hyphens with single hyphen
      .replace(/^-|-$/g, '');       // Remove leading/trailing hyphens
  }

  // Load session history and check for active session from localStorage
  function loadSessionState() {
    try {
      // Load completed session history
      const storedHistory = localStorage.getItem('askAI_sessionHistory');
      if (storedHistory) {
        const history = JSON.parse(storedHistory);
        lastRunOutput = history.output || '';
        lastCommand = history.command || '';
        lastSessionTime = history.timestamp || '';
        lastSessionCost = history.cost || null;
      }

      // Check for active session
      const activeSession = localStorage.getItem('askAI_activeSession');
      if (activeSession) {
        const session = JSON.parse(activeSession);
        sessionId = session.sessionId;
        input = session.command || '';
        isRunning = true;
        console.log('Resuming active session:', sessionId);

        // Start polling immediately for the active session
        startPolling();
      }
    } catch (err) {
      console.warn('Failed to load session state:', err);
    }
  }

  // Save active session to localStorage
  function saveActiveSession(sessionId: string, command: string) {
    try {
      const session = {
        sessionId,
        command,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem('askAI_activeSession', JSON.stringify(session));
    } catch (err) {
      console.warn('Failed to save active session:', err);
    }
  }

  // Clear active session from localStorage
  function clearActiveSession() {
    try {
      localStorage.removeItem('askAI_activeSession');
    } catch (err) {
      console.warn('Failed to clear active session:', err);
    }
  }

  // Save completed session history to localStorage
  function saveSessionHistory(command: string, output: string, cost: number | null = null) {
    try {
      const history = {
        command,
        output,
        cost,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem('askAI_sessionHistory', JSON.stringify(history));
      console.log('Saved session history to localStorage');
    } catch (err) {
      console.warn('Failed to save session history:', err);
    }
  }

  // Clear session history
  function clearSessionHistory() {
    try {
      localStorage.removeItem('askAI_sessionHistory');
      lastRunOutput = '';
      lastCommand = '';
      lastSessionTime = '';
      lastSessionCost = null;
      console.log('Cleared session history');
    } catch (err) {
      console.warn('Failed to clear session history:', err);
    }
  }

  export function openSession() {
    isOpen = true;
    // Load session state (history + active session) when opening
    loadSessionState();
    // Check if persistent logging is available
    checkPersistentLogging();
    error = '';
  }

  // Check if persistent logging is available
  async function checkPersistentLogging() {
    try {
      const response = await fetch(`${API_URL}/api/interactive/sessions`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        persistentLoggingAvailable = data.persistent;
        availableSessions = data.sessions || [];
      }
    } catch (error) {
      console.error('Failed to check persistent logging:', error);
    }
  }

  // Load available sessions
  async function loadAvailableSessions() {
    if (!persistentLoggingAvailable) return;
    
    loadingSessions = true;
    try {
      const response = await fetch(`${API_URL}/api/interactive/sessions`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        availableSessions = data.sessions || [];
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      loadingSessions = false;
    }
  }

  // Switch to a historical session
  async function switchToSession(session: any) {
    // Don't switch to the currently active session
    if (isSessionActive(session)) {
      console.log('Session is already active');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/interactive/session/${session.sessionId}/logs`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Clear current state
        isRunning = false;
        sessionId = null;
        currentCost = data.cost || null;
        
        // Load historical session data
        logs = data.logs || [];
        lastRunOutput = logs.join('\n');
        currentSessionName = session.sessionName || session.sessionId;
        lastSessionCost = data.cost || null;
        
        // Clear input for potential continuation
        input = '';
        error = '';
        
        // Close sidebar
        showSessionSidebar = false;
        
        console.log(`Switched to session: ${session.sessionName}`);
      }
    } catch (error) {
      console.error('Failed to switch to session:', error);
    }
  }

  // Continue in current session (for historical sessions)
  function continueInSession() {
    // This allows user to type new commands in the context of the loaded session
    // The session name will be passed to the backend for continuation
    console.log(`Continuing in session: ${currentSessionName}`);
  }

  // Check if a session is currently active
  function isSessionActive(session) {
    if (!sessionId || !isRunning) return false;
    
    // Extract the session name part from the current sessionId
    // Format: username-sessionname-timestamp
    const currentSessionParts = sessionId.split('-');
    const sessionParts = session.sessionId.split('-');
    
    // Compare the session name part (excluding username and timestamp)
    if (currentSessionParts.length >= 3 && sessionParts.length >= 3) {
      const currentSessionName = currentSessionParts.slice(1, -1).join('-');
      const sessionName = sessionParts.slice(1, -1).join('-');
      return currentSessionName === sessionName;
    }
    
    return false;
  }

  // Create new session
  function createNewSession() {
    // Clear current state
    logs = [];
    lastRunOutput = '';
    error = '';
    isRunning = false;
    sessionId = null;
    currentCost = null;
    
    // Set new session name (sanitized)
    const rawName = newSessionName.trim();
    currentSessionName = rawName ? sanitizeSessionName(rawName) : '';
    
    // Close dialog
    showNewSessionModal = false;
    newSessionName = '';
    
    // Clear input to start fresh
    input = '';
    
    console.log(`Created new session: ${currentSessionName || 'unnamed'}`);
  }

  export function closeSession() {
    isOpen = false;
    // Don't clear polling or session when just closing the modal
    // Keep polling active sessions in the background
  }

  async function startCommand() {
    if (!input.trim() || isRunning) return;

    isRunning = true;
    logs = [];
    lastRunOutput = '';
    error = '';
    currentCost = null;
    const commandToRun = input.trim();

    try {
      const response = await fetch(`${API_URL}/api/interactive/start`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          input: commandToRun,
          sessionName: currentSessionName || undefined
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        error = `Failed to start command: ${errorText}`;
        logs = [error];
        isRunning = false;
        return;
      }

      const data = await response.json();
      sessionId = data.sessionId;

      // Save active session to localStorage
      saveActiveSession(sessionId, commandToRun);

      // Refresh session list if sidebar is open to show new active session
      if (showSessionSidebar && persistentLoggingAvailable) {
        loadAvailableSessions();
      }

      // Start polling for updates
      startPolling();
    } catch (err) {
      error = `Failed to start command: ${err.message}`;
      logs = [error];
      isRunning = false;
    }
  }

  async function startPolling() {
    if (!sessionId) return;

    pollingInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/api/interactive/status/${sessionId}`, {
          credentials: 'include',
        });

        if (!response.ok) {
          console.error('Failed to poll status');
          return;
        }

        const data = await response.json();

        if (data.logs) {
          logs = data.logs;
          // Update current cost in real-time
          currentCost = data.cost;
        }

        if (data.completed) {
          isRunning = false;
          const finalOutput = data.output || '';
          const finalCost = data.cost;
          lastRunOutput = finalOutput;
          lastSessionCost = finalCost;

          // Save to localStorage with the command that was executed
          const activeSession = localStorage.getItem('askAI_activeSession');
          if (activeSession) {
            const session = JSON.parse(activeSession);
            saveSessionHistory(session.command, finalOutput, finalCost);
            lastCommand = session.command;
            lastSessionTime = new Date().toISOString();
          }

          // Clear active session since it's completed
          clearActiveSession();

          if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
          }
          sessionId = null;
          currentCost = null;

          // Clear current logs since we now have the final output
          logs = [];
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 1000); // Poll every second
  }

  async function cancelCommand() {
    if (!sessionId) return;

    try {
      await fetch(`${API_URL}/api/interactive/cancel/${sessionId}`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Cancel error:', error);
    }

    isRunning = false;
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }

    // Clear active session
    clearActiveSession();
    sessionId = null;
  }

  function handleKeyPress(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      startCommand();
    }
  }

  function formatTimestamp(isoString: string): string {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleString();
    } catch {
      return '';
    }
  }

  // Load session state when component mounts (for background polling)
  onMount(() => {
    loadSessionState();
  });

  onDestroy(() => {
    // Only clear polling when component is destroyed, not when modal closes
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
  });
</script>

{#if isOpen}
  <div class="modal-overlay" on:click={closeSession} role="button" tabindex="0" on:keydown={(e) => e.key === 'Escape' && closeSession()}>
    <div class="modal-content" on:click|stopPropagation role="dialog" aria-labelledby="modal-title" tabindex="-1">
      <div class="modal-header">
        <div class="header-left">
          <h2 id="modal-title">Ask AI</h2>
          {#if currentSessionName}
            <span class="session-name">({currentSessionName})</span>
          {/if}
        </div>
        <div class="header-right">
          <button class="new-session-btn" on:click={() => showNewSessionModal = true}>
            📄 New Session
          </button>
          {#if persistentLoggingAvailable}
            <button class="sessions-btn" on:click={() => { showSessionSidebar = !showSessionSidebar; loadAvailableSessions(); }}>
              📂 Sessions
            </button>
          {/if}
          <button class="close-button" on:click={closeSession} aria-label="Close modal">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <div class="session-content">
        <!-- Session Sidebar -->
        {#if showSessionSidebar}
          <div class="session-sidebar">
            <div class="sidebar-header">
              <h3>Available Sessions</h3>
              <button class="close-sidebar-btn" on:click={() => showSessionSidebar = false}>×</button>
            </div>
            <div class="sidebar-content">
              {#if loadingSessions}
                <div class="loading">Loading sessions...</div>
              {:else if availableSessions.length === 0}
                <div class="no-sessions">No saved sessions found</div>
              {:else}
                <div class="sessions-list">
                  {#each availableSessions as session}
                    <div class="session-item" class:active={isSessionActive(session)} class:clickable={!isSessionActive(session)} on:click={() => switchToSession(session)}>
                      <div class="session-info">
                        <div class="session-title">
                          {session.sessionName || session.sessionId}
                          {#if isSessionActive(session)}
                            <span class="active-badge">ACTIVE</span>
                          {/if}
                        </div>
                        <div class="session-meta">
                          <span class="session-date">{new Date(session.timestamp).toLocaleDateString()}</span>
                          <span class="session-time">{new Date(session.timestamp).toLocaleTimeString()}</span>
                          {#if session.size}
                            <span class="session-size">{(session.size / 1024).toFixed(1)}KB</span>
                          {/if}
                        </div>
                      </div>
                      <div class="session-actions">
                        {#if isSessionActive(session)}
                          <button class="active-session-btn">Running</button>
                        {:else}
                          <button class="load-session-btn">Load</button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Main Content Area -->
        <div class="main-content" class:with-sidebar={showSessionSidebar}>
        <!-- Logs Section -->
        <div class="logs-section">
          <div class="logs-header">
            <h3>Live Output</h3>
            <div class="header-actions">
              {#if isRunning}
                <div class="running-indicator">
                  <svg class="spinner" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <circle class="spinner-track" cx="12" cy="12" r="10" />
                    <circle class="spinner-circle" cx="12" cy="12" r="10" />
                  </svg>
                  Running{#if currentCost} ({formatCost(currentCost)}){/if}
                </div>
              {:else if lastRunOutput}
                <div class="history-indicator">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12,6 12,12 16,14"></polyline>
                  </svg>
                  Last run log{#if lastSessionCost} ({formatCost(lastSessionCost)}){/if}
                </div>
              {/if}
            </div>
          </div>

          <div class="logs-container">
            {#if isRunning && logs.length > 0}
              <div class="active-session-header">
                <strong>🔄 Active Session - Live Output:</strong>
              </div>
              {#each logs as log}
                <div class="log-line">{log}</div>
              {/each}
            {:else if isRunning && logs.length === 0}
              <div class="active-session-header">
                <strong>🔄 Active Session - Waiting for output...</strong>
              </div>
              <div class="waiting-message">Command is running, waiting for output...</div>
            {:else if error}
              <div class="error-message">
                <strong>Error:</strong>
                <pre>{error}</pre>
              </div>
            {:else if lastRunOutput}
              <div class="last-output">
                <div class="session-header">
                  <strong>✅ Last Completed Session:</strong>
                  <div class="session-meta">
                    {#if lastCommand}
                      <div class="last-command">Task: <code>{lastCommand}</code></div>
                    {/if}
                    {#if lastSessionTime}
                      <div class="session-time">Run at: {formatTimestamp(lastSessionTime)}</div>
                    {/if}
                    {#if lastSessionCost}
                      <div class="session-cost">Cost: {formatCost(lastSessionCost)}</div>
                    {/if}
                    <button class="clear-history-button" on:click={clearSessionHistory} title="Clear history" aria-label="Clear session history">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                      </svg>
                    </button>
                  </div>
                </div>
                <pre>{lastRunOutput}</pre>
              </div>
            {:else}
              <div class="no-logs">No sessions yet. Enter a command below to start.</div>
            {/if}
          </div>
        </div>

        <!-- Input Section -->
        <div class="input-section">
          <div class="input-container">
            <textarea
              bind:value={input}
              placeholder="Enter your command or question..."
              disabled={isRunning}
              on:keypress={handleKeyPress}
              rows="3"
            ></textarea>
            <div class="input-actions">
              {#if isRunning}
                <button class="cancel-button" on:click={cancelCommand}>
                  Cancel
                </button>
              {:else}
                <button
                  class="send-button"
                  on:click={startCommand}
                  disabled={!input.trim()}
                >
                  Send
                </button>
              {/if}
            </div>
          </div>
        </div>
        </div> <!-- Close main-content -->
      </div>
    </div>
  </div>
{/if}

<!-- New Session Dialog -->
{#if showNewSessionModal}
<div class="modal-overlay" on:click={() => showNewSessionModal = false} role="button" tabindex="0">
  <div class="modal-content small" on:click|stopPropagation role="dialog">
    <div class="modal-header">
      <h3>Create New Session</h3>
      <button class="close-button" on:click={() => showNewSessionModal = false}>×</button>
    </div>
    <div class="modal-body">
      <label for="session-name">Session Name (optional):</label>
      <input 
        id="session-name"
        bind:value={newSessionName} 
        placeholder="Enter session name..."
        on:keypress={(e) => e.key === 'Enter' && createNewSession()}
        autofocus
      />
    </div>
    <div class="modal-footer">
      <button class="primary-btn" on:click={createNewSession}>Create Session</button>
      <button class="secondary-btn" on:click={() => showNewSessionModal = false}>Cancel</button>
    </div>
  </div>
</div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--color-bg-primary);
    border-radius: 8px;
    width: 90vw;
    max-width: 800px;
    height: 80vh;
    max-height: 600px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid var(--color-border);
  }

  .modal-header h2 {
    margin: 0;
    color: var(--color-text-primary);
  }

  .close-button {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-secondary);
    padding: 4px;
    border-radius: 4px;
    transition: background-color 0.2s;
  }

  .close-button:hover {
    background-color: var(--color-bg-hover);
  }

  .session-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .logs-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 20px 20px 0 20px;
  }

  .logs-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .header-actions {
    display: flex;
    align-items: center;
  }

  .logs-header h3 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: 16px;
  }

  .running-indicator, .history-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--color-text-accent);
  }

  .history-indicator {
    color: var(--color-text-secondary);
    font-size: 12px;
  }

  .spinner {
    width: 16px;
    height: 16px;
    animation: spin 1.5s linear infinite;
  }

  .spinner-track {
    fill: none;
    stroke: var(--color-border-light);
    stroke-width: 2px;
  }

  .spinner-circle {
    fill: none;
    stroke: var(--color-bg-accent);
    stroke-width: 2px;
    stroke-linecap: round;
    stroke-dasharray: 60;
    stroke-dashoffset: 20;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .logs-container {
    flex: 1;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 12px;
    overflow-y: auto;
    font-family: monospace;
    font-size: 14px;
    line-height: 1.4;
    min-height: 200px;
  }

  .log-line {
    margin-bottom: 4px;
    white-space: pre-wrap;
    color: var(--color-text-primary);
  }

  .active-session-header {
    background-color: var(--color-bg-info, #e0f2fe);
    color: var(--color-text-info, #0369a1);
    padding: 8px 12px;
    border-radius: 4px;
    margin-bottom: 12px;
    border-left: 4px solid var(--color-bg-accent);
  }

  .waiting-message {
    color: var(--color-text-secondary);
    font-style: italic;
    text-align: center;
    padding: 20px;
  }

  .last-output {
    color: var(--color-text-primary);
  }

  .session-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
    gap: 12px;
  }

  .session-header strong {
    color: var(--color-text-accent);
    flex-shrink: 0;
  }

  .session-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--color-text-secondary);
    align-items: flex-end;
  }

  .last-command {
    max-width: 300px;
    word-break: break-all;
  }

  .last-command code {
    background-color: var(--color-bg-secondary);
    padding: 2px 4px;
    border-radius: 2px;
    font-size: 11px;
  }

  .session-time {
    font-style: italic;
  }

  .clear-history-button {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-secondary);
    padding: 2px;
    border-radius: 2px;
    transition: background-color 0.2s;
    margin-top: 4px;
  }

  .clear-history-button:hover {
    background-color: var(--color-bg-error, #fee2e2);
    color: var(--color-text-error, #dc2626);
  }

  .last-output pre {
    background-color: var(--color-bg-primary);
    padding: 8px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    white-space: pre-wrap;
    margin: 0;
  }

  .error-message {
    color: var(--color-text-error, #dc2626);
  }

  .error-message strong {
    color: var(--color-text-error, #dc2626);
    display: block;
    margin-bottom: 8px;
  }

  .error-message pre {
    background-color: var(--color-bg-error, #fee2e2);
    padding: 8px;
    border-radius: 4px;
    border: 1px solid var(--color-border-error, #fca5a5);
    white-space: pre-wrap;
    margin: 0;
    color: var(--color-text-error, #dc2626);
  }

  .no-logs {
    color: var(--color-text-tertiary);
    font-style: italic;
    text-align: center;
    padding: 40px 20px;
  }

  @media (prefers-color-scheme: dark) {
    .active-session-header {
      background-color: rgba(14, 165, 233, 0.1);
      color: #7dd3fc;
    }
  }

  .input-section {
    padding: 20px;
    border-top: 1px solid var(--color-border);
  }

  .input-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .input-container textarea {
    width: 100%;
    padding: 12px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background-color: var(--color-bg-textarea);
    color: var(--color-text-primary);
    font-family: monospace;
    font-size: 14px;
    resize: vertical;
    min-height: 60px;
  }

  .input-container textarea:focus {
    outline: none;
    border-color: var(--color-bg-accent);
    box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.2);
  }

  .input-container textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .input-actions {
    display: flex;
    justify-content: flex-end;
  }

  .send-button, .cancel-button {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    transition: background-color 0.2s;
  }

  .send-button {
    background-color: var(--color-bg-accent);
    color: white;
  }

  .send-button:hover:not(:disabled) {
    background-color: var(--color-bg-accent-hover);
  }

  .send-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .cancel-button {
    background-color: var(--color-bg-error, #dc2626);
    color: white;
  }

  .cancel-button:hover {
    background-color: var(--color-bg-error-hover, #b91c1c);
  }

  /* New styles for enhanced features */
  .session-name {
    font-size: 14px;
    color: var(--color-text-secondary);
    font-weight: normal;
    margin-left: 8px;
  }

  .header-left {
    display: flex;
    align-items: center;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .new-session-btn {
    background: var(--color-bg-accent);
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: background-color 0.2s;
  }

  .new-session-btn:hover {
    background: var(--color-bg-accent-hover);
  }

  .sessions-btn {
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: background-color 0.2s;
  }

  .sessions-btn:hover {
    background: var(--color-bg-hover);
  }

  .session-cost {
    color: var(--color-text-accent);
    font-weight: 500;
  }

  .modal-content.small {
    max-width: 400px;
    height: auto;
  }

  .modal-body {
    padding: 20px;
  }

  .modal-body label {
    display: block;
    margin-bottom: 8px;
    font-weight: 500;
  }

  .modal-body input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 20px;
    border-top: 1px solid var(--color-border);
  }

  .primary-btn {
    background: var(--color-bg-accent);
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
  }

  .secondary-btn {
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
  }

  /* Session Sidebar Styles */
  .session-sidebar {
    position: absolute;
    top: 0;
    right: 0;
    width: 300px;
    height: 100%;
    background: var(--color-bg-primary);
    border-left: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    z-index: 10;
  }

  .sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-secondary);
  }

  .sidebar-header h3 {
    margin: 0;
    font-size: 16px;
    color: var(--color-text-primary);
  }

  .close-sidebar-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-secondary);
    font-size: 18px;
    padding: 4px;
    border-radius: 4px;
    transition: background-color 0.2s;
  }

  .close-sidebar-btn:hover {
    background: var(--color-bg-hover);
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .loading, .no-sessions {
    text-align: center;
    color: var(--color-text-secondary);
    font-style: italic;
    padding: 20px;
  }

  .sessions-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .session-item {
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 12px;
    transition: all 0.2s;
    background: var(--color-bg-secondary);
  }

  .session-item.clickable {
    cursor: pointer;
  }

  .session-item.clickable:hover {
    border-color: var(--color-bg-accent);
    background: var(--color-bg-hover);
  }

  .session-item.active {
    border-color: var(--color-bg-accent);
    background: var(--color-bg-info, #e0f2fe);
    box-shadow: 0 0 0 1px var(--color-bg-accent);
  }

  .session-item.active:hover {
    background: var(--color-bg-info, #e0f2fe);
  }

  .session-info {
    margin-bottom: 8px;
  }

  .session-title {
    font-weight: 500;
    color: var(--color-text-primary);
    margin-bottom: 4px;
    word-break: break-word;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .active-badge {
    background: var(--color-bg-accent);
    color: white;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .session-meta {
    display: flex;
    gap: 8px;
    font-size: 12px;
    color: var(--color-text-secondary);
    flex-wrap: wrap;
  }

  .session-actions {
    display: flex;
    justify-content: flex-end;
  }

  .load-session-btn {
    background: var(--color-bg-accent);
    color: white;
    border: none;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: background-color 0.2s;
  }

  .load-session-btn:hover {
    background: var(--color-bg-accent-hover);
  }

  .active-session-btn {
    background: var(--color-bg-success, #10b981);
    color: white;
    border: none;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: default;
    font-size: 12px;
    font-weight: 500;
  }

  .main-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    position: relative;
    transition: margin-right 0.3s ease;
  }

  .main-content.with-sidebar {
    margin-right: 300px;
  }

  .session-content {
    position: relative;
  }
</style>
