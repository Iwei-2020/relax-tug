'use strict';

/**
 * 回合生成与判定单测
 *
 * 依据：《项目说明书》§2.2（每轮判定时序）、§3.3（候选色数量受难度控制）、§6.4（难度曲线）。
 * 覆盖：各难度档的候选色数量、目标色唯一存在、选项去重、输入窗口时长、判定口径、种子可复现。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRound, judge, difficultyOf } = require('../minigame/src/core/matcher.js');
const { DIFFICULTY, PALETTE } = require('../minigame/src/config/config.js');
const { createRng } = require('../minigame/src/core/rng.js');

test('createRound：候选色数量与输入窗口严格跟随难度档（§6.4）', () => {
  const rand = createRng(1);
  for (const key of Object.keys(DIFFICULTY)) {
    const round = createRound(key, rand);
    assert.equal(round.optionIds.length, DIFFICULTY[key].candidates, `${key} 候选色数量不符`);
    assert.equal(round.windowMs, DIFFICULTY[key].windowMs, `${key} 输入窗口不符`);
    assert.equal(round.difficulty, key);
  }
});

test('createRound：目标色必然出现在候选集中且候选色互不重复、均来自调色板', () => {
  const rand = createRng(20261019);
  const ids = new Set(PALETTE.map((c) => c.id));
  for (let i = 0; i < 200; i += 1) {
    const round = createRound('hell', rand); // 最严苛：9 个候选
    assert.ok(round.optionIds.includes(round.targetId), '目标色必须可在底部找到唯一正确答案');
    assert.equal(new Set(round.optionIds).size, round.optionIds.length, '候选色不得重复');
    for (const id of round.optionIds) assert.ok(ids.has(id), `候选色 ${id} 不在调色板内`);
  }
});

test('createRound：非法难度 key 回落默认档（normal）', () => {
  const round = createRound('unknown-key', createRng(7));
  assert.equal(round.difficulty, 'normal');
  assert.equal(round.optionIds.length, DIFFICULTY.normal.candidates);
  assert.equal(difficultyOf('unknown-key').windowMs, DIFFICULTY.normal.windowMs);
});

test('judge：判定口径为「是否正确点击了目标色」，与点击次数无关（§2.2）', () => {
  assert.equal(judge('red', 'red'), true);
  assert.equal(judge('red', 'blue'), false);
});

test('createRound：同一种子可复现同一轮（支持回放与稳定单测）', () => {
  const a = createRound('normal', createRng(42));
  const b = createRound('normal', createRng(42));
  assert.deepEqual(a, b);
});
