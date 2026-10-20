'use strict';

/**
 * 普通对战（classic）行为快照回归（《项目说明书》§2.2 / §2.3 / §6.4）
 *
 * 目的：本波引入「闯关模式」会改动 core（matcher / ghost / energy / battle），
 * 必须证明**普通对战逐位不变** —— 同种子 + 同操作策略 ⇒ 完全相同的能量、位移与结算摘要。
 *
 * 期望值是**改造前**实测冻结的（digest 仅取 classic 相关字段，因此新增 mode / level / livesLeft
 * 等闯关字段不会让本用例误报，但任何玩法行为变化都会立即暴露）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMatch, beginPlaying, nextRound, submit, isOver, summary } = require('../minigame/src/core/battle.js');
const { createRng } = require('../minigame/src/core/rng.js');

const FAST_SEG_MS = 100; // 与 test/battle.test.js 同口径：远低于 §6.3 硬上限

function curTarget(m) {
  return m.round ? m.round.targetIds[m.round.seqIndex] : null;
}

/** 跑到收官，返回 classic digest（字段顺序无关，逐字段断言）。 */
function digest(seed, difficulty, policy) {
  const rand = createRng(seed);
  let m = beginPlaying(createMatch({ difficulty }));
  m = nextRound(m, rand);
  const pxs = [];
  let guard = 0;
  while (!isOver(m) && guard < 500) {
    const pick = policy === 'correct' ? curTarget(m) : m.round.optionIds.find((id) => id !== curTarget(m));
    m = submit(m, pick, FAST_SEG_MS, rand);
    pxs.push(m.px);
    if (!isOver(m)) m = nextRound(m, rand);
    guard += 1;
  }
  assert.ok(guard < 500, '对局应在有限轮次内结束');
  const s = summary(m);
  return {
    result: s.result,
    difficulty: s.difficulty,
    challengeMode: s.challengeMode,
    durationMs: s.durationMs,
    rounds: s.rounds,
    hits: s.hits,
    perfectHits: s.perfectHits,
    misses: s.misses,
    timeouts: s.timeouts,
    bestCombo: s.bestCombo,
    accuracy: s.accuracy,
    myEnergy: s.myEnergy,
    oppEnergy: s.oppEnergy,
    netEnergy: s.netEnergy,
    displacementPx: s.displacementPx,
    eventsFired: s.eventsFired,
    eventIds: s.eventIds,
    pxHead: pxs.slice(0, 12),
    pxTail: pxs.slice(-6),
    steps: pxs.length,
  };
}

const CASES = [
  { seed: 20261019, difficulty: 'normal', policy: 'correct' },
  { seed: 20261020, difficulty: 'normal', policy: 'wrong' },
  { seed: 7, difficulty: 'easy', policy: 'correct' },
  { seed: 7, difficulty: 'hard', policy: 'correct' },
  { seed: 7, difficulty: 'hell', policy: 'wrong' },
  { seed: 99, difficulty: 'normal', policy: 'correct' },
];

// 改造前实测冻结（禁止手工编辑；如确需变更玩法，必须在提交说明里给出理由与新基线）。
const EXPECTED = [
  {
    result: 'win', difficulty: 'normal', challengeMode: false, durationMs: 1300, rounds: 5, hits: 13,
    perfectHits: 13, misses: 0, timeouts: 0, bestCombo: 13, accuracy: 1, myEnergy: 297, oppEnergy: 131,
    netEnergy: 166, displacementPx: 220, eventsFired: 1, eventIds: ['rush'],
    pxHead: [24.75, 33, 44, 48.125, 64.625, 89.375, 92.125, 129.25, 148.5, 167.75, 178.75, 215.875],
    pxTail: [129.25, 148.5, 167.75, 178.75, 215.875, 220],
    steps: 13,
  },
  {
    result: 'lose', difficulty: 'normal', challengeMode: false, durationMs: 1200, rounds: 12, hits: 0,
    perfectHits: 0, misses: 12, timeouts: 0, bestCombo: 0, accuracy: 0, myEnergy: 0, oppEnergy: 165,
    netEnergy: -165, displacementPx: -220, eventsFired: 1, eventIds: ['fog'],
    pxHead: [0, -17.875, -34.375, -52.25, -70.125, -93.5, -111.375, -129.25, -152.625, -178.75, -202.125, -220],
    pxTail: [-111.375, -129.25, -152.625, -178.75, -202.125, -220],
    steps: 12,
  },
  {
    result: 'win', difficulty: 'easy', challengeMode: false, durationMs: 1100, rounds: 4, hits: 11,
    perfectHits: 11, misses: 0, timeouts: 0, bestCombo: 11, accuracy: 1, myEnergy: 243, oppEnergy: 72,
    netEnergy: 171, displacementPx: 220, eventsFired: 0, eventIds: [],
    pxHead: [8.25, 33, 44, 48.125, 66, 70.125, 94.875, 140.25, 160.875, 198, 220],
    pxTail: [70.125, 94.875, 140.25, 160.875, 198, 220],
    steps: 11,
  },
  {
    result: 'win', difficulty: 'hard', challengeMode: false, durationMs: 1700, rounds: 6, hits: 17,
    perfectHits: 17, misses: 0, timeouts: 0, bestCombo: 17, accuracy: 1, myEnergy: 405, oppEnergy: 241,
    netEnergy: 164, displacementPx: 220, eventsFired: 0, eventIds: [],
    pxHead: [6.875, 16.5, 27.5, 34.375, 45.375, 52.25, 59.125, 70.125, 83.875, 94.875, 132, 143],
    pxTail: [143, 154, 191.125, 203.5, 215.875, 220],
    steps: 17,
  },
  {
    result: 'lose', difficulty: 'hell', challengeMode: false, durationMs: 1400, rounds: 14, hits: 0,
    perfectHits: 0, misses: 14, timeouts: 0, bestCombo: 0, accuracy: 0, myEnergy: 0, oppEnergy: 160,
    netEnergy: -160, displacementPx: -220, eventsFired: 1, eventIds: ['rush'],
    pxHead: [-16.5, -31.625, -50.875, -66, -88, -105.875, -122.375, -147.125, -147.125, -171.875, -171.875, -171.875],
    pxTail: [-147.125, -171.875, -171.875, -171.875, -195.25, -220],
    steps: 14,
  },
  {
    result: 'win', difficulty: 'normal', challengeMode: false, durationMs: 1600, rounds: 6, hits: 16,
    perfectHits: 16, misses: 0, timeouts: 0, bestCombo: 16, accuracy: 1, myEnergy: 378, oppEnergy: 212,
    netEnergy: 166, displacementPx: 220, eventsFired: 1, eventIds: ['breather'],
    pxHead: [8.25, 33, 45.375, 50.875, 67.375, 71.5, 81.125, 101.75, 138.875, 152.625, 165, 176],
    pxTail: [165, 176, 191.125, 202.125, 213.125, 220],
    steps: 16,
  },
];

test('classic 快照回归：普通对战玩法逐位不变（同种子 + 同策略 ⇒ 同能量 / 位移 / 摘要）', () => {
  CASES.forEach((c, i) => {
    const got = digest(c.seed, c.difficulty, c.policy);
    assert.deepEqual(got, EXPECTED[i], `classic 行为发生漂移：seed=${c.seed} difficulty=${c.difficulty} policy=${c.policy}`);
  });
});
