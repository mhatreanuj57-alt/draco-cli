'use strict';

// Boots the full-screen TUI.
//
// Ink is ESM-only, so it is loaded here with `await import('ink')` and handed
// to the component tree through ink-api.js. All synchronous modules (Chat,
// Sidebar, session.js, terminal.js) stay plain require()-able CommonJS.

const h = require('react').createElement;
const { setInk } = require('./ink-api.js');
const { setMode } = require('./sink.js');
const store = require('./store.js');
const { App } = require('./App.js');

const ENTER_ALT = '\x1b[?1049h\x1b[?25l\x1b[H';
const LEAVE_ALT = '\x1b[?25h\x1b[?1049l';

function syncSidebar({ cfg, agent, mcp }) {
  const patch = {};
  if (cfg) {
    patch.workspace = cfg.workspaceRoot;
    patch.approvals = cfg.yolo ? 'full-auto' : cfg.approvals || 'suggest';
    patch.model = cfg.model;
  }
  if (agent) {
    try {
      const u = agent.getUsage();
      patch.turns = u.turns || 0;
      patch.messageCount = u.messages || 0;
    } catch {
      /* usage is best-effort */
    }
    if (agent.activeModel) patch.model = agent.activeModel;
  }
  if (mcp) {
    try {
      patch.mcpServers = Array.isArray(mcp.servers) ? mcp.servers.length : 0;
      patch.mcpTools = mcp.listTools().length;
    } catch {
      patch.mcpServers = 0;
      patch.mcpTools = 0;
    }
  }
  store.setSidebar(patch);
}

async function bootTui({ cfg, agent, mcp, handleSubmit, handleExit }) {
  const ink = await import('ink');
  setInk(ink);
  setMode('tui');
  syncSidebar({ cfg, agent, mcp });

  if (store.getState().entries.length === 0) {
    store.push({ kind: 'rule', label: ` draco v${cfg.version || ''} ` });
    store.push({ kind: 'info', text: `Workspace: ${cfg.workspaceRoot}` });
    store.push({ kind: 'info', text: `Model: ${cfg.model} · Gemini free tier` });
    store.push({
      kind: 'success',
      text: 'Ready. Type a prompt, / for commands, or esc to stop a response.',
    });
  }

  process.stdout.write(ENTER_ALT);

  const wrapped = async (line) => {
    syncSidebar({ cfg, agent, mcp });
    store.setState({ running: true });
    store.resetInput();
    try {
      const result = await handleSubmit(line);
      if (result === 'exit') {
        exitResolve();
        return;
      }
    } catch (err) {
      store.push({
        kind: 'error',
        text: err && err.message ? err.message : String(err),
      });
    } finally {
      store.setState({ running: false });
      store.setStatus({ thinking: false });
      store.setScroll({ offset: 0, follow: true });
      syncSidebar({ cfg, agent, mcp });
    }
  };

  let exitResolve;
  const exited = new Promise((resolve) => {
    exitResolve = resolve;
  });

  const exit = async () => {
    handleExit();
    exitResolve();
  };

  const instance = ink.render(h(App, { onSubmit: wrapped, onExit: exit, agent }), {
    exitOnCtrlC: false,
    stdout: process.stdout,
    stdin: process.stdin,
  });

  const onSigint = () => {
    exit();
  };
  process.on('SIGINT', onSigint);

  await exited;
  process.removeListener('SIGINT', onSigint);

  try {
    instance.unmount();
  } catch {
    /* already gone */
  }
  setMode('legacy');
  process.stdout.write(LEAVE_ALT);
}

module.exports = { bootTui, syncSidebar };
