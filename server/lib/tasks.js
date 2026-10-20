'use strict';

/**
 * 服务端每日任务（《项目说明书》§4.7 每日任务与宝箱 + §6.6 数值）
 *
 * 与客户端 `minigame/src/core/tasks.js` **同一套公式、同一份参数**（constants.DAILY_TASKS 镜像），
 * 由 `test/progression.test.js` 交叉校验两端等价。
 *
 * 存储形态：进度与领奖状态**扁平地挂在当日计数器**（`rt_counters` 的 `openid:day` 文档）上，
 * 与广告频次共享同一份「今天」，因此天然满足 §4.7「与每日挑战同一把尺子」的刷新口径。
 * 纯函数一律返回新对象（`store` 读出的对象只是浅拷贝，原地改不会落库）。
 */

const { DAILY_TASKS } = require('./constants.js');

/** 本局对某指标的增量（§6.6 metric 定义）。 */
function metricValue(summary, metric) {
  const s = summary || {};
  switch (metric) {
    case 'matches':
      return 1;
    case 'wins':
      return s.result === 'win' ? 1 : 0;
    case 'perfectHits':
      return Math.max(0, Math.floor(s.perfectHits || 0));
    case 'bestCombo':
      return Math.max(0, Math.floor(s.bestCombo || 0));
    default:
      return 0;
  }
}

/** 计数器 → 纯状态（供下列纯函数使用）。 */
function stateFromCounter(counter, day) {
  const c = counter || {};
  return {
    day: day || '',
    progress: c.taskProgress && typeof c.taskProgress === 'object' ? { ...c.taskProgress } : {},
    claimed: c.taskClaimed && typeof c.taskClaimed === 'object' ? { ...c.taskClaimed } : {},
    chestClaimed: c.chestClaimed === true,
  };
}

/** 纯状态 → 计数器字段（写回时合并进 counter）。 */
function counterFields(state) {
  return {
    taskProgress: { ...state.progress },
    taskClaimed: { ...state.claimed },
    chestClaimed: state.chestClaimed === true,
  };
}

/** 一局结算后累计进度（返回新状态）。 */
function applyMatch(state, summary, cfg) {
  const c = cfg || DAILY_TASKS;
  const st = state || stateFromCounter(null, '');
  const progress = { ...st.progress };
  for (let i = 0; i < c.pool.length; i += 1) {
    const task = c.pool[i];
    const inc = metricValue(summary, task.metric);
    const prev = progress[task.id] || 0;
    progress[task.id] = task.mode === 'max' ? Math.max(prev, inc) : prev + inc;
  }
  return { ...st, progress };
}

/** 任务状态列表（供回执与领奖校验）。 */
function taskStates(state, cfg) {
  const c = cfg || DAILY_TASKS;
  const st = state || stateFromCounter(null, '');
  return c.pool.map((task) => {
    const raw = st.progress[task.id] || 0;
    const claimed = st.claimed[task.id] === true;
    const done = raw >= task.goal;
    return {
      id: task.id,
      name: task.name,
      goal: task.goal,
      progress: Math.min(raw, task.goal),
      done,
      claimed,
      claimable: done && !claimed,
      coins: task.coins,
    };
  });
}

/** 全部任务是否达成。 */
function allDone(state, cfg) {
  return taskStates(state, cfg).every((t) => t.done);
}

/** 宝箱状态（含是否可领）。 */
function chestState(state, cfg) {
  const c = cfg || DAILY_TASKS;
  const st = state || stateFromCounter(null, '');
  const ready = allDone(st, c);
  const claimed = st.chestClaimed === true;
  return { coins: c.chestCoins, ready, claimed, claimable: ready && !claimed };
}

/** 领取单个任务（幂等）。 */
function claim(state, taskId, cfg) {
  const c = cfg || DAILY_TASKS;
  const st = state || stateFromCounter(null, '');
  const task = c.pool.find((t) => t.id === taskId);
  if (!task) return { state: st, coins: 0, ok: false, reason: 'unknown-task' };
  if ((st.progress[taskId] || 0) < task.goal) return { state: st, coins: 0, ok: false, reason: 'not-done' };
  if (st.claimed[taskId] === true) return { state: st, coins: 0, ok: false, reason: 'already-claimed' };
  return { state: { ...st, claimed: { ...st.claimed, [taskId]: true } }, coins: task.coins, ok: true, reason: 'ok' };
}

/** 领取宝箱（幂等）。 */
function claimChest(state, cfg) {
  const c = cfg || DAILY_TASKS;
  const st = state || stateFromCounter(null, '');
  if (!allDone(st, c)) return { state: st, coins: 0, ok: false, reason: 'not-all-done' };
  if (st.chestClaimed === true) return { state: st, coins: 0, ok: false, reason: 'already-claimed' };
  return { state: { ...st, chestClaimed: true }, coins: c.chestCoins, ok: true, reason: 'ok' };
}

/** 回执用的任务汇总：`{ tasks, chest }`。 */
function summaryOf(state, cfg) {
  return { tasks: taskStates(state, cfg), chest: chestState(state, cfg) };
}

module.exports = {
  metricValue,
  stateFromCounter,
  counterFields,
  applyMatch,
  taskStates,
  allDone,
  chestState,
  claim,
  claimChest,
  summaryOf,
};
