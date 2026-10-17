'use strict';

function nextFallback(chain, model) {
  if (!Array.isArray(chain)) return null;
  const idx = chain.indexOf(model);
  if (idx >= 0) return chain[idx + 1] || null;
  if (chain[0] !== model) return chain[0] || null;
  return chain[1] || null;
}

module.exports = { nextFallback };
