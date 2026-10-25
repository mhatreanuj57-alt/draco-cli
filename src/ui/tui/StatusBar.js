'use strict';

const React = require('react');
const { useStore } = require('./store.js');
const { getInk } = require('./ink-api.js');
const { contextPercent } = require('./Sidebar.js');

const h = React.createElement;

function StatusBar() {
  const { Box, Text } = getInk();
  const s = useStore();
  const { sidebar, status, scroll } = s;

  const pct = contextPercent(sidebar);
  const ctx = pct == null ? '—' : `${pct}%`;
  const mode = sidebar.approvals || 'suggest';
  const scrollLabel = scroll.follow
    ? 'following'
    : `scrolled +${scroll.offset}`;

  return h(
    Box,
    {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderStyle: 'single',
      borderColor: '#3b4a5a',
      paddingLeft: 1,
      paddingRight: 1,
    },
    h(
      Box,
      { flexDirection: 'row' },
      h(Text, { color: '#7dcfff' }, '⏵⏵ '),
      h(Text, { color: '#bb9af7' }, mode),
      h(Text, { dimColor: true }, '  ·  '),
      h(Text, { color: '#9ece6a' }, status.model || sidebar.model || '—'),
      h(Text, { dimColor: true }, '  ·  '),
      h(Text, { color: ctx === '—' ? '#565f89' : '#e0af68' }, `ctx ${ctx}`)
    ),
    h(
      Box,
      { flexDirection: 'row' },
      status.thinking
        ? h(Text, { color: '#7aa2f7' }, `${status.thinkingText || 'working'}…  `)
        : null,
      h(Text, { dimColor: true }, `${scrollLabel}  ·  ctrl+c exit`)
    )
  );
}

module.exports = { StatusBar };
