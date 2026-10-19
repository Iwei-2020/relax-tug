'use strict';

/**
 * 确定性伪随机源（mulberry32）
 *
 * 为什么不用 `Math.random`：回合生成（目标色 + 干扰色）、AI 对手的命中/失误判定都需要
 * **可复现**，否则单测无法稳定断言、线上问题也无法用种子回放。生产环境可用时间戳做种子，
 * 测试环境传入固定种子即可逐次复现同一条对局。
 */

/**
 * @param {number} seed 32 位整数种子（0 会被替换为 1，避免全零序列退化）
 * @returns {() => number} 返回 [0, 1) 的伪随机函数
 */
function createRng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从数组中等概率取一个元素；空数组返回 undefined。 */
function pick(list, rand) {
  if (!list || list.length === 0) return undefined;
  return list[Math.floor(rand() * list.length) % list.length];
}

/** 以概率 p 命中的布尔判定。 */
function chance(p, rand) {
  return rand() < p;
}

/** [minInclusive, maxInclusive] 闭区间内的整型随机数。 */
function randInt(minInclusive, maxInclusive, rand) {
  const span = maxInclusive - minInclusive + 1;
  return minInclusive + Math.floor(rand() * span);
}

/**
 * 32 位字符串哈希（FNV-1a）：把「日期 + 难度」这类可读键稳定折叠成一个整数种子。
 * 目的：同一 key 在任何设备、任何时刻都得到同一 seed，天然支持「同日同题」。
 * @param {string} key
 * @returns {number} 32 位无符号整数（可能为 0，createRng 内部会兜底为 1）
 */
function hashSeed(key) {
  const s = String(key);
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h >>> 0;
}

/**
 * 每日挑战种子（《项目说明书》§4.4）：按「自然日（UTC+8）+ 难度档」派生。
 * 同一自然日 + 同一难度 → 同一局（同序列、同 AI 行为），不同设备结果一致；
 * 种子完全由客户端推导，**无需服务端下发**。
 * @param {number} nowMs 当前时间戳（毫秒）
 * @param {string} difficultyKey 难度档
 * @returns {number} 32 位整数种子
 */
function dailyChallengeSeed(nowMs, difficultyKey) {
  const dayKey = new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10); // UTC+8 自然日
  return hashSeed(`${dayKey}|${difficultyKey}`);
}

module.exports = { createRng, pick, chance, randInt, hashSeed, dailyChallengeSeed };
