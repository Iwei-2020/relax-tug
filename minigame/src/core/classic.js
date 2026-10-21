'use strict';

/**
 * 普通对战难度曲线：段位决定起点，对局时长持续推动难度和能量变化。
 * `timeRampMs` 只控制曲线到达最高档的速度，不是游戏时限。
 */

const { CLASSIC_MODE } = require('../config/config.js');

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function tierAt(intensity) {
  if (intensity < 0.25) return 'easy';
  if (intensity < 0.5) return 'normal';
  if (intensity < 0.75) return 'hard';
  return 'hell';
}

/**
 * Derive one classic round's parameters from the player's starting rank and elapsed match time.
 * @param {string} rankId
 * @param {number} elapsedMs
 */
function paramsAt(rankId, elapsedMs) {
  const rankIntensity = CLASSIC_MODE.rankStart[rankId] || 0;
  const timeProgress = clamp01(Math.max(0, elapsedMs || 0) / CLASSIC_MODE.timeRampMs);
  const intensity = clamp01(rankIntensity + (1 - rankIntensity) * timeProgress);
  const seq = CLASSIC_MODE.sequenceLength;
  const tiers = CLASSIC_MODE.candidateTiers;
  const tierIndex = Math.round(intensity * (tiers.length - 1));

  return {
    intensity,
    timeProgress,
    difficulty: tierAt(intensity),
    seqLen: Math.round(lerp(seq.min, seq.max, intensity)),
    candidates: tiers[tierIndex],
    windowMs: Math.round(lerp(CLASSIC_MODE.windowMs.start, CLASSIC_MODE.windowMs.end, intensity)),
    oppHit: lerp(CLASSIC_MODE.opponentHit.start, CLASSIC_MODE.opponentHit.end, intensity),
    oppMiss: lerp(CLASSIC_MODE.opponentMiss.start, CLASSIC_MODE.opponentMiss.end, intensity),
    energyScale: lerp(CLASSIC_MODE.energyScale.start, CLASSIC_MODE.energyScale.end, timeProgress),
  };
}

module.exports = { clamp01, tierAt, paramsAt };
