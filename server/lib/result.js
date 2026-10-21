'use strict';

/**
 * 对局结果校验与记账（《项目说明书》§2.3 胜负规则 + §5.1 广告频次 + §5.4 服务端只做校验）
 *
 * 定位：**服务端权威校验**，用于
 *   1) 反作弊：按 core 的同口径公式重算位移与能量上限，拒绝篡改上报；
 *   2) 记账：累计胜场 / 每日首胜 / 广告频次（复活、翻倍、皮肤解锁）；
 *   3) 供排行榜与埋点回收（§9.3 DoD：平均时长 / 命中率 / 胜负比）。
 *
 * 数值口径来自 server/lib/constants.js（由 tools/gen-constants.js 从小游戏 config 生成），
 * 保证客户端与服务端**同一套数字**，不存在第二处硬编码。
 */

const {
  HIT_ENERGY,
  COMBO_BONUS_MAX,
  PERFECT_MULTIPLIER,
  SEQUENCE_LENGTH,
  DISPLACEMENT_FACTOR,
  DISPLACEMENT_MAX_PX,
  GAME_HARD_LIMIT_MS,
  DIFFICULTY,
  EVENT_MAX_ENERGY_SCALE,
  EVENT_MAX_PER_MATCH,
  LEVEL_MAX,
  LEVEL_LIVES,
  LEVEL_MODE,
  MONETIZATION,
} = require('./constants.js');
const { CODES, ok, fail } = require('./envelope.js');
const { emptyCounter } = require('./store.js');
const { awardWithDailyCaps, applyAward, progressOf } = require('./progression.js');
const { stateFromCounter, counterFields, applyMatch, summaryOf } = require('./tasks.js');
const levels = require('./levels.js');

/** 判定结果集合。 */
const RESULTS = ['win', 'lose', 'draw'];
/** 对局模式集合（§4.8）：classic 普通对战 / level 闯关模式。 */
const MODES = ['classic', 'level'];
/** 时长上报允许的宽限（客户端帧率抖动 / 结算延时）。 */
const DURATION_SLACK_MS = 5000;
/** 上报缺省模式：历史客户端不带 mode 字段时按普通对战场处理。 */
const DEFAULT_MODE = 'classic';

/** UTC+8 的 yyyy-mm-dd（服务端记账按北京时间自然日切分）。 */
function dayKey(nowMs) {
  const shifted = new Date(nowMs + 8 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

function clampPx(value) {
  return Math.max(-DISPLACEMENT_MAX_PX, Math.min(DISPLACEMENT_MAX_PX, value));
}

/** 上报模式（缺省 classic，容忍历史客户端）。 */
function modeOf(payload) {
  return payload && payload.mode !== undefined ? payload.mode : DEFAULT_MODE;
}

/** 关卡号是否合法（闯关模式的位移系数与段数上界都依赖它）。 */
function validLevel(level) {
  return isInt(level) && level >= 1 && level <= LEVEL_MAX;
}

/**
 * 校验上报的对局摘要。
 * @returns {{ok:boolean, errors:string[]}}
 */
function validate(payload) {
  const p = payload || {};
  const errors = [];
  const mode = modeOf(p);
  const isLevel = mode === 'level';

  if (!MODES.includes(mode)) errors.push('mode 非法');
  if (!RESULTS.includes(p.result)) errors.push('result 非法');
  if (!isInt(p.hits) || p.hits < 0) errors.push('hits 非法');
  if (!isInt(p.misses) || p.misses < 0) errors.push('misses 非法');
  if (!isInt(p.timeouts) || p.timeouts < 0) errors.push('timeouts 非法');
  if (!isInt(p.bestCombo) || p.bestCombo < 0) errors.push('bestCombo 非法');
  if (isInt(p.bestCombo) && isInt(p.hits) && p.bestCombo > p.hits) errors.push('bestCombo 超过 hits');
  if (isLevel) {
    if (!isInt(p.energyPct) || p.energyPct < 0 || p.energyPct > LEVEL_MODE.energyMax) errors.push('energyPct 非法');
    else if (
      isInt(p.hits) &&
      p.energyPct >
        Math.min(
          LEVEL_MODE.energyMax,
          p.hits *
            Math.round(
              Math.round(
                Math.round((HIT_ENERGY + COMBO_BONUS_MAX) * PERFECT_MULTIPLIER) * EVENT_MAX_ENERGY_SCALE
              ) * LEVEL_MODE.energyScale
            )
        )
    ) {
      errors.push('energyPct 超过理论上限');
    }
    if (
      p.myEnergy !== undefined ||
      p.oppEnergy !== undefined ||
      p.netEnergy !== undefined ||
      p.displacementPx !== undefined
    ) {
      errors.push('闯关摘要包含对战字段');
    }
  } else {
    if (!isInt(p.myEnergy) || p.myEnergy < 0) errors.push('myEnergy 非法');
    if (!isInt(p.oppEnergy) || p.oppEnergy < 0) errors.push('oppEnergy 非法');
  }
  if (!isInt(p.durationMs) || p.durationMs < 0 || p.durationMs > GAME_HARD_LIMIT_MS + DURATION_SLACK_MS) {
    errors.push('durationMs 非法');
  }
  if (DIFFICULTY[p.difficulty] === undefined) errors.push('difficulty 非法');
  // 判定分档与每日挑战标记（§6.2 / §4.4）：均为可选字段，出现时只做存在性/一致性校验。
  if (p.perfectHits !== undefined) {
    if (!isInt(p.perfectHits) || p.perfectHits < 0) errors.push('perfectHits 非法');
    else if (isInt(p.hits) && p.perfectHits > p.hits) errors.push('perfectHits 超过 hits');
  }
  if (p.challengeMode !== undefined && typeof p.challengeMode !== 'boolean') errors.push('challengeMode 非法');
  // 随机事件触发次数（§6.5）：可选字段，出现时只做存在性/上界校验。
  if (p.eventsFired !== undefined) {
    if (!isInt(p.eventsFired) || p.eventsFired < 0) errors.push('eventsFired 非法');
    else if (p.eventsFired > EVENT_MAX_PER_MATCH) errors.push('eventsFired 超过每局上限');
  }

  // §4.8 闯关模式：关卡号与剩余生命必填并落在合法区间；难度须与该关「入门档」一致
  // （客户端 summary.difficulty 取的就是 levelConfig(level, 0).tier，服务端按同一镜像重算）。
  if (isLevel) {
    if (!validLevel(p.level)) errors.push('level 非法');
    if (!isInt(p.livesLeft) || p.livesLeft < 0 || p.livesLeft > LEVEL_LIVES) errors.push('livesLeft 非法');
    if (
      isInt(p.durationMs) &&
      p.durationMs !== GAME_HARD_LIMIT_MS &&
      !(p.result === 'lose' && p.livesLeft === 0)
    ) {
      errors.push('闯关时长必须为 45 秒，生命耗尽失败除外');
    }
    if (validLevel(p.level) && DIFFICULTY[p.difficulty] !== undefined) {
      if (p.difficulty !== levels.levelConfig(p.level, 0).tier) errors.push('difficulty 与关卡入门档不一致');
    }
  }

  // 能量上限：每次命中最高 +（基础 + 最高连击加成），完美判定（§6.2）再乘倍率，
  // 随机事件「手速狂潮」（§6.5）能量倍率再乘一次 —— 三档倍率都必须计入，否则合法上报会被误判为篡改。
  if (
    !isLevel &&
    isInt(p.hits) &&
    isInt(p.myEnergy) &&
    p.myEnergy > p.hits * (HIT_ENERGY + COMBO_BONUS_MAX) * PERFECT_MULTIPLIER * EVENT_MAX_ENERGY_SCALE
  ) {
    errors.push('myEnergy 超过理论上限');
  }

  // 普通对战位移必须与双方能量差一致；闯关只使用单边百分比进度。
  if (!isLevel && isInt(p.myEnergy) && isInt(p.oppEnergy)) {
    const expectedPx = clampPx((p.myEnergy - p.oppEnergy) * DISPLACEMENT_FACTOR);
    if (p.displacementPx !== expectedPx) errors.push('位移与能量不一致');
  }

  // 轮次一致性（§2.2 目标为颜色序列）：
  //   每轮必然以「走完序列 / 点错 / 超时 / 硬上限截断」之一结束，且：
  //     · 一轮最多贡献「该轮段数」次命中（上界）；
  //     · 未以失误/空轮结束的轮次（走完序列或截断）至少贡献 1 次命中（下界）。
  //   注意：下界**不能**写成「走完的轮数 × N」——硬上限截断的轮次不足 N 段，会把合法上报误判为篡改。
  //   闯关模式的段数随「关卡 + 局内轮次」变化 ⇒ 上界用 levels.maxSeqCapFor(level, rounds) 重算
  //   （客户端**不上报段数计划**，减少协议面与伪造面）。
  if (isInt(p.rounds) && isInt(p.hits) && isInt(p.misses) && isInt(p.timeouts)) {
    const clean = p.rounds - p.misses - p.timeouts; // 非「失误/空轮」结束的轮次
    const hitsMax =
      isLevel && validLevel(p.level) ? levels.maxSeqCapFor(p.level, p.rounds) : p.rounds * SEQUENCE_LENGTH;
    if (clean < 0) errors.push('rounds 小于失误与空轮之和，口径不一致');
    else if (p.hits < clean || p.hits > hitsMax) errors.push('hits 与轮次/序列长度不一致');
  }

  // 闯关只按单边 0–100% 能量校验胜负；时长必须恰为 45 秒。
  if (isLevel && RESULTS.includes(p.result)) {
    if (p.result === 'draw') errors.push('闯关模式不支持平局');
    if (p.result === 'win') {
      if (p.energyPct !== LEVEL_MODE.energyMax) errors.push('能量未满却判胜');
      if (p.durationMs !== GAME_HARD_LIMIT_MS) errors.push('闯关胜利必须持续 45 秒');
      if (p.livesLeft === 0) errors.push('生命耗尽却判胜');
    }
    if (p.result === 'lose') {
      if (p.energyPct === LEVEL_MODE.energyMax && p.livesLeft !== 0) errors.push('能量已满却判负');
      if (p.durationMs !== GAME_HARD_LIMIT_MS && p.livesLeft !== 0) errors.push('未到 45 秒且生命未耗尽却判负');
    }
    if (p.livesLeft === 0 && p.result !== 'lose') errors.push('生命耗尽却未判负');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 记账并落库。
 * @param {object} store 见 server/lib/store.js / store-cloud.js
 * @param {string} openid 调用方身份
 * @param {object} payload 对局摘要（core/battle.summary）
 * @param {number} nowMs 当前时间
 * @returns {Promise<object>} 信封
 */
async function recordResult(store, openid, payload, nowMs) {
  const check = validate(payload);
  if (!check.ok) {
    return fail(CODES.BAD_REQUEST, check.errors.join('；'));
  }
  if (!openid) {
    return fail(CODES.BAD_REQUEST, '缺少调用方身份（X-TT-OPENID）');
  }

  const day = dayKey(nowMs);
  const isWin = payload.result === 'win';
  const mode = modeOf(payload);
  const isLevel = mode === 'level';

  // 档案与当日计数器：先读旧值（计数器读不到时补空默认值）
  const prevProfile = (await store.getProfile(openid)) || {
    openid,
    nickname: '',
    wins: 0,
    matches: 0,
    exp: 0,
    coins: 0,
    createdAt: nowMs,
  };
  const prevCounter = (await store.countersOf(openid, day)) || emptyCounter();

  // §4.6 局外成长：奖励由对局摘要推导（客户端不可上报奖励数字），服务端另做单局 + 每日封顶（§6.6）
  const award = awardWithDailyCaps(payload, prevCounter);
  let profile = applyAward(prevProfile, award, payload.result, nowMs);

  // §4.8 闯关进度：只在**过关**时推进 `levels.max`（服务端权威；客户端本地乐观 + 回执覆盖）
  if (isLevel && isWin && validLevel(payload.level)) {
    profile = { ...profile, levels: levels.withClearedLevel(profile.levels, payload.level) };
  }
  const levelsProgress = levels.normalizeLevels(profile.levels);

  // §4.7 每日任务：进度累计进当日计数器（与广告频次共享同一 openid:day 文档）
  const taskState = applyMatch(stateFromCounter(prevCounter, day), payload);

  const firstWinToday = isWin && !prevCounter.firstWinUsed;
  const counter = {
    ...prevCounter,
    match: prevCounter.match + 1,
    win: prevCounter.win + (isWin ? 1 : 0),
    firstWinUsed: prevCounter.firstWinUsed || isWin,
    lastMatchAt: nowMs,
    expEarned: Math.max(0, Math.floor(prevCounter.expEarned || 0)) + award.exp, // 当日对局产出，供每日封顶
    coinsEarned: Math.max(0, Math.floor(prevCounter.coinsEarned || 0)) + award.coins,
    ...counterFields(taskState),
  };

  await store.saveProfile(profile);
  await store.saveCounters(openid, day, counter);
  await store.addResult({
    openid,
    day,
    mode, // 'classic' | 'level'（§4.8，对局归类口径 §5.4）
    level: validLevel(payload.level) ? payload.level : null, // 闯关关卡号
    result: payload.result,
    difficulty: payload.difficulty,
    challengeMode: payload.challengeMode === true, // 每日挑战局单独归类（§4.4 已下线，仅历史兼容）
    durationMs: payload.durationMs,
    rounds: payload.rounds,
    hits: payload.hits,
    perfectHits: isInt(payload.perfectHits) ? payload.perfectHits : 0, // 完美判定段数（§6.2）
    eventsFired: isInt(payload.eventsFired) ? payload.eventsFired : 0, // 随机事件触发次数（§6.5）
    misses: payload.misses,
    timeouts: payload.timeouts,
    bestCombo: payload.bestCombo,
    accuracy: payload.accuracy,
    ...(isLevel
      ? { energyPct: payload.energyPct }
      : {
          myEnergy: payload.myEnergy,
          oppEnergy: payload.oppEnergy,
          netEnergy: payload.netEnergy,
          displacementPx: payload.displacementPx,
        }),
    awardExp: award.exp, // 本局实发经验 / 金币（§4.6，已计入每日封顶后的结果）
    awardCoins: award.coins,
    createdAt: nowMs,
  });

  return ok({
    wins: profile.wins,
    matches: profile.matches,
    firstWinToday,
    rewardMultiplier: firstWinToday ? 3 : 1, // 每日首胜三倍（§5.1）
    award, // 本局实发奖励（§4.6）
    progress: progressOf(profile), // 权威进度（客户端据此对账，§4.6）
    levels: levelsProgress, // 权威闯关进度 `{ max }`（客户端本地乐观 + 此值覆盖，§4.8）
    tasks: summaryOf(taskState), // 每日任务进度（§4.7）
    daily: {
      match: counter.match,
      win: counter.win,
      rewardDoubleLeft: Math.max(0, MONETIZATION.rewardDoublePerDay - counter.rewardDouble),
      skinUnlockLeft: Math.max(0, MONETIZATION.skinUnlockPerDay - counter.skinUnlock),
    },
  });
}

module.exports = { RESULTS, DURATION_SLACK_MS, dayKey, validate, recordResult };
