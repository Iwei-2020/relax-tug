'use strict';

/**
 * 段位胜点单测（《项目说明书》§4.6）
 *
 * 覆盖：
 *   1) 胜点增减、晋级/降级边界与新旧档案迁移；
 *   2) **两端等价**：客户端 core 与服务端 lib 使用同一套规则；
 *   3) recordResult 落库段位胜点并保留闯关独立性。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const progression = require('../minigame/src/core/progression.js');
const serverProgression = require('../server/lib/progression.js');
const { recordResult, dayKey } = require('../server/lib/result.js');
const { createMemoryStore } = require('../server/lib/store.js');
const { utc8DayKey } = require('../minigame/src/core/rng.js');
const {
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

/* ── 1. 胜点变化、晋降段与档案迁移 ─────────────────────────────── */

test('胜点规则：胜利 +10、失败 -10、平局不变；闯关不计段位胜点', () => {
  assert.deepEqual(progression.awardFor({ result: 'win' }), { rankPoints: 10 });
  assert.deepEqual(progression.awardFor({ result: 'lose' }), { rankPoints: -10 });
  assert.deepEqual(progression.awardFor({ result: 'draw' }), { rankPoints: 0 });
  assert.deepEqual(progression.awardFor({ mode: 'level', result: 'win' }), { rankPoints: 0 });
});

test('胜点达到100晋级并结转，低于0降级并借入100', () => {
  const promoted = progression.applyRankPoints('silver', 95, 10);
  assert.deepEqual(promoted, { rankId: 'gold', rankPoints: 5 });

  const demoted = progression.applyRankPoints('silver', 5, -10);
  assert.deepEqual(demoted, { rankId: 'bronze', rankPoints: 95 });
  assert.deepEqual(progression.applyRankPoints('bronze', 0, -10), { rankId: 'bronze', rankPoints: 0 });
  assert.deepEqual(progression.applyRankPoints('master', 90, 10), { rankId: 'master', rankPoints: 100 });
});

test('档案迁移：保留旧段位，胜点归零并移除经验/等级/金币', () => {
  const p = progression.normalizeProgress({
    rankId: 'silver',
    exp: 9000,
    level: 12,
    coins: 500,
    wins: 7,
    matches: 10,
  });
  assert.deepEqual(p, { rankId: 'silver', rankPoints: 0, matches: 10, wins: 7 });
  assert.deepEqual(progression.emptyProgress(), { rankId: 'bronze', rankPoints: 0, matches: 0, wins: 0 });
});

test('applyAward：累计胜点、场次与胜场，且只对经典对局改动段位', () => {
  let p = progression.emptyProgress();
  p = progression.applyAward(p, progression.awardFor(matchSummary()), 'win');
  assert.deepEqual(p, { rankId: 'bronze', rankPoints: 10, matches: 1, wins: 1 });
  p = progression.applyAward(p, progression.awardFor(matchSummary({ result: 'lose' })), 'lose');
  assert.deepEqual(p, { rankId: 'bronze', rankPoints: 0, matches: 2, wins: 1 });
  p = progression.applyAward(p, progression.awardFor({ mode: 'level', result: 'win' }), 'win');
  assert.equal(p.rankPoints, 0);
  assert.equal(p.wins, 2);
});

/* ── 2. 两端等价（客户端 core ↔ 服务端 lib） ────────────────────── */

test('两端等价：胜点变化、晋降段与档案归一口径一致', () => {
  for (const mode of ['classic', 'level']) {
    for (const result of ['win', 'lose', 'draw']) {
      const summary = { mode, result };
      assert.deepEqual(progression.awardFor(summary), serverProgression.awardFor(summary));
    }
  }
  for (const [rankId, points, delta] of [
    ['bronze', 0, -10],
    ['bronze', 95, 10],
    ['silver', 95, 10],
    ['silver', 5, -10],
    ['master', 90, 10],
  ]) {
    assert.deepEqual(
      progression.applyRankPoints(rankId, points, delta),
      serverProgression.applyRankPoints(rankId, points, delta)
    );
  }
  assert.deepEqual(
    progression.normalizeProgress({ rankId: 'silver', exp: 700, level: 4 }),
    serverProgression.normalizeProgress({ rankId: 'silver', exp: 700, level: 4 })
  );
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

test('recordResult：胜负更新胜点，闯关胜利不改变段位胜点', async () => {
  const store = createMemoryStore();
  const now = Date.now();
  const first = await recordResult(store, 'u1', matchSummary({}), now);
  assert.equal(first.code, 0);
  assert.equal(first.data.award.rankPoints, 10);
  assert.equal(first.data.progress.rankPoints, 10);
  assert.equal(first.data.progress.wins, 1);
  assert.equal(Object.hasOwn(first.data.progress, 'level'), false);
  assert.equal(Object.hasOwn(first.data.progress, 'exp'), false);

  const loss = await recordResult(store, 'u1', matchSummary({ result: 'lose' }), now);
  assert.equal(loss.data.progress.rankPoints, 0);
  assert.equal(loss.data.progress.wins, 1);

  const levelLose = await recordResult(store, 'u1', {
    mode: 'level',
    level: 1,
    result: 'lose',
    difficulty: 'easy',
    livesLeft: 0,
    rounds: 1,
    hits: 0,
    perfectHits: 0,
    misses: 1,
    timeouts: 0,
    bestCombo: 0,
    energyPct: 0,
    durationMs: 1000,
  }, now);
  assert.equal(levelLose.data.award.rankPoints, 0);
  assert.equal(levelLose.data.progress.rankPoints, 0);
});

test('recordResult：清除旧成长字段并保留已迁移段位', async () => {
  const now = Date.now();
  const day = dayKey(now);
  const store = createMemoryStore({
    profiles: {
      u1: { openid: 'u1', exp: 25, level: 2, coins: 120, rankId: 'silver', wins: 0, matches: 0 },
    },
    counters: {
      [`u1:${day}`]: {
        taskProgress: { win2: 1 },
        taskClaimed: { win2: true },
        chestClaimed: true,
        expEarned: 90,
      },
    },
  });
  const result = await recordResult(store, 'u1', matchSummary({}), now);
  assert.equal(result.code, 0);

  const counter = await store.countersOf('u1', day);
  assert.equal(Object.hasOwn(counter, 'taskProgress'), false);
  assert.equal(Object.hasOwn(counter, 'taskClaimed'), false);
  assert.equal(Object.hasOwn(counter, 'chestClaimed'), false);
  assert.equal(Object.hasOwn(counter, 'expEarned'), false);
  const profile = await store.getProfile('u1');
  assert.equal(profile.rankId, 'silver');
  assert.equal(profile.rankPoints, 10);
  assert.equal(Object.hasOwn(profile, 'exp'), false);
  assert.equal(Object.hasOwn(profile, 'level'), false);
  assert.equal(Object.hasOwn(profile, 'coins'), false);
});

test('recordResult：非法上报被拒（篡改位移）', async () => {
  const store = createMemoryStore();
  const bad = matchSummary({});
  bad.displacementPx = bad.displacementPx + 7; // 与能量不符
  const res = await recordResult(store, 'u1', bad, Date.now());
  assert.notEqual(res.code, 0);
  assert.match(res.msg, /位移与能量不一致/);
});
