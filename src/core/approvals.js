'use strict';

const APPROVAL_MODES = ['suggest', 'auto-edit', 'full-auto'];

function approvalMode(ctx) {
  if (!ctx || !ctx.cfg) return 'suggest';
  if (ctx.cfg.yolo) return 'full-auto';
  return ctx.cfg.approvals || 'suggest';
}

async function gate(ctx, question, autoModes) {
  const mode = approvalMode(ctx);
  if (autoModes.includes(mode)) return true;
  if (typeof ctx.ask !== 'function') return false;
  const answer = await ctx.ask(question);
  const normalized = String(answer || '').trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

module.exports = { APPROVAL_MODES, approvalMode, gate };
