'use strict';

/**
 * 局外成长单测（《项目说明书》§4.6 + §6.6）
 *
 * 覆盖：
 *   1) 等级曲线单调、阈值正确、满级封顶；
 *   2) 段位映射边界与单调（只升不降）；
 *   3) 单局奖励公式 + 单局 / 每日封顶（防刷）；
 *   4) **两端等价**：客户端 core 与服务端 lib 用同一份镜像参数，同输入必须同输出；
 *   5) 端到端记账：recordResult 落库成长与权威进度。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const progression = require('../minigame/src/core/progression.js');
const serverProgression = require('../server/lib/progression.js');
const { recordResult, dayKey } = require('../server/lib/result.js');
const { createMemoryStore } = require('../server/lib/store.js');
const { utc8DayKey } = require('../minigame/src/core/rng.js');
const {
  PROGRESSION,
  DISPLACEMENT_FACTOR,
  DISPLACEMENT_MAX_PX,
} = require('../minigame/src/config/config.js');

/* ── 工具 ────────────────────────────────────────────────────────── */

function clampPx(v) {
  return Math.max(-DISPLACEMENT_MAX_PX, Math.min(DISPLACEMENT_MAX_PX, v));
}

/**
 * 构造一份能通过服务端 validate 的合法对局摘要（口径同 core/battle.summary）。
 * 默认值按**重标定后**的普通档量级取（越线阈值 80 → 160 后单局命中段数近似翻倍）：
 * 19 轮 / 36 命中 / 27 完美 / 最高连击 16 / 无失误，默认胜利。
 */
function matchSummary(overrides) {
  const o = Object.assign(
    {
      result: 'win',
      difficulty: 'normal',
      rounds: 19,
      hits: 36,
      perfectHits: 27,
      misses: 0,
      timeouts: 0,
      bestCombo: 16,
      myEnergy: 300,
      oppEnergy: 100,
      durationMs: 30000,
    },
    overrides || {}
  );
  o.displacementPx = clampPx((o.myEnergy - o.oppEnergy) * DISPLACEMENT_FACTOR);
  o.netEnergy = o.myEnergy - o.oppEnergy;
  return o;
}

/* ── 1. 等级曲线 ────────────────────────────────────────────────── */

test('等级曲线：阈值正确、单调不减、满级封顶', () => {
  // 阈值：1 级需 100（levelBase + levelStep×0），2 级需 200……
  assert.equal(progression.expToNext(1), PROGRESSION.levelBase);
  assert.equal(progression.expToNext(2), PROGRESSION.levelBase + PROGRESSION.levelStep);
  assert.ok(progression.expToNext(10) > progression.expToNext(9), '所需经验应随等级递增');

  assert.equal(progression.levelFromExp(0).level, 1);
  assert.equal(progression.levelFromExp(99).level, 1);
  assert.equal(progression.levelFromExp(100).level, 2, '攒满 100 经验升到 2 级');
  assert.equal(progression.levelFromExp(300).level, 3, '100 + 200 = 300 → 3 级');
  assert.equal(progression.levelFromExp(600).level, 4, '100 + 200 + 300 = 600 → 4 级');

  // 单调性：经验越多等级越高（抽样）
  let prev = 0;
  for (let exp = 0; exp <= 5000; exp += 137) {
    const lv = progression.levelFromExp(exp).level;
    assert.ok(lv >= prev, `等级应单调不减（exp=${exp}）`);
    prev = lv;
  }

  // 满级封顶
  const huge = progression.levelFromExp(10 ** 7);
  assert.equal(huge.level, PROGRESSION.maxLevel);
  assert.equal(huge.expToNext, 0);
  assert.equal(huge.isMax, true);
});

test('段位映射：边界正确且只升不降', () => {
  const ranks = PROGRESSION.ranks;
  assert.equal(progression.rankFor(1).id, ranks[0].id);
  for (let i = 0; i < ranks.length; i += 1) {
    assert.equal(progression.rankFor(ranks[i].minLevel).id, ranks[i].id, `等级 ${ranks[i].minLevel} 应落在 ${ranks[i].id}`);
  }
  // 单调：等级越高，段位序号越大
  let prevIdx = -1;
  for (let lv = 1; lv <= PROGRESSION.maxLevel; lv += 1) {
    const idx = ranks.findIndex((r) => r.id === progression.rankFor(lv).id);
    assert.ok(idx >= prevIdx, '段位不应回落');
    prevIdx = idx;
  }
});

/* ── 2. 单局奖励与封顶 ──────────────────────────────────────────── */

test('单局奖励：结果基础 + 命中 / 完美折算，并施加单局封顶', () => {
  const win = progression.awardFor(matchSummary({ hits: 25, perfectHits: 8 }));
  assert.equal(win.exp, 20 + 25 * 1 + 8 * 2, '胜利：20 + 命中 25 + 完美 16 = 61');
  assert.equal(win.coins, 30 + 8 * 2, '胜利：30 + 完美 16 = 46');

  // 失败 / 平局：仅基础 + 命中折算（完美为 0，金币只有结果基础）；期望值按默认量级符号化，
  // 避免重标定（命中段数 25 → 36）后硬编码数字漂移。
  const defaultHits = matchSummary({}).hits;
  const lose = progression.awardFor(matchSummary({ result: 'lose', perfectHits: 0 }));
  assert.equal(lose.exp, PROGRESSION.reward.expByResult.lose + defaultHits * PROGRESSION.reward.expPerHit);
  assert.equal(lose.coins, PROGRESSION.reward.coinsByResult.lose);

  const draw = progression.awardFor(matchSummary({ result: 'draw', perfectHits: 0 }));
  assert.equal(draw.exp, PROGRESSION.reward.expByResult.draw + defaultHits * PROGRESSION.reward.expPerHit);
  assert.equal(draw.coins, PROGRESSION.reward.coinsByResult.draw);

  // 单局封顶：经验随命中增长（封顶 matchExpCap）；金币随完美段数增长（封顶 matchCoinCap）
  const gamedExp = progression.awardFor(matchSummary({ hits: 999, perfectHits: 0 }));
  assert.equal(gamedExp.exp, PROGRESSION.reward.matchExpCap);
  const gamedCoin = progression.awardFor(matchSummary({ hits: 25, perfectHits: 200 }));
  assert.equal(gamedCoin.coins, PROGRESSION.reward.matchCoinCap);

  // 非法 / 负数输入被夹到非负
  const dirty = progression.awardFor({ result: 'weird', hits: -5, perfectHits: -1 });
  assert.equal(dirty.exp, PROGRESSION.reward.expByResult.lose);
  assert.equal(dirty.coins, PROGRESSION.reward.coinsByResult.lose);
});

test('applyAward：累计经验 / 金币并重算等级 / 段位，累计场次与胜场', () => {
  let p = progression.emptyProgress();
  assert.equal(p.level, 1);
  const award = progression.awardFor(matchSummary({}));
  p = progression.applyAward(p, award, 'win');
  assert.equal(p.exp, award.exp);
  assert.equal(p.coins, award.coins);
  assert.equal(p.matches, 1);
  assert.equal(p.wins, 1);
  assert.equal(p.level, progression.levelFromExp(award.exp).level, '等级由累计经验推导');
  p = progression.applyAward(p, award, 'win');
  assert.equal(p.wins, 2, '胜场应继续累计');
  assert.equal(p.exp, award.exp * 2);
});

test('normalizeProgress：脏数据收敛成合法进度并重算等级 / 段位', () => {
  const p = progression.normalizeProgress({ exp: '250', coins: -3, matches: null, wins: '2' });
  assert.equal(p.exp, 250);
  assert.equal(p.coins, 0, '负金币夹到 0');
  assert.equal(p.matches, 0);
  assert.equal(p.wins, 2);
  assert.equal(p.level, 2);
  assert.equal(p.rankId, progression.rankFor(2).id);
  const empty = progression.normalizeProgress(undefined);
  assert.deepEqual(empty, progression.emptyProgress());
});

/* ── 3. 两端等价（客户端 core ↔ 服务端 lib） ────────────────────── */

test('两端等价：奖励 / 等级 / 段位公式一致（同一份镜像参数）', () => {
  const samples = [];
  for (const result of ['win', 'draw', 'lose', 'unknown']) {
    for (const hits of [0, 3, 17, 25, 60]) {
      for (const perfects of [0, 2, 8, 40]) samples.push({ result, hits, perfectHits: perfects });
    }
  }
  for (const s of samples) {
    assert.deepEqual(progression.awardFor(s), serverProgression.awardFor(s), `奖励不一致：${JSON.stringify(s)}`);
  }
  for (const exp of [0, 99, 100, 300, 599, 600, 5000, 999999]) {
    assert.equal(progression.levelFromExp(exp).level, serverProgression.levelFromExp(exp).level, `等级不一致：exp=${exp}`);
  }
  for (let lv = 1; lv <= PROGRESSION.maxLevel + 2; lv += 1) {
    assert.equal(progression.rankFor(lv).id, serverProgression.rankFor(lv).id, `段位不一致：lv=${lv}`);
  }
});

test('两端等价：UTC+8 自然日口径一致（含跨 UTC 零点）', () => {
  const samples = [
    Date.UTC(2026, 9, 20, 0, 0, 0), // UTC 00:00 → UTC+8 已是 08:00 同日
    Date.UTC(2026, 9, 20, 15, 59, 59), // UTC 15:59 → UTC+8 23:59 同日
    Date.UTC(2026, 9, 20, 16, 0, 0), // UTC 16:00 → UTC+8 次日 00:00
    Date.now(),
  ];
  for (const ms of samples) {
    assert.equal(utc8DayKey(ms), dayKey(ms), `dayKey 口径不一致：${new Date(ms).toISOString()}`);
  }
  // 跨日边界必须落到不同日期
  assert.notEqual(utc8DayKey(Date.UTC(2026, 9, 20, 15, 59, 59)), utc8DayKey(Date.UTC(2026, 9, 20, 16, 0, 0)));
});

/* ── 4. 端到端记账 ──────────────────────────────────────────────── */

test('recordResult：落库成长、每日封顶生效、回执仅含权威进度', async () => {
  const store = createMemoryStore();
  const now = Date.now();
  const perMatchExp = progression.awardFor(matchSummary({})).exp; // 单局实发经验（未触每日封顶前）
  const dailyCap = PROGRESSION.reward.dailyExpCap;

  const first = await recordResult(store, 'u1', matchSummary({}), now);
  assert.equal(first.code, 0);
  assert.equal(first.data.award.exp, perMatchExp);
  assert.equal(first.data.progress.exp, perMatchExp);
  assert.equal(first.data.progress.wins, 1);
  assert.equal(first.data.progress.level, progression.levelFromExp(perMatchExp).level);
  assert.equal(Object.hasOwn(first.data, 'tasks'), false, '回执不再包含每日任务状态');

  // 每日经验封顶：连打到额度耗尽 —— 第（partialIdx+1）局被削到剩余额度、其后再打均为 0。
  // 局数由 cap / perMatchExp 推导，重标定后单局经验变化时无需改测试。
  const partialIdx = Math.floor(dailyCap / perMatchExp); // 首个不满额的局（0 基）
  const matches = partialIdx + 2; // 多打 1 局确保额度用尽
  let last = first;
  const awards = [first.data.award.exp];
  for (let i = 1; i < matches; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await recordResult(store, 'u1', matchSummary({}), now);
    awards.push(last.data.award.exp);
  }
  const day = dayKey(now);
  const counter = await store.countersOf('u1', day);
  assert.equal(counter.expEarned, dailyCap, `当日经验产出封顶到 ${dailyCap}`);
  if (dailyCap % perMatchExp === 0) {
    assert.equal(awards[partialIdx - 1], perMatchExp, '额度正好整除时最后一局仍为全额');
  } else {
    assert.equal(awards[partialIdx], dailyCap - partialIdx * perMatchExp, '触顶那一局只发剩余额度');
  }
  assert.equal(awards[partialIdx + 1], 0, '额度用尽后不再产出');
  assert.equal(last.data.progress.exp, dailyCap);
});

test('recordResult：保存计数器时清除历史每日任务字段', async () => {
  const now = Date.now();
  const day = dayKey(now);
  const store = createMemoryStore({
    counters: {
      [`u1:${day}`]: {
        taskProgress: { win2: 1 },
        taskClaimed: { win2: true },
        chestClaimed: true,
      },
    },
  });
  const result = await recordResult(store, 'u1', matchSummary({}), now);
  assert.equal(result.code, 0);

  const counter = await store.countersOf('u1', day);
  assert.equal(Object.hasOwn(counter, 'taskProgress'), false);
  assert.equal(Object.hasOwn(counter, 'taskClaimed'), false);
  assert.equal(Object.hasOwn(counter, 'chestClaimed'), false);
});

test('recordResult：非法上报被拒（篡改位移）', async () => {
  const store = createMemoryStore();
  const bad = matchSummary({});
  bad.displacementPx = bad.displacementPx + 7; // 与能量不符
  const res = await recordResult(store, 'u1', bad, Date.now());
  assert.notEqual(res.code, 0);
  assert.match(res.msg, /位移与能量不一致/);
});
