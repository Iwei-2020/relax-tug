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
  DIFFICULTY,
  MATCH_TIMEOUT_MS,
  PROGRESSION,
  LEVEL_LIVES,
  LEVEL_ENERGY_MAX,
  LEVEL_ENERGY_SCALE,
} = require('../config/config.js');
const { createEnergyState, applyHit, applyMiss, applyTimeout, displacement, finalResult } = require('./energy.js');
const { createRound, currentTargetId, judgeGrade } = require('./matcher.js');
const classicMode = require('./classic.js');
const { createGhost, stepGhost } = require('./ghost.js');
const { createEventState, activeEvent, tick: tickEvent, maybeTrigger } = require('./events.js');
const { clampLevel, levelConfig } = require('./levels.js');

/**
 * 创建一局。普通对战和闯关模式均从 3 秒开场倒计时开始。
 *
 * 两种模式（§4.8）：
 *   · `classic`（默认）：普通对战，按开局段位和已进行时长动态调整难度与能量变化，无整局时限；
 *   · `level`：闯关模式，按 `level` 派生段数 / 候选 / 窗口；能量达到 100% 即过关。
 * @param {{difficulty?:string, rankId?:string, matchTimeoutMs?:number, challenge?:boolean, mode?:'classic'|'level', level?:number}} [options]
 */
function createMatch(options) {
  const opts = options || {};
  const mode = opts.mode === 'level' ? 'level' : 'classic';
  const level = mode === 'level' ? clampLevel(opts.level) : null;
  const rankId =
    mode === 'classic' && PROGRESSION.ranks.some((rank) => rank.id === opts.rankId)
      ? opts.rankId
      : PROGRESSION.ranks[0].id;
  // 闯关模式：本关第 1 轮的参数（后续轮次在 nextRound 里按 roundIndex 重算）
  const entryCfg = mode === 'level' ? levelConfig(level, 0) : null;
  const difficulty =
    mode === 'level'
      ? entryCfg.tier
      : DIFFICULTY[opts.difficulty]
        ? opts.difficulty
        : classicMode.paramsAt(rankId, 0).difficulty;
  return {
    mode, // 'classic' 普通对战 | 'level' 闯关模式（§4.8）
    level, // 闯关关卡号（classic 为 null）
    rankId,
    difficulty,
    challenge: mode === 'classic' && opts.challenge === true, // 每日挑战局标记（§4.4 已下线，仅历史兼容）
    matchTimeoutMs: opts.matchTimeoutMs === undefined ? MATCH_TIMEOUT_MS : opts.matchTimeoutMs,
    phase: 'countdown',
    countdownLeftMs: COUNTDOWN_MS,
    elapsedMs: 0,
    roundIndex: 0,
    roundElapsedMs: 0,
    round: null,
    player: createEnergyState(),
    ghost: mode === 'classic' ? createGhost(difficulty) : null,
    livesLeft: mode === 'level' ? LEVEL_LIVES : null, // 闯关模式剩余生命（§4.8）
    goalReached: mode === 'level' ? false : null,
    levelCfg: entryCfg, // 闯关模式当前轮参数（classic 为 null）
    classicCfg: mode === 'classic' ? classicMode.paramsAt(rankId, 0) : null,
    events: createEventState(), // §6.5 随机事件状态（种子驱动，附在 match 上便于快照/上报）
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
  // §6.5 随机事件：检查点在轮间刷新（每轮结束后的停顿内），玩家体感为「下一轮开始冒出事件」。
  // 触发完全由 rand 驱动 → 同种子同事件序列（闯关模式「每关固定种子」同理，§4.8）。
  const events = maybeTrigger(match.events, match.roundIndex, rand);
  const ev = activeEvent(events);

  // 闯关模式：每轮按「关卡 + 局内轮次」重算段数、候选数与输入窗口。
  let difficulty = match.difficulty;
  let levelCfg = match.levelCfg;
  let classicCfg = match.classicCfg;
  let overrides;
  if (match.mode === 'level') {
    levelCfg = levelConfig(match.level, match.roundIndex);
    difficulty = levelCfg.tier;
    overrides = { seqLen: levelCfg.seqLen, candidates: levelCfg.candidates, windowMs: levelCfg.windowMs };
  } else {
    classicCfg = classicMode.paramsAt(match.rankId, match.elapsedMs);
    difficulty = classicCfg.difficulty;
    overrides = {
      seqLen: classicCfg.seqLen,
      candidates: classicCfg.candidates,
      windowMs: classicCfg.windowMs,
    };
  }

  const round = createRound(difficulty, rand, ev ? ev.windowScale : undefined, overrides);
  const ghost =
    match.mode === 'classic'
      ? { ...match.ghost, difficulty, oppHit: classicCfg.oppHit, oppMiss: classicCfg.oppMiss }
      : match.ghost;
  return {
    ...match,
    events,
    difficulty: match.mode === 'classic' ? difficulty : match.difficulty,
    levelCfg,
    classicCfg,
    ghost,
    round,
    roundElapsedMs: 0,
  };
}

/**
 * 结算一次操作（普通对战推进 AI；闯关模式只更新玩家能量）。
 *
 * 一次操作 = 结算序列中的**一段**：点对则推进到下一段（本轮继续，窗口由表现层重置），
 * 走完最后一段 / 点错 / 超时则本轮结束（roundIndex +1），随后由表现层停顿并刷新下一轮。
 * 这样「每段 ↔ 一次命中」与 §2.4 能量公式一一对应，玩家在窗口内快速连点即为「逐段各一次」。
 *
 * @param {object} match 对局状态
 * @param {string|null} clickedId 玩家点击的候选色 id；`null` = 本段超时未操作
 * @param {number} dtMs 本段耗时（用于对局计时与时长驱动难度）
 * @param {() => number} rand 伪随机源
 * @returns {object} 新对局状态（含 lastRound 供 UI 做命中/失误反馈）
 */
function submit(match, clickedId, dtMs, rand) {
  if (match.phase !== 'playing' || !match.round) return match;

  const segMs = Math.max(0, dtMs || 0);
  const isLevel = match.mode === 'level';
  const elapsedMs = isLevel ? Math.min(GAME_HARD_LIMIT_MS, match.elapsedMs + segMs) : match.elapsedMs + segMs;
  const classicCfg = isLevel ? null : classicMode.paramsAt(match.rankId, elapsedMs);

  const targetId = currentTargetId(match.round);
  const seqLength = match.round.targetIds.length;
  const segIndex = match.round.seqIndex;

  // §6.5 随机事件：按真实时间衰减（到期自动失效，恢复常态），并取出本次生效的能量倍率
  const events = tickEvent(match.events, segMs);
  const active = activeEvent(events);
  const eventEnergyScale = active && active.energyScale ? active.energyScale : 1;
  const energyScale = eventEnergyScale * (classicCfg ? classicCfg.energyScale : 1);

  // 我方本段：命中吃连击加成（+ 判定分档倍率 + 事件能量倍率），点错扣分并清零连击，超时（空段）不增不减
  const timedOut = clickedId === null || clickedId === undefined;
  const grade = timedOut ? 'miss' : judgeGrade(targetId, clickedId, segMs, match.round.windowMs);
  const correct = grade !== 'miss';
  const perfect = grade === 'perfect';
  const updatedPlayer = timedOut
    ? applyTimeout(match.player)
    : correct
      ? applyHit(match.player, undefined, perfect, energyScale)
      : applyMiss(match.player, classicCfg ? classicCfg.energyScale : undefined);
  const rawDelta = updatedPlayer.energy - match.player.energy;
  const scaledEnergy = Math.max(
    0,
    Math.min(LEVEL_ENERGY_MAX, match.player.energy + Math.round(rawDelta * LEVEL_ENERGY_SCALE))
  );
  const goalReached = isLevel && (match.goalReached === true || scaledEnergy >= LEVEL_ENERGY_MAX);
  const player = isLevel
    ? {
        ...updatedPlayer,
        energy: goalReached ? LEVEL_ENERGY_MAX : scaledEnergy,
        lastGain: (goalReached ? LEVEL_ENERGY_MAX : scaledEnergy) - match.player.energy,
      }
    : updatedPlayer;
  const stepped = isLevel
    ? null
    : stepGhost(match.ghost, player.energy, rand, {
        oppHit: classicCfg.oppHit,
        oppMiss: classicCfg.oppMiss,
        energyScale: classicCfg.energyScale,
      });
  const ghost = isLevel ? null : { ...match.ghost, state: stepped.state };

  // 点错/超时本轮作废，但保留已清段数（UI 用它显示「差几段」）
  const cleared = correct ? segIndex + 1 : segIndex;
  const timeUp = isLevel && elapsedMs >= GAME_HARD_LIMIT_MS;

  // 闯关模式：点错 / 超时各扣 1 条生命；生命只记录错误次数，不提前结束 45 秒对局。
  const livesLeft = isLevel ? Math.max(0, match.livesLeft - (correct ? 0 : 1)) : match.livesLeft;
  let px = 0;
  let result = null;
  if (isLevel) {
    if (livesLeft <= 0) result = 'lose';
    else if (timeUp) result = goalReached ? 'win' : 'lose';
  } else {
    const oppEnergy = ghost.state.energy;
    px = displacement(player.energy, oppEnergy);
    result = finalResult(player.energy, oppEnergy, timeUp);
  }

  // 对局收官时，把当前轮一并标记结束，避免留下半轮状态。
  // 否则最后那一轮不足 N 段却仍计入「未结束」，会破坏服务端
  // 「hits ≤ 轮次 × 序列长度」的一致性上界，误把合法上报判成篡改（见 server/lib/result.js）。
  const roundDone = !correct || cleared >= seqLength || result !== null;

  return {
    ...match,
    events, // §6.5 随机事件状态（tick 后的新对象）
    difficulty: classicCfg ? classicCfg.difficulty : match.difficulty,
    classicCfg: classicCfg || match.classicCfg,
    player,
    ghost,
    elapsedMs,
    goalReached: isLevel ? goalReached : match.goalReached,
    roundIndex: roundDone ? match.roundIndex + 1 : match.roundIndex,
    round: { ...match.round, seqIndex: cleared, done: roundDone },
    roundElapsedMs: 0,
    px,
    livesLeft, // 闯关模式剩余生命（classic 恒为 null）
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
      ...(isLevel ? {} : { ghostGain: stepped.gained, ghostHit: stepped.hit }),
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
 * perfectHits：其中「完美判定」的段数（§6.2 判定分档）。
 * mode / level / rankId / livesLeft：对局模式、开局段位与闯关进度。
 * challengeMode：每日挑战标记（§4.4 已下线，仅历史兼容，恒 false）。
 * eventsFired / eventIds：本局随机事件的触发次数与序列（§6.5），供服务端上界校验与后续分析。
 */
function summary(match) {
  const p = match.player;
  const total = p.hits + p.misses + p.timeouts;
  const ev = match.events || {};
  const result = {
    result: match.result,
    mode: match.mode,
    level: match.level,
    rankId: match.mode === 'classic' ? match.rankId : null,
    difficulty: match.difficulty,
    challengeMode: match.challenge === true,
    livesLeft: match.livesLeft,
    durationMs: match.elapsedMs,
    rounds: match.roundIndex,
    hits: p.hits,
    perfectHits: p.perfects,
    misses: p.misses,
    timeouts: p.timeouts,
    bestCombo: p.bestCombo,
    accuracy: total === 0 ? 0 : p.hits / total,
    ...(match.mode === 'level'
      ? { energyPct: p.energy }
      : {
          myEnergy: p.energy,
          oppEnergy: match.ghost.state.energy,
          netEnergy: p.energy - match.ghost.state.energy,
          displacementPx: match.px,
        }),
    eventsFired: ev.fired || 0,
    eventIds: ev.firedIds ? ev.firedIds.slice() : [],
  };
  return result;
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
