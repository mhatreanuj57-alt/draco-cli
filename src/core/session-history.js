'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const theme = require('../ui/theme.js');

class SessionHistory {
  constructor(config) {
    this.config = config;
    this.historyFile = path.join(
      os.homedir(),
      '.draco',
      'history',
      `${config.workspaceHash || 'default'}.json`
    );
    this.sessions = [];
    this.currentIndex = -1;
    this.maxSessions = 100;
  }

  load() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf8');
        this.sessions = JSON.parse(data);
        this.currentIndex = this.sessions.length - 1;
      }
    } catch (error) {
      theme.printError(`Failed to load history: ${error.message}`);
      this.sessions = [];
    }
  }

  save() {
    try {
      const dir = path.dirname(this.historyFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const sessionsToSave = this.sessions.slice(-this.maxSessions);
      fs.writeFileSync(this.historyFile, JSON.stringify(sessionsToSave, null, 2));
    } catch (error) {
      theme.printError(`Failed to save history: ${error.message}`);
    }
  }

  addSession(session) {
    const historyEntry = {
      id: Date.now().toString(36),
      timestamp: new Date().toISOString(),
      model: session.model,
      prompt: session.prompt?.substring(0, 200) || '',
      tokenCount: session.tokenCount || 0,
      messageCount: session.messages?.length || 0,
      duration: session.duration || 0,
      workspace: this.config.workspaceRoot,
      tags: session.tags || [],
    };

    this.sessions.push(historyEntry);
    this.currentIndex = this.sessions.length - 1;
    this.save();

    return historyEntry;
  }

  updateSession(id, updates) {
    const index = this.sessions.findIndex((s) => s.id === id);
    if (index === -1) return null;

    this.sessions[index] = { ...this.sessions[index], ...updates };
    this.save();

    return this.sessions[index];
  }

  getSession(id) {
    return this.sessions.find((s) => s.id === id) || null;
  }

  getRecentSessions(count = 10) {
    return this.sessions.slice(-count).reverse();
  }

  searchSessions(query) {
    const lowerQuery = query.toLowerCase();
    return this.sessions
      .filter(
        (s) =>
          s.prompt.toLowerCase().includes(lowerQuery) ||
          s.model.toLowerCase().includes(lowerQuery) ||
          s.tags.some((t) => t.toLowerCase().includes(lowerQuery))
      )
      .reverse();
  }

  clearHistory() {
    this.sessions = [];
    this.currentIndex = -1;
    this.save();
  }

  getStats() {
    const totalSessions = this.sessions.length;
    const totalTokens = this.sessions.reduce((sum, s) => sum + (s.tokenCount || 0), 0);
    const totalMessages = this.sessions.reduce((sum, s) => sum + (s.messageCount || 0), 0);

    const modelCounts = {};
    for (const session of this.sessions) {
      modelCounts[session.model] = (modelCounts[session.model] || 0) + 1;
    }

    const tagCounts = {};
    for (const session of this.sessions) {
      for (const tag of session.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    return {
      totalSessions,
      totalTokens,
      totalMessages,
      modelCounts,
      tagCounts,
      averageTokensPerSession: totalSessions > 0 ? Math.round(totalTokens / totalSessions) : 0,
    };
  }

  exportHistory(format = 'json') {
    if (format === 'json') {
      return JSON.stringify(this.sessions, null, 2);
    }

    if (format === 'markdown') {
      let md = '# Session History\n\n';
      for (const session of this.sessions.reverse()) {
        md += `## ${session.timestamp}\n`;
        md += `- **Model**: ${session.model}\n`;
        md += `- **Prompt**: ${session.prompt}\n`;
        md += `- **Tokens**: ${session.tokenCount}\n`;
        md += `- **Messages**: ${session.messageCount}\n\n`;
      }
      return md;
    }

    if (format === 'csv') {
      const headers = ['timestamp', 'model', 'prompt', 'tokenCount', 'messageCount', 'duration'];
      const rows = this.sessions.map((s) =>
        headers.map((h) => `"${String(s[h] || '').replace(/"/g, '""')}"`).join(',')
      );
      return [headers.join(','), ...rows].join('\n');
    }

    throw new Error(`Unsupported format: ${format}`);
  }
}

module.exports = { SessionHistory };
