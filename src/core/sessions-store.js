'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config.js');

function saveSession(workspaceRoot, data) {
  try {
    const file = config.sessionFileFor(workspaceRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
    return file;
  } catch {
    return null;
  }
}

function loadLatestSession(workspaceRoot) {
  try {
    const file = config.sessionFileFor(workspaceRoot);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function clearSavedSession(workspaceRoot) {
  try {
    fs.unlinkSync(config.sessionFileFor(workspaceRoot));
  } catch {}
}

function listSessions() {
  const dir = config.sessionsDir();
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
  const sessions = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data || !Array.isArray(data.messages)) continue;
      sessions.push({ file, data });
    } catch {}
  }
  sessions.sort((a, b) => String(b.data.updatedAt).localeCompare(String(a.data.updatedAt)));
  return sessions;
}

module.exports = { saveSession, loadLatestSession, clearSavedSession, listSessions };
