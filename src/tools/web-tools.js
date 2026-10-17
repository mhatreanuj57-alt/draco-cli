'use strict';

const dns = require('dns').promises;
const { FETCH_TIMEOUT_MS, FETCH_MAX_BYTES } = require('../config.js');

function isPrivateIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIPv6(ip) {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  if (s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) {
    return true;
  }
  if (/^f[cd]/.test(s)) return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function assertPublicUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http/https URLs are allowed, got "${url.protocol}"`);
  }
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Blocked: localhost targets are not allowed.');
  }
  const isLiteralV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isLiteralV6 = host.includes(':');
  const addresses = isLiteralV4 || isLiteralV6 ? [{ address: host }] : null;
  return { url, host, addresses };
}

async function resolveAndGuard(urlString) {
  const { url, host, addresses } = assertPublicUrl(urlString);
  let resolved;
  if (addresses) {
    resolved = addresses;
    if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
      throw new Error(
        `Blocked: ${host} is a loopback/link-local/private address. ` +
          `SSRF protection refuses to fetch internal network targets.`
      );
    }
  } else {
    try {
      resolved = await dns.lookup(host, { all: true, verbatim: true });
    } catch (e) {
      throw new Error(`Could not resolve host "${host}": ${e.message}`);
    }
    for (const entry of resolved) {
      const addr = entry.address;
      if (isPrivateIPv4(addr) || isPrivateIPv6(addr)) {
        throw new Error(
          `Blocked: ${host} resolves to a loopback/link-local/private address (${addr}). ` +
            `SSRF protection refuses to fetch internal network targets.`
        );
      }
    }
  }
  return url;
}

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
};

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch {
        return '';
      }
    })
    .replace(/&([a-z]+);/gi, (_, name) => NAMED_ENTITIES[name.toLowerCase()] ?? `&${name};`);
}

function htmlToText(html) {
  // Regex-based conversion: good enough for static HTML; JS-rendered pages will
  // yield only their noscript/static content.
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style\s*>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg\s*>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|section|article|header|footer|h[1-6]|li|tr|ul|ol|table|pre|blockquote)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v\u00a0]+/g, ' ');
  s = s.replace(/ ?\n ?/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

async function fetchCapped(urlString, timeoutMs, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(urlString, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'DracoCLI/1.0 (+https://github.com/draco-cli)',
        Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} while fetching ${urlString}`);
    }
    if (!res.body) {
      const text = await res.text();
      return { text, contentType: res.headers.get('content-type') || '' };
    }
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let total = 0;
    let text = '';
    for await (const chunk of res.body) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new Error(
          `Response exceeded the ${Math.round(maxBytes / (1024 * 1024))}MB size cap.`
        );
      }
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    return { text, contentType: res.headers.get('content-type') || '' };
  } catch (e) {
    if (e.name === 'AbortError') {
      const timedOut = e.message === undefined;
      throw new Error(
        `Request timed out or was aborted after ${Math.round(timeoutMs / 1000)}s${timedOut ? '' : ''}`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function webFetch(args) {
  const format = args.format === 'html' ? 'html' : 'text';
  let url;
  try {
    url = await resolveAndGuard(String(args.url || ''));
  } catch (e) {
    return `Error: ${e.message}`;
  }
  try {
    const { text, contentType } = await fetchCapped(
      url.href,
      Number(args.timeoutMs) > 120000 ? 120000 : Number(args.timeoutMs) || FETCH_TIMEOUT_MS,
      FETCH_MAX_BYTES
    );
    if (format === 'html') return text;
    if (/application\/json/i.test(contentType)) return text;
    const cleaned = htmlToText(text);
    return cleaned || '(page contained no readable text)';
  } catch (e) {
    return `Error: ${e.message || e}`;
  }
}

const SEARCH_PROVIDERS = {
  async brave(query, apiKey) {
    const endpoint =
      'https://api.search.brave.com/res/v1/web/search?' +
      new URLSearchParams({ q: query, count: '5' }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(endpoint, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Brave search HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      const results = ((data.web && data.web.results) || []).slice(0, 5);
      return results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description || '',
      }));
    } finally {
      clearTimeout(timer);
    }
  },

  async duckduckgo(query) {
    const endpoint =
      'https://html.duckduckgo.com/html/?' +
      new URLSearchParams({ q: query }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        body: new URLSearchParams({ q: query }).toString(),
      });
      if (!res.ok) {
        throw new Error(`DuckDuckGo HTTP ${res.status} (may be rate-limited — retry later or set DRACO_SEARCH_API_KEY to use Brave)`);
      }
      const html = await res.text();
      const clean = (s) =>
        decodeEntities(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      const unwrap = (u) => {
        if (u.startsWith('//')) u = 'https:' + u;
        try {
          const parsed = new URL(u);
          const target = parsed.searchParams.get('uddg');
          return target ? decodeURIComponent(target) : u;
        } catch {
          return u;
        }
      };
      const anchorRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
      const links = [];
      let m;
      while ((m = anchorRe.exec(html)) !== null && links.length < 8) {
        links.push({ url: unwrap(m[1]), title: clean(m[2]) });
      }
      const snippets = [];
      while ((m = snippetRe.exec(html)) !== null && snippets.length < 8) {
        snippets.push(clean(m[1]));
      }
      const seen = new Set();
      const results = [];
      for (let i = 0; i < links.length && results.length < 5; i++) {
        const r = { title: links[i].title, url: links[i].url, snippet: snippets[i] || '' };
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        results.push(r);
      }
      return results;
    } finally {
      clearTimeout(timer);
    }
  },
};

async function webSearch(args, cfg) {
  const query = String(args.query || '').trim();
  if (!query) return 'Error: query is required.';
  const providerName = cfg.searchApiKey ? (cfg.searchProvider || 'brave') : 'duckduckgo';
  const impl = SEARCH_PROVIDERS[providerName];
  if (!impl) return `Error: unknown search provider "${providerName}".`;
  try {
    const results = await impl(query, cfg.searchApiKey);
    if (!results.length) return `No results found for "${query}".`;
    return results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
      .join('\n\n');
  } catch (e) {
    return `Error: search failed — ${e.message || e}`;
  }
}

module.exports = {
  assertPublicUrl,
  resolveAndGuard,
  htmlToText,
  webFetch,
  webSearch,
};
