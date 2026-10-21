'use strict';

/**
 * 闯关模式服务端校验与记账单测（《项目说明书》§4.8 / §6.7 + §5.4 服务端只做校验）
 *
 * 覆盖：
 *   1) validate 接受合法闯关上报（多关卡）与历史 classic 上报；
 *   2) 拒绝各类篡改：mode / level / livesLeft / 难度入门档 / 位移系数 / 段数上界 / 收官一致性；
 *   3) recordResult 推进 `levels.max`（仅过关推进，权威口径）；
 *   4) playerState 云函数回执携带 `levels`，供换设备恢复进度。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate, recordResult } = require('../server/lib/result.js');
const serverLevels = require('../server/lib/levels.js');
const { createMemoryStore } = require('../server/lib/store.js');
const { resetStore } = require('../server/lib/store-provider.js');
const playerStateFn = require('../server/functions/playerState/index.js');
const {
  DISPLACEMENT_FACTOR,
  DISPLACEMENT_MAX_PX,
  LEVEL_LIVES,
  LEVEL_MODE,
  GAME_HARD_LIMIT_MS,
} = require('../server/lib/constants.js');

const CTX = { headers: { 'x-tt-openid': 'u1' } };

function clampPx(v) {
  return Math.max(-DISPLACEMENT_MAX_PX, Math.min(DISPLACEMENT_MAX_PX, v));
}

/**
 * 构造一份合法闯关上报（默认能量满格过关）。
 */
function levelPayload(level, overrides) {
  const cfg = serverLevels.levelConfig(level, 0);
  const o = Object.assign(
    {
      mode: 'level',
      level,
      result: 'win',
      difficulty: cfg.tier,
      livesLeft: LEVEL_LIVES,
      rounds: 20,
      hits: 20,
      perfectHits: 20,
      misses: 0,
      timeouts: 0,
      bestCombo: 20,
      accuracy: 1,
      energyPct: LEVEL_MODE.energyMax,
      durationMs: GAME_HARD_LIMIT_MS,
    },
    overrides || {}
  );
  return o;
}

/** 构造一份合法闯关失败上报（能量未满，45 秒到时）。 */
function levelLosePayload(level, overrides) {
  return levelPayload(
    level,
    Object.assign({ result: 'lose', energyPct: 40, durationMs: GAME_HARD_LIMIT_MS }, overrides || {})
  );
}

/* ── 1. 合法上报 ───────────────────────────────────────────────── */

test('validate：合法闯关上报通过（L1 / L25 / L50 / L75 / L100）', () => {
  [1, 25, 50, 75, 100].forEach((level) => {
    const p = levelPayload(level);
    const r = validate(p);
    assert.equal(r.ok, true, `L${level} 应通过：${r.errors.join('；')}`);
    assert.equal(p.energyPct, 100, '满能量即过关');
  });
  // 失败上报（时限内未充满）同样合法
  const lose = levelLosePayload(40);
  assert.equal(validate(lose).ok, true, validate(lose).errors.join('；'));
  assert.equal(lose.energyPct, 40);
});

test('validate：历史 classic 上报（不带 mode）仍按普通对战口径通过', () => {
  // 普通对战口径：位移系数 220/160，段数上界 rounds × 3
  const p = {
    result: 'win',
    difficulty: 'normal',
    rounds: 8,
    hits: 20,
    perfectHits: 12,
    misses: 0,
    timeouts: 0,
    bestCombo: 12,
    myEnergy: 200,
    oppEnergy: 0,
    durationMs: 25000,
  };
  p.displacementPx = clampPx((p.myEnergy - p.oppEnergy) * DISPLACEMENT_FACTOR);
  p.netEnergy = p.myEnergy - p.oppEnergy;
  const r = validate(p);
  assert.equal(r.ok, true, r.errors.join('；'));
});

/* ── 2. 篡改拒绝 ───────────────────────────────────────────────── */

test('validate：拒绝 mode / level / livesLeft 非法', () => {
  assert.match(validate(levelPayload(10, { mode: 'sandbox' })).errors.join(), /mode 非法/);
  assert.match(validate(levelPayload(10, { level: 0 })).errors.join(), /level 非法/);
  assert.match(validate(levelPayload(10, { level: 101 })).errors.join(), /level 非法/);
  assert.match(validate(levelPayload(10, { level: 3.5 })).errors.join(), /level 非法/);
  assert.match(validate(levelPayload(10, { livesLeft: -1 })).errors.join(), /livesLeft 非法/);
  assert.match(validate(levelPayload(10, { livesLeft: LEVEL_LIVES + 1 })).errors.join(), /livesLeft 非法/);
});

test('validate：拒绝难度与关卡入门档不一致（防伪造档位）', () => {
  // L1 入门档是 easy；报 hard 应被拒
  const p = levelPayload(1, { difficulty: 'hard' });
  assert.match(validate(p).errors.join(), /difficulty 与关卡入门档不一致/);
  // 与真实入门档一致则通过
  assert.equal(validate(levelPayload(1)).ok, true);
  assert.equal(serverLevels.levelConfig(1, 0).tier, 'easy');
});

test('validate：闯关拒绝非法百分比与对战方字段', () => {
  assert.match(validate(levelPayload(60, { energyPct: 101 })).errors.join(), /energyPct 非法/);
  assert.match(validate(levelPayload(60, { myEnergy: 100 })).errors.join(), /闯关摘要包含对战字段/);
  assert.match(validate(levelPayload(60, { oppEnergy: 0 })).errors.join(), /闯关摘要包含对战字段/);
  assert.match(validate(levelPayload(60, { displacementPx: 220 })).errors.join(), /闯关摘要包含对战字段/);
  assert.match(validate(levelPayload(60, { durationMs: 44999 })).errors.join(), /闯关时长必须为 45 秒/);
  assert.match(
    validate(levelPayload(60, { result: 'lose', livesLeft: 1, energyPct: 40, durationMs: 44999 })).errors.join(),
    /闯关时长必须为 45 秒/
  );
});

test('validate：拒绝超过「关卡 + 轮次」派生的段数上界', () => {
  const level = 1;
  const rounds = 6;
  const cap = serverLevels.maxSeqCapFor(level, rounds);
  assert.equal(serverLevels.maxSeqCapFor(level, rounds), cap);
  const valid = { result: 'lose', energyPct: 30, livesLeft: 2, rounds, hits: cap, perfectHits: cap, bestCombo: cap };
  // 上界内合法
  assert.equal(validate(levelPayload(level, valid)).ok, true);
  // 越界被拒
  const bad = levelPayload(level, {
    ...valid,
    hits: cap + 1,
    perfectHits: cap + 1,
    bestCombo: cap + 1,
  });
  assert.match(validate(bad).errors.join(), /hits 与轮次\/序列长度不一致/);
  // 同一份 hits 在 classic 口径下反而合法（证明上界确实按关卡重算，而非沿用 SEQUENCE_LENGTH）
  assert.equal(rounds * 3 > cap, true, 'L1 前 6 轮的段数上界应低于 3 段/轮的普通口径');
});

test('validate：闯关收官接受 45 秒结果或生命耗尽的提前失败', () => {
  assert.match(validate(levelPayload(30, { livesLeft: 0, result: 'win' })).errors.join(), /机会耗尽却判胜/);
  assert.match(validate(levelPayload(30, { result: 'win', energyPct: 99 })).errors.join(), /能量未满却判胜/);
  assert.match(validate(levelPayload(30, { result: 'lose', energyPct: 100 })).errors.join(), /能量已满却判负/);
  assert.match(validate(levelPayload(30, { result: 'draw' })).errors.join(), /闯关模式不支持平局/);
  const lifeOut = levelPayload(30, { result: 'lose', livesLeft: 0, energyPct: 40, durationMs: 12000 });
  assert.equal(validate(lifeOut).ok, true, validate(lifeOut).errors.join('；'));
  const timedLose = levelPayload(30, { result: 'lose', livesLeft: 2, energyPct: 40 });
  assert.equal(validate(timedLose).ok, true, validate(timedLose).errors.join('；'));
});

/* ── 3. recordResult：权威进度 ─────────────────────────────────── */

test('recordResult：仅「过关」推进 levels.max，且不可回退（权威口径）', async () => {
  const store = createMemoryStore();
  const now = Date.now();

  const r1 = await recordResult(store, 'u1', levelPayload(5), now);
  assert.equal(r1.code, 0, r1.msg);
  assert.equal(r1.data.levels.max, 5, '过关应推进到该关');

  // 低关卡过关不回退
  const r2 = await recordResult(store, 'u1', levelPayload(3), now);
  assert.equal(r2.data.levels.max, 5);

  // 失败不推进
  const r3 = await recordResult(store, 'u1', levelLosePayload(9), now);
  assert.equal(r3.code, 0, r3.msg);
  assert.equal(r3.data.levels.max, 5);

  // 更高关卡过关继续推进
  const r4 = await recordResult(store, 'u1', levelPayload(9), now);
  assert.equal(r4.data.levels.max, 9);

  // 档案里的 levels 与回执一致（同一文档持久化）
  const profile = await store.getProfile('u1');
  assert.equal(profile.levels.max, 9);
});

test('recordResult：非法闯关上报被拒（不写进度、不发奖）', async () => {
  const store = createMemoryStore();
  const now = Date.now();
  const bad = levelPayload(12, { energyPct: 99, result: 'win' });
  const res = await recordResult(store, 'u1', bad, now);
  assert.notEqual(res.code, 0);
  assert.match(res.msg, /能量未满却判胜/);
  const profile = await store.getProfile('u1');
  assert.equal(profile, null, '被拒的上报不应落库');
});

/* ── 4. playerState 回执携带 levels ────────────────────────────── */

test('playerState 云函数：回执携带权威成长和 levels（换设备恢复进度）', async () => {
  const store = createMemoryStore();
  resetStore(store);
  const now = Date.now();

  // 未玩过：levels.max = 0
  let res = await playerStateFn({}, CTX);
  assert.equal(res.code, 0, res.msg);
  assert.deepEqual(res.data.levels, { max: 0 });

  await recordResult(store, 'u1', levelPayload(17), now);
  await recordResult(store, 'u1', levelLosePayload(30), now);

  res = await playerStateFn({}, CTX);
  assert.deepEqual(res.data.levels, { max: 17 }, '服务端应返回权威关卡进度');
  // classic 玩法上报不影响 levels
  const classic = {
    result: 'win',
    difficulty: 'normal',
    rounds: 8,
    hits: 20,
    perfectHits: 12,
    misses: 0,
    timeouts: 0,
    bestCombo: 12,
    myEnergy: 200,
    oppEnergy: 0,
    durationMs: 25000,
  };
  classic.displacementPx = clampPx(200 * DISPLACEMENT_FACTOR);
  classic.netEnergy = 200;
  await recordResult(store, 'u1', classic, now);
  res = await playerStateFn({}, CTX);
  assert.deepEqual(res.data.levels, { max: 17 });
});
