'use strict';

const path = require('path');
const config = require('../config.js');
const ui = require('../ui/terminal.js');
const { handle, EXIT } = require('./slash-commands.js');

async function runRepl({ cfg, rl, lineQueue, agent, mcp }) {
  const nextLine = lineQueue.nextLine;
  const rt = { cfg, agent, mcp };
  const basename = path.basename(cfg.workspaceRoot);

  try {
    while (true) {
      if (!lineQueue.isClosed()) {
        rl.setPrompt(ui.promptText(basename));
        rl.prompt();
      }
      const line = await nextLine();
      if (line === null) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      ui.divider();
      let result;
      try {
        result = await handle(trimmed, rt);
      } catch (e) {
        ui.error(e && e.message ? e.message : String(e));
        continue;
      }
      if (result === EXIT) break;
      if (result === false) {
        await agent.runTurn(trimmed).catch((e) => {
          ui.error(e && e.message ? e.message : String(e));
        });
      }
    }
  } finally {
    ui.info('Goodbye.');
    try {
      rl.close();
    } catch {}
  }
}

module.exports = { runRepl };
