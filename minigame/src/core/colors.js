'use strict';

/**
 * 颜色工具（《项目说明书》§2.2 / §3.2 / §3.3）
 *
 * 约束（美术 / 研发共同遵守）：
 *   - 颜色即唯一标识，禁止用文字标色名替代色块；
 *   - 一轮的目标是一条 **N 段颜色序列**（§2.2），序列内颜色互不重复，
 *     且每个目标色在候选面板中都恰好只有一块 —— 即每段仍有「唯一且明确」的正确答案；
 *   - 候选色数量受难度控制（4 / 6 / 9），干扰色取自同一调色板（近似色天然构成干扰）。
 *
 * 本模块是纯函数，不依赖渲染。
 */

const { PALETTE } = require('../config/config.js');

/** id → hex。未命中返回中性灰，避免渲染层因 undefined 崩溃。 */
function hexOf(id) {
  const entry = PALETTE.find((c) => c.id === id);
  return entry ? entry.hex : '#9E9E9E';
}

/** id → 调色板条目（含 name），未命中返回 null。 */
function colorOf(id) {
  return PALETTE.find((c) => c.id === id) || null;
}

/**
 * 取一条目标颜色序列（段内互不重复）。
 * 互不重复是刻意的：这样候选面板里每个目标色只有一块，玩家每段仍只需找「唯一答案」，
 * 不会出现两块同色导致的「点哪块才对」歧义。
 * @param {number} length 序列段数（= config.sequenceLength）
 * @param {() => number} rand 伪随机源
 * @returns {object[]} 调色板条目数组
 */
function pickSequence(length, rand) {
  const pool = PALETTE.slice();
  const out = [];
  while (out.length < length && pool.length > 0) {
    const idx = Math.floor(rand() * pool.length) % pool.length;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * 取干扰色：调色板中排除给定目标色后，随机取 count 个且互不重复。
 * @param {string|string[]} excludeIds 目标序列的颜色 id（单个或多个）
 * @param {number} count 需要的干扰色个数
 * @param {() => number} rand 伪随机源
 */
function pickDistractors(excludeIds, count, rand) {
  const exclude = Array.isArray(excludeIds) ? excludeIds : [excludeIds];
  const pool = PALETTE.filter((c) => exclude.indexOf(c.id) === -1).slice();
  const out = [];
  while (out.length < count && pool.length > 0) {
    const idx = Math.floor(rand() * pool.length) % pool.length;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/** Fisher–Yates 洗牌（返回新数组，不改动入参）。 */
function shuffle(list, rand) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1)) % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

module.exports = { hexOf, colorOf, pickSequence, pickDistractors, shuffle };
