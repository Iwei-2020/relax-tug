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

test('锚点：keyframeParams 在关键帧上取到该档输入窗口', () => {
  const easy = client.keyframeParams(0);
  assert.equal(easy.tier, 'easy');
  assert.equal(easy.windowMs, 1600);

  const normal = client.keyframeParams(0.34);
  assert.equal(normal.tier, 'normal');
  assert.equal(normal.windowMs, 1400);

  const hard = client.keyframeParams(0.67);
  assert.equal(hard.tier, 'hard');
  assert.equal(hard.windowMs, 1200);

  const hell = client.keyframeParams(1);
  assert.equal(hell.tier, 'hell');
  assert.equal(hell.windowMs, 1100);
});

test('锚点：levelConfig(L1, 0) 与 levelConfig(L100, 上限轮) 符合关卡曲线', () => {
  const l1 = client.levelConfig(1, 0);
  assert.equal(l1.level, 1);
  assert.equal(l1.seqLen, 1);
  assert.equal(l1.candidates, 2);
  assert.equal(l1.windowMs, 1600);
  assert.equal(l1.tier, 'easy');

  const l100 = client.levelConfig(100, 60);
  assert.equal(l100.level, 100);
  assert.equal(l100.seqLen, SEQ_LEN_MAX);
  assert.equal(l100.candidates, 9);
  assert.equal(l100.windowMs, 1100);
  assert.equal(l100.tier, 'hell');
});

test('爬坡档位：段数 1–6 与候选 2/4/6/9 的推进区间（说明书 §6.7 档位区间表）', () => {
  // seqLen：u → 1 + 5u 就近取整 → 1 段 u<0.1、2 段 [0.1,0.3)、3 段 [0.3,0.5)、4 段 [0.5,0.7)、5 段 [0.7,0.9)、6 段 ≥0.9
  assert.equal(client.seqLenAt(0.09), 1);
  assert.equal(client.seqLenAt(0.1), 2);
  assert.equal(client.seqLenAt(0.29), 2);
  assert.equal(client.seqLenAt(0.3), 3);
  assert.equal(client.seqLenAt(0.49), 3);
  assert.equal(client.seqLenAt(0.5), 4);
  assert.equal(client.seqLenAt(0.69), 4);
  assert.equal(client.seqLenAt(0.7), 5);
  assert.equal(client.seqLenAt(0.89), 5);
  assert.equal(client.seqLenAt(0.9), 6);
  assert.equal(client.seqLenAt(1), 6);
  // candidates：u → 3u 就近取档 → 2 格 u<1/6、4 格 [1/6,0.5)、6 格 [0.5,5/6)、9 格 ≥5/6
  assert.equal(client.candidatesAt(0.16), 2);
  assert.equal(client.candidatesAt(1 / 6), 4);
  assert.equal(client.candidatesAt(0.49), 4);
  assert.equal(client.candidatesAt(0.5), 6);
  assert.equal(client.candidatesAt(5 / 6 - 0.01), 6);
  assert.equal(client.candidatesAt(5 / 6), 9);
  assert.equal(client.candidatesAt(1), 9);
  // 两条曲线拉满全区间（to = 1）后，u=1 处必须同时触顶且满足「候选 ≥ 段数」
  const top = client.levelConfig(100, 60);
  assert.equal(top.seqLen, SEQ_LEN_MAX);
  assert.equal(top.candidates, CANDIDATE_TIERS[CANDIDATE_TIERS.length - 1]);
});

/* ── 2. 全枚举：单调性 + 硬约束 ─────────────────────────────────── */

test('全枚举 L1..100 × R0..60：单调不减、单调不增、硬约束恒定成立', () => {
  const rounds = 61;
  let prevU = -1;
  let prevSeq = -1;
  let prevCand = -1;
  let prevWindow = Infinity;
  for (let l = 1; l <= LEVEL_MAX; l += 1) {
    // 每个关卡内：roundIndex 递增 → 强度递增
    prevU = -1;
    prevSeq = -1;
    prevCand = -1;
    prevWindow = Infinity;
    for (let r = 0; r < rounds; r += 1) {
      const c = client.levelConfig(l, r);
      assert.ok(c.u >= prevU - 1e-12, `u 应随轮次单调不减（L${l} R${r}）`);
      assert.ok(c.seqLen >= prevSeq, `seqLen 应随轮次单调不减（L${l} R${r}）`);
      assert.ok(c.candidates >= prevCand, `candidates 应随轮次单调不减（L${l} R${r}）`);
      assert.ok(c.windowMs <= prevWindow, `windowMs 应随轮次单调不增（L${l} R${r}）`);
      // 硬约束：候选 ≥ 段数，且候选只取合法档位
      assert.ok(c.candidates >= c.seqLen, `候选数必须 ≥ 段数（L${l} R${r}）`);
      assert.ok(CANDIDATE_TIERS.indexOf(c.candidates) >= 0, `候选档位非法（L${l} R${r}）`);
      assert.ok(c.seqLen >= SEQ_LEN_MIN && c.seqLen <= SEQ_LEN_MAX, `段数越界（L${l} R${r}）`);
      prevU = c.u;
      prevSeq = c.seqLen;
      prevCand = c.candidates;
      prevWindow = c.windowMs;
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

/* ── 6. 目标条带带宽（§3.2 三重约束 / §3.3 段数 1–6） ────────────── */

/**
 * 条带最终绘制宽度：`bandW` 受屏宽 / 中区高度 / 「每段 ≤ segMaxWidth」三重约束，
 * 其中「每段 ≤132」按本轮**实际段数**收敛（components/palette 实现口径）。
 */
function drawnBandW(target, segCount) {
  const segW = Math.min(target.bandW / segCount, target.segMaxWidth);
  return segW * segCount;
}

test('条带带宽：普通对战（3 段）与改造前逐像素一致，闯关 6 段可排布且每段 ≤132', () => {
  const { computeLayout } = require('../minigame/src/components/theme.js');
  const { SEQUENCE_LENGTH } = require('../minigame/src/config/config.js');
  const screens = [
    [390, 844],
    [360, 640],
    [430, 932],
    [768, 1024],
    [1024, 1536],
  ];
  for (let i = 0; i < screens.length; i += 1) {
    const [w, h] = screens[i];
    const L = computeLayout({ windowWidth: w, windowHeight: h, pixelRatio: 2 });
    // 改造前的口径 = min(屏宽 84%, 中区高 92%, 3 段 × 132)；普通对战必须完全不变
    const before = Math.min(Math.round(w * 0.84), Math.round(L.mid.h * 0.92), SEQUENCE_LENGTH * 132);
    assert.equal(drawnBandW(L.target, SEQUENCE_LENGTH), before, `${w}×${h} 普通对战条带宽度不应变化`);

    for (let n = 1; n <= SEQ_LEN_MAX; n += 1) {
      const bw = drawnBandW(L.target, n);
      assert.ok(bw / n <= L.target.segMaxWidth + 1e-9, `${w}×${h} 每段宽度不得超过 132（n=${n}）`);
      assert.ok(bw <= Math.round(w * 0.84) + 1e-9, `${w}×${h} 条带不得超出屏宽 84%（n=${n}）`);
      assert.ok(bw <= Math.round(L.mid.h * 0.92) + 1e-9, `${w}×${h} 条带不得超出中区高度 92%（n=${n}）`);
    }
    // 段数越多 → 条带越宽（6 段不再受 3 段上限压制）
    assert.ok(drawnBandW(L.target, SEQ_LEN_MAX) >= drawnBandW(L.target, SEQUENCE_LENGTH));
  }
});
