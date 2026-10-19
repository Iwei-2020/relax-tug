'use strict';

/**
 * 颜色工具（《项目说明书》§3.2 / §3.3）
 *
 * 约束（美术 / 研发共同遵守）：
 *   - 颜色即唯一标识，禁止用文字标色名替代色块；
 *   - 目标色必须能在候选面板中找到「唯一且明确」的正确答案；
 *   - 候选色数量受难度控制（4 / 6 / 9），干扰色取自同一调色板（近似色天然构成干扰）。
 *
 * 本模块是纯函数，不依赖渲染。
 */

const { PALETTE } = require('../config/config.js');
const { pick } = require('./rng.js');

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
 * 取干扰色：调色板中除目标色外，随机取 count 个且互不重复。
 * 调色板共 9 色，故 candidates ≤ 9 时（= 难度档最大值）必然够用。
 */
function pickDistractors(targetId, count, rand) {
  const pool = PALETTE.filter((c) => c.id !== targetId).slice();
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

/** 随机取一个目标色条目。 */
function pickTarget(rand) {
  return pick(PALETTE, rand);
}

module.exports = { hexOf, colorOf, pickDistractors, shuffle, pickTarget };
