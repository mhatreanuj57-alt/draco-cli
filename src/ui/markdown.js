'use strict';

const theme = require('./theme.js');
const { isTui } = require('./tui/sink.js');
const store = require('./tui/store.js');

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

/**
 * Incremental markdown renderer.
 *
 * mode:
 *   'render' — legacy TTY: renders ANSI as lines arrive, framed in a response box
 *   'raw'    — legacy pipe: writes bytes straight through untouched
 *   'tui'    — full-screen UI: hands rendered lines to a sink instead of stdout
 *
 * TUI options:
 *   onLine(rendered, raw)   — a complete line is ready
 *   onPartial(rendered)     — the trailing, not-yet-terminated text changed
 */
class MarkdownStream {
  constructor(opts) {
    const options = opts || {};
    this.buffer = '';
    this.state = { fence: false };
    this.blockOpen = false;
    this.mode = options.mode || (isTui() ? 'tui' : tty ? 'render' : 'raw');
    this.onLine = typeof options.onLine === 'function' ? options.onLine : null;
    this.onPartial =
      typeof options.onPartial === 'function' ? options.onPartial : store.setLivePartial;
  }

  get isTuiMode() {
    return this.mode === 'tui';
  }

  openBlock() {
    if (this.mode !== 'render' || this.blockOpen) return;
    this.blockOpen = true;
    process.stdout.write(theme.responseRule('top') + '\n');
  }

  closeBlock() {
    if (this.mode !== 'render' || !this.blockOpen) return;
    this.blockOpen = false;
    process.stdout.write(theme.responseRule('bottom') + '\n');
  }

  write(chunk) {
    if (this.mode === 'raw') {
      process.stdout.write(chunk);
      return;
    }
    if (this.mode === 'tui') {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const raw = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        this.emitLine(raw);
      }
      this.emitPartial();
      return;
    }
    // 'render'
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl + 1);
      this.buffer = this.buffer.slice(nl + 1);
      this.flushLine(line);
    }
  }

  emitLine(raw) {
    const rendered = raw.trim() === '' ? '' : renderLine(raw, this.state);
    if (this.onLine) this.onLine(rendered, raw);
    else store.pushLiveLine(rendered);
  }

  emitPartial() {
    if (!this.onPartial) return;
    const raw = this.buffer;
    const rendered = raw.trim() === '' ? '' : renderLine(raw, this.state);
    this.onPartial(rendered, raw);
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
    if (this.mode === 'raw') return;
    if (this.mode === 'tui') {
      if (this.buffer.length > 0) {
        const rest = this.buffer;
        this.buffer = '';
        this.emitLine(rest);
      }
      if (this.onPartial) this.onPartial('', '');
      return;
    }
    if (this.buffer.length > 0) {
      const rest = this.buffer;
      this.buffer = '';
      this.flushLine(rest.endsWith('\n') ? rest : `${rest}\n`);
    }
    this.closeBlock();
  }
}

module.exports = { MarkdownStream, renderLine };
