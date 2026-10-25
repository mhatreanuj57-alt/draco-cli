'use strict';

// Ink is ESM-only (top-level await), so it cannot be require()d from this
// CommonJS codebase. boot.js imports it once with `await import('ink')` and
// hands the primitives over here. Components pull them at render time via
// getInk() — never at module load — so the module graph stays synchronously
// requirable.

let ink = null;

function setInk(api) {
  ink = api;
}

function getInk() {
  if (!ink) {
    throw new Error(
      'Ink not loaded yet — boot.js must call setInk() before rendering the TUI.'
    );
  }
  return ink;
}

module.exports = { setInk, getInk };
