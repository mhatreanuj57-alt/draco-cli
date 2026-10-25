'use strict';

const React = require('react');
const { useStore, setState, update, setInput, resetInput, setScroll } = require('./store.js');
const { getInk } = require('./ink-api.js');
const { Sidebar } = require('./Sidebar.js');
const { StatusBar } = require('./StatusBar.js');
const { InputBox } = require('./InputBox.js');
const { Chat } = require('./Chat.js');
const { Modal } = require('./Modal.js');

const h = React.createElement;

const SCROLL_STEP = 6;
const STATUS_HEIGHT = 3;
const INPUT_HEIGHT = 5;

function measure(size) {
  const rows = (size && size.rows) || process.stdout.rows || 24;
  const cols = (size && size.columns) || process.stdout.columns || 80;
  const chat = Math.max(3, rows - STATUS_HEIGHT - INPUT_HEIGHT - 1);
  return { rows, cols, chat };
}

function App({ onSubmit, onExit, agent }) {
  const { Box, Text, useInput, useWindowSize } = getInk();
  const s = useStore();
  const { input, modal, running, status } = s;

  useInput((raw, key) => {
    // ---- nested prompt (approvals / confirmations) ----
    if (modal) {
      const draft = modal.draft || '';
      if (key.return) {
        modal.resolve(draft);
        return;
      }
      if (key.escape) {
        modal.resolve(modal.kind === 'ask' ? '' : 'n');
        return;
      }
      if (key.backspace || key.delete) {
        update((st) => ({
          modal: st.modal
            ? Object.assign({}, st.modal, { draft: draft.slice(0, -1) })
            : null,
        }));
        return;
      }
      if (raw && !key.ctrl && !key.meta && raw.length > 0) {
        update((st) => ({
          modal: st.modal
            ? Object.assign({}, st.modal, { draft: draft + raw })
            : null,
        }));
      }
      return;
    }

    // ---- global keys ----
    if (key.ctrl && (raw === 'c' || raw === 'C')) {
      if (agent && agent.abortActive && agent.abortActive()) return;
      onExit();
      return;
    }
    if (key.escape) {
      if (agent && agent.abortActive) agent.abortActive();
      return;
    }
    if (key.ctrl && (raw === 'l' || raw === 'L')) {
      setState({ entries: [], live: null, scroll: { offset: 0, follow: true } });
      return;
    }
    if (key.pageUp) {
      update((st) => ({
        scroll: { offset: st.scroll.offset + SCROLL_STEP, follow: false },
      }));
      return;
    }
    if (key.pageDown) {
      update((st) => {
        const offset = Math.max(0, st.scroll.offset - SCROLL_STEP);
        return { scroll: { offset, follow: offset === 0 } };
      });
      return;
    }

    // While a response is streaming, only esc/ctrl+c are meaningful.
    if (running || status.thinking) return;

    if (key.return) {
      const value = input.value;
      if (!value.trim()) {
        resetInput();
        return;
      }
      const hist = input.history.slice();
      if (hist[hist.length - 1] !== value) hist.push(value);
      resetInput();
      setInput({ history: hist });
      onSubmit(value);
      return;
    }

    if (key.leftArrow) {
      setInput({ cursor: Math.max(0, input.cursor - 1) });
      return;
    }
    if (key.rightArrow) {
      setInput({ cursor: Math.min(input.value.length, input.cursor + 1) });
      return;
    }
    if (key.upArrow) {
      const hist = input.history;
      if (hist.length === 0) return;
      const idx = input.histIdx < 0 ? hist.length - 1 : Math.max(0, input.histIdx - 1);
      const value = hist[idx];
      setInput({ histIdx: idx, value, cursor: value.length });
      return;
    }
    if (key.downArrow) {
      const hist = input.history;
      if (input.histIdx < 0) return;
      const idx = input.histIdx + 1;
      if (idx >= hist.length) {
        setInput({ histIdx: -1, value: '', cursor: 0 });
        return;
      }
      const value = hist[idx];
      setInput({ histIdx: idx, value, cursor: value.length });
      return;
    }
    if (key.delete) {
      if (input.cursor >= input.value.length) return;
      const value = input.value.slice(0, input.cursor) + input.value.slice(input.cursor + 1);
      setInput({ value });
      return;
    }
    if (key.backspace) {
      if (input.cursor === 0) return;
      const value = input.value.slice(0, input.cursor - 1) + input.value.slice(input.cursor);
      setInput({ value, cursor: input.cursor - 1 });
      return;
    }
    if (key.ctrl && (raw === 'a' || raw === 'A')) {
      setInput({ cursor: 0 });
      return;
    }
    if (key.ctrl && (raw === 'e' || raw === 'E')) {
      setInput({ cursor: input.value.length });
      return;
    }
    if (key.ctrl && (raw === 'u' || raw === 'U')) {
      setInput({ value: '', cursor: 0 });
      return;
    }
    if (key.ctrl && (raw === 'w' || raw === 'W')) {
      const left = input.value.slice(0, input.cursor).replace(/\S+\s*$/, '');
      const value = left + input.value.slice(input.cursor);
      setInput({ value, cursor: left.length });
      return;
    }

    if (raw && !key.ctrl && !key.meta && raw.length > 0) {
      const value = input.value.slice(0, input.cursor) + raw + input.value.slice(input.cursor);
      setInput({ value, cursor: input.cursor + raw.length });
    }
  });

  const size = useWindowSize();
  const { cols, chat } = measure(size);
  const showSidebar = cols >= 100;

  return h(
    Box,
    { flexDirection: 'column', width: '100%', height: '100%' },
    h(
      Box,
      { flexDirection: 'row', flexGrow: 1, overflow: 'hidden' },
      h(
        Box,
        { flexDirection: 'column', flexGrow: 1, overflow: 'hidden', paddingRight: showSidebar ? 1 : 0 },
        h(Chat, { height: chat, width: Math.max(20, cols - (showSidebar ? 37 : 3)) }),
        h(InputBox),
        h(Modal)
      ),
      showSidebar ? h(Sidebar) : null
    ),
    h(StatusBar)
  );
}

module.exports = { App, measure };
