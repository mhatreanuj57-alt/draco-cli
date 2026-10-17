'use strict';

const { exec } = require('child_process');
const { SHELL_TIMEOUT_MS, SHELL_MAX_BUFFER } = require('../config.js');
const { sandboxPath } = require('./sandbox.js');
const { gate } = require('../core/approvals.js');

async function executeShell(args, ctx) {
  const command = String(args.command || '').trim();
  if (!command) return 'Error: "command" is required.';

  const allowed = await gate(ctx, `Allow shell command: "${command}" ? [y/N] `, ['full-auto']);
  if (!allowed) {
    return 'User declined to run this command. Do not retry it; ask how they want to proceed.';
  }

  let cwd = ctx.workspaceRoot;
  if (args.cwd) cwd = sandboxPath(ctx.workspaceRoot, args.cwd);

  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        shell: args.shell || true,
        timeout: SHELL_TIMEOUT_MS,
        maxBuffer: SHELL_MAX_BUFFER,
      },
      (err, stdout, stderr) => {
        if (err && !stdout && !stderr) {
          return resolve(`Error running command: ${err.message}`);
        }
        let out = `${stdout || ''}${stderr ? (stdout ? '\n' : '') + stderr : ''}`.trim();
        if (!out) out = '(no output)';
        if (err && err.killed) out += `\n[command timed out after ${SHELL_TIMEOUT_MS / 1000}s]`;
        else if (err && typeof err.code === 'number') out += `\n[exit code: ${err.code}]`;
        resolve(out);
      }
    );
  });
}

module.exports = { executeShell };
