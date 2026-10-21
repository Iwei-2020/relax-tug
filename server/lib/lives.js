'use strict';

const { DAILY_LIVES } = require('./constants.js');

function dayKey(nowMs) {
  return new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function normalizeLives(raw, nowMs) {
  const day = dayKey(nowMs);
  if (!raw || raw.day !== day) return { day, count: DAILY_LIVES };
  const count = Number(raw.count);
  return {
    day,
    count: Number.isFinite(count) ? Math.max(0, Math.min(DAILY_LIVES, Math.floor(count))) : DAILY_LIVES,
  };
}

function consumeLife(raw, nowMs) {
  const state = normalizeLives(raw, nowMs);
  if (state.count <= 0) return { ok: false, state };
  return { ok: true, state: { ...state, count: state.count - 1 } };
}

function grantLife(raw, nowMs) {
  const state = normalizeLives(raw, nowMs);
  if (state.count >= DAILY_LIVES) return { ok: false, state };
  return { ok: true, state: { ...state, count: state.count + 1 } };
}

module.exports = { dayKey, normalizeLives, consumeLife, grantLife };
