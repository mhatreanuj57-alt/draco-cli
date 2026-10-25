'use strict';

const {
  CHAT_TIMEOUT_MS,
  MODELS_TIMEOUT_MS,
} = require('../config.js');

const DEFAULT_PROBE_MODEL = 'gemini-3.8-flash';

function endpoint(cfg, suffix) {
  return `${cfg.apiBase}${cfg.apiPath || ''}/${suffix}`;
}

function probeModel(cfg) {
  return (cfg.model && cfg.model.trim()) || DEFAULT_PROBE_MODEL;
}

class ApiError extends Error {
  constructor(status, message, bodyText) {
    super(message);
    this.name = 'ApiError';
    this.status = status || 0;
    this.bodyText = bodyText || '';
  }
}

function extractEmbeddedStatus(message) {
  const m = /\[(\d{3})\]/.exec(String(message));
  return m ? Number(m[1]) : undefined;
}

function isFallbackable(err) {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 429) return true;
  if ([400, 502, 503, 504, 529].includes(err.status)) {
    return /unavailable|not supported|ModelError|overloaded|upstream|temporarily/i.test(
      err.message + ' ' + err.bodyText
    );
  }
  if (/overloaded|upstream error|temporarily unavailable/i.test(err.message + ' ' + err.bodyText)) {
    return true;
  }
  return false;
}

async function safeBodyText(res, maxChars = 2000) {
  try {
    const text = await res.text();
    return text.slice(0, maxChars);
  } catch {
    return '';
  }
}

function extractApiMessage(status, bodyText) {
  try {
    const json = JSON.parse(bodyText);
    const msg =
      (json.error && (json.error.message || json.error.code)) ||
      json.message ||
      '';
    if (msg) return `${msg}`;
  } catch {
    // fall through to raw body
  }
  return bodyText ? bodyText.slice(0, 200) : `HTTP ${status}`;
}

async function listModels(cfg) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(endpoint(cfg, 'models'), {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new ApiError(
          0,
          `Gemini did not respond within ${Math.round(
            MODELS_TIMEOUT_MS / 1000
          )}s. The free tier may be rate-limiting you — try /models again shortly.`
        );
      }
      throw new ApiError(0, `Network error: ${e.message}`);
    }
    if (!res.ok) {
      const body = await safeBodyText(res);
      throw new ApiError(res.status, extractApiMessage(res.status, body), body);
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, 'Malformed JSON in models registry response.');
    }
    const rawList = Array.isArray(json.data)
      ? json.data
      : Array.isArray(json.models)
        ? json.models
        : Array.isArray(json)
          ? json
          : [];
    const ids = rawList
      .map((m) => (typeof m === 'string' ? m : m && (m.id || m.name)))
      .filter((id) => typeof id === 'string' && id.length > 0);
    if (!ids.length) {
      throw new ApiError(res.status, 'Models registry returned no usable ids.');
    }
    return ids;
  } finally {
    clearTimeout(timer);
  }
}

class AbortedError extends Error {
  constructor() {
    super('Stopped by user.');
    this.name = 'AbortedError';
    this.userAbort = true;
  }
}

async function streamChatCompletion(opts) {
  const { cfg, model, messages, tools, onDelta, signal } = opts;
  const controller = new AbortController();
  // Idle timeout: every received chunk resets it, so only a genuinely stalled
  // connection aborts — an actively streaming (but slow) reply never does.
  let timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  const bump = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  };
  let externalAborted = false;
  const onExternalAbort = () => {
    externalAborted = true;
    controller.abort();
  };
  if (signal) {
    if (signal.aborted) onExternalAbort();
    else signal.addEventListener('abort', onExternalAbort);
  }
  const cleanup = () => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  };

  let res;
  try {
    res = await fetch(endpoint(cfg, 'chat/completions'), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, tools, stream: true }),
    });
  } catch (e) {
    cleanup();
    if (externalAborted) throw new AbortedError();
    if (e.name === 'AbortError') {
      throw new ApiError(
        0,
        `No response from Gemini after ${Math.round(
          CHAT_TIMEOUT_MS / 1000
        )}s — the free tier is heavily queued right now. Try again shortly.`
      );
    }
    throw new ApiError(0, `Network error: ${e.message}`);
  }

  if (!res.ok) {
    cleanup();
    const body = await safeBodyText(res);
    throw new ApiError(res.status, extractApiMessage(res.status, body), body);
  }
  if (!res.body) {
    cleanup();
    throw new ApiError(res.status || 0, 'Server returned an empty response body.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason = null;
  const parts = new Map();
  let done = false;

  try {
    outer: for await (const chunk of res.body) {
      bump();
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          done = true;
          break outer;
        }
        let evt;
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt.error) {
          const msg =
            (evt.error.message || evt.error.code || JSON.stringify(evt.error)).toString();
          const status =
            evt.error.status ||
            extractEmbeddedStatus(msg) ||
            evt.status ||
            res.status;
          throw new ApiError(status, msg);
        }
        const choice = evt.choices && evt.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (typeof delta.content === 'string' && delta.content.length > 0 && onDelta) {
          onDelta(delta.content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const frag of delta.tool_calls) {
            const idx = typeof frag.index === 'number' ? frag.index : 0;
            let part = parts.get(idx);
            if (!part) {
              part = { id: '', name: '', arguments: '' };
              parts.set(idx, part);
            }
            if (frag.id) part.id = frag.id;
            if (frag.function) {
              if (frag.function.name) part.name += frag.function.name;
              if (frag.function.arguments) part.arguments += frag.function.arguments;
            }
          }
        }
      }
    }
  } catch (e) {
    cleanup();
    if (externalAborted) throw new AbortedError();
    if (done) {
      // stream already completed; ignore trailing read errors
    } else if (e instanceof ApiError) {
      throw e;
    } else if (e.name === 'AbortError') {
      throw new ApiError(
        res.status,
        'Stream stalled — no data from Gemini. Try again; /retry resends your message.'
      );
    } else {
      throw new ApiError(res.status, `Connection dropped mid-stream: ${e.message}`);
    }
  } finally {
    clearTimeout(timer);
  }

  const toolCalls = [...parts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, p], n) => ({
      id: p.id || `call_${n}`,
      type: 'function',
      function: { name: p.name, arguments: p.arguments || '{}' },
    }));

  return { toolCalls, finishReason };
}

async function probeApiKey(cfg, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(endpoint(cfg, 'chat/completions'), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: probeModel(cfg),
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        return { verdict: 'unreachable', detail: 'request timed out' };
      }
      return { verdict: 'unreachable', detail: e.message };
    }
    if (res.ok || res.status === 429) {
      // 429 = rate-limited but authenticated
      return { verdict: 'ok', status: res.status };
    }
    if (res.status === 401 || res.status === 403) {
      return { verdict: 'invalid', status: res.status };
    }
    if (res.status === 400) {
      // Gemini reports a bad key as 400 INVALID_ARGUMENT, so inspect the body.
      // A real model/param error still means the key itself was accepted.
      const body = await safeBodyText(res);
      if (/api key|api_key|API_KEY|unauthenticated|permission/i.test(body)) {
        return { verdict: 'invalid', status: res.status };
      }
      return { verdict: 'ok', status: res.status };
    }
    return { verdict: 'unknown', status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { ApiError, AbortedError, isFallbackable, listModels, streamChatCompletion, probeApiKey };
