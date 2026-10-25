'use strict';

const readline = require('readline');

const config = require('./config.js');
const ui = require('./ui/terminal.js');
const mcpClient = require('./integrations/mcp-manager.js');
const { createSession } = require('./core/session.js');
const { loadLatestSession } = require('./core/sessions-store.js');
const { parseArgs } = require('./cli/args.js');
const { createLineQueue } = require('./cli/line-queue.js');
const { runRepl } = require('./cli/repl.js');
const { runOneShot } = require('./cli/oneshot.js');
const { handle: handleSlash, EXIT: SLASH_EXIT } = require('./cli/slash-commands.js');
const store = require('./ui/tui/store.js');
const { setMode } = require('./ui/tui/sink.js');
const { bootTui } = require('./ui/tui/boot.js');

function printUsage() {
  process.stdout.write(
    [
      `Draco CLI v${config.VERSION}`,
      '',
      'Usage: draco [prompt] [options]',
      '',
      'Options:',
      '  --model=<id>    Start with a specific model id',
      '  --suggest       Ask before every file write and shell command',
      '  --auto-edit     Auto-apply file edits, still ask before shell commands',
      '  --full-auto     Run everything without asking (same as --yolo)',
      '  --yolo          Alias of --full-auto',
      '  --continue, -c  Resume the last session for this directory',
      '  --version, -v   Print version and exit',
      '  --help, -h      Show this help',
      '  --check-update  Check for available updates',
      '',
      'One-shot mode:   draco "your prompt here" — answer once, then exit',
      '',
      'Environment:',
      '  GEMINI_API_KEY          Google AI Studio key (skips the first-run prompt)',
      '  GOOGLE_API_KEY          Alias of GEMINI_API_KEY',
      '  DRACO_MODEL             Default model override (default: gemini-3.8-flash)',
      '  DRACO_APPROVALS         suggest | auto-edit | full-auto',
      '  DRACO_YOLO              "true" to auto-approve shell commands',
      '  DRACO_SEARCH_PROVIDER   Search backend when a key is set (default: brave)',
      '  DRACO_SEARCH_API_KEY    Optional. Use Brave instead of built-in DuckDuckGo',
    ].join('\n') + '\n'
  );
}

function installGlobalHandlers() {
  process.on('uncaughtException', (err) => {
    ui.error(`Uncaught exception: ${err && err.stack ? err.stack : err}`);
  });
  process.on('unhandledRejection', (reason) => {
    ui.error(`Unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
  });
}

async function ensureApiKey(cfg, nextLine) {
  if (cfg.apiKey) return true;
  ui.info('No API key found. Create a free one at https://aistudio.google.com/apikey');
  for (let attempt = 0; attempt < 5; attempt++) {
    process.stdout.write(
      `${ui.c.yellow}?${ui.c.reset} Paste your Google AI Studio API key: `
    );
    const line = await nextLine();
    if (line === null) return false;
    const key = line.trim();
    if (!key) {
      ui.error('Key cannot be empty.');
      continue;
    }
    const spinner = new ui.Spinner('Validating key…');
    spinner.start();
    const probe = await api_probe(cfg, key);
    spinner.stop();
    if (probe.verdict === 'invalid') {
      ui.error(`Key rejected (HTTP ${probe.status}). Check it and try again.`);
      continue;
    }
    if (probe.verdict === 'unreachable') {
      ui.error(`Could not reach the API to verify (${probe.detail}). Using the key anyway.`);
    }
    cfg.apiKey = key;
    cfg.keySource = 'session';
    break;
  }
  if (!cfg.apiKey) return false;
  process.stdout.write(
    `${ui.c.yellow}?${ui.c.reset} Save key to ${cfg.configFile} for future sessions? [Y/n] `
  );
  const saveAnswer = await nextLine();
  const declined =
    saveAnswer !== null && ['n', 'no'].includes(saveAnswer.trim().toLowerCase());
  if (declined) {
    ui.info('Key kept for this session only.');
  } else {
    try {
      config.persistConfig({ apiKey: cfg.apiKey });
      cfg.keySource = 'saved';
      ui.success(`Key saved to ${cfg.configFile}.`);
    } catch (e) {
      ui.error(`Could not save key (${e.message}). It will only last this session.`);
    }
  }
  return true;
}

async function checkForUpdate() {
  const https = require('https');
  const currentVersion = config.VERSION;
  
  return new Promise((resolve) => {
    const options = {
      hostname: 'registry.npmjs.org',
      path: '/draco-cli/latest',
      method: 'GET',
      timeout: 5000,
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const pkg = JSON.parse(data);
          const latestVersion = pkg.version;
          if (latestVersion !== currentVersion) {
            resolve({
              updateAvailable: true,
              current: currentVersion,
              latest: latestVersion,
            });
          } else {
            resolve({ updateAvailable: false, current: currentVersion });
          }
        } catch (e) {
          resolve({ updateAvailable: false, current: currentVersion, error: e.message });
        }
      });
    });
    
    req.on('error', () => {
      resolve({ updateAvailable: false, current: currentVersion, error: 'Could not check for updates' });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ updateAvailable: false, current: currentVersion, error: 'Timeout checking for updates' });
    });
    
    req.end();
  });
}

function api_probe(cfg, key) {
  const { probeApiKey } = require('./providers/openai-compatible.js');
  return probeApiKey(cfg, key);
}

async function runTui({ cfg, flags, mcp, rl }) {
  // Everything printed from here on is captured into the store instead of stdout.
  setMode('tui');

  // Approvals and confirmations become an overlay rather than a readline
  // prompt, so they resolve through the modal instead of nextLine().
  const agent = createSession(
    cfg,
    async (question) => store.askModal(question, { kind: 'ask' }),
    { mcp }
  );

  if (flags.continueSession) {
    const data = loadLatestSession(cfg.workspaceRoot);
    if (data && agent.importSession(data)) {
      store.push({ kind: 'success', text: `Resumed last session (${data.model}).` });
    } else {
      store.push({ kind: 'info', text: 'No previous session for this directory — starting fresh.' });
    }
  }

  // readline must let go of stdin before Ink takes it into raw mode.
  try {
    rl.removeAllListeners('line');
    rl.removeAllListeners('close');
    rl.close();
  } catch {
    /* already closed */
  }

  const rt = { cfg, agent, mcp };

  const handleSubmit = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return undefined;
    store.push({ kind: 'user', text: trimmed });
    const result = await handleSlash(trimmed, rt);
    if (result === SLASH_EXIT) return 'exit';
    if (result === false) {
      await agent.runTurn(trimmed).catch((e) => {
        store.push({ kind: 'error', text: e && e.message ? e.message : String(e) });
      });
    }
    return undefined;
  };

  const handleExit = () => {
    try {
      mcp.stopAll();
    } catch {
      /* nothing to stop */
    }
    setTimeout(() => process.exit(0), 150).unref();
  };

  await bootTui({ cfg, agent, mcp, handleSubmit, handleExit });
}

async function main(argv) {
  let flags;
  try {
    flags = parseArgs(argv || []);
  } catch (e) {
    ui.error(e.message);
    printUsage();
    process.exit(2);
  }

  config.loadEnvFile();
  if (flags.version) {
    process.stdout.write(`Draco CLI v${config.VERSION}\n`);
    return;
  }
  if (flags.help) {
    printUsage();
    return;
  }
  
  if (flags.checkUpdate) {
    const result = await checkForUpdate();
    if (result.updateAvailable) {
      ui.info(`Update available: ${result.current} -> ${result.latest}`);
      ui.info('Run "npm update -g draco-cli" to update.');
    } else {
      ui.success(`You are running the latest version (${result.current}).`);
    }
    return;
  }

  const cfg = config.resolveConfig(flags);

  // The full-screen TUI needs a real terminal on both ends, and only makes
  // sense for the interactive loop — one-shot prompts and piped runs stay on
  // the legacy readline path.
  const wantsTui = Boolean(process.stdin.isTTY && process.stdout.isTTY) &&
    !(flags.promptArgs && flags.promptArgs.length > 0);

  if (!wantsTui) ui.splash(cfg);

  installGlobalHandlers();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
  });
  const lineQueue = createLineQueue(rl);
  const nextLine = lineQueue.nextLine;

  rl.on('SIGINT', () => {
    process.stdout.write('\n');
    ui.info('Goodbye.');
    process.exit(0);
  });

  const hasKey = await ensureApiKey(cfg, nextLine);
  if (!hasKey) {
    ui.error('No API key provided. Set GEMINI_API_KEY or enter it when prompted.');
    process.exit(1);
  }

  const mcp = await mcpClient.createFromConfig();

  if (wantsTui) {
    await runTui({ cfg, flags, mcp, rl });
    return;
  }

  const agent = createSession(
    cfg,
    async (question) => {
      process.stdout.write(`${ui.c.yellow}?${ui.c.reset} ${question}`);
      const answer = await nextLine();
      return answer === null ? '' : answer;
    },
    { mcp }
  );

  rl.on('keypress', (_ch, key) => {
    if (key && key.name === 'escape') {
      agent.abortActive();
    }
  });

  if (flags.continueSession) {
    const data = loadLatestSession(cfg.workspaceRoot);
    if (data && agent.importSession(data)) ui.success(`Resumed last session (${data.model}).`);
    else ui.info('No previous session for this directory — starting fresh.');
  }

  if (flags.promptArgs && flags.promptArgs.length > 0) {
    const prompt = flags.promptArgs.join(' ').trim();
    const code = await runOneShot({ prompt, agent });
    try {
      rl.close();
    } catch {}
    mcp.stopAll();
    setTimeout(() => process.exit(code), 300);
    return;
  }

  await runRepl({ cfg, rl, lineQueue, agent, mcp });

  try {
    mcp.stopAll();
  } catch {}
  setTimeout(() => process.exit(0), 250).unref();
}

module.exports = { main };
