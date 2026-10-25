'use strict';

const React = require('react');
const { useStore } = require('./store.js');
const { getInk } = require('./ink-api.js');

const wrapAnsiModule = require('wrap-ansi');
const wrap = wrapAnsiModule.default || wrapAnsiModule;

const h = React.createElement;

const KIND_META = {
  info: { glyph: 'ℹ', color: '#7aa2f7' },
  success: { glyph: '✔', color: '#9ece6a' },
  warn: { glyph: '⚠', color: '#e0af68' },
  error: { glyph: '✖', color: '#f7768e' },
  tool: { glyph: '●', color: '#7dcfff' },
};

function wrapAll(text, width) {
  const w = Math.max(20, width);
  const out = [];
  const src = String(text == null ? '' : text);
  if (src === '') {
    out.push('');
    return out;
  }
  for (const line of src.split('\n')) {
    // hardWrapping false lets long words overflow rather than be cut, which is
    // what we want for URLs/paths; the terminal clips them.
    const wrapped = wrap(line, { width: w, trim: false, hard: false });
    out.push(...wrapped.split('\n'));
  }
  return out;
}

function entryToLines(entry, width) {
  const out = [];
  const meta = KIND_META[entry.kind];

  if (entry.kind === 'user') {
    const body = wrapAll(entry.text, width - 2);
    out.push({ text: `❯ ${body[0] || ''}`, color: '#7dcfff', bold: true });
    for (let i = 1; i < body.length; i++) {
      out.push({ text: `  ${body[i]}`, color: '#c0caf5' });
    }
    out.push({ text: '', dim: true });
    return out;
  }

  if (entry.kind === 'assistant') {
    const src = Array.isArray(entry.lines) ? entry.lines : wrapAll(entry.text, width);
    for (const raw of src) {
      for (const wl of wrapAll(raw, width)) {
        out.push({ text: wl, raw: true });
      }
    }
    if (entry.truncated) out.push({ text: '⏹ stopped', color: '#e0af68', raw: true });
    if (entry.errored) out.push({ text: '✖ interrupted', color: '#f7768e' });
    out.push({ text: '', dim: true });
    return out;
  }

  if (entry.kind === 'tool') {
    const line = `${meta.glyph} ${entry.name}  ${entry.summary || ''}`;
    for (const wl of wrapAll(line, width)) {
      out.push({ text: wl, color: meta.color });
    }
    return out;
  }

  if (entry.kind === 'rule') {
    out.push({ text: entry.label || '─'.repeat(Math.min(width, 60)), dim: true });
    return out;
  }

  // info / warn / error / success
  const glyph = meta ? meta.glyph : '·';
  const color = meta ? meta.color : '#c0caf5';
  const body = wrapAll(entry.text, width - 2);
  out.push({ text: `${glyph} ${body[0] || ''}`, color });
  for (let i = 1; i < body.length; i++) out.push({ text: `  ${body[i]}`, color });
  return out;
}

function liveToLines(live, width) {
  const out = [];
  const src = Array.isArray(live.lines) ? live.lines : [];
  for (const raw of src) {
    for (const wl of wrapAll(raw, width)) out.push({ text: wl, raw: true });
  }
  if (live.partial) {
    for (const wl of wrapAll(live.partial, width)) {
      out.push({ text: wl, raw: true, partial: true });
    }
  }
  return out;
}

function Chat({ height, width }) {
  const { Box, Text } = getInk();
  const s = useStore();
  const w = Math.max(20, width || process.stdout.columns || 80);

  const all = [];
  for (const e of s.entries) all.push(...entryToLines(e, w));
  if (s.live) all.push(...liveToLines(s.live, w));

  const total = all.length;
  const view = Math.max(1, height);
  let start = 0;
  if (s.scroll.follow) {
    start = Math.max(0, total - view);
  } else {
    start = Math.max(0, total - view - s.scroll.offset);
  }
  const visible = all.slice(start, start + view);

  // Pin to the bottom so the newest line sits just above the input box.
  const pad = Math.max(0, view - visible.length);

  return h(
    Box,
    { flexDirection: 'column', flexGrow: 1, overflow: 'hidden', justifyContent: 'flex-end' },
    Array.from({ length: pad }, (_, i) => h(Text, { key: `p${i}` }, '')),
    visible.map((line, i) => {
      if (line.raw) {
        // Already contains SGR codes from markdown.js — pass them through.
        return h(Text, { key: i, wrap: 'truncate' }, line.text || ' ');
      }
      return h(
        Text,
        {
          key: i,
          color: line.color,
          dimColor: line.dim || undefined,
          bold: line.bold || undefined,
          wrap: 'truncate',
        },
        line.text || ' '
      );
    })
  );
}

module.exports = { Chat, wrapAll, entryToLines };
