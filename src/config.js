'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let VERSION = '0.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  if (pkg && pkg.version) VERSION = pkg.version;
} catch {
  // keep fallback version
}

const PROVIDER_NAME = 'Google AI Studio';
const DEFAULT_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_API_PATH = '';
const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_FALLBACK_CHAIN = ['gemini-3.8-flash', 'gemini-3.1-pro-preview'];
const KNOWN_FREE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
];

// Gemini free tier queues requests: measured TTFB of ~110s, occasionally >180s.
// This is an *idle* budget that resets on every chunk, so it only governs how
// long we wait in total silence — not how long a reply may stream for.
const CHAT_TIMEOUT_MS = 300000;
const MODELS_TIMEOUT_MS = 30000;
const SHELL_TIMEOUT_MS = 45000;
const SHELL_MAX_BUFFER = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30000;
const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const READ_FILE_MAX_BYTES = 256 * 1024;

function configFilePath() {
  return path.join(os.homedir(), '.draco', 'config.json');
}

function loadEnvFile(dir) {
  const p = path.join(dir || process.cwd(), '.env');
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return;
  }
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function loadPersisted() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFilePath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistConfig(patch) {
  const next = { ...loadPersisted() };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
  fs.writeFileSync(configFilePath(), JSON.stringify(next, null, 2) + '\n');
  return next;
}

const APPROVAL_MODES = ['suggest', 'auto-edit', 'full-auto'];
const DEFAULT_APPROVALS = 'suggest';

function configDirPath() {
  return path.join(os.homedir(), '.draco');
}

function configFilePath() {
  return path.join(configDirPath(), 'config.json');
}

function sessionsDir() {
  return path.join(configDirPath(), 'sessions');
}

function mcpConfigPath() {
  return path.join(configDirPath(), 'mcp.json');
}

function loadMcpConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(mcpConfigPath(), 'utf8'));
    const servers = parsed && typeof parsed === 'object' ? parsed.mcpServers : null;
    return servers && typeof servers === 'object' ? servers : {};
  } catch {
    return {};
  }
}

function sessionFileFor(cwd) {
  const key = cwd.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'root';
  return path.join(sessionsDir(), `${key}.json`);
}

function validateConfig(config) {
  const warnings = [];
  
  if (!config.apiKey) {
    warnings.push(
      'No API key configured. Get one at https://aistudio.google.com/apikey and set GEMINI_API_KEY.'
    );
  }

  if (config.model && !KNOWN_FREE_MODELS.includes(config.model)) {
    warnings.push(
      `Model "${config.model}" is not on the Gemini free-tier list. It may be paid-only or invalid.`
    );
  }
  
  if (config.fallbackChain && config.fallbackChain.length === 0) {
    warnings.push('Fallback chain is empty. Using default chain.');
    config.fallbackChain = DEFAULT_FALLBACK_CHAIN.slice();
  }
  
  if (config.searchProvider === 'brave' && !config.searchApiKey) {
    warnings.push('Brave search selected but no API key. Will fall back to DuckDuckGo.');
  }
  
  return { config, warnings };
}

function resolveConfig(cliFlags) {
  loadEnvFile();
  const persisted = loadPersisted();
  const env = process.env;
  const cli = cliFlags || {};

  const model =
    cli.model || env.DRACO_MODEL || persisted.model || DEFAULT_MODEL;

  let yolo = false;
  if (cli.yolo) yolo = true;
  else if (env.DRACO_YOLO === 'true') yolo = true;
  else if (env.DRACO_YOLO === 'false') yolo = false;
  else if (typeof persisted.yolo === 'boolean') yolo = persisted.yolo;

  let approvals = cli.approvals || env.DRACO_APPROVALS || persisted.approvals;
  if (!APPROVAL_MODES.includes(approvals)) approvals = DEFAULT_APPROVALS;
  if (yolo) approvals = 'full-auto';

  const fallbackChain =
    Array.isArray(persisted.fallbackChain) && persisted.fallbackChain.length > 0
      ? persisted.fallbackChain
      : DEFAULT_FALLBACK_CHAIN.slice();

  let apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '';
  let keySource = null;
  if (apiKey) {
    keySource = env.GEMINI_API_KEY ? 'environment' : 'environment (GOOGLE_API_KEY)';
  } else if (typeof persisted.apiKey === 'string' && persisted.apiKey.trim()) {
    apiKey = persisted.apiKey.trim();
    keySource = 'saved';
  }

  const config = {
    version: VERSION,
    provider: PROVIDER_NAME,
    apiKey,
    keySource,
    apiBase: DEFAULT_API_BASE,
    apiPath: DEFAULT_API_PATH,
    model,
    yolo,
    approvals,
    fallbackChain,
    searchProvider: env.DRACO_SEARCH_PROVIDER || 'brave',
    searchApiKey: env.DRACO_SEARCH_API_KEY || '',
    workspaceRoot: process.cwd(),
    configFile: configFilePath(),
  };

  const validated = validateConfig(config);
  validated.config.warnings = validated.warnings;
  return validated.config;
}

module.exports = {
  VERSION,
  APPROVAL_MODES,
  DEFAULT_APPROVALS,
  DEFAULT_API_BASE,
  DEFAULT_API_PATH,
  PROVIDER_NAME,
  DEFAULT_MODEL,
  DEFAULT_FALLBACK_CHAIN,
  KNOWN_FREE_MODELS,
  CHAT_TIMEOUT_MS,
  MODELS_TIMEOUT_MS,
  SHELL_TIMEOUT_MS,
  SHELL_MAX_BUFFER,
  FETCH_TIMEOUT_MS,
  FETCH_MAX_BYTES,
  READ_FILE_MAX_BYTES,
  configFilePath,
  configDirPath,
  sessionsDir,
  sessionFileFor,
  mcpConfigPath,
  loadMcpConfig,
  loadEnvFile,
  loadPersisted,
  persistConfig,
  resolveConfig,
};

