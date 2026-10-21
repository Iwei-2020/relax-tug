'use strict';

const { DAILY_LIVES } = require('../config/config.js');
const { utc8DayKey } = require('./rng.js');

function dayOf(nowMs) {
  return utc8DayKey(Number.isFinite(nowMs) ? nowMs : Date.now());
}

function emptyLives(nowMs) {
  return { day: dayOf(nowMs), count: DAILY_LIVES };
}

function normalizeLives(raw, nowMs) {
  const day = dayOf(nowMs);
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

module.exports = { DAILY_LIVES, emptyLives, normalizeLives, consumeLife, grantLife };
