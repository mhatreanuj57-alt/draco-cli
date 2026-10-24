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
      '  OPENCODE_ZEN_KEY        Optional. Skips the first-run key prompt.',
      '  DRACO_MODEL             Default model override (default: nemotron-3-ultra-free)',
      '  DRACO_APPROVALS         suggest | auto-edit | full-auto',
      '  DRACO_YOLO              "true" to auto-approve shell commands',
      '  DRACO_API_BASE          Override the API endpoint',
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
  ui.info('No API key found. Get a free one at https://opencode.ai');
  for (let attempt = 0; attempt < 5; attempt++) {
    process.stdout.write(`${ui.c.yellow}?${ui.c.reset} Enter your OpenCode Zen API key: `);
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
  ui.splash(cfg);

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
    ui.error('No API key provided. Set OPENCODE_ZEN_KEY or enter it when prompted.');
    process.exit(1);
  }

  const mcp = await mcpClient.createFromConfig();

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
