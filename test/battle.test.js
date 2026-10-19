'use strict';

/**
 * 对局状态机单测
 *
 * 依据：《项目说明书》§2.2（对战流程）、§2.3（胜负规则）、§6.3（时长）、§6.4（对手强度）。
 * 覆盖：阶段流转、全命中必胜、全失误必败、能量不为负、硬上限兜底、结算摘要口径、
 *      状态推进的不可变性（返回新对象，不改入参）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMatch,
  advanceCountdown,
  beginPlaying,
  nextRound,
  submit,
  isOver,
  shouldFallbackToAI,
  summary,
} = require('../minigame/src/core/battle.js');
const { COUNTDOWN_MS, GAME_HARD_LIMIT_MS, DIFFICULTY } = require('../minigame/src/config/config.js');
const { createRng } = require('../minigame/src/core/rng.js');

/** 把一局跑到结束（guard 防死循环）。 */
function playOut(match, rand, decide) {
  let m = match;
  let guard = 0;
  while (!isOver(m) && guard < 500) {
    m = submit(m, decide(m), m.round ? m.round.windowMs : 1400, rand);
    if (!isOver(m)) m = nextRound(m, rand);
    guard += 1;
  }
  assert.ok(guard < 500, '对局应在有限轮次内结束');
  return m;
}

test('createMatch：开局处于 countdown 阶段，双方能量归零', () => {
  const m = createMatch({ difficulty: 'normal' });
  assert.equal(m.phase, 'countdown');
  assert.equal(m.countdownLeftMs, COUNTDOWN_MS);
  assert.equal(m.player.energy, 0);
  assert.equal(m.ghost.state.energy, 0);
  assert.equal(m.result, null);
  assert.equal(m.difficulty, 'normal');
});

test('createMatch / advanceCountdown：非法难度回落默认档；倒计时归零自动进入 playing', () => {
  assert.equal(createMatch({ difficulty: 'not-a-level' }).difficulty, 'normal');

  let m = createMatch({});
  m = advanceCountdown(m, COUNTDOWN_MS - 100);
  assert.equal(m.phase, 'countdown', '未归零前仍处于倒计时');

  m = advanceCountdown(m, 500);
  assert.equal(m.phase, 'playing');
  assert.equal(m.countdownLeftMs, 0);

  const jumped = beginPlaying(createMatch({}));
  assert.equal(jumped.phase, 'playing');
});

test('nextRound：生成目标色与候选集，候选数量跟随难度档（§6.4）', () => {
  const rand = createRng(9);
  let m = beginPlaying(createMatch({ difficulty: 'easy' }));
  m = nextRound(m, rand);
  assert.ok(m.round, '进入 playing 后应有当前轮');
  assert.equal(m.round.optionIds.length, DIFFICULTY.easy.candidates);
  assert.ok(m.round.optionIds.includes(m.round.targetId));
  assert.equal(nextRound(m, rand).round === m.round, false, '每轮都是新对象');
});

test('全命中：我方必胜（能量优势累积到越线，§2.3）', () => {
  const rand = createRng(20261019);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  const done = playOut(m, rand, (cur) => cur.round.targetId); // 每轮都点对
  assert.equal(done.result, 'win');
  assert.equal(done.px, 220, '胜利时绳子应在 ±上限处定格');
  assert.equal(done.player.energy > done.ghost.state.energy, true);
});

test('全失误：我方必败，且能量不会为负（§6.2）', () => {
  const rand = createRng(20261020);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  const done = playOut(m, rand, (cur) => {
    // 故意点一个非目标色
    const wrong = cur.round.optionIds.find((id) => id !== cur.round.targetId);
    return wrong;
  });
  assert.equal(done.result, 'lose');
  assert.equal(done.px, -220);
  assert.equal(done.player.energy, 0, '能量下限为 0，不出现负能量');
});

test('空轮：窗口内未操作按 timeout 结算，不增不减且不清零连击（§6.2）', () => {
  const rand = createRng(11);
  let m = beginPlaying(createMatch({ difficulty: 'easy' }));
  m = nextRound(m, rand);
  m = submit(m, m.round.targetId, 100, rand);
  assert.equal(m.lastRound.kind, 'hit');
  const comboBefore = m.player.combo;
  const energyBefore = m.player.energy;

  m = nextRound(m, rand);
  m = submit(m, null, 100, rand); // 空轮
  assert.equal(m.lastRound.kind, 'timeout');
  assert.equal(m.player.energy, energyBefore);
  assert.equal(m.player.combo, comboBefore, '空轮不中断连击');
  assert.equal(m.player.timeouts, 1);
});

test('硬上限：超过 45s 未越线时按位移判定收官（§6.3 / §2.3）', () => {
  const rand = createRng(5);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  // 用超大 dt 模拟超时（正常玩法下由场景逐帧累加）
  m = submit(m, m.round.targetId, GAME_HARD_LIMIT_MS, rand);
  assert.equal(m.phase, 'over');
  assert.ok(['win', 'lose', 'draw'].includes(m.result));
});

test('状态推进不可变：submit 返回新对象且不修改入参', () => {
  const rand = createRng(3);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  const snapshotEnergy = m.player.energy;
  const snapshotRounds = m.roundIndex;

  const next = submit(m, m.round.targetId, 200, rand);
  assert.notEqual(next, m, '必须返回新对象');
  assert.equal(m.player.energy, snapshotEnergy, '入参能量不得被原地修改');
  assert.equal(m.roundIndex, snapshotRounds, '入参轮次不得被原地修改');
  assert.equal(m.round, next.round, '本轮信息保留到刷新前，供 UI 做命中反馈');
  assert.equal(next.roundIndex, snapshotRounds + 1);
});

test('summary：结算摘要字段口径（命中率 = 命中 / 总轮次）', () => {
  const rand = createRng(20261019);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  const done = playOut(m, rand, (cur) => cur.round.targetId);

  const s = summary(done);
  assert.equal(s.result, 'win');
  assert.equal(s.rounds, s.hits + s.misses + s.timeouts);
  assert.equal(s.accuracy, s.rounds === 0 ? 0 : s.hits / s.rounds);
  assert.equal(s.netEnergy, s.myEnergy - s.oppEnergy);
  assert.equal(s.displacementPx, done.px);
  assert.ok(s.durationMs > 0 && s.durationMs <= GAME_HARD_LIMIT_MS);
});

test('shouldFallbackToAI：匹配上限 3s 后进入 AI 对局，不阻塞玩家（§4.1）', () => {
  const m = createMatch({});
  assert.equal(shouldFallbackToAI(m, m.matchTimeoutMs - 1), false);
  assert.equal(shouldFallbackToAI(m, m.matchTimeoutMs), true);
});
