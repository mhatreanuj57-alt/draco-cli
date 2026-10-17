'use strict';

// One permanent 'line' listener feeding a queue + waiter list; nextLine() serves
// both the main prompt and nested confirmations in arrival order so no piped or
// pasted input line is ever dropped.
function createLineQueue(rl) {
  const queue = [];
  const waiters = [];
  const state = { closed: false };

  rl.on('line', (line) => {
    const w = waiters.shift();
    if (w) w.resolve(line);
    else queue.push(line);
  });

  rl.on('close', () => {
    state.closed = true;
    while (waiters.length) waiters.shift().resolve(null);
  });

  function nextLine() {
    if (queue.length > 0) return Promise.resolve(queue.shift());
    if (state.closed) return Promise.resolve(null);
    return new Promise((resolve) => waiters.push({ resolve }));
  }

  function isClosed() {
    return state.closed;
  }

  return { nextLine, isClosed };
}

module.exports = { createLineQueue };
