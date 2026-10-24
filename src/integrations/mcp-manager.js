'use strict';

const { spawn } = require('child_process');
const config = require('../config.js');
const ui = require('../ui/terminal.js');

const REQUEST_TIMEOUT_MS = 30000;
const MAX_TOOL_RESULT_CHARS = 32000;

class McpServer {
  constructor(name, definition) {
    this.name = name;
    this.definition = definition;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.tools = [];
    this.ready = false;
  }

  connect() {
    const def = this.definition;
    if (!def || typeof def.command !== 'string') {
      throw new Error(`server "${this.name}" needs a "command" field`);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.proc = spawn(def.command, Array.isArray(def.args) ? def.args : [], {
          env: { ...process.env, ...(def.env || {}) },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e) {
        return reject(e);
      }
      const failTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`MCP server "${this.name}" did not respond in time`));
        }
      }, REQUEST_TIMEOUT_MS);

      this.proc.stdout.on('data', (chunk) => this.onData(chunk));
      this.proc.stderr.on('data', () => {});
      this.proc.on('error', (e) => {
        if (!settled) {
          settled = true;
          clearTimeout(failTimer);
          reject(e);
        }
      });
      this.proc.on('exit', () => {
        for (const p of this.pending.values()) {
          p.reject(new Error(`MCP server "${this.name}" exited`));
        }
        this.pending.clear();
        this.ready = false;
      });

      this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'draco-cli', version: config.VERSION },
      })
        .then(async () => {
          this.notify('notifications/initialized', {});
          const res = await this.request('tools/list', {});
          this.tools = Array.isArray(res.tools) ? res.tools : [];
          this.ready = true;
          settled = true;
          clearTimeout(failTimer);
          resolve(this.tools);
        })
        .catch((e) => {
          if (!settled) {
            settled = true;
            clearTimeout(failTimer);
            reject(e);
          }
        });
    });
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    }
  }

  send(obj) {
    if (!this.proc || !this.proc.stdin.writable) throw new Error(`MCP server "${this.name}" is not running`);
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  request(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.send(payload);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  notify(method, params) {
    try {
      this.send({ jsonrpc: '2.0', method, params });
    } catch {
      // notifications are best-effort
    }
  }

  async callTool(toolName, args) {
    const result = await this.request('tools/call', { name: toolName, arguments: args || {} });
    if (result && result.isError) {
      const errText = extractText(result).slice(0, 500);
      throw new Error(errText || 'tool reported an error');
    }
    return extractText(result);
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
      this.ready = false;
    }
  }
}

function extractText(result) {
  if (!result) return '';
  const content = Array.isArray(result.content) ? result.content : [];
  const parts = content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text);
  const text = parts.join('\n').trim();
  return truncate(text);
}

function truncate(text, max = MAX_TOOL_RESULT_CHARS) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n[...truncated ${text.length - max} chars...]`;
}

class McpManager {
  constructor(serverDefs) {
    this.servers = [];
    for (const [name, definition] of Object.entries(serverDefs || {})) {
      this.servers.push(new McpServer(name, definition));
    }
  }

  async startAll() {
    const summaries = [];
    for (const server of this.servers) {
      try {
        const tools = await server.connect();
        summaries.push(`${server.name}: ${tools.length} tool(s)`);
      } catch (e) {
        ui.error(`MCP server "${server.name}" failed to start (${e.message}). Continuing without it.`);
      }
    }
    return summaries;
  }

  listTools() {
    const out = [];
    for (const server of this.servers) {
      if (!server.ready) continue;
      for (const tool of server.tools) {
        out.push({
          qualifiedName: `mcp_${sanitize(server.name)}_${sanitize(tool.name)}`,
          serverName: server.name,
          toolName: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        });
      }
    }
    return out;
  }

  async call(qualifiedName, args) {
    const tool = this.listTools().find((t) => t.qualifiedName === qualifiedName);
    if (!tool) throw new Error(`Unknown MCP tool "${qualifiedName}".`);
    const server = this.servers.find((s) => s.name === tool.serverName && s.ready);
    if (!server) throw new Error(`MCP server "${tool.serverName}" is not running.`);
    return server.callTool(tool.toolName, args);
  }

  stopAll() {
    for (const server of this.servers) server.stop();
  }
}

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
}

async function createFromConfig() {
  const defs = config.loadMcpConfig();
  const manager = new McpManager(defs);
  if (Object.keys(defs).length > 0) {
    const summaries = await manager.startAll();
    if (summaries.length) ui.info(`MCP servers: ${summaries.join(', ')}`);
  }
  return manager;
}

module.exports = { McpManager, McpServer, createFromConfig };
