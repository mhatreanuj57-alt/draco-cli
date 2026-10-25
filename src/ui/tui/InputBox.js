'use strict';

const React = require('react');
const { useStore } = require('./store.js');
const { getInk } = require('./ink-api.js');

const h = React.createElement;

const PLACEHOLDER = 'ask anything — type / for commands, @ to reference files';

function InputBox() {
  const { Box, Text } = getInk();
  const s = useStore();
  const { input, status } = s;
  const busy = s.running || status.thinking;
  const value = input.value;
  const cursor = Math.min(input.cursor, value.length);

  const before = value.slice(0, cursor);
  const at = value[cursor] || ' ';
  const after = value.slice(cursor + 1);

  return h(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: busy ? '#7aa2f7' : '#3b4a5a',
      paddingLeft: 1,
      paddingRight: 1,
      marginTop: 0,
    },
    h(
      Box,
      { flexDirection: 'row' },
      h(Text, { color: '#9ece6a', bold: true }, '❯ '),
      value.length === 0
        ? h(
            React.Fragment,
            null,
            // Cursor sits on the first placeholder glyph so the hint reads as one word.
            h(
              Text,
              { backgroundColor: '#7aa2f7', color: '#1a1b26' },
              PLACEHOLDER.slice(0, 1)
            ),
            h(Text, { color: '#565f89' }, PLACEHOLDER.slice(1))
          )
        : h(
            React.Fragment,
            null,
            h(Text, {}, before),
            h(Text, { backgroundColor: '#7aa2f7', color: '#1a1b26' }, at),
            h(Text, {}, after)
          )
    ),
    h(
      Box,
      { flexDirection: 'row', marginTop: 0 },
      h(
        Text,
        { dimColor: true },
        busy
          ? 'esc stop  ·  streaming…'
          : 'ctrl+c exit  ·  ctrl+p commands  ·  pgup/pgdn scroll  ·  ctrl+l clear'
      )
    )
  );
}

module.exports = { InputBox, PLACEHOLDER };
