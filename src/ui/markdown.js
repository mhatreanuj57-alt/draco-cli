'use strict';

const theme = require('./theme.js');

const tty = process.stdout.isTTY;

const c = theme.c;

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
      return `${c.dim}└─ code${c.reset}`;
    }
    return `${c.blue}${line}${c.reset}`;
  }
  const fence = /^\s*```(.*)$/.exec(line);
  if (fence) {
    state.fence = true;
    const lang = (fence[1] || '').trim();
    return `${c.dim}┌─ code${lang ? ` ${lang}` : ''}${c.reset}`;
  }
  const h = /^(#{1,6})\s+(.*)$/.exec(line);
  if (h) {
    const level = h[1].length;
    const color = level <= 2 ? c.bold : c.magenta || c.purple;
    return `${color}${h[2]}${c.reset}`;
  }
  const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
  if (bullet) {
    return `${bullet[1]}${c.cyan}•${c.reset} ${inline(bullet[2])}`;
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
    this.blockOpen = false;
  }

  openBlock() {
    if (!tty || this.blockOpen) return;
    this.blockOpen = true;
    process.stdout.write(theme.responseRule('top') + '\n');
  }

  closeBlock() {
    if (!tty || !this.blockOpen) return;
    this.blockOpen = false;
    process.stdout.write(theme.responseRule('bottom') + '\n');
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
    this.openBlock();
    if (text.trim() === '') {
      process.stdout.write(theme.gutter() + (hadNewline ? '\n' : ''));
      return;
    }
    process.stdout.write(
      `${theme.gutter()} ${renderLine(text, this.state)}` + (hadNewline ? '\n' : '')
    );
  }

  end() {
    if (!tty) return;
    if (this.buffer.length > 0) {
      const rest = this.buffer;
      this.buffer = '';
      this.flushLine(rest.endsWith('\n') ? rest : `${rest}\n`);
    }
    this.closeBlock();
  }
}

module.exports = { MarkdownStream };
