'use strict';

const React = require('react');
const { PassThrough } = require('stream');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ink = await import('ink');
  require('../src/ui/tui/ink-api.js').setInk(ink);
  require('../src/ui/tui/sink.js').setMode('tui');
  const store = require('../src/ui/tui/store.js');

  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.setEncoding('utf8');

  const stdout = new PassThrough();
  stdout.isTTY = true;
  stdout.columns = 140;
  stdout.rows = 40;
  stdout.on('data', () => {});

  const h = React.createElement;
  const { App } = require('../src/ui/tui/App.js');

  const submitted = [];
  let exited = 0;
  const inst = ink.render(
    h(App, {
      onSubmit: (v) => submitted.push(v),
      onExit: () => exited++,
      agent: { abortActive: () => false },
    }),
    { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
  );

  const results = [];
  const check = (name, ok) => results.push([name, ok]);
  const send = async (s, wait = 60) => {
    stdin.write(s);
    await sleep(wait);
  };

  // --- typing + cursor ---
  await send('hello');
  check('typing inserts', store.getState().input.value === 'hello');
  check('cursor tracks', store.getState().input.cursor === 5);

  await send('\x1b[D'); // left arrow
  check('left arrow moves cursor', store.getState().input.cursor === 4);

  await send('X');
  check('insert at cursor', store.getState().input.value === 'hellXo');

  await send('\x1b[3~'); // delete forward
  check('delete key', store.getState().input.value === 'hellX');

  await send('\x15'); // ctrl+u clear
  check('ctrl+u clears', store.getState().input.value === '');

  // --- submit ---
  await send('first prompt');
  await send('\r', 120);
  check('submit received', submitted[0] === 'first prompt');
  check('input reset after submit', store.getState().input.value === '');

  // --- history ---
  await send('second prompt');
  await send('\r', 120);
  await send('\x1b[A'); // up arrow
  check('history recall', store.getState().input.value === 'second prompt');
  await send('\x1b[A');
  check('history back further', store.getState().input.value === 'first prompt');
  await send('\x1b[B');
  check('history forward', store.getState().input.value === 'second prompt');
  await send('\x1b[B');
  check('history clears at end', store.getState().input.value === '');

  // --- scrolling ---
  for (let i = 0; i < 8; i++) store.push({ kind: 'info', text: `line ${i}` });
  await send('\x1b[5~'); // page up
  check('page up scrolls', store.getState().scroll.follow === false && store.getState().scroll.offset > 0);
  await send('\x1b[6~'); // page down
  const off = store.getState().scroll.offset;
  await send('\x1b[6~');
  check('page down returns to follow', store.getState().scroll.follow === true && off >= 0);

  // --- ctrl+l clears ---
  await send('\x0c');
  check('ctrl+l clears chat', store.getState().entries.length === 0);

  // --- ctrl+c exits ---
  await send('\x03');
  check('ctrl+c calls onExit', exited === 1);

  // --- modal flow ---
  const p = store.askModal('Run this shell command?', { kind: 'ask' });
  await sleep(50);
  check('modal opens', store.getState().modal !== null);
  await send('yes please');
  check('modal draft captured', store.getState().modal.draft === 'yes please');
  await send('\r', 60);
  const answer = await p;
  check('modal resolves', answer === 'yes please');
  check('modal closed', store.getState().modal === null);

  // --- modal escape aborts to n ---
  const p2 = store.askModal('sure?', { kind: 'ask' });
  await sleep(50);
  await send('\x1b', 60);
  const a2 = await p2;
  check('modal escape resolves empty', a2 === '');

  let fail = 0;
  for (const [name, ok] of results) {
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  console.log(`\n${results.length - fail}/${results.length} passed`);

  try {
    inst.unmount();
  } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('INTERACT CRASH:', e);
  process.exit(1);
});
