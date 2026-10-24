'use strict';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  purple: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightPurple: '\x1b[95m',
  brightCyan: '\x1b[96m',
};

const colorEnabled =
  !process.env.NO_COLOR &&
  (process.env.FORCE_COLOR !== undefined ||
    Boolean(process.stdout.isTTY) ||
    Boolean(process.stderr.isTTY));

const c = {};
for (const key of Object.keys(ANSI)) {
  c[key] = colorEnabled ? ANSI[key] : '';
}

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

const LOGO_COLORS = [c.red, c.red, c.purple, c.purple, c.cyan, c.cyan, c.cyan];

function paint(color, text) {
  return `${color}${text}${c.reset}`;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

function textWidth(text) {
  return stripAnsi(text).length;
}

function columns(max) {
  const limit = max || 100;
  return Math.max(20, Math.min(process.stdout.columns || 80, limit));
}

function box(lines, opts = {}) {
  const borderColor = opts.borderColor || c.cyan;
  const pad = opts.pad === undefined ? 2 : opts.pad;
  const defaultAlign = opts.align || 'center';
  const items = lines.map((line) => (typeof line === 'string' ? { text: line } : line));
  const innerWidth = Math.max(0, ...items.map((item) => textWidth(item.text || '')));
  const rule = '─'.repeat(innerWidth + pad * 2);
  const out = [`${borderColor}┌${rule}┐${c.reset}`];

  for (const item of items) {
    const text = item.text || '';
    const align = item.align || defaultAlign;
    const slack = innerWidth - textWidth(text);
    let left;
    if (align === 'left') left = 0;
    else if (align === 'right') left = slack;
    else left = Math.floor(slack / 2);
    const right = slack - left;
    const color = item.color || '';
    out.push(
      `${borderColor}│${c.reset}${' '.repeat(pad)}${color}${' '.repeat(left)}${text}` +
        `${c.reset}${' '.repeat(right)}${' '.repeat(pad)}${borderColor}│${c.reset}`
    );
  }

  out.push(`${borderColor}└${rule}┘${c.reset}`);
  return out.join('\n');
}

function clearScreen() {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[2J\x1b[0H');
}

function welcomeBanner(cfg) {
  clearScreen();
  const version = cfg && cfg.version ? `v${cfg.version}` : '';
  const lines = [
    ...LOGO.map((row, i) => ({ text: row, color: c.bold + LOGO_COLORS[i], align: 'left' })),
    { text: '' },
    { text: 'DRACO CLI', color: c.bold + c.cyan, align: 'center' },
    { text: 'AI coding agent for your terminal', color: c.purple, align: 'center' },
    { text: version, color: c.gray, align: 'center' },
  ];
  return box(lines, { borderColor: c.cyan, pad: 2 });
}

function dividerLine(label) {
  const total = columns(100);
  const core = label ? ` ${label} ` : '';
  const rest = Math.max(0, total - textWidth(core));
  const left = Math.floor(rest / 2);
  const right = rest - left;
  return (
    `${c.gray}${'─'.repeat(left)}${c.reset}` +
    `${c.purple}${core}${c.reset}` +
    `${c.gray}${'─'.repeat(right)}${c.reset}`
  );
}

function responseRule(kind) {
  const total = columns(100);
  if (kind === 'bottom') {
    return `${c.cyan}└${'─'.repeat(Math.max(0, total - 1))}${c.reset}`;
  }
  const head = '┌─ DRACO ';
  return `${c.cyan}${head}${'─'.repeat(Math.max(0, total - textWidth(head)))}${c.reset}`;
}

function gutter() {
  return `${c.cyan}│${c.reset}`;
}

function errorTag(message) {
  return `${c.bold}${c.red}[ERROR]${c.reset} ${message}`;
}

function printError(message) {
  process.stderr.write(errorTag(message) + '\n');
}

module.exports = {
  ANSI,
  c,
  colorEnabled,
  paint,
  stripAnsi,
  textWidth,
  columns,
  box,
  clearScreen,
  welcomeBanner,
  dividerLine,
  responseRule,
  gutter,
  errorTag,
  printError,
};
