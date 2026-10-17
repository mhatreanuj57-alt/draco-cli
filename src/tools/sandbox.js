'use strict';

const path = require('path');

function sandboxPath(workspaceRoot, p) {
  if (typeof p !== 'string' || !p.trim()) {
    throw new Error('A non-empty "path" is required.');
  }
  const rootAbs = path.resolve(workspaceRoot);
  const abs = path.resolve(rootAbs, p);
  const rel = path.relative(rootAbs, abs);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!inside) {
    throw new Error(
      `Access denied: "${p}" resolves outside the workspace root (${rootAbs}).`
    );
  }
  return abs;
}

module.exports = { sandboxPath };
