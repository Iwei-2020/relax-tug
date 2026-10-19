'use strict';

/**
 * 能量与位移单测
 *
 * 依据：《解压拔河大作战 · 项目说明书》§2.4（能量机制）、§6.1（位移/越线）、§6.2（命中与连击）。
 * 覆盖：连击加成边界、命中/失误/空轮、能量下限、位移夹取、越线与平局判定、纯函数不可变性。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEnergyState,
  comboBonus,
  applyHit,
  applyMiss,
  applyTimeout,
  displacement,
  ropeState,
  outcome,
  finalResult,
} = require('../minigame/src/core/energy.js');
const { HIT_ENERGY, MISS_PENALTY, DISPLACEMENT_FACTOR, WIN_NET_ENERGY, DRAW_BAND_PX, PERFECT_MULTIPLIER } = require('../minigame/src/config/config.js');

test('comboBonus：仅在第 3 / 5 / 8+ 次命中生效（§6.2 连击表）', () => {
  assert.equal(comboBonus(1), 0);
  assert.equal(comboBonus(2), 0);
  assert.equal(comboBonus(3), 2);
  assert.equal(comboBonus(4), 0);
  assert.equal(comboBonus(5), 4);
  assert.equal(comboBonus(6), 0);
  assert.equal(comboBonus(7), 0);
  assert.equal(comboBonus(8), 6); // 8 次及以上每次 +6
  assert.equal(comboBonus(12), 6);
});

test('applyHit：基础 +12，第 3 次命中额外 +2，且返回新对象（不改入参）', () => {
  let s = createEnergyState();
  s = applyHit(s);
  assert.equal(s.energy, HIT_ENERGY);
  assert.equal(s.combo, 1);
  assert.equal(s.lastGain, HIT_ENERGY);

  s = applyHit(s);
  assert.equal(s.energy, HIT_ENERGY * 2);

  const before = s;
  s = applyHit(s); // 第 3 次：+12 +2
  assert.equal(s.energy, HIT_ENERGY * 3 + 2);
  assert.equal(s.combo, 3);
  assert.equal(s.bestCombo, 3);
  assert.equal(s.lastGain, HIT_ENERGY + 2);
  assert.equal(before.energy, HIT_ENERGY * 2, '入参对象不得被原地修改');
  assert.equal(before.combo, 2);
});

test('applyHit：单次命中上限 = 基础 +12 与最高加成 +6（§6.2）', () => {
  let s = createEnergyState();
  for (let i = 0; i < 8; i += 1) s = applyHit(s);
  assert.equal(s.combo, 8);
  assert.equal(s.lastGain, 18); // 12 + 6
  assert.equal(s.perfects, 0, '普通命中不计入完美段数');
});

test('applyHit：完美判定（perfect=true）能量 ×1.5 并计入 perfects（§6.2 判定分档）', () => {
  let s = createEnergyState();
  s = applyHit(s, undefined, true);
  assert.equal(s.energy, Math.round(HIT_ENERGY * PERFECT_MULTIPLIER)); // 12 × 1.5 = 18
  assert.equal(s.lastGain, 18);
  assert.equal(s.hits, 1);
  assert.equal(s.perfects, 1);

  // 连击加成同样吃倍率：第 3 次命中 (12 + 2) × 1.5 = 21
  let t = createEnergyState();
  t = applyHit(t);
  t = applyHit(t);
  t = applyHit(t, undefined, true);
  assert.equal(t.lastGain, Math.round((HIT_ENERGY + 2) * PERFECT_MULTIPLIER));
  assert.equal(t.perfects, 1);

  // 完美上限：第 8 次命中 (12 + 6) × 1.5 = 27
  let u = createEnergyState();
  for (let i = 0; i < 7; i += 1) u = applyHit(u);
  u = applyHit(u, undefined, true);
  assert.equal(u.lastGain, 27);

  // 浮动系数（AI 口径）与倍率可叠加，且默认不必传 perfect
  const v = applyHit(createEnergyState(), 1);
  assert.equal(v.perfects, 0);
  assert.equal(v.lastGain, HIT_ENERGY);
});

test('applyMiss：扣 6 分、连击清零、能量不为负（§6.2）', () => {
  let s = createEnergyState();
  s = applyHit(s); // 12
  s = applyHit(s); // 24
  const after = applyMiss(s);
  assert.equal(after.energy, 24 - MISS_PENALTY);
  assert.equal(after.combo, 0);
  assert.equal(after.lastGain, -MISS_PENALTY);
  assert.equal(after.bestCombo, 2, '最高连击保留');

  // 能量不足时只扣到 0，不出现负能量
  let low = createEnergyState();
  low = applyHit(low); // 12
  low = applyMiss(low); // 6
  low = applyMiss(low); // 0
  low = applyMiss(low); // 仍 0
  assert.equal(low.energy, 0);
  assert.equal(low.lastGain, 0);
});

test('applyTimeout：空轮不增不减、不清零连击（§6.2）', () => {
  let s = createEnergyState();
  s = applyHit(s);
  s = applyHit(s);
  const t = applyTimeout(s);
  assert.equal(t.energy, s.energy);
  assert.equal(t.combo, 2);
  assert.equal(t.lastGain, 0);
  assert.equal(t.timeouts, 1);
});

test('displacement：位移系数 = 上限 / 越线净能量差，且夹在 ±上限内（§2.4 / §6.1）', () => {
  assert.equal(DISPLACEMENT_FACTOR, 220 / WIN_NET_ENERGY);
  assert.equal(displacement(WIN_NET_ENERGY, 0), 220); // 刚好越线
  assert.equal(displacement(0, WIN_NET_ENERGY), -220);
  assert.equal(displacement(WIN_NET_ENERGY * 3, 0), 220, '超出部分被夹取');
  assert.equal(displacement(0, WIN_NET_ENERGY * 3), -220);
  assert.equal(displacement(WIN_NET_ENERGY / 2, 0), DISPLACEMENT_FACTOR * (WIN_NET_ENERGY / 2));
});

test('ropeState / outcome：越线、带宽、继续三态（§2.3）', () => {
  assert.equal(ropeState(WIN_NET_ENERGY, 0), 'win');
  assert.equal(ropeState(0, WIN_NET_ENERGY), 'lose');
  assert.equal(ropeState(0, 0), 'even');
  assert.equal(outcome(0, 0), 'draw');
  assert.equal(outcome(WIN_NET_ENERGY, 0), 'win');
  assert.equal(outcome(0, WIN_NET_ENERGY), 'lose');
});

test('ropeState：带宽按位移绝对值判定，带外仍为 ongoing', () => {
  // 位移 = (my-opp)*2.75；带宽 ±20px ⇒ 净能量差 ≈ ±7.27
  const inBand = Math.floor(DRAW_BAND_PX / DISPLACEMENT_FACTOR); // 7 ⇒ 19.25px，落在带内
  const outBand = inBand + 1; // 8 ⇒ 22px，带外
  assert.equal(ropeState(inBand, 0), 'even');
  assert.equal(ropeState(outBand, 0), 'ongoing');
  assert.equal(outcome(outBand, 0), 'ongoing');
});

test('finalResult：未超时且未越线返回 null；超时按位移判胜负/平局（§2.3）', () => {
  assert.equal(finalResult(WIN_NET_ENERGY - 1, 0, false), null);
  assert.equal(finalResult(WIN_NET_ENERGY, 0, false), 'win', '越线即时结算，无需等倒计时');

  // 超时：位移偏向我方 → 胜；落入带宽 → 平局
  assert.equal(finalResult(30, 0, true), 'win');
  assert.equal(finalResult(0, 30, true), 'lose');
  assert.equal(finalResult(0, 0, true), 'draw');
});
