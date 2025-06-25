import path from 'path';
import fs from 'fs/promises';
import { writeFileSync, appendFileSync, existsSync, readdirSync, statSync, readFileSync } from 'fs';

// Helper function to save session data persistently
export function saveSessionToPersistentStorage(session, username) {
  const logDir = process.env.ASK_AI_LOG;
  if (!logDir) {
    return; // No persistent storage configured
  }

  try {
    const userLogDir = path.join(logDir, username);

    // Create user directory if it doesn't exist
    if (!existsSync(userLogDir)) {
      fs.mkdir(userLogDir, { recursive: true }).catch(console.error);
    }

    // Create log file name with timestamp
    const timestamp = session.startTime ? session.startTime.toISOString().replace(/[:.]/g, '-') : new Date().toISOString().replace(/[:.]/g, '-');
    const logFileName = `${session.name || 'session'}_${timestamp}.log`;
    const logFilePath = path.join(userLogDir, logFileName);

    // Prepare session metadata
    const metadata = {
      sessionId: session.id,
      sessionName: session.name,
      startTime: session.startTime,
      endTime: session.endTime,
      completed: session.completed,
      cancelled: session.cancelled,
      failed: session.failed,
      exitCode: session.exitCode,
      error: session.error,
      cost: session.cost,
      active: session.active || false
    };

    // Save session data
    const sessionData = {
      metadata,
      logs: session.logs,
      output: session.output
    };

    writeFileSync(logFilePath, JSON.stringify(sessionData, null, 2));
    console.log(`Session ${session.id} saved to ${logFilePath}`);
  } catch (error) {
    console.error('Failed to save session to persistent storage:', error);
  }
}

// Utility function to extract cost from logs (check last 100 lines or find first match)
export function extractCostFromLogs(logs) {
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

// Utility function to sanitize session names for file system compatibility
export function sanitizeSessionName(name) {
  if (!name || !name.trim()) return '';

  return name.trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-')         // Replace spaces with hyphens
    .replace(/-+/g, '-')          // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, '');       // Remove leading/trailing hyphens
}

// Utility function to write logs synchronously to both console and file
export function writeLogEntry(session, logEntry, logType = 'INFO') {
  const timestamp = new Date().toISOString();
  const formattedEntry = `[${timestamp}] [${logType}] ${logEntry}`;

  // Add to session logs array
  session.logs.push(logEntry);

  // Write to console (same as before)
  console.log(`Session ${session.id} ${logType.toLowerCase()}:`, logEntry);

  // Write to log file immediately if configured
  if (session.logFile) {
    try {
      appendFileSync(session.logFile, logEntry);
    } catch (error) {
      console.error(`Failed to write to log file ${session.logFile}:`, error);
    }
  }

  // Update cost in real-time
  session.cost = extractCostFromLogs(session.logs);

  // Update session metadata in persistent storage incrementally
  if (session.logFile) {
    updateSessionMetadata(session);
  }
}

// Utility function to update session metadata incrementally
export function updateSessionMetadata(session) {
  if (!session.logFile) return;

  try {
    const metadata = {
      sessionId: session.id,
      sessionName: session.name,
      startTime: session.startTime,
      endTime: session.endTime,
      completed: session.completed,
      cancelled: session.cancelled,
      failed: session.failed,
      exitCode: session.exitCode,
      error: session.error,
      cost: session.cost,
      active: session.active || false,
      lastUpdated: new Date().toISOString()
    };

    const sessionData = {
      metadata,
      logs: session.logs,
      output: session.output || session.logs.join('')
    };

    // Write metadata to a separate .meta file for incremental updates
    const metaFile = session.logFile.replace('.log', '.meta');
    writeFileSync(metaFile, JSON.stringify(sessionData, null, 2));
  } catch (error) {
    console.error('Failed to update session metadata:', error);
  }
}