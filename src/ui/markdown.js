'use strict';

const tty = process.stdout.isTTY;

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  italic: '\x1b[3m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function inline(line) {
  let out = line;
  out = out.replace(/`([^`]+)`/g, `${c.yellow}$1${c.reset}`);
  out = out.replace(/\*\*([^*]+)\*\*/g, `${c.bold}$1${c.reset}`);
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, `$1${c.italic}$2${c.reset}`);
  return out;
}

function renderLine(line, state) {
  if (state.fence) {
    if (/^\s*```/.test(line)) {
      state.fence = false;
      return `${c.dim}\u2502${c.reset}`;
    }
    return `${c.dim}\u2502${c.reset} ${c.blue}${line}${c.reset}`;
  }
  if (/^\s*```/.test(line)) {
    state.fence = true;
    return `${c.dim}\u2502${c.reset}`;
  }
  const h = /^(#{1,6})\s+(.*)$/.exec(line);
  if (h) {
    const level = h[1].length;
    const color = level <= 2 ? c.bold : c.magenta;
    return `${color}${h[2]}${c.reset}`;
  }
  const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
  if (bullet) {
    return `${bullet[1]}${c.cyan}\u2022${c.reset} ${inline(bullet[2])}`;
  }
  const numbered = /^(\s*)(\d+\.)\s+(.*)$/.exec(line);
  if (numbered) {
    return `${numbered[1]}${c.cyan}${numbered[2]}${c.reset} ${inline(numbered[3])}`;
  }
  return inline(line);
}

class MarkdownStream {
  constructor() {
    this.buffer = '';
    this.state = { fence: false };
    this.started = false;
  }

  write(chunk) {
    if (!tty) {
      process.stdout.write(chunk);
      return;
    }
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl + 1);
      this.buffer = this.buffer.slice(nl + 1);
      this.flushLine(line);
    }
  }

  flushLine(lineWithNewline) {
    const hadNewline = lineWithNewline.endsWith('\n');
    const text = hadNewline ? lineWithNewline.slice(0, -1) : lineWithNewline;
    if (text.trim() === '' ) {
      process.stdout.write('\n');
      return;
    }
    process.stdout.write(renderLine(text, this.state) + (hadNewline ? '\n' : ''));
  }

  end() {
    if (!tty) return;
    if (this.buffer.length > 0) {
      const rest = this.buffer;
      this.buffer = '';
      this.flushLine(rest);
    }
  }
}

module.exports = { MarkdownStream };
