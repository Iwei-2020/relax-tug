'use strict';

/**
 * 回合生成与判定（《项目说明书》§2.2 对战流程「每轮判定时序」+ §3.2 / §3.3）
 *
 * 一轮 = 一条 **N 段目标颜色序列** + 一组候选色（含每个目标色与干扰色）+ 每段的输入窗口时长。
 * 玩家需按序列从左到右**依次**点中每段：点对一段即结算一次命中并推进到下一段；
 * 点错或某段超时则本轮立即结束。判定只看「点击的是不是当前段的目标色」，与点击次数无关。
 *
 * 序列内颜色互不重复（见 colors.pickSequence），因此候选面板中每个目标色恰好只有一块，
 * 每段仍存在「唯一且明确」的正确答案（§3.2）。
 */

const { DIFFICULTY, DEFAULT_DIFFICULTY, SEQUENCE_LENGTH } = require('../config/config.js');
const { pickSequence, pickDistractors, shuffle } = require('./colors.js');

/** 取难度档参数；非法 key 回落默认档（普通）。 */
function difficultyOf(key) {
  return DIFFICULTY[key] || DIFFICULTY[DEFAULT_DIFFICULTY];
}

/**
 * 生成一轮。
 * @param {string} difficultyKey easy | normal | hard | hell
 * @param {() => number} rand 伪随机源（见 core/rng.js）
 * @returns {{targetIds:string[], seqIndex:number, done:boolean, optionIds:string[], windowMs:number, difficulty:string}}
 */
function createRound(difficultyKey, rand) {
  const difficulty = DIFFICULTY[difficultyKey] ? difficultyKey : DEFAULT_DIFFICULTY;
  const diff = difficultyOf(difficulty);
  const sequence = pickSequence(SEQUENCE_LENGTH, rand);
  const targetIds = sequence.map((c) => c.id);
  const distractors = pickDistractors(targetIds, diff.candidates - targetIds.length, rand);
  const options = shuffle(sequence.concat(distractors), rand);
  return {
    targetIds,
    seqIndex: 0, // 当前待点段的下标（0 起）
    done: false, // 本轮是否已结束（走完序列 / 点错 / 超时）
    optionIds: options.map((c) => c.id),
    windowMs: diff.windowMs, // **每段**的输入窗口（不是整轮的时长）
    difficulty,
  };
}

/**
 * 当前待点段的目标色 id；序列不存在或已走完时返回 null。
 */
function currentTargetId(round) {
  if (!round || !round.targetIds) return null;
  const id = round.targetIds[round.seqIndex];
  return id === undefined ? null : id;
}

/**
 * 判定一次点击是否命中：命中的是「是否正确点击了当前段的目标色」。
 */
function judge(targetId, clickedId) {
  return targetId === clickedId;
}

/** 候选色数量（供渲染层排布网格）。 */
function optionCount(round) {
  return round.optionIds.length;
}

module.exports = { createRound, currentTargetId, judge, difficultyOf, optionCount };
