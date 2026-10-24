'use strict';

const ui = require('../ui/terminal.js');

async function runOneShot({ prompt, agent }) {
  try {
    process.stdout.write(`${ui.c.green}➜${ui.c.reset} ${prompt}\n`);
    ui.divider();
    await agent.runTurn(prompt);
    return 0;
  } catch (e) {
    ui.error(e && e.message ? e.message : String(e));
    return 1;
  }
}

module.exports = { runOneShot };
