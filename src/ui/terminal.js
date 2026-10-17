'use strict';

const tty = process.stdout.isTTY;

const c = {
  reset: tty ? '\x1b[0m' : '',
  bold: tty ? '\x1b[1m' : '',
  dim: tty ? '\x1b[2m' : '',
  red: tty ? '\x1b[31m' : '',
  green: tty ? '\x1b[32m' : '',
  yellow: tty ? '\x1b[33m' : '',
  blue: tty ? '\x1b[34m' : '',
  magenta: tty ? '\x1b[35m' : '',
  cyan: tty ? '\x1b[36m' : '',
  gray: tty ? '\x1b[90m' : '',
};

const GLYPHS = {
  D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██║  ██║', '╚█████╔╝', ' ╚════╝ '],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚██╗ ██╔╝', ' ╚═══╝ '],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╗  ╚═╝', '        '],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '██║     ', '╚█████╗ ', ' ╚════╝ '],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
};

const LOGO = (() => {
  const rows = [];
  for (let r = 0; r < 7; r++) {
    rows.push('DRACO'.split('').map((ch) => GLYPHS[ch][r]).join(' ').replace(/\s+$/, ''));
  }
  return rows;
})();

function splash(cfg) {
  for (const line of LOGO) process.stdout.write(c.red + c.bold + line + c.reset + '\n');
  process.stdout.write('\n');
  process.stdout.write(`${c.bold}Draco CLI v${cfg.version}${c.reset}\n`);
  process.stdout.write('Endpoint: OpenCode Zen API Server\n');
  process.stdout.write('Model: Free Dynamic Routing Tier\n');
  process.stdout.write('\n');
  process.stdout.write(`Workspace: ${cfg.workspaceRoot}\n`);
  process.stdout.write(`${c.gray}Active model: ${cfg.model}${c.reset}\n`);
  process.stdout.write(`Type ${c.cyan}/help${c.reset} for commands. ${c.gray}Esc stops a response.${c.reset}\n`);
  if (!cfg.searchApiKey) {
    process.stdout.write(
      `${c.gray}Web search: on via DuckDuckGo (no key). Set DRACO_SEARCH_API_KEY to use Brave.${c.reset}\n`
    );
  }
  process.stdout.write('\n');
}

function promptText(basename) {
  return `${c.green}draco${c.reset} ${c.magenta}${basename}${c.reset} ${c.cyan}❯${c.reset} `;
}

function info(msg) {
  process.stdout.write(`${c.blue}ℹ${c.reset} ${msg}\n`);
}

function success(msg) {
  process.stdout.write(`${c.green}✔${c.reset} ${msg}\n`);
}

function warn(msg) {
  process.stdout.write(`${c.yellow}⚠ ${msg}${c.reset}\n`);
}

function error(msg) {
  process.stdout.write(`${c.red}✖ ${msg}${c.reset}\n`);
}

function toolStart(name, args) {
  let summary = '';
  try {
    summary = JSON.stringify(args);
  } catch {
    summary = '';
  }
  if (summary.length > 100) summary = summary.slice(0, 97) + '...';
  process.stdout.write(`${c.cyan}● ${name}${c.reset} ${c.dim}${summary}${c.reset}\n`);
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class Spinner {
  constructor(text) {
    this.text = text || 'Thinking…';
    this.timer = null;
    this.frame = 0;
  }

  start() {
    if (!tty || this.timer) return;
    this.timer = setInterval(() => {
      const f = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length];
      process.stdout.write(`\r${c.cyan}${f}${c.reset} ${this.text}`);
    }, 80);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (tty) process.stdout.write('\r\x1b[K');
  }
}

module.exports = { c, splash, promptText, info, success, warn, error, toolStart, Spinner };
