'use strict';

const React = require('react');
const { PassThrough } = require('stream');

(async () => {
  const ink = await import('ink');
  require('../src/ui/tui/ink-api.js').setInk(ink);
  require('../src/ui/tui/sink.js').setMode('tui');
  const store = require('../src/ui/tui/store.js');

  store.push({ kind: 'rule', label: ' draco v3.1.1 ' });
  store.push({ kind: 'user', text: 'refactor the auth module' });
  store.push({ kind: 'tool', name: 'read_file', summary: '{"path":"src/auth.js"}' });
  store.push({
    kind: 'assistant',
    lines: ['Here is the plan:', '- step one', '- step two'],
  });
  store.push({ kind: 'success', text: 'Done.' });
  store.push({ kind: 'error', text: 'boom sample error' });

  store.setSidebar({
    workspace: process.cwd(),
    approvals: 'suggest',
    model: 'gemini-3.8-flash',
    turns: 3,
    messageCount: 7,
    mcpServers: 2,
    mcpTools: 5,
    tokensIn: 1200,
    tokensOut: 340,
  });
  store.setStatus({ model: 'gemini-3.8-flash' });

  store.beginLive('assistant');
  store.pushLiveLine('Streaming line one');
  store.setLivePartial('partial tail marker', 'partial tail marker');

  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.setEncoding('utf8');

  const stdout = new PassThrough();
  stdout.isTTY = true;
  stdout.columns = 140;
  stdout.rows = 40;

  const h = React.createElement;
  const { App } = require('../src/ui/tui/App.js');

  let out = '';
  stdout.on('data', (d) => {
    out += d.toString();
  });

  const inst = ink.render(h(App, { onSubmit() {}, onExit() {}, agent: null }), {
    stdin,
    stdout,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await new Promise((r) => setTimeout(r, 500));
  try {
    inst.unmount();
  } catch {}

  const text = out
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

  const checks = [
    ['sidebar SESSION', text.includes('SESSION')],
    ['sidebar CONTEXT', text.includes('CONTEXT')],
    ['model shown', text.includes('gemini-3.8-flash')],
    ['user message', text.includes('refactor the auth module')],
    ['tool call', text.includes('read_file')],
    ['assistant text', text.includes('Here is the plan')],
    ['success entry', text.includes('Done.')],
    ['error entry', text.includes('boom sample error')],
    ['input placeholder', text.includes('ask anything')],
    ['live partial', text.includes('partial tail marker')],
['mcp counts', text.includes('2 srv · 5 tools')],
    ['hint row', text.includes('ctrl+c exit')],
    ['context percent', /\d+%/.test(text)],
    ['status bar ctx', text.includes('ctx')],
  ];

  let fail = 0;
  for (const [name, ok] of checks) {
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  console.log(`\n${checks.length - fail}/${checks.length} passed`);
  if (process.env.DUMP) console.log('---RAW---\n' + text);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('SMOKE CRASH:', e);
  process.exit(1);
});
