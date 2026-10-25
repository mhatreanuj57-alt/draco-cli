'use strict';

// End-to-end: drives the real main() entry point with fake TTY streams,
// types a slash command through Ink, and checks it reaches the store.

const { PassThrough } = require('stream');
const { sleep } = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

const results = [];
const log = (...a) => {
  const fn = global.__origWrite;
  if (fn) fn.call(process.stdout, a.join(' ') + '\n');
  else process.stderr.write(a.join(' ') + '\n');
};
const check = (name, ok) => {
  results.push([name, ok]);
  if (process.env.VERBOSE) log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};

(async () => {
  // --- fake TTY for stdin ---
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.setEncoding('utf8');
  Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });

  // --- stdout: mark as TTY, size it, capture frames ---
  let captured = '';
  process.stdout.isTTY = true;
  Object.defineProperty(process.stdout, 'columns', { value: 140, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: 40, configurable: true });
  const origWrite = process.stdout.write;
  global.__origWrite = origWrite;
  process.stdout.write = function (chunk, ...rest) {
    try {
      captured += chunk == null ? '' : chunk.toString();
    } catch {}
    return true;
  };

  const store = require('../src/ui/tui/store.js');
  const { main } = require('../src/index.js');

  let finished = false;
  main([]).catch((e) => {
    console.error('MAIN CRASH:', e);
    finished = true;
  });

  // Wait for boot.
  for (let i = 0; i < 60 && store.getState().entries.length === 0; i++) await sleep(100);

  const booted = store.getState().entries.length > 0;
  check('tui booted (entries written)', booted);
  check('alt screen entered', captured.includes('\x1b[?1049h'));
  check('welcome shows workspace', /Workspace:/.test(captured) || /draco v/.test(captured));

  if (booted) {
    const before = store.getState().entries.length;
    stdin.write('/help');
    await sleep(120);
    check('typing shows in input', store.getState().input.value === '/help');
    stdin.write('\r');
    await sleep(700);
    const after = store.getState().entries;
    const helpShown =
      after.length > before &&
      after.some((e) => typeof e.text === 'string' && /Commands|clear|help/i.test(e.text));
    check('slash /help executed', helpShown);
    check('input cleared after command', store.getState().input.value === '');
    check('running flag reset', store.getState().running === false);
  }

  check('no uncaught crash', !finished || false);

  let fail = 0;
  for (const [n, ok] of results) {
    if (!ok) fail++;
    log(`${ok ? 'PASS' : 'FAIL'}  ${n}`);
  }
  log(`\n${results.length - fail}/${results.length} passed`);

  process.stdout.write = origWrite;
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('E2E CRASH:', e);
  process.exit(1);
});
