'use strict';

/**
 * 能量与位移核心（《项目说明书》§2.4 能量机制 + §6.1 / §6.2 数值）
 *
 * 设计原则：**全部纯函数，一律返回新对象，绝不原地修改入参**。
 * （历史上"原地改字段不落库/不生效"的坑正是来自就地修改，这里从数据结构上杜绝。）
 *
 * 数据形状 EnergyState：
 *   { energy, combo, bestCombo, hits, misses, timeouts, lastGain }
 *   - energy    累计能量（≥ 0）
 *   - combo     当前连击数（命中 +1，点错清零，空轮不变）
 *   - bestCombo 本局最高连击
 *   - lastGain  最近一次操作的净变化（命中为正、失误为负、空轮为 0），供 UI 飘字用
 */

const {
  HIT_ENERGY,
  MISS_PENALTY,
  MIN_ENERGY,
  COMBO_BONUS,
  COMBO_HIGH_FROM,
  COMBO_BONUS_MAX,
  DISPLACEMENT_FACTOR,
  DISPLACEMENT_MAX_PX,
  DRAW_BAND_PX,
} = require('../config/config.js');

/** 空能量状态（开局值）。 */
function createEnergyState() {
  return { energy: 0, combo: 0, bestCombo: 0, hits: 0, misses: 0, timeouts: 0, lastGain: 0 };
}

/**
 * 连击加成（§6.2 连击表）：
 *   第 3 次命中 +2；第 5 次命中 +4；第 8 次及以后每次 +6；其余为 0。
 * @param {number} comboAfterHit 计入本次命中后的连击数
 */
function comboBonus(comboAfterHit) {
  if (comboAfterHit >= COMBO_HIGH_FROM) return COMBO_BONUS[String(COMBO_HIGH_FROM)] || COMBO_BONUS_MAX;
  const exact = COMBO_BONUS[String(comboAfterHit)];
  return exact === undefined ? 0 : exact;
}

/**
 * 命中一次。
 * @param {object} state 能量状态
 * @param {number} [jitter] 可选浮动系数（AI 对手的 ±10% 浮动，见 §6.4）；可缺省＝精确值
 * @returns {object} 新状态
 */
function applyHit(state, jitter) {
  const combo = state.combo + 1;
  const base = HIT_ENERGY + comboBonus(combo);
  const gain = jitter === undefined ? base : Math.max(1, Math.round(base * jitter));
  return {
    ...state,
    energy: state.energy + gain,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    hits: state.hits + 1,
    lastGain: gain,
  };
}

/**
 * 点错一次：扣分并清零连击（已获能量保留，不出现负能量）。
 * @returns {object} 新状态
 */
function applyMiss(state) {
  const delta = Math.min(state.energy, MISS_PENALTY);
  return {
    ...state,
    energy: Math.max(MIN_ENERGY, state.energy - delta),
    combo: 0,
    misses: state.misses + 1,
    lastGain: delta === 0 ? 0 : -delta, // 避免出现 -0（能量已为 0 时扣减为 0）
  };
}

/**
 * 空轮（窗口内未操作）：不增不减、**不清零连击**（§6.2「空轮不计能量」；
 * 只有「点错」才中断连击）。
 * @returns {object} 新状态
 */
function applyTimeout(state) {
  return { ...state, timeouts: state.timeouts + 1, lastGain: 0 };
}

/**
 * 绳子位移（§2.4 公式）：(我方能量 - 对方能量) × 位移系数，并夹在 ±上限内。
 * 正值 = 绳子被我方拉向己侧。
 */
function displacement(myEnergy, oppEnergy) {
  const raw = (myEnergy - oppEnergy) * DISPLACEMENT_FACTOR;
  return Math.max(-DISPLACEMENT_MAX_PX, Math.min(DISPLACEMENT_MAX_PX, raw));
}

/**
 * 绳子状态：
 *   'win'     位移达到 +上限（我方越线）
 *   'lose'    位移达到 -上限（对方越线）
 *   'even'    位移落在 ±平局带宽内
 *   'ongoing' 其余（对局继续）
 */
function ropeState(myEnergy, oppEnergy) {
  const px = displacement(myEnergy, oppEnergy);
  if (px >= DISPLACEMENT_MAX_PX) return 'win';
  if (px <= -DISPLACEMENT_MAX_PX) return 'lose';
  if (Math.abs(px) <= DRAW_BAND_PX) return 'even';
  return 'ongoing';
}

/**
 * 对局结果（把 'even' 折叠为 'draw'，供结算页直接使用）：
 *   'win' | 'lose' | 'draw' | 'ongoing'
 */
function outcome(myEnergy, oppEnergy) {
  const s = ropeState(myEnergy, oppEnergy);
  return s === 'even' ? 'draw' : s;
}

/**
 * 终局判定（§2.3 胜负规则）：
 *   - 已越线 → 立即结算（抢先判定，不等倒计时）；
 *   - 未越线且未超时 → null（对局继续）；
 *   - 超时 → 按位移比较：偏向谁谁胜，落在带宽内判平局。
 * @returns {'win'|'lose'|'draw'|null}
 */
function finalResult(myEnergy, oppEnergy, timeUp) {
  const s = ropeState(myEnergy, oppEnergy);
  if (s === 'win' || s === 'lose') return s;
  if (!timeUp) return null;
  if (s === 'even') return 'draw';
  return displacement(myEnergy, oppEnergy) > 0 ? 'win' : 'lose';
}

module.exports = {
  createEnergyState,
  comboBonus,
  applyHit,
  applyMiss,
  applyTimeout,
  displacement,
  ropeState,
  outcome,
  finalResult,
};
