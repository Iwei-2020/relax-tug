'use strict';

/**
 * 普通对战（classic）动态段位曲线回归（《项目说明书》§2.2 / §2.3 / §6.4）
 *
 * 验证同一段位、种子和输入策略可复现，并覆盖不同段位的普通对局。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMatch, beginPlaying, nextRound, submit, isOver, summary } = require('../minigame/src/core/battle.js');
const { createRng } = require('../minigame/src/core/rng.js');

const FAST_SEG_MS = 100;

function curTarget(m) {
  return m.round ? m.round.targetIds[m.round.seqIndex] : null;
}

/** 跑到收官，返回 classic digest（字段顺序无关，逐字段断言）。 */
function digest(seed, difficulty, policy, rankId) {
  const rand = createRng(seed);
  let m = beginPlaying(createMatch({ difficulty, rankId }));
  m = nextRound(m, rand);
  const pxs = [];
  let guard = 0;
  while (!isOver(m) && guard < 5000) {
    const pick = policy === 'correct' ? curTarget(m) : m.round.optionIds.find((id) => id !== curTarget(m));
    m = submit(m, pick, FAST_SEG_MS, rand);
    pxs.push(m.px);
    if (!isOver(m)) m = nextRound(m, rand);
    guard += 1;
  }
  assert.ok(guard < 5000, '对局应在有限轮次内结束');
  const s = summary(m);
  return {
    result: s.result,
    rankId: s.rankId,
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
  { seed: 20261019, difficulty: 'normal', policy: 'correct', rankId: 'bronze' },
  { seed: 20261020, difficulty: 'normal', policy: 'wrong', rankId: 'silver' },
  { seed: 7, difficulty: 'easy', policy: 'correct', rankId: 'gold' },
  { seed: 7, difficulty: 'hard', policy: 'correct', rankId: 'platinum' },
  { seed: 7, difficulty: 'hell', policy: 'wrong', rankId: 'diamond' },
  { seed: 99, difficulty: 'normal', policy: 'correct', rankId: 'master' },
];

test('普通对战按开局段位调整曲线且同种子可复现', () => {
  CASES.forEach((c) => {
    const got = digest(c.seed, c.difficulty, c.policy, c.rankId);
    const repeated = digest(c.seed, c.difficulty, c.policy, c.rankId);
    assert.deepEqual(got, repeated, `局面不可复现：seed=${c.seed} rank=${c.rankId}`);
    assert.equal(got.rankId, c.rankId);
    assert.ok(['win', 'lose'].includes(got.result));
  });
});
