'use strict';

const fs = require('fs');
const path = require('path');
const { READ_FILE_MAX_BYTES } = require('../config.js');
const { sandboxPath } = require('./sandbox.js');
const { approvalMode, gate } = require('../core/approvals.js');
const { diffLines, renderDiff } = require('../ui/diff.js');

function readFile(workspaceRoot, p) {
  const abs = sandboxPath(workspaceRoot, p);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (e) {
    throw new Error(`Cannot stat "${p}": ${e.message}`);
  }
  if (stat.isDirectory()) {
    throw new Error(`"${p}" is a directory, not a file.`);
  }
  if (stat.size > READ_FILE_MAX_BYTES) {
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(READ_FILE_MAX_BYTES);
    fs.readSync(fd, buf, 0, READ_FILE_MAX_BYTES, 0);
    fs.closeSync(fd);
    return (
      buf.toString('utf8') +
      `\n\n[File truncated: showing the first ${Math.round(
        READ_FILE_MAX_BYTES / 1024
      )} KB of ${(stat.size / 1024).toFixed(1)} KB total.]`
    );
  }
  return fs.readFileSync(abs, 'utf8');
}

function writeFileRaw(workspaceRoot, p, content) {
  if (typeof content !== 'string') {
    throw new Error('"content" must be a string.');
  }
  const abs = sandboxPath(workspaceRoot, p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${abs}`;
}

async function writeFile(workspaceRoot, p, content, ctx) {
  if (typeof content !== 'string') {
    throw new Error('"content" must be a string.');
  }
  const abs = sandboxPath(workspaceRoot, p);
  const exists = fs.existsSync(abs) && fs.statSync(abs).isFile();
  if (exists && approvalMode(ctx) !== 'suggest' && process.stdout.isTTY) {
    const rows = diffLines(fs.readFileSync(abs, 'utf8'), content);
    process.stdout.write(renderDiff(rows) + '\n');
  }
  const allowed = await gate(ctx, `Allow ${exists ? 'edit of' : 'creation of'} "${p}" ? [y/N] `, [
    'auto-edit',
    'full-auto',
  ]);
  if (!allowed) {
    return 'User declined this file write. Do not retry it; ask how they want to proceed.';
  }
  return writeFileRaw(workspaceRoot, p, content);
}

async function makeDirectory(workspaceRoot, p, ctx) {
  const allowed = await gate(ctx, `Allow creating directory "${p}" ? [y/N] `, [
    'auto-edit',
    'full-auto',
  ]);
  if (!allowed) {
    return 'User declined this directory creation. Do not retry it; ask how they want to proceed.';
  }
  const abs = sandboxPath(workspaceRoot, p);
  fs.mkdirSync(abs, { recursive: true });
  return `Created directory ${abs}`;
}

module.exports = { readFile, writeFile, makeDirectory };
