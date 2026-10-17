'use strict';

const { streamChatCompletion } = require('../providers/openai-compatible.js');
const ui = require('../ui/terminal.js');

function simplifyMessageForSummary(message) {
  let content = message.content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((part) => part && part.type === 'text')
      .map((part) => part.text);
    content = texts.join('\n') || '[media attachment]';
  }
  if (message.role === 'tool') {
    return { role: 'user', content: `[tool result] ${String(content).slice(0, 2000)}` };
  }
  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(content ?? ''),
  };
}

const SUMMARY_SYSTEM_PROMPT =
  'Summarize this coding-agent conversation. Capture: the user goals, files created/modified (with paths), key decisions, commands run, errors hit and their fixes, and any unfinished next steps. Be dense and factual.';

async function compactConversation({ cfg, model, messages }) {
  const spinner = new ui.Spinner('Compacting conversation…');
  spinner.start();
  const controller = new AbortController();
  let summary = '';
  try {
    await streamChatCompletion({
      cfg,
      model,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        ...messages.map(simplifyMessageForSummary),
      ],
      tools: [],
      signal: controller.signal,
      onDelta(t) {
        summary += t;
      },
    });
    spinner.stop();
    return summary.trim();
  } catch (err) {
    spinner.stop();
    throw err;
  }
}

module.exports = { compactConversation, simplifyMessageForSummary };
