'use strict';

/**
 * 对局状态机（《项目说明书》§2.2 对战流程 + §2.3 胜负规则 + §6.3 时长）
 *
 * 阶段：'countdown'（3-2-1）→ 'playing'（逐轮）→ 'over'（结算）。
 *
 * 设计原则：**纯函数式状态推进**，每个推进函数返回新的 match 对象，绝不原地修改。
 * 随机源（`rand`）不放进状态对象，由调用方（game/loop 或单测）显式传入，
 * 这样 match 状态保持可序列化、可在结算时上报服务端。
 */

const {
  COUNTDOWN_MS,
  GAME_HARD_LIMIT_MS,
  DEFAULT_DIFFICULTY,
  DIFFICULTY,
  MATCH_TIMEOUT_MS,
} = require('../config/config.js');
const { createEnergyState, applyHit, applyMiss, applyTimeout, displacement, finalResult } = require('./energy.js');
const { createRound, judge } = require('./matcher.js');
const { createGhost, stepGhost } = require('./ghost.js');

/**
 * 创建一局（未开始，处于倒计时阶段）。
 * @param {{difficulty?:string, matchTimeoutMs?:number}} [options]
 */
function createMatch(options) {
  const opts = options || {};
  const difficulty = DIFFICULTY[opts.difficulty] ? opts.difficulty : DEFAULT_DIFFICULTY;
  return {
    difficulty,
    matchTimeoutMs: opts.matchTimeoutMs === undefined ? MATCH_TIMEOUT_MS : opts.matchTimeoutMs,
    phase: 'countdown',
    countdownLeftMs: COUNTDOWN_MS,
    elapsedMs: 0, // 对局计时（不含倒计时）
    roundIndex: 0,
    roundElapsedMs: 0,
    round: null,
    player: createEnergyState(),
    ghost: createGhost(difficulty),
    result: null,
    lastRound: null,
    px: 0,
    draw: false,
  };
}

/** 倒计时推进；归零后自动进入 'playing'。 */
function advanceCountdown(match, dtMs) {
  if (match.phase !== 'countdown') return match;
  const left = match.countdownLeftMs - Math.max(0, dtMs || 0);
  if (left > 0) return { ...match, countdownLeftMs: left };
  return { ...match, countdownLeftMs: 0, phase: 'playing' };
}

/** 由 'countdown' 直接进入 'playing'（用于跳过倒计时）。 */
function beginPlaying(match) {
  if (match.phase !== 'countdown') return match;
  return { ...match, countdownLeftMs: 0, phase: 'playing' };
}

/**
 * 刷新下一轮（轮间停顿结束后调用）。
 * @param {object} match 对局状态
 * @param {() => number} rand 伪随机源
 */
function nextRound(match, rand) {
  if (match.phase !== 'playing') return match;
  return { ...match, round: createRound(match.difficulty, rand), roundElapsedMs: 0 };
}

/**
 * 结算一轮：玩家操作与对手产出在同一轮内一并推进（异步实时体感）。
 *
 * 一轮只结算一次：**首次点击即结束本轮**（命中/点错），窗口内无操作则以空轮结束
 * （§6.2「空轮不计能量」）。这样每轮 ↔ 一次命中口径一一对应，与 §2.4 能量公式一致；
 * 玩家仍可在窗口内快速连点，那是「每轮各一次」的连续点击。
 *
 * @param {object} match 对局状态
 * @param {string|null} clickedId 玩家点击的候选色 id；`null` = 空轮（窗口超时未操作）
 * @param {number} dtMs 本轮耗时（用于对局计时与硬上限判定）
 * @param {() => number} rand 伪随机源
 * @returns {object} 新对局状态（含 lastRound 供 UI 做命中/失误反馈）
 */
function submit(match, clickedId, dtMs, rand) {
  if (match.phase !== 'playing' || !match.round) return match;

  const elapsedMs = match.elapsedMs + Math.max(0, dtMs || 0);

  // 我方本轮：命中吃连击加成，点错扣分并清零连击，空轮不增不减
  const timedOut = clickedId === null || clickedId === undefined;
  const correct = timedOut ? false : judge(match.round.targetId, clickedId);
  const player = timedOut ? applyTimeout(match.player) : correct ? applyHit(match.player) : applyMiss(match.player);

  // 对手本轮：难度命中率 + 平衡兜底 + ±10% 浮动
  const stepped = stepGhost(match.ghost, player.energy, rand);
  const ghost = { ...match.ghost, state: stepped.state };

  const myEnergy = player.energy;
  const oppEnergy = ghost.state.energy;
  const px = displacement(myEnergy, oppEnergy);
  const timeUp = elapsedMs >= GAME_HARD_LIMIT_MS;
  const result = finalResult(myEnergy, oppEnergy, timeUp);

  return {
    ...match,
    player,
    ghost,
    elapsedMs,
    roundIndex: match.roundIndex + 1,
    roundElapsedMs: 0,
    px,
    phase: result ? 'over' : 'playing',
    result,
    lastRound: {
      kind: timedOut ? 'timeout' : correct ? 'hit' : 'miss',
      correct,
      clickedId: timedOut ? null : clickedId,
      targetId: match.round.targetId,
      playerGain: player.lastGain,
      ghostGain: stepped.gained,
      ghostHit: stepped.hit,
      comboAfter: player.combo,
      px,
    },
  };
}

/** 对局是否已结束。 */
function isOver(match) {
  return match.phase === 'over';
}

/** 匹配超时（§4.1：上限 3s，超时直接进入 AI 对局，不阻塞玩家）。 */
function shouldFallbackToAI(match, waitedMs) {
  return waitedMs >= match.matchTimeoutMs;
}

/**
 * 结算摘要（供结算页展示 §4.3 数据面板，以及上报服务端 reportResult）。
 * 命中率以「命中 / (命中 + 失误 + 空轮)」计，无操作时记 0。
 */
function summary(match) {
  const p = match.player;
  const total = p.hits + p.misses + p.timeouts;
  return {
    result: match.result,
    difficulty: match.difficulty,
    durationMs: match.elapsedMs,
    rounds: match.roundIndex,
    hits: p.hits,
    misses: p.misses,
    timeouts: p.timeouts,
    bestCombo: p.bestCombo,
    accuracy: total === 0 ? 0 : p.hits / total,
    myEnergy: p.energy,
    oppEnergy: match.ghost.state.energy,
    netEnergy: p.energy - match.ghost.state.energy,
    displacementPx: match.px,
  };
}

module.exports = {
  createMatch,
  advanceCountdown,
  beginPlaying,
  nextRound,
  submit,
  isOver,
  shouldFallbackToAI,
  summary,
};
