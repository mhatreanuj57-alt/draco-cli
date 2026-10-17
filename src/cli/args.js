'use strict';

function parseArgs(argv) {
  const flags = { model: undefined, yolo: false, version: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--version' || a === '-v') flags.version = true;
    else if (a === '--yolo') flags.yolo = true;
    else if (a === '--continue' || a === '-c') flags.continueSession = true;
    else if (a === '--suggest') flags.approvals = 'suggest';
    else if (a === '--auto-edit') flags.approvals = 'auto-edit';
    else if (a === '--full-auto') flags.approvals = 'full-auto';
    else if (a.startsWith('--model=')) flags.model = a.slice('--model='.length);
    else if (a === '--model') {
      if (i + 1 >= argv.length) throw new Error('--model requires a value.');
      flags.model = argv[++i];
    } else if (a.startsWith('-') && a !== '-') {
      throw new Error(`Unknown option: ${a}`);
    } else {
      flags.promptArgs = flags.promptArgs || [];
      flags.promptArgs.push(a);
    }
  }
  return flags;
}

module.exports = { parseArgs };
