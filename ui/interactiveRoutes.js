import path from 'path';
import fs from 'fs/promises';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { getUserRepoPath } from './routes.js';
import {
  saveSessionToPersistentStorage,
  extractCostFromLogs,
  sanitizeSessionName,
  writeLogEntry,
  updateSessionMetadata
} from './helpers.js';

// Setup Interactive Session routes
export function setupInteractiveRoutes(app, isAuthenticated, dependencies) {
  const {
    WORKDIR,
    ROOT_DIR,
    getAuthConfig
  } = dependencies;

  // Interactive session endpoints
  // Start a new interactive command session
  app.post('/api/interactive/start', isAuthenticated, async (req, res) => {
    try {
      const { input, sessionName } = req.body;

      if (!input || !input.trim()) {
        return res.status(400).json({ error: 'Input is required' });
      }

      // Check if user is authenticated
      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const username = req.user.username;

      // Check if user already has a running session
      if (global.interactiveSessions[username] && global.interactiveSessions[username].running) {
        return res.status(409).json({ error: 'Another command is already running for this user' });
      }

      // Check if continuing an existing session or creating a new one
      let sessionId;
      let sanitizedSessionName = sessionName ? sanitizeSessionName(sessionName) : '';
      let isSessionContinuation = false;

      // If sessionName is provided, check if we're continuing an existing session
      if (sanitizedSessionName) {
        // First check if there was a recently completed session with the same name
        const recentSession = global.interactiveSessions[username];

        if (recentSession && !recentSession.running && recentSession.name === sanitizedSessionName) {
          // Continue the recent session
          sessionId = recentSession.id;
          isSessionContinuation = true;
          console.log(`Continuing recent session: ${sessionId}`);
        } else {
          // Look for existing session files with this name
          const logDir = process.env.ASK_AI_LOG;
          if (logDir) {
            const userLogDir = path.join(logDir, username);
            if (existsSync(userLogDir)) {
              const existingFiles = readdirSync(userLogDir)
                .filter(file => file.endsWith('.log') || file.endsWith('.meta'))
                .filter(file => file.startsWith(sanitizedSessionName + '_'));

              if (existingFiles.length > 0) {
                // Continue existing session - use existing session ID from metadata
                const latestFile = existingFiles
                  .map(file => {
                    const filePath = path.join(userLogDir, file);
                    const stats = statSync(filePath);
                    return { file, stats, filePath };
                  })
                  .sort((a, b) => b.stats.mtime - a.stats.mtime)[0];

                try {
                  const sessionData = JSON.parse(readFileSync(latestFile.filePath, 'utf8'));
                  if (sessionData.metadata && sessionData.metadata.sessionId) {
                    sessionId = sessionData.metadata.sessionId;
                    isSessionContinuation = true;
                    console.log(`Continuing existing session from file: ${sessionId}`);
                  }
                } catch (error) {
                  console.warn('Failed to read existing session metadata, creating new session:', error);
                }
              }
            }
          }
        }
      }

      // Generate new session ID if not continuing existing session
      if (!sessionId) {
        sessionId = sanitizedSessionName
          ? `${username}-${sanitizedSessionName}-${Date.now()}`
          : `${username}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log(`Generated new session ID: ${sessionId}`);
      }

      // Get the interactive command from environment
      const askAiCommand = process.env.ASK_AI_COMMAND || 'docker run --rm -i ubuntu:latest bash -c "echo \\"Input received:\\"; cat; echo \\"\\nSleeping for 2 seconds...\\"; sleep 2; echo \\"Done!\\""';
      const askAiTimeout = parseInt(process.env.ASK_AI_TIMEOUT || '30000');

      console.log(`Starting interactive session ${sessionId} for user ${username}`);
      console.log(`Command: ${askAiCommand}`);
      console.log(`Input: ${input}`);
      console.log(`Timeout: ${askAiTimeout}ms`);

      // Create log file only if ASK_AI_LOG is configured
      const logDir = process.env.ASK_AI_LOG;
      let logFile = null;
      if (logDir) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${sessionName || sessionId}_${timestamp}.log`;
        const userLogDir = path.join(logDir, username);
        logFile = path.join(userLogDir, fileName);

        // Ensure directory exists synchronously before creating log file
        try {
          if (!existsSync(userLogDir)) {
            await fs.mkdir(userLogDir, { recursive: true });
            console.log(`Created log directory: ${userLogDir}`);
          }
        } catch (error) {
          console.error('Failed to create log directory:', error);
          logFile = null; // Disable logging if directory creation fails
        }
      }

      // Initialize session
      const session = {
        id: sessionId,
        name: sanitizedSessionName || sessionId,
        username,
        running: true,
        completed: false,
        cancelled: false,
        failed: false,
        logs: [],
        output: '',
        cost: null,
        startTime: new Date(),
        endTime: null,
        logFile,
        process: null,
        timeout: null,
        exitCode: null,
        active: true // Mark as active session
      };

      global.interactiveSessions[username] = session;

      // Log session start information
      const sessionStartLog = `=== SESSION START ===
Session ID: ${sessionId}
Session Name: ${session.name}
Username: ${username}
Start Time: ${session.startTime.toISOString()}
Command: ${askAiCommand}
Timeout: ${askAiTimeout}ms
Input Length: ${input.length} characters
Log File: ${logFile || 'Not configured'}
=== INPUT ===
${input}
=== OUTPUT ===
`;

      // Write initial session information
      writeLogEntry(session, sessionStartLog, 'START');

      // Import child_process
      const { spawn } = await import('child_process');

      // Get user repository path for WORKDIR_PATH environment variable
      const userRepoPath = getUserRepoPath(req, WORKDIR, ROOT_DIR, getAuthConfig);
      console.log(`WORKDIR_PATH: ${userRepoPath}`);

      // Start the process with shell to handle complex commands
      const childProcess = spawn('sh', ['-c', askAiCommand], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          WORKDIR_PATH: userRepoPath,
          SESSION_NAME: sanitizedSessionName || sessionId
        }
      });

      session.process = childProcess;

      // Set up timeout
      session.timeout = setTimeout(() => {
        if (session.running && childProcess) {
          console.log(`Session ${sessionId} timed out after ${askAiTimeout}ms`);
          childProcess.kill('SIGTERM');

          const timeoutLog = `
=== SESSION TIMEOUT ===
Session ID: ${sessionId}
Timeout: ${askAiTimeout}ms
Time: ${new Date().toISOString()}
Process terminated due to timeout
=== TIMEOUT END ===
`;

          writeLogEntry(session, timeoutLog, 'TIMEOUT');
        }
      }, askAiTimeout);

      // Send input to the process
      childProcess.stdin.write(input);
      childProcess.stdin.end();

      // Handle stdout
      childProcess.stdout.on('data', (data) => {
        const output = data.toString();
        writeLogEntry(session, output, 'STDOUT');
      });

      // Handle stderr
      childProcess.stderr.on('data', (data) => {
        const output = data.toString();
        const logEntry = `STDERR: ${output}`;
        writeLogEntry(session, logEntry, 'STDERR');
      });

      // Handle process completion
      childProcess.on('close', (code) => {
        session.running = false;
        session.completed = true;
        session.failed = code !== 0;
        session.exitCode = code;
        session.output = session.logs.join('');
        session.endTime = new Date();
        session.cost = extractCostFromLogs(session.logs);
        session.active = false; // Mark as inactive

        // Log session completion
        const completionLog = `
=== SESSION END ===
Session ID: ${sessionId}
End Time: ${session.endTime.toISOString()}
Exit Code: ${code}
Duration: ${session.endTime.getTime() - session.startTime.getTime()}ms
Cost: ${session.cost ? '$' + session.cost.toFixed(5) : 'N/A'}
Status: ${code === 0 ? 'SUCCESS' : 'FAILED'}
Total Log Entries: ${session.logs.length}
=== SESSION COMPLETE ===
`;

        writeLogEntry(session, completionLog, 'END');

        // Save session data persistently (final save)
        saveSessionToPersistentStorage(session, username);

        // Clear timeout
        if (session.timeout) {
          clearTimeout(session.timeout);
          session.timeout = null;
        }

        console.log(`Session ${sessionId} completed with exit code: ${code}`);

        // Clean up after 5 minutes (but keep session data for history)
        setTimeout(() => {
          if (global.interactiveSessions[username] && global.interactiveSessions[username].id === sessionId) {
            // Don't delete the session, just clean up the process reference
            global.interactiveSessions[username].process = null;
            console.log(`Cleaned up process for session ${sessionId}`);
          }
        }, 5 * 60 * 1000);
      });

      // Handle process error
      childProcess.on('error', (error) => {
        session.running = false;
        session.completed = true;
        session.failed = true;
        session.error = error.message;
        session.endTime = new Date();
        session.active = false; // Mark as inactive

        // Log error with details
        const errorLog = `
=== SESSION ERROR ===
Session ID: ${sessionId}
Error Time: ${session.endTime.toISOString()}
Error Message: ${error.message}
Duration: ${session.endTime.getTime() - session.startTime.getTime()}ms
=== ERROR DETAILS ===
${error.stack || error.message}
=== SESSION TERMINATED ===
`;

        writeLogEntry(session, errorLog, 'ERROR');

        session.output = session.logs.join('');
        session.cost = extractCostFromLogs(session.logs);

        // Save session data persistently
        saveSessionToPersistentStorage(session, username);

        // Clear timeout
        if (session.timeout) {
          clearTimeout(session.timeout);
          session.timeout = null;
        }

        console.error(`Session ${sessionId} error:`, error);
      });

      res.json({ sessionId, status: 'started' });
    } catch (error) {
      console.error('Error starting interactive session:', error);
      res.status(500).json({ error: 'Failed to start interactive session' });
    }
  });

  // Get status of an interactive session
  app.get('/api/interactive/status/:sessionId', isAuthenticated, async (req, res) => {
    try {
      const { sessionId } = req.params;

      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const username = req.user.username;
      const session = global.interactiveSessions[username];

      if (!session || session.id !== sessionId) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({
        sessionId,
        name: session.name,
        running: session.running,
        completed: session.completed,
        cancelled: session.cancelled,
        failed: session.failed,
        logs: session.logs,
        output: session.output,
        cost: session.cost,
        exitCode: session.exitCode,
        error: session.error,
        startTime: session.startTime,
        endTime: session.endTime
      });
    } catch (error) {
      console.error('Error getting session status:', error);
      res.status(500).json({ error: 'Failed to get session status' });
    }
  });

  // Cancel an interactive session
  app.post('/api/interactive/cancel/:sessionId', isAuthenticated, async (req, res) => {
    try {
      const { sessionId } = req.params;

      if (!req.user || !req.user.username) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const username = req.user.username;
      const session = global.interactiveSessions[username];

      if (!session || session.id !== sessionId) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (session.process && session.running) {
        session.process.kill('SIGTERM');
        session.running = false;
        session.completed = true;
        session.cancelled = true;
        session.logs.push('\nProcess cancelled by user');
        session.output = session.logs.join('');
        session.cost = extractCostFromLogs(session.logs);
        session.endTime = new Date();
        session.active = false; // Mark as inactive

        // Save session data persistently (including cancelled sessions)
        saveSessionToPersistentStorage(session, username);

        // Clear timeout
        if (session.timeout) {
          clearTimeout(session.timeout);
          session.timeout = null;
        }

        console.log(`Session ${sessionId} cancelled by user`);
      }

      res.json({ status: 'cancelled' });
    } catch (error) {
      console.error('Error cancelling session:', error);
      res.status(500).json({ error: 'Failed to cancel session' });
    }
  });

  // List all sessions (only if ASK_AI_LOG is configured)
  app.get('/api/interactive/sessions', isAuthenticated, async (req, res) => {
    try {
      const username = req.user.username;
      const logDir = process.env.ASK_AI_LOG;

      if (!logDir) {
        return res.json({ sessions: [], persistent: false });
      }

      const userLogDir = path.join(logDir, username);

      if (!existsSync(userLogDir)) {
        return res.json({ sessions: [], persistent: true });
      }

      const allFiles = readdirSync(userLogDir)
        .filter(file => file.endsWith('.log') || file.endsWith('.meta'));

      // Group files by session ID to prefer .meta over .log
      const sessionMap = new Map();

      allFiles.forEach(file => {
        const sessionId = file.replace(/\.(log|meta)$/, '');
        if (!sessionMap.has(sessionId) || file.endsWith('.meta')) {
          sessionMap.set(sessionId, file);
        }
      });

      const logFiles = Array.from(sessionMap.values())
        .map(file => {
          const filePath = path.join(userLogDir, file);
          const stats = statSync(filePath);

          try {
            // Read the JSON session data
            const sessionData = JSON.parse(readFileSync(filePath, 'utf8'));
            const metadata = sessionData.metadata || {};

            return {
              sessionId: metadata.sessionId || file.replace(/\.(log|meta)$/, ''),
              sessionName: metadata.sessionName || 'Unknown Session',
              startTime: metadata.startTime ? new Date(metadata.startTime) : stats.birthtime,
              endTime: metadata.endTime ? new Date(metadata.endTime) : null,
              completed: metadata.completed || false,
              cancelled: metadata.cancelled || false,
              failed: metadata.failed || false,
              cost: metadata.cost || 0,
              active: metadata.active || false,
              size: stats.size,
              logFile: filePath
            };
          } catch (error) {
            // Fallback for old format or corrupted files
            console.warn(`Failed to parse session file ${filePath}:`, error);
            const [sessionName, timestamp] = file.replace(/\.(log|meta)$/, '').split('_');

            return {
              sessionId: file.replace(/\.(log|meta)$/, ''), // Use filename as fallback
              sessionName: sessionName || 'Unknown Session',
              startTime: stats.birthtime,
              endTime: null,
              completed: false,
              cancelled: false,
              failed: false,
              cost: 0,
              active: false,
              size: stats.size,
              logFile: filePath
            };
          }
        })
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

      // Remove any duplicate sessions before processing
      // Group sessions by sessionName and keep only the most recent one
      const sessionGroups = new Map();
      logFiles.forEach(session => {
        const key = session.sessionName;
        if (!sessionGroups.has(key) ||
            new Date(session.startTime) > new Date(sessionGroups.get(key).startTime)) {
          sessionGroups.set(key, session);
        }
      });

      // Convert back to array
      const deduplicatedLogFiles = Array.from(sessionGroups.values())
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

      // Check if there's a currently active session
      const currentSession = global.interactiveSessions[username];
      if (currentSession && currentSession.running) {
        // Mark the current session as active in the list
        const activeSessionIndex = deduplicatedLogFiles.findIndex(s => {
          // First try exact match with session ID
          if (s.sessionId === currentSession.id) {
            return true;
          }

          // Then try matching by session name
          if (s.sessionName === currentSession.name) {
            return true;
          }

          return false;
        });

        if (activeSessionIndex === -1) {
          // Add current session if not in persistent storage yet
          deduplicatedLogFiles.unshift({
            sessionId: currentSession.id,
            sessionName: currentSession.name,
            startTime: currentSession.startTime,
            endTime: null,
            completed: false,
            cancelled: false,
            failed: false,
            cost: currentSession.cost || 0,
            active: true,
            size: 0,
            logFile: null
          });
        } else {
          // Mark existing session as active and update with current session data
          deduplicatedLogFiles[activeSessionIndex].active = true;
          deduplicatedLogFiles[activeSessionIndex].sessionId = currentSession.id; // Ensure correct session ID
          deduplicatedLogFiles[activeSessionIndex].cost = currentSession.cost || deduplicatedLogFiles[activeSessionIndex].cost;
        }
      }

      res.json({ sessions: deduplicatedLogFiles, persistent: true });
    } catch (error) {
      console.error('Error listing sessions:', error);
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // Get logs for specific session (only if ASK_AI_LOG is configured)
  app.get('/api/interactive/session/:sessionId/logs', isAuthenticated, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const username = req.user.username;
      const logDir = process.env.ASK_AI_LOG;

      if (!logDir) {
        return res.status(404).json({ error: 'Persistent logging not configured' });
      }

      const userLogDir = path.join(logDir, username);

      if (!existsSync(userLogDir)) {
        return res.status(404).json({ error: 'Session logs not found' });
      }

      const logFiles = readdirSync(userLogDir)
        .filter(file => file.includes(sessionId) && (file.endsWith('.log') || file.endsWith('.meta')));

      if (logFiles.length === 0) {
        return res.status(404).json({ error: 'Session logs not found' });
      }

      // Prefer .meta files for most up-to-date information
      const metaFile = logFiles.find(file => file.endsWith('.meta'));
      const logFile = logFiles.find(file => file.endsWith('.log'));

      const primaryFile = metaFile ? path.join(userLogDir, metaFile) : path.join(userLogDir, logFile);

      try {
        // Try to read as JSON (new format from .meta or .log)
        const sessionData = JSON.parse(readFileSync(primaryFile, 'utf8'));
        const metadata = sessionData.metadata || {};
        const logs = sessionData.logs || [];

        res.json({
          sessionId: metadata.sessionId || sessionId,
          sessionName: metadata.sessionName || 'Unknown Session',
          logs: logs,
          output: sessionData.output || logs.join(''),
          cost: metadata.cost || extractCostFromLogs(logs),
          startTime: metadata.startTime,
          endTime: metadata.endTime,
          completed: metadata.completed || false,
          cancelled: metadata.cancelled || false,
          failed: metadata.failed || false,
          active: metadata.active || false,
          logFile: metaFile || logFile
        });
      } catch (parseError) {
        // Fallback for old format (plain text logs)
        console.warn(`Session ${sessionId} using legacy format, parsing as text`);
        const logs = readFileSync(logFile, 'utf8');
        const logLines = logs.split('\n').filter(line => line.trim());
        const cost = extractCostFromLogs(logLines);

        res.json({
          sessionId,
          sessionName: sessionId,
          logs: logLines,
          output: logs,
          cost,
          startTime: null,
          endTime: null,
          completed: false,
          cancelled: false,
          failed: false,
          active: false,
          logFile: logFiles[0]
        });
      }
    } catch (error) {
      console.error('Error getting session logs:', error);
      res.status(500).json({ error: 'Failed to get session logs' });
    }
  });
}