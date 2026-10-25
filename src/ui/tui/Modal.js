'use strict';

const React = require('react');
const { useStore } = require('./store.js');
const { getInk } = require('./ink-api.js');

const h = React.createElement;

// Overlay for nested prompts (approvals, confirmations, free-text asks).
// The value is captured by App's key handler and handed to modal.resolve().
function Modal() {
  const { Box, Text } = getInk();
  const s = useStore();
  const modal = s.modal;
  if (!modal) return null;

  const value = modal.draft || '';
  const isYesNo = modal.kind !== 'ask';

  return h(
    Box,
    { flexDirection: 'column', marginTop: 1, marginBottom: 1 },
    h(
      Box,
      {
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: '#e0af68',
        paddingLeft: 1,
        paddingRight: 1,
      },
      h(Text, { color: '#e0af68', bold: true }, '  Approval required'),
      h('br'),
      h(
        Box,
        { flexDirection: 'row' },
        h(Text, { color: '#e0af68', bold: true }, '? '),
        h(Text, { wrap: 'wrap' }, modal.question || 'Continue?')
      ),
      h('br'),
      h(
        Box,
        { flexDirection: 'row' },
        h(Text, { color: '#9ece6a' }, '> '),
        h(
          Text,
          { color: value ? '#c0caf5' : '#565f89' },
          value || (isYesNo ? 'y / n' : 'type your answer')
        ),
        h(Text, { backgroundColor: '#7aa2f7', color: '#1a1b26' }, ' ')
      )
    )
  );
}

module.exports = { Modal };
