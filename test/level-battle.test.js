'use strict';

/**
 * 闯关模式状态机单测（《项目说明书》§4.8 闯关模式 + §6.7 闯关模式数值）
 *
 * 覆盖：模式装配、每轮参数随「关卡 + 局内轮次」爬坡、生命值扣除与耗尽失败、
 *      收官优先级（越线 > 对方越线 > 生命耗尽 > 硬上限）、位移系数按关卡派生、
 *      每关固定种子、结算摘要口径、clampLevel 边界。
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
  summary,
} = require('../minigame/src/core/battle.js');
const { createRng } = require('../minigame/src/core/rng.js');
const { displacement } = require('../minigame/src/core/energy.js');
const levels = require('../minigame/src/core/levels.js');
const { COUNTDOWN_MS, LEVEL_LIVES, GAME_HARD_LIMIT_MS } = require('../minigame/src/config/config.js');

const FAST_SEG_MS = 100;

function curTarget(m) {
  return m.round ? m.round.targetIds[m.round.seqIndex] : null;
}

function playOut(match, rand, decide) {
  let m = match;
  let guard = 0;
  while (!isOver(m) && guard < 500) {
    m = submit(m, decide(m), FAST_SEG_MS, rand);
    if (!isOver(m)) m = nextRound(m, rand);
    guard += 1;
  }
  assert.ok(guard < 500, '对局应在有限轮次内结束');
  return m;
}

/* ── 装配 ─────────────────────────────────────────────────────── */

test('createMatch(mode:level)：装配关卡参数、3 条生命、对手按陪练弱化', () => {
  const m = createMatch({ mode: 'level', level: 5 });
  assert.equal(m.mode, 'level');
  assert.equal(m.level, 5);
  assert.equal(m.livesLeft, LEVEL_LIVES);
  assert.equal(m.livesLeft, 3);
  assert.equal(m.phase, 'countdown');
  assert.ok(m.levelCfg, '闯关模式应携带本关参数');
  assert.equal(m.levelCfg.level, 5);
  assert.equal(m.challenge, false, '闯关模式不是每日挑战');
  // 对手命中率 = 关键帧插值 × oppHitScale（陪练弱化，§6.7）
  assert.ok(m.ghost.oppHit < LEVEL_LIVES, 'sanity');
  assert.ok(Math.abs(m.ghost.oppHit - levels.levelConfig(5, 0).oppHit) < 1e-12);
  assert.ok(m.ghost.winNetEnergy === levels.winNetEnergyOf(5));

  // 普通对战仍是 classic、livesLeft 为 null
  const c = createMatch({ difficulty: 'normal' });
  assert.equal(c.mode, 'classic');
  assert.equal(c.level, null);
  assert.equal(c.livesLeft, null);
  assert.equal(c.levelCfg, null);
  assert.equal(c.challenge, false);
});

test('clampLevel：关卡号越界 / 非法一律夹到 [1, 100]', () => {
  assert.equal(levels.clampLevel(0), 1);
  assert.equal(levels.clampLevel(-9), 1);
  assert.equal(levels.clampLevel(101), 100);
  assert.equal(levels.clampLevel('x'), 1);
  assert.equal(levels.clampLevel(12.7), 12);
  assert.equal(createMatch({ mode: 'level', level: 999 }).level, 100);
  assert.equal(createMatch({ mode: 'level' }).level, 1, '缺省关卡为 1');
});

/* ── 每轮参数爬坡（需求 2 / 3） ─────────────────────────────────── */

test('每轮参数：段数与候选随「关卡 + 局内轮次」爬坡，且候选恒 ≥ 段数', () => {
  const LEVEL = 50; // 关内爬坡区间落在此关：u 从 0.495 爬到 0.675
  const rand = createRng(101);
  let m = beginPlaying(createMatch({ mode: 'level', level: LEVEL }));
  m = nextRound(m, rand);

  let prevSeq = 0;
  let prevCand = 0;
  for (let i = 0; i < 12; i += 1) {
    assert.equal(m.round.targetIds.length, levels.levelConfig(LEVEL, m.roundIndex).seqLen);
    assert.equal(m.round.optionIds.length, levels.levelConfig(LEVEL, m.roundIndex).candidates);
    assert.ok(m.round.optionIds.length >= m.round.targetIds.length, '候选数必须 ≥ 段数');
    assert.ok(m.round.targetIds.length >= prevSeq, '段数应单调不减');
    assert.ok(m.round.optionIds.length >= prevCand, '候选档位应单调不减');
    prevSeq = m.round.targetIds.length;
    prevCand = m.round.optionIds.length;
    // 点完本轮全部段以推进 roundIndex；中途收官（越线 / 生命耗尽）则停
    let cur = m;
    while (!cur.round.done && !isOver(cur)) cur = submit(cur, curTarget(cur), FAST_SEG_MS, rand);
    m = cur;
    if (isOver(m)) break;
    m = nextRound(m, rand);
  }
  // 同一关内「局内进度」确实带来爬坡：第 1 轮 < 第 9 轮
  assert.ok(
    levels.levelConfig(LEVEL, 0).seqLen < levels.levelConfig(LEVEL, 8).seqLen,
    '关内爬坡应让段数随轮次上升'
  );
  assert.ok(
    levels.levelConfig(LEVEL, 0).candidates < levels.levelConfig(LEVEL, 8).candidates,
    '关内爬坡应让候选档位随轮次上升'
  );
});

/* ── 生命值（需求 4） ───────────────────────────────────────────── */

test('生命值：点错 3 次即闯关失败，剩余生命归零', () => {
  const rand = createRng(2026);
  let m = beginPlaying(createMatch({ mode: 'level', level: 40 }));
  m = nextRound(m, rand);
  const wrong = (cur) => cur.round.optionIds.find((id) => id !== curTarget(cur));

  assert.equal(m.livesLeft, 3);
  m = submit(m, wrong(m), FAST_SEG_MS, rand);
  assert.equal(m.livesLeft, 2, '点错扣 1 条命');
  assert.equal(isOver(m), false, '扣 1 条命不应立即结束');

  m = nextRound(m, rand);
  m = submit(m, wrong(m), FAST_SEG_MS, rand);
  assert.equal(m.livesLeft, 1);

  m = nextRound(m, rand);
  m = submit(m, wrong(m), FAST_SEG_MS, rand);
  assert.equal(m.livesLeft, 0);
  assert.equal(m.result, 'lose', '第 3 条命耗尽即闯关失败');
  assert.equal(isOver(m), true);
  assert.equal(m.round.done, true, '收官时本轮也要记为结束（服务端一致性口径）');

  const s = summary(m);
  assert.equal(s.result, 'lose');
  assert.equal(s.mode, 'level');
  assert.equal(s.level, 40);
  assert.equal(s.livesLeft, 0);
});

test('生命值：某段超时同样扣 1 条命（§4.8 口径：点错 + 超时都扣命）', () => {
  const rand = createRng(77);
  let m = beginPlaying(createMatch({ mode: 'level', level: 20 }));
  m = nextRound(m, rand);
  m = submit(m, null, FAST_SEG_MS, rand); // 空段
  assert.equal(m.lastRound.kind, 'timeout');
  assert.equal(m.livesLeft, 2, '超时扣 1 条命');
});

test('收官优先级：越线优先于生命耗尽（全命中 → 过关，生命不降）', () => {
  const rand = createRng(20261019);
  let m = beginPlaying(createMatch({ mode: 'level', level: 3 }));
  m = nextRound(m, rand);
  const done = playOut(m, rand, curTarget);
  assert.equal(done.result, 'win', '全命中必然越线过关');
  assert.equal(done.livesLeft, LEVEL_LIVES, '整局未失误，生命不应被扣');
  assert.equal(done.px, 220, '越线定义不变：位移达 ±上限');
});

/* ── 位移系数按关卡派生（§6.7） ────────────────────────────────── */

test('位移系数：同能量差下，闯关模式的位移大于普通对战（阈值更低）', () => {
  const lv = levels.displacementFactorOf(1);
  const classic = displacement(100, 0);
  const levelPx = displacement(100, 0, lv);
  assert.ok(levelPx > classic, '闯关阈值 112 < 160 ⇒ 单位能量的像素更多');
  assert.ok(Math.abs(levelPx - 100 * (220 / 112)) < 1e-9);
  // 关卡越高阈值越低 ⇒ 位移系数越大
  assert.ok(levels.displacementFactorOf(100) > levels.displacementFactorOf(1));
});

test('硬上限：闯关模式超时且未耗尽生命时按位移判定收官（§2.3 / §6.3）', () => {
  const rand = createRng(303);
  let m = beginPlaying(createMatch({ mode: 'level', level: 1 }));
  m = nextRound(m, rand);
  m = submit(m, curTarget(m), GAME_HARD_LIMIT_MS, rand); // 用超大 dt 直接触发倒计时归零
  assert.equal(m.phase, 'over');
  assert.ok(['win', 'lose', 'draw'].includes(m.result));
  assert.equal(m.livesLeft, LEVEL_LIVES, '命中不扣命');
});

/* ── 每关固定种子（需求 / §4.8） ───────────────────────────────── */

test('每关固定种子：同关卡 ⇒ 同种子、同题目（与设备 / 日期无关）', () => {
  const seed = levels.levelSeed(12);
  const a = beginPlaying(createMatch({ mode: 'level', level: 12 }));
  const b = beginPlaying(createMatch({ mode: 'level', level: 12 }));
  const ra = nextRound(a, createRng(seed));
  const rb = nextRound(b, createRng(levels.levelSeed(12)));
  assert.deepEqual(rb.round.targetIds, ra.round.targetIds);
  assert.deepEqual(rb.round.optionIds, ra.round.optionIds);
  // 不同关卡题目不同
  const rc = nextRound(beginPlaying(createMatch({ mode: 'level', level: 13 })), createRng(levels.levelSeed(13)));
  assert.notDeepEqual(rc.round.targetIds, ra.round.targetIds);
});

test('倒计时：闯关模式同样从 countdown 进入 playing', () => {
  let m = createMatch({ mode: 'level', level: 7 });
  assert.equal(m.countdownLeftMs, COUNTDOWN_MS);
  m = advanceCountdown(m, COUNTDOWN_MS + 1);
  assert.equal(m.phase, 'playing');
});
