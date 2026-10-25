'use strict';

const React = require('react');
const { useStore } = require('./store.js');
const { getInk } = require('./ink-api.js');

const h = React.createElement;

function Bar(pct, width) {
  const w = Math.max(1, width);
  const filled = Math.max(0, Math.min(w, Math.round((pct / 100) * w)));
  return `${'█'.repeat(filled)}${'░'.repeat(w - filled)}`;
}

// Shared by the sidebar and the status bar so they never disagree on context %.
function contextPercent(sidebar) {
  const tokens = (sidebar.tokensIn || 0) + (sidebar.tokensOut || 0);
  if (sidebar.contextPct != null) return sidebar.contextPct;
  if (tokens <= 0) return null;
  // Gemini flash-class models expose ~1M token context.
  return Math.min(100, Math.max(1, Math.round((tokens / 1000000) * 100)));
}

function Row({ label, value, color, Text }) {
  const { Box } = getInk();
  return h(
    Box,
    { flexDirection: 'row', flexWrap: 'nowrap' },
    h(Text, { dimColor: true }, label.padEnd(10)),
    h(Text, { color }, value)
  );
}

function Sidebar() {
  const { Box, Text } = getInk();
  const s = useStore();
  const { sidebar, status } = s;

  const tokens = sidebar.tokensIn + sidebar.tokensOut;
  const pct = contextPercent(sidebar);

  const workspace =
    (sidebar.workspace || '').split(/[\\/]/).filter(Boolean).pop() || '—';

  return h(
    Box,
    {
      width: 34,
      flexShrink: 0,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: '#3b4a5a',
      paddingLeft: 1,
      paddingRight: 1,
      overflow: 'hidden',
    },
    h(Text, { bold: true, color: '#7aa2f7' }, ' SESSION'),
    h('br'),
    h(Row, {
      label: 'model',
      value: status.model || sidebar.model || '—',
      color: '#9ece6a',
      Text,
    }),
    h(Row, { label: 'root', value: workspace, color: '#e0af68', Text }),
    h(Row, { label: 'approvals', value: sidebar.approvals, color: '#bb9af7', Text }),

    h('br'),
    h(Text, { bold: true, color: '#7aa2f7' }, ' CONTEXT'),
    h('br'),
    pct == null
      ? h(Text, { dimColor: true }, 'awaiting usage')
      : h(
          React.Fragment,
          null,
          h(
            Text,
            { color: pct > 80 ? '#f7768e' : pct > 60 ? '#e0af68' : '#9ece6a' },
            `${Bar(pct, 16)} ${String(pct).padStart(3)}%`
          ),
          h('br'),
          h(Text, { dimColor: true }, `${tokens.toLocaleString()} tokens`),
          h('br'),
          h(
            Text,
            { dimColor: true },
            `${sidebar.tokensIn.toLocaleString()} in · ${sidebar.tokensOut.toLocaleString()} out`
          )
        ),

    h('br'),
    h(Text, { bold: true, color: '#7aa2f7' }, ' TOOLS'),
    h('br'),
    h(Row, {
      label: 'mcp',
      value:
        sidebar.mcpServers > 0
          ? `${sidebar.mcpServers} srv · ${sidebar.mcpTools} tools`
          : 'none',
      color: sidebar.mcpServers > 0 ? '#9ece6a' : '#565f89',
      Text,
    }),
    h(Row, { label: 'lsp', value: 'disabled', color: '#565f89', Text }),

    h('br'),
    h(Text, { bold: true, color: '#7aa2f7' }, ' HISTORY'),
    h('br'),
    h(Row, { label: 'turns', value: String(sidebar.turns), color: '#9ece6a', Text }),
    h(Row, { label: 'msgs', value: String(sidebar.messageCount), color: '#9ece6a', Text }),

    h('br'),
    status.thinking
      ? h(Text, { color: '#7aa2f7' }, `⠋ ${status.thinkingText || 'working'}`)
      : h(Text, { dimColor: true }, 'idle')
  );
}

module.exports = { Sidebar, Bar, contextPercent };
