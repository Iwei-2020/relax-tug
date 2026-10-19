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
const { createRound, currentTargetId, judgeGrade } = require('./matcher.js');
const { createGhost, stepGhost } = require('./ghost.js');

/**
 * 创建一局（未开始，处于倒计时阶段）。
 * @param {{difficulty?:string, matchTimeoutMs?:number, challenge?:boolean}} [options]
 */
function createMatch(options) {
  const opts = options || {};
  const difficulty = DIFFICULTY[opts.difficulty] ? opts.difficulty : DEFAULT_DIFFICULTY;
  return {
    difficulty,
    challenge: opts.challenge === true, // 每日挑战局标记（§4.4：固定种子同题局，单独记账）
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
 *
 * 守卫：当前序列**未走完**时不刷新 —— 序列化之后「一轮」要按段推进，
 * 若无条件替换 round，会把剩余段直接丢掉、把半途的推进变成隐形的空轮。
 * @param {object} match 对局状态
 * @param {() => number} rand 伪随机源
 */
function nextRound(match, rand) {
  if (match.phase !== 'playing') return match;
  if (match.round && !match.round.done) return match;
  return { ...match, round: createRound(match.difficulty, rand), roundElapsedMs: 0 };
}

/**
 * 结算一次操作（玩家操作与对手产出在同一段内一并推进，异步实时体感）。
 *
 * 一次操作 = 结算序列中的**一段**：点对则推进到下一段（本轮继续，窗口由表现层重置），
 * 走完最后一段 / 点错 / 超时则本轮结束（roundIndex +1），随后由表现层停顿并刷新下一轮。
 * 这样「每段 ↔ 一次命中」与 §2.4 能量公式一一对应，玩家在窗口内快速连点即为「逐段各一次」。
 *
 * @param {object} match 对局状态
 * @param {string|null} clickedId 玩家点击的候选色 id；`null` = 本段超时未操作
 * @param {number} dtMs 本段耗时（用于对局计时与硬上限判定）
 * @param {() => number} rand 伪随机源
 * @returns {object} 新对局状态（含 lastRound 供 UI 做命中/失误反馈）
 */
function submit(match, clickedId, dtMs, rand) {
  if (match.phase !== 'playing' || !match.round) return match;

  const targetId = currentTargetId(match.round);
  const seqLength = match.round.targetIds.length;
  const segIndex = match.round.seqIndex;

  const segMs = Math.max(0, dtMs || 0);
  const elapsedMs = match.elapsedMs + segMs;

  // 我方本段：命中吃连击加成（+ 判定分档倍率），点错扣分并清零连击，超时（空段）不增不减
  const timedOut = clickedId === null || clickedId === undefined;
  const grade = timedOut ? 'miss' : judgeGrade(targetId, clickedId, segMs, match.round.windowMs);
  const correct = grade !== 'miss';
  const perfect = grade === 'perfect';
  const player = timedOut
    ? applyTimeout(match.player)
    : correct
      ? applyHit(match.player, undefined, perfect)
      : applyMiss(match.player);

  // 对手也按「段」推进：与玩家逐段对称，序列化改动才不会打破 §6.4 的能量平衡口径
  const stepped = stepGhost(match.ghost, player.energy, rand);
  const ghost = { ...match.ghost, state: stepped.state };

  // 点错/超时本轮作废，但保留已清段数（UI 用它显示「差几段」）
  const cleared = correct ? segIndex + 1 : segIndex;
  const timeUp = elapsedMs >= GAME_HARD_LIMIT_MS;

  const myEnergy = player.energy;
  const oppEnergy = ghost.state.energy;
  const px = displacement(myEnergy, oppEnergy);
  const result = finalResult(myEnergy, oppEnergy, timeUp);

  // 对局一旦收官（越线即时结算 / 硬上限截断）就把本轮一并记为结束：
  // 否则最后那一轮不足 N 段却仍计入「未结束」，会破坏服务端
  // 「hits ≤ 轮次 × 序列长度」的一致性上界，误把合法上报判成篡改（见 server/lib/result.js）。
  const roundDone = !correct || cleared >= seqLength || result !== null;

  return {
    ...match,
    player,
    ghost,
    elapsedMs,
    roundIndex: roundDone ? match.roundIndex + 1 : match.roundIndex,
    round: { ...match.round, seqIndex: cleared, done: roundDone },
    roundElapsedMs: 0,
    px,
    phase: result ? 'over' : 'playing',
    result,
    lastRound: {
      kind: timedOut ? 'timeout' : correct ? 'hit' : 'miss',
      grade, // 'perfect' | 'good' | 'miss'（超时归 'miss'，见 §6.2 判定分档）
      perfect,
      correct,
      clickedId: timedOut ? null : clickedId,
      targetId,
      segIndex,
      roundDone,
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
 * perfectHits：其中「完美判定」的段数（§6.2 判定分档）；challengeMode：每日挑战局标记（§4.4）。
 */
function summary(match) {
  const p = match.player;
  const total = p.hits + p.misses + p.timeouts;
  return {
    result: match.result,
    difficulty: match.difficulty,
    challengeMode: match.challenge === true,
    durationMs: match.elapsedMs,
    rounds: match.roundIndex,
    hits: p.hits,
    perfectHits: p.perfects,
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
