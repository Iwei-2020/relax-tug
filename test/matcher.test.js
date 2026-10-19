'use strict';

/**
 * 回合生成与判定单测
 *
 * 依据：《项目说明书》§2.2（每轮判定时序，目标为 N 段颜色序列）、§3.3（候选色数量受难度控制）、§6.4（难度曲线）。
 * 覆盖：各难度档的候选色数量、每段目标色在候选集中唯一可得、选项去重、输入窗口时长、判定口径、种子可复现。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRound, currentTargetId, judge, judgeGrade, difficultyOf } = require('../minigame/src/core/matcher.js');
const { DIFFICULTY, PALETTE, SEQUENCE_LENGTH, PERFECT_WINDOW_RATIO } = require('../minigame/src/config/config.js');
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

test('createRound：目标为 N 段互不重复的序列，每段都能在候选集中找到唯一答案', () => {
  const rand = createRng(20261019);
  const ids = new Set(PALETTE.map((c) => c.id));
  for (let i = 0; i < 200; i += 1) {
    const round = createRound('hell', rand); // 最严苛：9 个候选
    assert.equal(round.targetIds.length, SEQUENCE_LENGTH, '目标应为固定 N 段序列');
    assert.equal(new Set(round.targetIds).size, round.targetIds.length, '序列内颜色不得重复');
    for (const id of round.targetIds) {
      assert.ok(round.optionIds.includes(id), `目标段 ${id} 必须可在底部找到唯一正确答案`);
    }
    assert.equal(new Set(round.optionIds).size, round.optionIds.length, '候选色不得重复');
    for (const id of round.optionIds) assert.ok(ids.has(id), `候选色 ${id} 不在调色板内`);
    assert.equal(round.seqIndex, 0, '新的一轮从第 0 段开始');
    assert.equal(round.done, false);
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

test('judgeGrade：点对按时机分「完美 / 普通」，点错归 miss（§2.2 / §6.2 判定分档）', () => {
  const W = 1000;
  const edge = Math.floor(W * PERFECT_WINDOW_RATIO); // 完美窗口的右边界（含）

  assert.equal(judgeGrade('red', 'red', 0, W), 'perfect', '窗口开启瞬间点中应为完美');
  assert.equal(judgeGrade('red', 'red', edge, W), 'perfect', '完美窗口边界（含）仍为完美');
  assert.equal(judgeGrade('red', 'red', edge + 1, W), 'good', '边界之后为普通');
  assert.equal(judgeGrade('red', 'red', W, W), 'good', '窗口末点中为普通');
  assert.equal(judgeGrade('red', 'red', W * 2, W), 'good', '超出窗口（本不应发生）仍按普通处理');

  assert.equal(judgeGrade('red', 'blue', 1, W), 'miss', '点错不参与分档');
  assert.equal(judgeGrade('red', 'red', 0, 0), 'good', '窗口非法（0）时不给完美，避免除零');
});

test('currentTargetId：随 seqIndex 逐段推进，走完序列或缺失时返回 null', () => {
  const round = createRound('normal', createRng(1));
  const ids = round.targetIds;
  for (let i = 0; i < ids.length; i += 1) {
    assert.equal(currentTargetId({ ...round, seqIndex: i }), ids[i], `第 ${i} 段目标色应逐段推进`);
  }
  assert.equal(currentTargetId({ ...round, seqIndex: ids.length }), null, '走完序列后无当前段');
  assert.equal(currentTargetId(null), null);
});

test('createRound：同一种子可复现同一轮（支持回放与稳定单测）', () => {
  const a = createRound('normal', createRng(42));
  const b = createRound('normal', createRng(42));
  assert.deepEqual(a, b);
});
