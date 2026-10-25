'use strict';

// Single reactive state tree for the full-screen TUI.
// Non-React code (session.js, terminal.js, providers) mutates it via update();
// React reads it with useSyncExternalStore(subscribe, getState).

const React = require('react');

let uid = 0;
const nextId = () => `e${++uid}`;

const initialState = {
  entries: [],
  live: null, // { id, kind, lines, text } — in-progress assistant stream
  status: {
    model: null,
    thinking: false,
    startedAt: 0,
    elapsed: 0,
    turns: 0,
    aborted: false,
  },
  sidebar: {
    model: null,
    contextPct: null,
    tokensIn: 0,
    tokensOut: 0,
    mcpTools: 0,
    mcpServers: 0,
    approvals: 'suggest',
    workspace: '',
    turns: 0,
    messageCount: 0,
  },
  modal: null, // { id, kind:'ask'|'confirm'|'input', question, resolve }
  input: {
    value: '',
    cursor: 0,
    history: [],
    histIdx: -1,
    submitted: false,
  },
  scroll: { offset: 0, follow: true },
  running: false,
};

let state = initialState;
const listeners = new Set();

function getState() {
  return state;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

// Shallow-merge a patch into state and notify subscribers.
function setState(patch) {
  state = Object.assign({}, state, patch);
  emit();
}

// Functional update: fn receives current state, returns next state (or a patch).
function update(fn) {
  const next = fn(state);
  if (!next || next === state) return;
  state = Object.assign({}, state, next);
  emit();
}

function push(entry) {
  const id = entry.id || nextId();
  const full = Object.assign({ id, ts: Date.now() }, entry);
  update((s) => ({ entries: s.entries.concat([full]) }));
  return id;
}

function patchEntry(id, patch) {
  update((s) => ({
    entries: s.entries.map((e) => (e.id === id ? Object.assign({}, e, patch) : e)),
  }));
}

function clearEntries() {
  setState({ entries: [], live: null });
}

// --- live streaming buffer -------------------------------------------------

function beginLive(kind) {
  const id = nextId();
  const live = { id, kind: kind || 'assistant', lines: [], text: '', partial: '' };
  setState({ live });
  return id;
}

function pushLiveLine(line) {
  update((s) => {
    if (!s.live) return null;
    return { live: Object.assign({}, s.live, { lines: s.live.lines.concat([line]) }) };
  });
}

// The trailing, not-yet-terminated text of the current stream.
function setLivePartial(rendered, raw) {
  update((s) => {
    if (!s.live) return null;
    return { live: Object.assign({}, s.live, { partial: rendered, text: raw || '' }) };
  });
}

function pushLiveLine(line) {
  update((s) => {
    if (!s.live) return null;
    return { live: Object.assign({}, s.live, { lines: s.live.lines.concat([line]) }) };
  });
}

function setLiveText(text) {
  update((s) => (s.live ? { live: Object.assign({}, s.live, text) } : null));
}

// Flush the live buffer into a permanent entry.
function endLive(extra) {
  const live = state.live;
  if (!live) return null;
  const entry = Object.assign(
    {
      id: live.id,
      kind: live.kind,
      lines: live.lines,
      text: live.text,
      ts: Date.now(),
    },
    extra || {}
  );
  update((s) => ({
    entries: s.entries.concat([entry]),
    live: null,
  }));
  return entry.id;
}

function discardLive() {
  setState({ live: null });
}

// --- status / sidebar ------------------------------------------------------

function setStatus(patch) {
  update((s) => ({ status: Object.assign({}, s.status, patch) }));
}

function setSidebar(patch) {
  update((s) => ({ sidebar: Object.assign({}, s.sidebar, patch) }));
}

// --- modal (nested prompts / approvals) ------------------------------------

function askModal(question, opts) {
  const options = opts || {};
  return new Promise((resolve) => {
    const modal = {
      id: nextId(),
      kind: options.kind || 'ask',
      question,
      placeholder: options.placeholder || '',
      defaultValue: options.defaultValue || '',
      resolve: (value) => {
        setState({ modal: null });
        resolve(value);
      },
    };
    setState({ modal });
  });
}

function closeModal(value) {
  const modal = state.modal;
  if (modal && modal.resolve) modal.resolve(value);
}

// --- input line ------------------------------------------------------------

function setInput(patch) {
  update((s) => ({ input: Object.assign({}, s.input, patch) }));
}

function resetInput() {
  setInput({ value: '', cursor: 0, histIdx: -1, submitted: false });
}

function setScroll(patch) {
  update((s) => ({ scroll: Object.assign({}, s.scroll, patch) }));
}

module.exports = {
  getState,
  subscribe,
  setState,
  update,
  push,
  patchEntry,
  clearEntries,
  beginLive,
  pushLiveLine,
  setLivePartial,
  setLiveText,
  endLive,
  discardLive,
  setStatus,
  setSidebar,
  askModal,
  closeModal,
  setInput,
  resetInput,
  setScroll,
  nextId,
  // React binding
  useStore: () =>
    React.useSyncExternalStore(subscribe, getState, getState),
};
