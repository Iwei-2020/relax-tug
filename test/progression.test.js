'use strict';

/**
 * 局外成长与每日任务单测（《项目说明书》§4.6 / §4.7 + §6.6）
 *
 * 覆盖：
 *   1) 等级曲线单调、阈值正确、满级封顶；
 *   2) 段位映射边界与单调（只升不降）；
 *   3) 单局奖励公式 + 单局 / 每日封顶（防刷）；
 *   4) 每日任务三种累计口径（count / sum / max）；
 *   5) 领奖幂等、跨日刷新（不结转）；
 *   6) **两端等价**：客户端 core 与服务端 lib 用同一份镜像参数，同输入必须同输出；
 *   7) 端到端记账：recordResult 落库成长与任务进度，dailyTasks 云函数领奖口径。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const progression = require('../minigame/src/core/progression.js');
const clientTasks = require('../minigame/src/core/tasks.js');
const serverProgression = require('../server/lib/progression.js');
const serverTasks = require('../server/lib/tasks.js');
const { recordResult, dayKey } = require('../server/lib/result.js');
const { createMemoryStore } = require('../server/lib/store.js');
const { resetStore } = require('../server/lib/store-provider.js');
const dailyTasksFn = require('../server/functions/dailyTasks/index.js');
const { utc8DayKey } = require('../minigame/src/core/rng.js');
const {
  PROGRESSION,
  DAILY_TASKS,
  DISPLACEMENT_FACTOR,
  DISPLACEMENT_MAX_PX,
} = require('../minigame/src/config/config.js');

/* ── 工具 ────────────────────────────────────────────────────────── */

function clampPx(v) {
  return Math.max(-DISPLACEMENT_MAX_PX, Math.min(DISPLACEMENT_MAX_PX, v));
}

/**
 * 构造一份能通过服务端 validate 的合法对局摘要（口径同 core/battle.summary）。
 * 默认值：10 轮 / 25 命中 / 8 完美 / 无失误，默认胜利。
 */
function matchSummary(overrides) {
  const o = Object.assign(
    {
      result: 'win',
      difficulty: 'normal',
      rounds: 10,
      hits: 25,
      perfectHits: 8,
      misses: 0,
      timeouts: 0,
      bestCombo: 8,
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

const CTX = { headers: { 'x-tt-openid': 'u1' } };

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

  const lose = progression.awardFor(matchSummary({ result: 'lose', perfectHits: 0 }));
  assert.equal(lose.exp, 8 + 25);
  assert.equal(lose.coins, 10);

  const draw = progression.awardFor(matchSummary({ result: 'draw', perfectHits: 0 }));
  assert.equal(draw.exp, 12 + 25);
  assert.equal(draw.coins, 15);

  // 单局封顶：经验随命中增长（封顶 90）；金币随完美段数增长（封顶 120）
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
  assert.equal(p.level, 1, '61 经验还不到 2 级');
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

/* ── 3. 每日任务累计口径 ────────────────────────────────────────── */

test('每日任务累计：count（每局 0/1）/ sum（累加）/ max（取最大）', () => {
  let st = clientTasks.emptyTasks('2026-10-20');
  st = clientTasks.applyMatch(st, matchSummary({}));
  st = clientTasks.applyMatch(st, matchSummary({}));
  assert.equal(st.progress.play3, 2, 'matches 计数 +1');
  assert.equal(st.progress.win2, 2, '两局胜利 → wins 计数 2');
  assert.equal(st.progress.perfect10, 16, 'perfectHits 累加 8 + 8');
  assert.equal(st.progress.combo8, 8, 'bestCombo 取最大（非累加）');

  // 失败局：wins 不增，但 matches 仍 +1
  const before = st;
  st = clientTasks.applyMatch(st, matchSummary({ result: 'lose' }));
  assert.equal(st.progress.win2, 2);
  assert.equal(st.progress.play3, 3);
  assert.equal(before.progress.play3, 2, '不可变性：原状态不被修改');
});

test('每日任务：达成与可领判定、领奖幂等、宝箱仅在全部达成后可领', () => {
  const day = '2026-10-20';
  const st = clientTasks.emptyTasks(day);

  // 初始：全部未达成
  assert.equal(clientTasks.taskStates(st).every((t) => !t.done && !t.claimable), true);
  assert.equal(clientTasks.claimableIds(st).length, 0);
  assert.equal(clientTasks.chestState(st).claimable, false, '未全部达成不能领宝箱');

  // 未达成时领取 → not-done，且状态不变
  const r0 = clientTasks.claim(st, 'win2');
  assert.equal(r0.ok, false);
  assert.equal(r0.reason, 'not-done');
  assert.equal(r0.coins, 0);

  // 攒够：3 胜 → 全部达成
  let s = st;
  s = clientTasks.applyMatch(s, matchSummary({}));
  s = clientTasks.applyMatch(s, matchSummary({}));
  s = clientTasks.applyMatch(s, matchSummary({}));
  assert.equal(clientTasks.allDone(s), true);
  assert.equal(clientTasks.chestState(s).claimable, true);

  // 领取 win2 → 发 60
  const r1 = clientTasks.claim(s, 'win2');
  assert.equal(r1.ok, true);
  assert.equal(r1.coins, DAILY_TASKS.pool.find((t) => t.id === 'win2').coins);
  // 重复领取 → 幂等
  const r2 = clientTasks.claim(r1.state, 'win2');
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'already-claimed');
  assert.equal(r2.coins, 0);
  // 未知任务
  assert.equal(clientTasks.claim(r1.state, 'nope').reason, 'unknown-task');

  // 宝箱：领一次 → 再领幂等
  const c1 = clientTasks.claimChest(r1.state);
  assert.equal(c1.ok, true);
  assert.equal(c1.coins, DAILY_TASKS.chestCoins);
  const c2 = clientTasks.claimChest(c1.state);
  assert.equal(c2.ok, false);
  assert.equal(c2.reason, 'already-claimed');
  assert.equal(clientTasks.chestState(c1.state).claimable, false);
});

test('每日任务：跨日归零重开（不结转），同日保留', () => {
  let st = clientTasks.emptyTasks('2026-10-20');
  st = clientTasks.applyMatch(st, matchSummary({}));
  const kept = clientTasks.rollover(st, '2026-10-20');
  assert.equal(kept.progress.win2, 1, '同日不重置');

  const reset = clientTasks.rollover(st, '2026-10-21');
  assert.equal(reset.day, '2026-10-21');
  assert.deepEqual(reset.progress, {}, '跨日进度归零');
  assert.equal(reset.chestClaimed, false);

  // normalizeTasks：脏数据 + 跨日 → 合法空状态
  const norm = clientTasks.normalizeTasks({ day: '2026-10-20', progress: { win2: 5 }, claimed: { win2: true } }, '2026-10-21');
  assert.deepEqual(norm.progress, {});
  assert.equal(norm.claimed.win2, undefined);
});

/* ── 4. 两端等价（客户端 core ↔ 服务端 lib） ────────────────────── */

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

test('两端等价：每日任务累计与领奖逻辑一致', () => {
  const summaries = [
    matchSummary({}),
    matchSummary({ result: 'lose', perfectHits: 0 }),
    matchSummary({ result: 'win', perfectHits: 8 }),
    matchSummary({ result: 'draw', perfectHits: 3 }),
  ];
  let client = clientTasks.emptyTasks('d');
  let server = serverTasks.stateFromCounter(null, 'd');
  for (const s of summaries) {
    client = clientTasks.applyMatch(client, s);
    server = serverTasks.applyMatch(server, s);
  }
  assert.deepEqual(client.progress, server.progress, '累计口径一致');
  assert.deepEqual(clientTasks.taskStates(client), serverTasks.taskStates(server), '任务状态一致');

  for (const id of ['play3', 'win2', 'perfect10', 'combo8', 'nope']) {
    const a = clientTasks.claim(client, id);
    const b = serverTasks.claim(server, id);
    assert.equal(a.ok, b.ok, `领奖结果一致：${id}`);
    assert.equal(a.coins, b.coins);
    assert.equal(a.reason, b.reason);
  }
  // 宝箱一致性
  assert.deepEqual(clientTasks.chestState(client), serverTasks.chestState(server));
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

/* ── 5. 端到端记账 ──────────────────────────────────────────────── */

test('recordResult：落库成长、每日封顶生效、回执含权威进度与任务', async () => {
  const store = createMemoryStore();
  const now = Date.now();

  const first = await recordResult(store, 'u1', matchSummary({}), now);
  assert.equal(first.code, 0);
  assert.equal(first.data.award.exp, 61);
  assert.equal(first.data.progress.exp, 61);
  assert.equal(first.data.progress.wins, 1);
  assert.equal(first.data.progress.level, 1);
  assert.equal(first.data.tasks.tasks.find((t) => t.id === 'win2').progress, 1);

  // 每日经验封顶：连打 15 局，第 14 局被削到剩余额度、第 15 局为 0
  let last = first;
  const awards = [first.data.award.exp];
  for (let i = 0; i < 14; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await recordResult(store, 'u1', matchSummary({}), now);
    awards.push(last.data.award.exp);
  }
  const day = dayKey(now);
  const counter = await store.countersOf('u1', day);
  assert.equal(counter.expEarned, PROGRESSION.reward.dailyExpCap, '当日经验产出封顶到 800');
  assert.equal(awards[13], PROGRESSION.reward.dailyExpCap - 13 * 61, '第 14 局只发剩余额度');
  assert.equal(awards[14], 0, '额度用尽后不再产出');
  assert.equal(last.data.progress.exp, PROGRESSION.reward.dailyExpCap);
});

test('recordResult：非法上报被拒（篡改位移）', async () => {
  const store = createMemoryStore();
  const bad = matchSummary({});
  bad.displacementPx = bad.displacementPx + 7; // 与能量不符
  const res = await recordResult(store, 'u1', bad, Date.now());
  assert.notEqual(res.code, 0);
  assert.match(res.msg, /位移与能量不一致/);
});

test('dailyTasks 云函数：进度不足 → 达成可领 → 重复领取幂等 → 宝箱', async () => {
  const store = createMemoryStore();
  resetStore(store);
  const now = Date.now();

  // 初始：全不可领
  let res = await dailyTasksFn({ action: 'state' }, CTX);
  assert.equal(res.code, 0);
  assert.equal(res.data.tasks.tasks.every((t) => !t.claimable), true);
  assert.equal(res.data.tasks.chest.claimable, false);

  // 两局胜利
  await recordResult(store, 'u1', matchSummary({}), now);
  await recordResult(store, 'u1', matchSummary({}), now);

  res = await dailyTasksFn({ action: 'state' }, CTX);
  const win2 = res.data.tasks.tasks.find((t) => t.id === 'win2');
  assert.equal(win2.claimable, true, '胜 2 局后可领');
  assert.equal(res.data.tasks.tasks.find((t) => t.id === 'play3').claimable, false, '还差 1 局');
  assert.equal(res.data.progress.coins, 92, '两局胜利产出 46×2');

  // 领取
  res = await dailyTasksFn({ action: 'claim', taskId: 'win2' }, CTX);
  assert.equal(res.data.granted, 60);
  assert.equal(res.data.progress.coins, 92 + 60);

  // 重复领取：幂等，不发奖
  res = await dailyTasksFn({ action: 'claim', taskId: 'win2' }, CTX);
  assert.equal(res.data.granted, 0);
  assert.equal(res.data.reason, 'already-claimed');
  assert.equal(res.data.progress.coins, 92 + 60);

  // 未达成时领取 → not-done（此时 play3 只到 2/3）
  res = await dailyTasksFn({ action: 'claim', taskId: 'play3' }, CTX);
  assert.equal(res.data.granted, 0);
  assert.equal(res.data.reason, 'not-done');

  // 再来一局 → 全部达成 → 领宝箱
  await recordResult(store, 'u1', matchSummary({}), now);
  res = await dailyTasksFn({ action: 'state' }, CTX);
  assert.equal(res.data.tasks.chest.claimable, true);
  res = await dailyTasksFn({ action: 'chest' }, CTX);
  assert.equal(res.data.granted, DAILY_TASKS.chestCoins);
  const afterChest = res.data.progress.coins;
  res = await dailyTasksFn({ action: 'chest' }, CTX);
  assert.equal(res.data.granted, 0);
  assert.equal(res.data.reason, 'already-claimed');
  assert.equal(res.data.progress.coins, afterChest, '重复领宝箱不发奖');

  // 未知 action / 缺身份
  assert.notEqual((await dailyTasksFn({ action: 'boom' }, CTX)).code, 0);
  assert.notEqual((await dailyTasksFn({ action: 'state' }, {})).code, 0);
});
