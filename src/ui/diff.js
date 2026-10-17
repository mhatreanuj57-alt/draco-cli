'use strict';

const tty = process.stdout.isTTY;

const col = {
  reset: tty ? '\x1b[0m' : '',
  dim: tty ? '\x1b[2m' : '',
  red: tty ? '\x1b[31m' : '',
  green: tty ? '\x1b[32m' : '',
  cyan: tty ? '\x1b[36m' : '',
};

function splitLines(text) {
  return String(text ?? '').split('\n');
}

function diffLines(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const rows = [];
  for (let i = Math.max(0, start - 3); i < start; i++) rows.push({ type: ' ', text: a[i] });
  for (let i = start; i < endA; i++) rows.push({ type: '-', text: a[i] });
  for (let i = start; i < endB; i++) rows.push({ type: '+', text: b[i] });
  const tailStart = Math.min(a.length, endA + 3);
  for (let i = endA; i < tailStart; i++) rows.push({ type: ' ', text: a[i] });
  return rows;
}

function renderDiff(rows, maxRows = 120) {
  const shown = rows.slice(0, maxRows);
  const parts = [];
  parts.push(`${col.dim}\u2500\u2500 diff ${'─'.repeat(24)}${col.reset}`);
  for (const row of shown) {
    if (row.type === '+') parts.push(`${col.green}+ ${row.text}${col.reset}`);
    else if (row.type === '-') parts.push(`${col.red}- ${row.text}${col.reset}`);
    else parts.push(`${col.dim}  ${row.text}${col.reset}`);
  }
  if (rows.length > shown.length) {
    parts.push(`${col.cyan}\u2026 ${rows.length - shown.length} more lines${col.reset}`);
  }
  parts.push(`${col.dim}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${col.reset}`);
  return parts.join('\n');
}

module.exports = { diffLines, renderDiff };
