'use strict';

/**
 * 回合生成与判定（《项目说明书》§2.2 对战流程「每轮判定时序」+ §3.2 / §3.3）
 *
 * 一轮 = 一个目标色 + 一组候选色（含目标色与干扰色）+ 一个输入窗口时长。
 * 判定只看「点击的是不是目标色」，与点击次数无关。
 */

const { DIFFICULTY, DEFAULT_DIFFICULTY } = require('../config/config.js');
const { pickTarget, pickDistractors, shuffle } = require('./colors.js');

/** 取难度档参数；非法 key 回落默认档（普通）。 */
function difficultyOf(key) {
  return DIFFICULTY[key] || DIFFICULTY[DEFAULT_DIFFICULTY];
}

/**
 * 生成一轮。
 * @param {string} difficultyKey easy | normal | hard | hell
 * @param {() => number} rand 伪随机源（见 core/rng.js）
 * @returns {{targetId:string, optionIds:string[], windowMs:number, difficulty:string}}
 */
function createRound(difficultyKey, rand) {
  const difficulty = DIFFICULTY[difficultyKey] ? difficultyKey : DEFAULT_DIFFICULTY;
  const diff = difficultyOf(difficulty);
  const target = pickTarget(rand);
  const distractors = pickDistractors(target.id, diff.candidates - 1, rand);
  const options = shuffle([target, ...distractors], rand);
  return {
    targetId: target.id,
    optionIds: options.map((c) => c.id),
    windowMs: diff.windowMs,
    difficulty,
  };
}

/**
 * 判定本轮点击是否命中：命中的是「是否正确点击了目标色」。
 * 目标色在候选集中必然唯一存在（见 colors.pickDistractors 的排除逻辑）。
 */
function judge(targetId, clickedId) {
  return targetId === clickedId;
}

/** 候选色数量（供渲染层排布网格）。 */
function optionCount(round) {
  return round.optionIds.length;
}

module.exports = { createRound, judge, difficultyOf, optionCount };
