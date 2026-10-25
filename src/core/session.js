'use strict';

const { AbortedError, isFallbackable, streamChatCompletion } = require('../providers/openai-compatible.js');
const { buildToolDefs, executeTool } = require('../tools/index.js');
const { MarkdownStream } = require('../ui/markdown.js');
const { buildSystemPrompt, loadAgentsMd } = require('./prompt.js');
const { nextFallback } = require('./fallback.js');
const { extractImages } = require('./images.js');
const { compactConversation } = require('./compaction.js');
const { saveSession } = require('./sessions-store.js');
const ui = require('../ui/terminal.js');
const { isTui } = require('../ui/tui/sink.js');
const store = require('../ui/tui/store.js');

const MAX_TOOL_ROUNDS = 12;
const MAX_TOOL_RESULT_CHARS = 16000;

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n[...truncated ${text.length - max} chars...]`;
}

function buildUserMessage(workspaceRoot, text) {
  const images = extractImages(workspaceRoot, text);
  if (images.length === 0) return { role: 'user', content: text };
  return { role: 'user', content: [{ type: 'text', text }, ...images] };
}

function createSession(cfg, ask, options) {
  const opts = options || {};
  const mcp = opts.mcp || null;
  const agentsMd = loadAgentsMd(cfg.workspaceRoot);

  const state = {
    cfg,
    ask,
    activeModel: cfg.model,
    lastUserText: null,
    messages: [],
    activeController: null,
    usage: { turns: 0, outputChars: 0 },
  };

  function abortActive() {
    if (state.activeController) {
      state.activeController.abort();
      return true;
    }
    return false;
  }

  function reset() {
    state.messages = [{ role: 'system', content: buildSystemPrompt(cfg, agentsMd) }];
  }

  function toolContext() {
    return {
      workspaceRoot: cfg.workspaceRoot,
      yolo: cfg.yolo,
      approvals: cfg.approvals,
      ask: state.ask,
      cfg,
      mcp,
    };
  }

  async function runTurn(userText) {
    state.lastUserText = userText;
    state.messages.push(buildUserMessage(cfg.workspaceRoot, userText));
    await completeTurn();
    state.usage.turns += 1;
    persist();
  }

  async function retry() {
    if (!state.lastUserText) {
      ui.warn('Nothing to retry yet.');
      return false;
    }
    const last = state.messages[state.messages.length - 1];
    if (!last || last.role !== 'user') {
      state.messages.push(buildUserMessage(cfg.workspaceRoot, state.lastUserText));
    }
    ui.info(`Retrying: "${truncate(String(state.lastUserText), 60)}"`);
    await completeTurn();
    persist();
    return true;
  }

  async function compact() {
    const conversation = state.messages.filter((m) => m.role !== 'system');
    if (conversation.length < 3) {
      ui.warn('Conversation is too short to compact.');
      return false;
    }
    let summary;
    try {
      summary = await compactConversation({
        cfg,
        model: state.activeModel,
        messages: conversation,
      });
    } catch (err) {
      ui.error(`Compaction failed: ${err.message || err}`);
      return false;
    }
    if (!summary) {
      ui.error('Compaction produced an empty summary; conversation left unchanged.');
      return false;
    }
    state.messages = [
      { role: 'system', content: buildSystemPrompt(cfg, agentsMd) },
      {
        role: 'user',
        content: `[Earlier conversation was summarized to stay within context limits. Summary:]\n${summary}\n\n[End of summary. Continue helping from here.]`,
      },
    ];
    persist();
    ui.success(`Conversation compacted to ~${Math.round(summary.length / 4)} tokens of summary.`);
    return true;
  }

  function persist() {
    saveSession(cfg.workspaceRoot, exportSession());
  }

  function exportSession() {
    return {
      version: 2,
      cwd: cfg.workspaceRoot,
      model: state.activeModel,
      updatedAt: new Date().toISOString(),
      lastUserText: state.lastUserText,
      messages: state.messages,
    };
  }

  function importSession(data) {
    if (
      !data ||
      !Array.isArray(data.messages) ||
      data.messages.length === 0 ||
      data.messages[0].role !== 'system'
    ) {
      return false;
    }
    state.messages = data.messages;
    if (typeof data.model === 'string' && data.model) {
      state.activeModel = data.model;
      cfg.model = data.model;
    }
    state.lastUserText = typeof data.lastUserText === 'string' ? data.lastUserText : null;
    return true;
  }

  function getUsage() {
    return {
      ...state.usage,
      messages: state.messages.filter((m) => m.role !== 'system').length,
    };
  }

  async function completeTurn() {
    const md = new MarkdownStream();
    for (let round = 1; ; round++) {
      if (round > MAX_TOOL_ROUNDS) {
        ui.error(`Stopped after ${MAX_TOOL_ROUNDS} tool rounds in a single turn.`);
        return;
      }
      const model = state.activeModel;
      const controller = new AbortController();
      state.activeController = controller;
      const spinner = new ui.Spinner(`Thinking (${model})…`);
      spinner.start();
      let acc = '';
      let emitted = false;
      let res;
      const tui = isTui();
      if (tui) store.beginLive('assistant');
      try {
        res = await streamChatCompletion({
          cfg,
          model,
          messages: state.messages,
          tools: buildToolDefs(mcp ? mcp.listTools() : []),
          signal: controller.signal,
          onDelta(t) {
            acc += t;
            if (!emitted) {
              emitted = true;
              spinner.stop();
              if (tui) store.setStatus({ model });
            }
            if (tui) store.setLiveText(acc);
            md.write(t);
          },
        });
      } catch (err) {
        state.activeController = null;
        spinner.stop();
        if (err instanceof AbortedError || controller.signal.aborted) {
          md.end();
          if (tui) store.endLive({ truncated: true });
          else if (emitted) process.stdout.write('\n');
          ui.warn('⏹ Response stopped. Type /retry to resend your last message.');
          return;
        }
        if (isFallbackable(err) && !emitted) {
          const nextModel = nextFallback(cfg.fallbackChain, model);
          if (nextModel) {
            if (tui) store.discardLive();
            ui.warn(
              `Switching to backup model: ${nextModel} — ${model} hit ${
                err.status === 429 ? 'a rate limit' : 'an availability error'
              }.`
            );
            state.activeModel = nextModel;
            continue;
          }
          if (tui) store.discardLive();
          ui.error(
            `All models in the fallback chain failed. Use /models to pick another manually.`
          );
          return;
        }
        if (emitted) {
          md.end();
          if (tui) store.endLive({ errored: true });
          else process.stdout.write('\n');
          ui.error('Connection dropped mid-stream. Type /retry to resend your last message.');
          return;
        }
        if (tui) store.discardLive();
        if (err instanceof AbortedError) {
          ui.warn(err.message);
          return;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          ui.error('Request timed out — connection may have dropped.');
          return;
        }
        ui.error(`${err.status ? `API error HTTP ${err.status}: ` : ''}${err.message || err}`);
        return;
      }
      if (emitted) {
        md.end();
        if (tui) store.endLive();
        else process.stdout.write('\n');
      } else if (tui) {
        store.discardLive();
      }
      state.usage.outputChars += acc.length;
      if (tui && res.usage) {
        store.setSidebar({
          tokensIn: res.usage.prompt_tokens || 0,
          tokensOut: res.usage.completion_tokens || 0,
        });
      }
      if (tui) store.setStatus({ model });

      const toolCalls = res.toolCalls || [];
      if (toolCalls.length > 0) {
        state.messages.push({
          role: 'assistant',
          content: acc || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        });
        for (const tc of toolCalls) {
          if (controller.signal.aborted) {
            state.activeController = null;
            ui.warn('⏹ Response stopped. Type /retry to resend your last message.');
            return;
          }
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            args = { _raw: tc.function.arguments };
          }
          ui.toolStart(tc.function.name, args);
          const result = await executeTool(tc.function.name, args, toolContext());
          state.messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: truncate(String(result), MAX_TOOL_RESULT_CHARS),
          });
        }
        continue;
      }

      state.activeController = null;
      state.messages.push({ role: 'assistant', content: acc });
      if (!acc && res.finishReason !== 'stop') {
        ui.error('(empty response from model)');
      }
      return;
    }
  }

  function setModel(id) {
    state.activeModel = id;
    cfg.model = id;
  }

  reset();

  return {
    get activeModel() {
      return state.activeModel;
    },
    setModel,
    reset,
    retry,
    compact,
    runTurn,
    abortActive,
    exportSession,
    importSession,
    clearSavedSession: () => require('./sessions-store.js').clearSavedSession(cfg.workspaceRoot),
    getUsage,
  };
}

module.exports = { createSession };
