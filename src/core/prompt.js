'use strict';

const fs = require('fs');
const path = require('path');

function loadAgentsMd(workspaceRoot) {
  const p = path.join(workspaceRoot, 'AGENTS.md');
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return '';
    return fs.readFileSync(p, 'utf8').slice(0, 32000);
  } catch {
    return '';
  }
}

function buildSystemPrompt(cfg, agentsMd) {
  const toolsLine =
    'Your tools: readFile, writeFile, makeDirectory, executeShell, webFetch, webSearch.';
  const webLine =
    'webSearch is for open-ended discovery ("find out about X"); webFetch is for retrieving a specific URL you already have. Prefer local project context and only use the web when the task clearly needs current or external information.';
  const lines = [
    `You are Draco, an autonomous terminal-based coding agent working inside the user's workspace at ${cfg.workspaceRoot}.`,
    'You are confined to that directory: every file operation is sandboxed to it and paths outside are rejected.',
    toolsLine,
    '- Use the tools proactively to actually perform work instead of describing hypothetical edits.',
    '- Read a file with readFile before editing it unless its contents are already in context.',
    '- Shell commands and file writes may require user approval depending on the current approval mode; batch related commands sensibly.',
    '- If a tool call fails, read the error message and adapt; never repeat the identical failing call.',
    webLine,
    'Be concise, technical, and act on the request directly. Format answers in Markdown.',
  ];
  if (agentsMd && agentsMd.trim()) {
    lines.push(
      '',
      'Project instructions from AGENTS.md (follow these carefully):',
      '---',
      agentsMd.trim(),
      '---'
    );
  }
  return lines.join('\n');
}

module.exports = { buildSystemPrompt, loadAgentsMd };
