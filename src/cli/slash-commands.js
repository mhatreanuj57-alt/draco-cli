'use strict';

const fs = require('fs');
const path = require('path');
const api = require('../providers/openai-compatible.js');
const { listSessions } = require('../core/sessions-store.js');
const { APPROVAL_MODES } = require('../core/approvals.js');
const config = require('../config.js');
const ui = require('../ui/terminal.js');

const EXIT = Symbol('exit');

const HELP_LINES = [
  'Commands:',
  '  /help                  Show this help',
  '  /models                List models from the live registry (cached list on failure)',
  '  /model [id]            Show or switch the active model (persists)',
  '  /approvals [mode]      suggest | auto-edit | full-auto (persists)',
  '  /yolo [on|off]         Shortcut for full-auto vs suggest',
  '  /sessions              List saved conversation sessions',
  '  /resume [n]            Resume a saved session in place',
  '  /compact               Summarize the conversation to free context',
  '  /usage                 Session usage stats',
  '  /retry                 Resend your last message',
  '  /config                Show effective configuration',
  '  /clear                 Reset the conversation (keeps the system prompt)',
  '  /init                  Generate an AGENTS.md project-instructions file',
  '  /version               Print version',
  '  /quit, /exit           Leave Draco',
];

function helpText(cfg) {
  const lines = HELP_LINES.slice();
  if (!cfg.searchApiKey) {
    lines.push(
      '',
      `${ui.c.gray}Web search uses DuckDuckGo (no key needed). Set DRACO_SEARCH_API_KEY to use Brave.${ui.c.reset}`
    );
  }
  return lines.join('\n');
}

function describeSession(entry, i) {
  const d = entry.data;
  const firstUser = (d.messages.find((m) => m.role === 'user' && typeof m.content === 'string') || {}).content;
  let preview = firstUser ? String(firstUser).replace(/\s+/g, ' ').slice(0, 48) : '(no prompt yet)';
  return `${String(i + 1).padStart(2)}  ${d.cwd}  ${ui.c.gray}${(d.updatedAt || '').slice(0, 16).replace('T', ' ')}${ui.c.reset}  ${d.model}\n    ${ui.c.dim}${preview}${ui.c.reset}`;
}

async function handle(line, rt) {
  if (!line.startsWith('/')) return false;
  const [cmdRaw, ...rest] = line.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const arg = rest.join(' ').trim();
  const cfg = rt.cfg;

  switch (cmd) {
    case '/help':
      process.stdout.write(helpText(cfg) + '\n');
      return true;

    case '/version':
      process.stdout.write(`Draco CLI v${cfg.version}\n`);
      return true;

    case '/models': {
      ui.info('Fetching model registry…');
      try {
        const ids = await api.listModels(cfg);
        for (const id of ids) {
          const marker = id === rt.agent.activeModel ? `${ui.c.green}*${ui.c.reset} ` : '  ';
          process.stdout.write(`${marker}${id}\n`);
        }
        process.stdout.write(
          `${ui.c.gray}(active marked with *; some accounts use an "opencode/" prefix — switch with /model opencode/<id>)${ui.c.reset}\n`
        );
      } catch (e) {
        ui.error(
          `Could not fetch live registry (${e.message || e}). Showing cached known free models:`
        );
        for (const id of config.KNOWN_FREE_MODELS) {
          const marker = id === rt.agent.activeModel ? `${ui.c.green}*${ui.c.reset} ` : '  ';
          process.stdout.write(`${marker}${id}\n`);
        }
      }
      return true;
    }

    case '/model': {
      if (!arg) {
        process.stdout.write(`Active model: ${rt.agent.activeModel}\n`);
        return true;
      }
      rt.agent.setModel(arg);
      try {
        config.persistConfig({ model: arg });
        ui.success(`Model set to ${arg} (persisted to ${cfg.configFile}).`);
      } catch (e) {
        ui.error(`Model switched to ${arg} for this session, but persisting failed: ${e.message}`);
      }
      return true;
    }

    case '/yolo': {
      const next = arg === 'on' ? 'full-auto' : arg === 'off' ? 'suggest' : (cfg.approvals === 'full-auto' ? 'suggest' : 'full-auto');
      cfg.approvals = next;
      cfg.yolo = next === 'full-auto';
      try {
        config.persistConfig({ approvals: next });
      } catch {}
      if (next === 'full-auto') ui.warn('FULL-AUTO — shell commands run without confirmation. Use with care.');
      else ui.success(`Approval mode: ${next}.`);
      return true;
    }

    case '/approvals': {
      const modes = APPROVAL_MODES;
      if (!arg) {
        process.stdout.write(
          [
            `Approval mode: ${cfg.approvals}`,
            '',
            `${ui.c.bold}suggest${ui.c.reset}    ask before file writes AND shell commands`,
            `${ui.c.bold}auto-edit${ui.c.reset}  apply file edits automatically, still ask before shell`,
            `${ui.c.bold}full-auto${ui.c.reset}  everything runs without asking`,
          ].join('\n') + '\n'
        );
        return true;
      }
      const mode = arg.toLowerCase();
      if (!modes.includes(mode)) {
        ui.error(`Unknown mode "${arg}". Use one of: ${modes.join(', ')}.`);
        return true;
      }
      cfg.approvals = mode;
      cfg.yolo = mode === 'full-auto';
      try {
        config.persistConfig({ approvals: mode });
        ui.success(`Approval mode: ${mode} (persisted).`);
      } catch {
        ui.success(`Approval mode: ${mode} (this session).`);
      }
      return true;
    }

    case '/sessions': {
      const sessions = listSessions();
      if (!sessions.length) {
        ui.info('No saved sessions yet. Conversations auto-save as you chat.');
        return true;
      }
      process.stdout.write(sessions.map((s, i) => describeSession(s, i)).join('\n') + '\n');
      return true;
    }

    case '/resume': {
      const sessions = listSessions();
      if (!sessions.length) {
        ui.info('No saved sessions to resume.');
        return true;
      }
      const idx = parseInt(arg, 10);
      if (!Number.isInteger(idx) || idx < 1 || idx > sessions.length) {
        process.stdout.write(sessions.map((s, i) => describeSession(s, i)).join('\n') + '\n');
        ui.info('Run /resume <number> to restore one.');
        return true;
      }
      const chosen = sessions[idx - 1];
      if (rt.agent.importSession(chosen.data)) {
        ui.success(`Resumed session from ${chosen.data.cwd} (${chosen.data.model}).`);
      } else {
        ui.error('That session could not be restored.');
      }
      return true;
    }

    case '/compact': {
      await rt.agent.compact();
      return true;
    }

    case '/usage': {
      const u = rt.agent.getUsage();
      const lines = [
        `messages in context:  ${u.messages}`,
        `turns this session:   ${u.turns}`,
        `response characters:  ${u.outputChars}`,
        `approx output tokens: ~${Math.round(u.outputChars / 4)}`,
      ];
      process.stdout.write(lines.join('\n') + '\n');
      return true;
    }

    case '/init': {
      const target = path.join(cfg.workspaceRoot, 'AGENTS.md');
      if (fs.existsSync(target)) {
        ui.warn('AGENTS.md already exists here — edit it directly.');
        return true;
      }
      const template = [
        `# AGENTS.md`,
        '',
        `Instructions for Draco (and other coding agents) working in this repository.`,
        '',
        '## Project overview',
        '- What this project does:',
        '',
        '## Build & test commands',
        '- Install:',
        '- Build:',
        '- Test:',
        '',
        '## Conventions',
        '- Language/framework:',
        '- Style rules:',
        '- Files or directories never to modify:',
        '',
      ].join('\n');
      try {
        fs.writeFileSync(target, template);
        ui.success(`Created ${target}. Fill it in — Draco reads it automatically every session.`);
      } catch (e) {
        ui.error(`Could not write AGENTS.md: ${e.message}`);
      }
      return true;
    }

    case '/config': {
      const k = cfg.apiKey;
      const masked = k
        ? (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '•••')
        : 'not set';
      const mcpCount = rt.mcp ? rt.mcp.listTools().length : 0;
      const lines = [
        `version:       ${cfg.version}`,
        `endpoint:      ${cfg.apiBase}`,
        `model:         ${rt.agent.activeModel}`,
        `approvals:     ${cfg.approvals}`,
        `fallbackChain: ${cfg.fallbackChain.join(' -> ')}`,
        `search:        ${cfg.searchApiKey ? `${cfg.searchProvider} (key set)` : 'duckduckgo (keyless)'}`,
        `mcp tools:     ${mcpCount}`,
        `workspaceRoot: ${cfg.workspaceRoot}`,
        `config file:   ${cfg.configFile}`,
        `api key:       ${masked} (${cfg.keySource || 'unknown source'})`,
      ];
      process.stdout.write(lines.map((l) => `${ui.c.gray}${l}${ui.c.reset}`).join('\n') + '\n');
      return true;
    }

    case '/clear':
      rt.agent.reset();
      rt.agent.clearSavedSession();
      ui.success('Conversation cleared.');
      return true;

    case '/retry':
      await rt.agent.retry();
      return true;

    case '/quit':
    case '/exit':
      return EXIT;

    default:
      ui.error(`Unknown command "${cmdRaw}". Type /help for commands.`);
      return true;
  }
}

module.exports = { handle, EXIT };

