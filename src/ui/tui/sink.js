'use strict';

// Output mode switch.
//
// 'legacy' (default) — terminal.js / markdown.js write straight to stdout,
//                      which is what piped runs, --help, key setup and
//                      one-shot mode need.
// 'tui'             — those same calls are captured into the reactive store
//                      and rendered by Ink instead of printed.
//
// One source of truth for message formatting: the ANSI/glyph choices in
// theme.js and terminal.js stay identical in both modes.

let mode = 'legacy';

function setMode(next) {
  mode = next === 'tui' ? 'tui' : 'legacy';
}

function isTui() {
  return mode === 'tui';
}

module.exports = { setMode, isTui };
