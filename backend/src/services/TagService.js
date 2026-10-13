// backend/src/services/TagService.js

/**
 * TagService - simple in‑memory service to manage tags for individual log entries.
 * It operates on the same `store` Map used by the routes (via a reference passed in).
 * Each log entry (parsed log) is expected to have a `tags` array (initialized during processing).
 */

function addTag(store, fileId, logIndex, newTags) {
  const record = store.get(fileId);
  if (!record) {
    throw new Error('File not found');
  }
  const logEntry = record.parsedLogs.find(l => l.index === logIndex);
  if (!logEntry) {
    throw new Error('Log entry not found');
  }
  if (!Array.isArray(logEntry.tags)) {
    logEntry.tags = [];
  }
  // Ensure tags are unique strings
  newTags.forEach(tag => {
    const tagStr = String(tag).trim();
    if (tagStr && !logEntry.tags.includes(tagStr)) {
      logEntry.tags.push(tagStr);
    }
  });

  // Persist to database directly to avoid re-inserting all logs
  const db = require('../db');
  db.prepare('UPDATE logs SET tags = ? WHERE fileId = ? AND logIndex = ?').run(JSON.stringify(logEntry.tags), fileId, logIndex);

  return logEntry.tags;
}

function getTagsForFile(store, fileId) {
  const record = store.get(fileId);
  if (!record) {
    throw new Error('File not found');
  }
  // Return a map of logIndex -> tags array
  const result = {};
  record.parsedLogs.forEach(log => {
    result[log.index] = log.tags || [];
  });
  return result;
}

module.exports = {
  addTag,
  getTagsForFile
};
