'use strict';

const theme = require('./theme.js');
const { isTui } = require('./tui/sink.js');
const store = require('./tui/store.js');

const tty = process.stdout.isTTY;

const c = theme.c;

function splash(cfg) {
  process.stdout.write(theme.welcomeBanner(cfg) + '\n');
  process.stdout.write('\n');
  process.stdout.write(`Endpoint: ${cfg.provider || 'Google AI Studio'} (Gemini API)\n`);
  process.stdout.write(`${c.gray}Free-tier models via aistudio.google.com${c.reset}\n`);
  process.stdout.write('\n');
  process.stdout.write(`${c.bold}Workspace:${c.reset} ${cfg.workspaceRoot}\n`);
  process.stdout.write(`${c.gray}Active model: ${cfg.model}${c.reset}\n`);
  process.stdout.write(`Type ${c.cyan}/help${c.reset} for commands. ${c.gray}Esc stops a response.${c.reset}\n`);
  if (!cfg.searchApiKey) {
    process.stdout.write(
      `${c.gray}Web search: on via DuckDuckGo (no key). Set DRACO_SEARCH_API_KEY to use Brave.${c.reset}\n`
    );
  }
  process.stdout.write('\n');
}

function clearScreen() {
  theme.clearScreen();
}

function promptText(basename) {
  return `${c.green}➜${c.reset} ${c.cyan}${basename}${c.reset} `;
}

function divider(label) {
  if (isTui()) {
    store.push({ kind: 'rule', label: label || '' });
    return;
  }
  process.stdout.write(theme.dividerLine(label) + '\n');
}

function responseStart() {
  process.stdout.write(theme.responseRule('top') + '\n');
}

function responseEnd() {
  process.stdout.write(theme.responseRule('bottom') + '\n');
}

function info(msg) {
  if (isTui()) {
    store.push({ kind: 'info', text: msg });
    return;
  }
  process.stdout.write(`${c.blue}ℹ${c.reset} ${msg}\n`);
}

function success(msg) {
  if (isTui()) {
    store.push({ kind: 'success', text: msg });
    return;
  }
  process.stdout.write(`${c.green}✔${c.reset} ${msg}\n`);
}

function warn(msg) {
  if (isTui()) {
    store.push({ kind: 'warn', text: msg });
    return;
  }
  process.stdout.write(`${c.yellow}⚠ ${msg}${c.reset}\n`);
}

function error(msg) {
  if (isTui()) {
    store.push({ kind: 'error', text: msg });
    return;
  }
  process.stdout.write(theme.errorTag(msg) + '\n');
}

function toolStart(name, args) {
  let summary = '';
  try {
    summary = JSON.stringify(args);
  } catch {
    summary = '';
  }
  if (summary.length > 100) summary = summary.slice(0, 97) + '...';
  if (isTui()) {
    store.push({ kind: 'tool', name, summary });
    return;
  }
  process.stdout.write(`${c.cyan}● ${name}${c.reset} ${c.dim}${summary}${c.reset}\n`);
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class Spinner {
  constructor(text) {
    this.text = text || 'Thinking…';
    this.timer = null;
    this.frame = 0;
    this.tuiActive = false;
  }

  start() {
    if (isTui()) {
      this.tuiActive = true;
      store.setStatus({ thinking: true, startedAt: Date.now(), thinkingText: this.text });
      return;
    }
    if (!tty || this.timer) return;
    this.timer = setInterval(() => {
      const f = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length];
      process.stdout.write(`\r${c.cyan}${f}${c.reset} ${this.text}`);
    }, 80);
  }

  stop() {
    if (this.tuiActive) {
      this.tuiActive = false;
      store.setStatus({ thinking: false, thinkingText: '' });
      return;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (tty) process.stdout.write('\r\x1b[K');
  }
}

module.exports = {
  c,
  theme,
  splash,
  clearScreen,
  divider,
  responseStart,
  responseEnd,
  promptText,
  info,
  success,
  warn,
  error,
  toolStart,
  Spinner,
};
