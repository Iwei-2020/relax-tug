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
const { COUNTDOWN_MS, GAME_HARD_LIMIT_MS, DIFFICULTY, SEQUENCE_LENGTH } = require('../minigame/src/config/config.js');
const { createRng, dailyChallengeSeed } = require('../minigame/src/core/rng.js');
const { createRound } = require('../minigame/src/core/matcher.js');

/** 当前待点段的目标色 id（§2.2：一轮 = N 段序列，逐段判定）。 */
function curTarget(m) {
  return m.round ? m.round.targetIds[m.round.seqIndex] : null;
}

/**
 * 单段耗时（模拟「熟练玩家快速连点」）：以固定小 dt 驱动 playOut，
 * 使「全命中 / 全失误」这类确定性用例在远低于 §6.3 硬上限（45s）的步数内收官。
 * 越线阈值重标定后单局命中段数由 ≈18 涨到 ≈36，若沿用整段 windowMs（1400ms）作为 dt，
 * 累计耗时（≈40s+）会贴近甚至越过硬上限，用例会退化为「超时收官」而非「越线收官」。
 */
const FAST_SEG_MS = 100;

/** 把一局跑到结束（guard 防死循环）。 */
function playOut(match, rand, decide) {
  let m = match;
  let guard = 0;
  while (!isOver(m) && guard < 500) {
    m = submit(m, decide(m), FAST_SEG_MS, rand);
    // 序列未走完时 nextRound 是 no-op，下一轮迭代继续点同一轮的下一段
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

test('nextRound：生成目标序列与候选集，序列走完前不刷新（§2.2 / §6.4）', () => {
  const rand = createRng(9);
  let m = beginPlaying(createMatch({ difficulty: 'easy' }));
  m = nextRound(m, rand);
  assert.ok(m.round, '进入 playing 后应有当前轮');
  assert.equal(m.round.optionIds.length, DIFFICULTY.easy.candidates);
  assert.equal(m.round.targetIds.length, SEQUENCE_LENGTH);
  for (const id of m.round.targetIds) assert.ok(m.round.optionIds.includes(id));
  assert.equal(nextRound(m, rand).round === m.round, true, '序列未走完时不得刷新，否则剩余段会被丢掉');

  // 逐段点完最后一段之后，本轮才算结束，此时才允许刷新为新对象
  let done = m;
  for (let i = 0; i < SEQUENCE_LENGTH; i += 1) {
    done = submit(done, curTarget(done), 100, rand);
  }
  assert.equal(done.round.done, true, '走完最后一段后本轮结束');
  assert.equal(done.phase, 'playing', '仅 3 段命中不应直接结束对局');
  assert.equal(nextRound(done, rand).round === done.round, false, '本轮结束后刷新为新对象');
});

test('全命中：我方必胜（能量优势累积到越线，§2.3）', () => {
  const rand = createRng(20261019);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  const done = playOut(m, rand, curTarget); // 每段都点对
  assert.equal(done.result, 'win');
  assert.equal(done.px, 220, '胜利时绳子应在 ±上限处定格');
  assert.equal(done.player.energy > done.ghost.state.energy, true);
});

test('全失误：我方必败，且能量不会为负（§6.2）', () => {
  const rand = createRng(20261020);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  const done = playOut(m, rand, (cur) => {
    // 故意点一个非当前段目标色
    const wrong = cur.round.optionIds.find((id) => id !== curTarget(cur));
    return wrong;
  });
  assert.equal(done.result, 'lose');
  assert.equal(done.px, -220);
  assert.equal(done.player.energy, 0, '能量下限为 0，不出现负能量');
});

test('段内推进与空段：点对一段推进下一段，某段超时按 timeout 结算且不清零连击（§6.2）', () => {
  const rand = createRng(11);
  let m = beginPlaying(createMatch({ difficulty: 'easy' }));
  m = nextRound(m, rand);
  m = submit(m, curTarget(m), 100, rand);
  assert.equal(m.lastRound.kind, 'hit');
  assert.equal(m.round.seqIndex, 1, '点对一段后应推进到下一段');
  assert.equal(m.round.done, false, '序列未走完，本轮继续');
  const comboBefore = m.player.combo;
  const energyBefore = m.player.energy;

  m = nextRound(m, rand); // 序列未走完 → 守卫使之不刷新
  assert.equal(m.round.seqIndex, 1, 'nextRound 不得丢掉未走完的序列');
  m = submit(m, null, 100, rand); // 当前段超时
  assert.equal(m.lastRound.kind, 'timeout');
  assert.equal(m.round.done, true, '当前段超时应结束本轮');
  assert.equal(m.player.energy, energyBefore);
  assert.equal(m.player.combo, comboBefore, '空段不中断连击');
  assert.equal(m.player.timeouts, 1);
});

test('硬上限：超过 45s 未越线时按位移判定收官（§6.3 / §2.3）', () => {
  const rand = createRng(5);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  // 用超大 dt 模拟超时（正常玩法下由场景逐帧累加）
  m = submit(m, curTarget(m), GAME_HARD_LIMIT_MS, rand);
  assert.equal(m.phase, 'over');
  assert.ok(['win', 'lose', 'draw'].includes(m.result));
  assert.equal(m.round.done, true, '截断收官时本轮也要记为结束，保证服务端一致性口径成立');
});

test('状态推进不可变：submit 返回新对象且不修改入参', () => {
  const rand = createRng(3);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  const snapshotEnergy = m.player.energy;
  const snapshotRounds = m.roundIndex;
  const snapshotSeq = m.round.seqIndex;

  const next = submit(m, curTarget(m), 200, rand);
  assert.notEqual(next, m, '必须返回新对象');
  assert.equal(m.player.energy, snapshotEnergy, '入参能量不得被原地修改');
  assert.equal(m.roundIndex, snapshotRounds, '入参轮次不得被原地修改');
  assert.equal(m.round.seqIndex, snapshotSeq, '入参的序列进度不得被原地修改');
  assert.notEqual(next.round, m.round, 'round 也必须是新对象（序列进度在它上面）');
  assert.equal(next.round.seqIndex, snapshotSeq + 1, '点对一段推进一段');
  assert.equal(next.round.done, false, '一段命中不结束本轮');
  assert.equal(next.roundIndex, snapshotRounds, '本轮未结束，轮次不推进');
});

test('判定分档：窗口前段点中记「完美」（能量更高），后段点中记「普通」（§2.2 / §6.2）', () => {
  const rand = createRng(21);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  const w = m.round.windowMs;

  // 完美：在窗口前 50% 内点中
  const early = submit(m, curTarget(m), Math.floor(w * 0.2), rand);
  assert.equal(early.lastRound.kind, 'hit');
  assert.equal(early.lastRound.grade, 'perfect');
  assert.equal(early.lastRound.perfect, true);
  assert.equal(early.player.perfects, 1);

  // 普通：在窗口后半段点中
  const late = submit(m, curTarget(m), Math.floor(w * 0.9), rand);
  assert.equal(late.lastRound.grade, 'good');
  assert.equal(late.lastRound.perfect, false);
  assert.equal(late.player.perfects, 0);
  assert.ok(early.player.energy > late.player.energy, '完美判定单段能量应高于普通判定');

  // 点错不参与分档
  const wrong = m.round.optionIds.find((id) => id !== curTarget(m));
  const miss = submit(m, wrong, 10, rand);
  assert.equal(miss.lastRound.kind, 'miss');
  assert.equal(miss.lastRound.grade, 'miss');
});

test('summary：perfectHits 与 challengeMode 口径（§6.2 判定分档 / §4.4 每日挑战）', () => {
  const rand = createRng(31);
  let m = beginPlaying(createMatch({ difficulty: 'normal', challenge: true }));
  m = nextRound(m, rand);
  m = submit(m, curTarget(m), 10, rand); // 完美一段
  m = submit(m, curTarget(m), m.round.windowMs, rand); // 普通一段
  const s = summary(m);
  assert.equal(s.perfectHits, 1, '完美段数应单独统计');
  assert.ok(s.perfectHits <= s.hits, '完美段数不得超过命中段数');
  assert.equal(s.challengeMode, true, '每日挑战局应打标记');
  assert.equal(summary(createMatch({})).challengeMode, false, '普通对局不带挑战标记');
});

test('每日挑战：同日同难度种子稳定、跨日或换难度即变，且同种子生成同一局（§4.4）', () => {
  const t1 = Date.parse('2026-10-19T09:00:00+08:00');
  const t2 = Date.parse('2026-10-19T23:30:00+08:00');
  const t3 = Date.parse('2026-10-20T00:30:00+08:00');

  assert.equal(dailyChallengeSeed(t1, 'normal'), dailyChallengeSeed(t2, 'normal'), '同一自然日内种子稳定');
  assert.notEqual(dailyChallengeSeed(t1, 'normal'), dailyChallengeSeed(t3, 'normal'), '跨自然日种子变化');
  assert.notEqual(dailyChallengeSeed(t1, 'normal'), dailyChallengeSeed(t1, 'hard'), '同日不同难度种子不同');
  assert.ok(dailyChallengeSeed(t1, 'normal') >= 0, '种子为 32 位无符号整数');

  // 同种子 → 同一轮序列，这是「全球同题」可比性的来源
  const a = createRound('normal', createRng(dailyChallengeSeed(t1, 'normal')));
  const b = createRound('normal', createRng(dailyChallengeSeed(t2, 'normal')));
  assert.deepEqual(b.targetIds, a.targetIds);
  assert.deepEqual(b.optionIds, a.optionIds);
});

test('summary：结算摘要字段口径（命中率 = 命中段数 / 总判定段数）', () => {
  const rand = createRng(20261019);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  const done = playOut(m, rand, curTarget);

  const s = summary(done);
  assert.equal(s.result, 'win');
  const settled = s.hits + s.misses + s.timeouts;
  assert.equal(s.accuracy, settled === 0 ? 0 : s.hits / settled, '命中率 = 命中段数 / 总判定段数');
  assert.ok(s.hits >= Math.max(0, s.rounds - s.misses - s.timeouts), '未以失误/空轮结束的轮次至少贡献 1 次命中');
  assert.ok(s.hits <= s.rounds * SEQUENCE_LENGTH, '一轮最多贡献 N 次命中');
  assert.equal(s.netEnergy, s.myEnergy - s.oppEnergy);
  assert.equal(s.displacementPx, done.px);
  assert.ok(s.durationMs > 0 && s.durationMs <= GAME_HARD_LIMIT_MS);
});

test('shouldFallbackToAI：匹配上限 3s 后进入 AI 对局，不阻塞玩家（§4.1）', () => {
  const m = createMatch({});
  assert.equal(shouldFallbackToAI(m, m.matchTimeoutMs - 1), false);
  assert.equal(shouldFallbackToAI(m, m.matchTimeoutMs), true);
});
