'use strict';

/**
 * 闯关模式核心单测（《项目说明书》§4.8 / §6.7）
 *
 * 覆盖：
 *   1) 关键帧锚点（L1 / L35 / L68 / L100）与数值区间；
 *   2) 全枚举单调性（u / seqLen / candidates 对 level 与 roundIndex 单调不减）；
 *   3) 硬约束：`candidates ≥ seqLen` 且 `candidates ∈ CANDIDATE_TIERS`；
 *   4) **两端等价**：客户端 core ↔ 服务端 lib，同输入必须逐字段同输出；
 *   5) 进度模型：normalizeLevels 兜底 / freeLevel / needsAd 边界 / levelSeed 稳定性。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const client = require('../minigame/src/core/levels.js');
const server = require('../server/lib/levels.js');
const rng = require('../minigame/src/core/rng.js');
const {
  LEVEL_MAX,
  LEVEL_LIVES,
  SEQ_LEN_MIN,
  SEQ_LEN_MAX,
  CANDIDATE_TIERS,
  PALETTE_MAX,
} = require('../minigame/src/config/config.js');

/* ── 1. 常量与锚点 ─────────────────────────────────────────────── */

test('常量：关卡上限 / 生命值 / 段数区间 / 候选档位与调色板容量自洽', () => {
  assert.equal(LEVEL_MAX, 100);
  assert.equal(LEVEL_LIVES, 3);
  assert.equal(SEQ_LEN_MIN, 1);
  assert.equal(SEQ_LEN_MAX, 6);
  assert.deepEqual(CANDIDATE_TIERS, [2, 4, 6, 9]);
  // 候选档位不得超过调色板容量（9 色 → 最多 9 格）
  assert.equal(CANDIDATE_TIERS[CANDIDATE_TIERS.length - 1], PALETTE_MAX);
  assert.equal(PALETTE_MAX, 9);
});

test('锚点：keyframeParams 在关键帧上取到该档原值（windowMs / oppHit）', () => {
  const easy = client.keyframeParams(0);
  assert.equal(easy.tier, 'easy');
  assert.equal(easy.windowMs, 1600);
  assert.ok(Math.abs(easy.oppHit - 0.6) < 1e-9);

  const normal = client.keyframeParams(0.34);
  assert.equal(normal.tier, 'normal');
  assert.equal(normal.windowMs, 1400);
  assert.ok(Math.abs(normal.oppHit - 0.7) < 1e-9);

  const hard = client.keyframeParams(0.67);
  assert.equal(hard.tier, 'hard');
  assert.equal(hard.windowMs, 1200);
  assert.ok(Math.abs(hard.oppHit - 0.82) < 1e-9);

  const hell = client.keyframeParams(1);
  assert.equal(hell.tier, 'hell');
  assert.equal(hell.windowMs, 1100);
  assert.ok(Math.abs(hell.oppHit - 0.9) < 1e-9);
  // 陪练弱化：>=1 帧的 oppHit 再乘 oppHitScale（0.35）
  assert.ok(Math.abs(client.widen(hell.oppHit) - 0.315) < 1e-9);
});

test('锚点：levelConfig(L1, 0) 与 levelConfig(L100, 上限轮) 落在地狱 / 简单端的期望值', () => {
  const l1 = client.levelConfig(1, 0);
  assert.equal(l1.level, 1);
  assert.equal(l1.seqLen, 1);
  assert.equal(l1.candidates, 2);
  assert.equal(l1.windowMs, 1600);
  assert.equal(l1.tier, 'easy');
  assert.equal(l1.winNetEnergy, 112);

  const l100 = client.levelConfig(100, 60);
  assert.equal(l100.level, 100);
  assert.equal(l100.seqLen, SEQ_LEN_MAX);
  assert.equal(l100.candidates, 9);
  assert.equal(l100.windowMs, 1100);
  assert.equal(l100.tier, 'hell');
  assert.equal(l100.winNetEnergy, 72);

  // 越线阈值随关卡单调不增，且夹在 sanity 下限之上
  assert.equal(client.winNetEnergyOf(1), 112);
  assert.equal(client.winNetEnergyOf(100), 72);
  assert.ok(client.winNetEnergyOf(50) < client.winNetEnergyOf(1));
  assert.ok(client.winNetEnergyOf(50) > client.winNetEnergyOf(100));
  // 位移系数 = 220 / 阈值
  assert.ok(Math.abs(client.displacementFactorOf(100) - 220 / 72) < 1e-9);
});

/* ── 2. 全枚举：单调性 + 硬约束 ─────────────────────────────────── */

test('全枚举 L1..100 × R0..60：单调不减、单调不增、硬约束恒定成立', () => {
  const rounds = 61;
  let prevU = -1;
  let prevSeq = -1;
  let prevCand = -1;
  let prevWindow = Infinity;
  let prevOppHit = -1;
  for (let l = 1; l <= LEVEL_MAX; l += 1) {
    // 每个关卡内：roundIndex 递增 → 强度递增
    prevU = -1;
    prevSeq = -1;
    prevCand = -1;
    prevWindow = Infinity;
    prevOppHit = -1;
    for (let r = 0; r < rounds; r += 1) {
      const c = client.levelConfig(l, r);
      assert.ok(c.u >= prevU - 1e-12, `u 应随轮次单调不减（L${l} R${r}）`);
      assert.ok(c.seqLen >= prevSeq, `seqLen 应随轮次单调不减（L${l} R${r}）`);
      assert.ok(c.candidates >= prevCand, `candidates 应随轮次单调不减（L${l} R${r}）`);
      assert.ok(c.windowMs <= prevWindow, `windowMs 应随轮次单调不增（L${l} R${r}）`);
      assert.ok(c.oppHit >= prevOppHit - 1e-12, `oppHit 应随轮次单调不减（L${l} R${r}）`);
      // 硬约束：候选 ≥ 段数，且候选只取合法档位
      assert.ok(c.candidates >= c.seqLen, `候选数必须 ≥ 段数（L${l} R${r}）`);
      assert.ok(CANDIDATE_TIERS.indexOf(c.candidates) >= 0, `候选档位非法（L${l} R${r}）`);
      assert.ok(c.seqLen >= SEQ_LEN_MIN && c.seqLen <= SEQ_LEN_MAX, `段数越界（L${l} R${r}）`);
      prevU = c.u;
      prevSeq = c.seqLen;
      prevCand = c.candidates;
      prevWindow = c.windowMs;
      prevOppHit = c.oppHit;
    }
  }
});

test('全枚举：强度 u 随关卡单调不减（同轮次下），且恒在 [0, 1]', () => {
  for (let r = 0; r < 20; r += 1) {
    let prev = -1;
    for (let l = 1; l <= LEVEL_MAX; l += 1) {
      const u = client.levelIntensity(l, r);
      assert.ok(u >= prev - 1e-12, `u 应随关卡单调不减（L${l} R${r}）`);
      assert.ok(u >= 0 && u <= 1, `u 必须落在 [0, 1]（L${l} R${r}）`);
      prev = u;
    }
  }
});

test('关内爬坡：最迟第 roundRamp.rounds 轮爬到本关上限档', () => {
  const { entry, cap } = client.levelBand(50);
  assert.equal(client.levelIntensity(50, 0), entry); // 第 1 轮 = 入门档
  assert.ok(Math.abs(client.levelIntensity(50, 8) - cap) < 1e-12); // 第 8 轮 = 上限档
  assert.ok(Math.abs(client.levelIntensity(50, 99) - cap) < 1e-12); // 之后保持上限
});

/* ── 3. 两端等价（客户端 core ↔ 服务端 lib） ─────────────────────── */

/** 确定性伪随机（LCG），保证用例可复现。 */
function makeLcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('两端等价：levelConfig / 各派生函数对 2000 组输入逐字段相等', () => {
  const rand = makeLcg(0x1e3f5a7b);
  for (let i = 0; i < 2000; i += 1) {
    const level = 1 + Math.floor(rand() * (LEVEL_MAX + 10)) - 5; // 故意含少量越界值
    const roundIndex = Math.floor(rand() * 70);
    assert.deepEqual(
      client.levelConfig(level, roundIndex),
      server.levelConfig(level, roundIndex),
      `levelConfig(${level}, ${roundIndex}) 两端不一致`
    );
    assert.equal(client.clampLevel(level), server.clampLevel(level));
    assert.equal(client.levelIntensity(level, roundIndex), server.levelIntensity(level, roundIndex));
    const u = rand();
    assert.equal(client.seqLenAt(u), server.seqLenAt(u));
    assert.equal(client.candidatesAt(u), server.candidatesAt(u));
    assert.equal(client.winNetEnergyOf(level), server.winNetEnergyOf(level));
    assert.equal(client.displacementFactorOf(level), server.displacementFactorOf(level));
    assert.equal(client.maxSeqLenFor(level, roundIndex), server.maxSeqLenFor(level, roundIndex));
    assert.equal(
      client.maxSeqCapFor(level, roundIndex),
      server.maxSeqCapFor(level, roundIndex),
      `maxSeqCapFor(${level}, ${roundIndex}) 两端不一致`
    );
    assert.equal(client.levelSeed(level), server.levelSeed(level));
  }
});

test('maxSeqCapFor 恒 ≥ rounds（每轮至少 1 段），且 rounds = 0 → 0', () => {
  assert.equal(client.maxSeqCapFor(50, 0), 0);
  for (let rounds = 1; rounds <= 60; rounds += 1) {
    assert.ok(client.maxSeqCapFor(50, rounds) >= rounds);
  }
  // 高关卡段数多 → 上界更高
  assert.ok(client.maxSeqCapFor(100, 20) > client.maxSeqCapFor(1, 20));
});

/* ── 4. 进度模型 ───────────────────────────────────────────────── */

test('normalizeLevels：损坏 / 缺失 → {max:0}，越界夹紧', () => {
  assert.deepEqual(client.normalizeLevels(undefined), { max: 0 });
  assert.deepEqual(client.normalizeLevels(null), { max: 0 });
  assert.deepEqual(client.normalizeLevels({}), { max: 0 });
  assert.deepEqual(client.normalizeLevels({ max: 'x' }), { max: 0 });
  assert.deepEqual(client.normalizeLevels({ max: -3 }), { max: 0 });
  assert.deepEqual(client.normalizeLevels({ max: 3.9 }), { max: 3 });
  assert.deepEqual(client.normalizeLevels({ max: 999 }), { max: LEVEL_MAX });
  assert.deepEqual(client.emptyLevels(), { max: 0 });
  // 两端一致
  const rand = makeLcg(0x2c9d31);
  for (let i = 0; i < 200; i += 1) {
    const raw = i % 3 === 0 ? undefined : { max: Math.floor(rand() * 150) - 20 };
    assert.deepEqual(client.normalizeLevels(raw), server.normalizeLevels(raw));
  }
});

test('freeLevel / needsAd：默认只能挑战「已通关最大关 + 1」，其它关需看广告', () => {
  assert.equal(client.freeLevel({ max: 0 }), 1);
  assert.equal(client.freeLevel({ max: 7 }), 8);
  assert.equal(client.freeLevel({ max: LEVEL_MAX }), null); // 全通 → null

  // 免费关不需广告
  assert.equal(client.needsAd(1, { max: 0 }), false);
  assert.equal(client.needsAd(8, { max: 7 }), false);
  // 其它关需广告（含已通关的关卡 ≠ free）
  assert.equal(client.needsAd(2, { max: 0 }), true);
  assert.equal(client.needsAd(5, { max: 7 }), true);
  // 全通后任意关免费复盘
  assert.equal(client.needsAd(1, { max: LEVEL_MAX }), false);
  assert.equal(client.needsAd(50, { max: LEVEL_MAX }), false);
  // 越界关号夹紧后再判定
  assert.equal(client.needsAd(0, { max: 0 }), false); // 0 → 夹成 1 = free
  assert.equal(client.needsAd(999, { max: 50 }), true); // → 夹成 100 ≠ 51
});

test('withClearedLevel：只在更高时推进 max', () => {
  assert.deepEqual(client.withClearedLevel({ max: 0 }, 3), { max: 3 });
  assert.deepEqual(client.withClearedLevel({ max: 7 }, 3), { max: 7 });
  assert.deepEqual(client.withClearedLevel({ max: 7 }, 8), { max: 8 });
  assert.deepEqual(client.withClearedLevel(undefined, 1), { max: 1 });
});

/* ── 5. levelSeed ──────────────────────────────────────────────── */

test('levelSeed：每关固定、稳定、与 core/rng.hashSeed 同口径', () => {
  assert.equal(client.levelSeed(7), client.levelSeed(7)); // 稳定
  assert.notEqual(client.levelSeed(7), client.levelSeed(8)); // 不同关不同种子
  // 与 rng 的 hashSeed('level:N') 完全一致（内联哈希未走样）
  for (let l = 1; l <= LEVEL_MAX; l += 7) {
    assert.equal(client.levelSeed(l), rng.hashSeed(`level:${l}`));
    assert.equal(server.levelSeed(l), rng.hashSeed(`level:${l}`));
  }
  // 越界夹紧：0 与 101 分别等价于 1 与 100
  assert.equal(client.levelSeed(0), client.levelSeed(1));
  assert.equal(client.levelSeed(101), client.levelSeed(100));
});
