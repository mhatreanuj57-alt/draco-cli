'use strict';

// Drives the real session.js turn loop with a stubbed provider to prove the
// TUI branches I added: live buffer lifecycle + usage capture.

const React = require('react');
const { PassThrough } = require('stream');
const os = require('os');

const results = [];
const check = (n, ok) => results.push([n, ok]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ink = await import('ink');
  require('../src/ui/tui/ink-api.js').setInk(ink);
  require('../src/ui/tui/sink.js').setMode('tui');
  const store = require('../src/ui/tui/store.js');

  // Patch the provider BEFORE session.js loads, because session destructures
  // streamChatCompletion at require time.
  const provider = require('../src/providers/openai-compatible.js');
  let calls = 0;
  provider.streamChatCompletion = async ({ onDelta, messages }) => {
    calls++;
    if (calls === 1) {
      // First round: stream text with a newline, then a tool call.
      onDelta('# Heading\n');
      onDelta('- bullet one\n');
      onDelta('trailing partial');
      return {
        toolCalls: [
          { id: 'c1', function: { name: 'read_file', arguments: '{"path":"a.js"}' } },
        ],
        finishReason: 'tool_calls',
        usage: { prompt_tokens: 1200, completion_tokens: 300 },
      };
    }
    // Second round: final answer, no tools.
    onDelta('Final answer.\n');
    return {
      toolCalls: [],
      finishReason: 'stop',
      usage: { prompt_tokens: 1500, completion_tokens: 90 },
    };
  };

  const { createSession } = require('../src/core/session.js');
  const config = require('../src/config.js');
  const cfg = config.resolveConfig({});
  cfg.workspaceRoot = os.tmpdir();

  const agent = createSession(cfg, async () => 'y', { mcp: null });

  await agent.runTurn('do something');

  const s = store.getState();

  const assistants = s.entries.filter((e) => e.kind === 'assistant');
  check('two assistant entries (tool round + final)', assistants.length === 2);
  check('provider called twice', calls === 2);

  const flat = assistants.map((a) => (a.lines || []).join('\n')).join('\n');
  check('heading rendered', /Heading/.test(flat));
  check('bullet rendered', /bullet one/.test(flat));
  check('final answer present', /Final answer/.test(flat));
  check('no raw markdown heading marker', !/# Heading/.test(flat));
check('bullet glyph used', /•/.test(flat));

  check('live buffer cleaned up', s.live === null);
  check('usage captured into sidebar', s.sidebar.tokensIn === 1500 && s.sidebar.tokensOut === 90);
  check('turn counted', s.status.model === cfg.model);

  // error path: live buffer must not leak
  provider.streamChatCompletion = async () => {
    throw Object.assign(new Error('quota exceeded'), { status: 429 });
  };
  const a2 = createSession(cfg, async () => 'y', { mcp: null });
  await a2.runTurn('again').catch(() => {});
  check('live discarded on error', store.getState().live === null);

  let fail = 0;
  for (const [n, ok] of results) {
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`);
  }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('SESSION TEST CRASH:', e);
  process.exit(1);
});
