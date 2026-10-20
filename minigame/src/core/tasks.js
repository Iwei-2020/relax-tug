'use strict';

/**
 * 每日任务核心（《项目说明书》§4.7 每日任务与宝箱 + §6.6 数值）
 *
 * 纯函数：进度状态是「普通对象 + 普通对象」的可序列化结构，便于落本地存储与上报服务端。
 * 刷新口径：全部按 **UTC+8 自然日** 切分（`core/rng.utc8DayKey`），跨日由 `rollover` 归零重开，
 * **不跨日结转**（§4.7）——与服务端 `rt_counters` 的 `openid:day` 文档天然同一天。
 *
 * 数据形状 TaskState：
 *   { day, progress: { [taskId]: number }, claimed: { [taskId]: true }, chestClaimed: boolean }
 */

const { DAILY_TASKS } = require('../config/config.js');

/** 空任务状态。 */
function emptyTasks(day) {
  return { day: day || '', progress: {}, claimed: {}, chestClaimed: false };
}

/** 本局对某指标贡献的增量（§6.6 的 metric 定义）。 */
function metricValue(summary, metric) {
  const s = summary || {};
  switch (metric) {
    case 'matches':
      return 1; // 每局固定 +1
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

/**
 * 一局结算后累计进度（返回新对象）。
 * mode：'count' 每局 +0/1；'sum' 累加；'max' 取最大（非累加，避免多局堆高）。
 * @param {object} state TaskState
 * @param {object} summary core/battle.summary
 */
function applyMatch(state, summary, cfg) {
  const c = cfg || DAILY_TASKS;
  const st = state || emptyTasks();
  const progress = { ...st.progress };
  for (let i = 0; i < c.pool.length; i += 1) {
    const task = c.pool[i];
    const inc = metricValue(summary, task.metric);
    const prev = progress[task.id] || 0;
    progress[task.id] = task.mode === 'max' ? Math.max(prev, inc) : prev + inc;
  }
  return { ...st, progress };
}

/**
 * 任务状态列表（供 UI 展示与服务端领奖校验）。
 * 每条：`{ id, name, goal, progress（已夹到 goal）, done, claimed, claimable, coins }`。
 */
function taskStates(state, cfg) {
  const c = cfg || DAILY_TASKS;
  const st = state || emptyTasks();
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

/** 宝箱状态（供 UI）：`{ coins, ready, claimed, claimable }`。 */
function chestState(state, cfg) {
  const c = cfg || DAILY_TASKS;
  const st = state || emptyTasks();
  const ready = allDone(st, c);
  const claimed = st.chestClaimed === true;
  return { coins: c.chestCoins, ready, claimed, claimable: ready && !claimed };
}

/** 宝箱是否可领（全部达成且当日未领过）。 */
function chestClaimable(state, cfg) {
  const st = state || emptyTasks();
  return allDone(st, cfg) && st.chestClaimed !== true;
}

/** 待领取任务 id 列表（供首页红点）。 */
function claimableIds(state, cfg) {
  return taskStates(state, cfg)
    .filter((t) => t.claimable)
    .map((t) => t.id);
}

/**
 * 领取单个任务（幂等）：未达成 / 已领 / 未知任务一律不改状态、不发奖。
 * @returns {{state:object, coins:number, ok:boolean, reason:string}}
 */
function claim(state, taskId, cfg) {
  const c = cfg || DAILY_TASKS;
  const st = state || emptyTasks();
  const task = c.pool.find((t) => t.id === taskId);
  if (!task) return { state: st, coins: 0, ok: false, reason: 'unknown-task' };
  if ((st.progress[taskId] || 0) < task.goal) return { state: st, coins: 0, ok: false, reason: 'not-done' };
  if (st.claimed[taskId] === true) return { state: st, coins: 0, ok: false, reason: 'already-claimed' };
  return { state: { ...st, claimed: { ...st.claimed, [taskId]: true } }, coins: task.coins, ok: true, reason: 'ok' };
}

/** 领取宝箱（幂等）：需全部任务达成且当日未领。 */
function claimChest(state, cfg) {
  const c = cfg || DAILY_TASKS;
  const st = state || emptyTasks();
  if (!allDone(st, c)) return { state: st, coins: 0, ok: false, reason: 'not-all-done' };
  if (st.chestClaimed === true) return { state: st, coins: 0, ok: false, reason: 'already-claimed' };
  return { state: { ...st, chestClaimed: true }, coins: c.chestCoins, ok: true, reason: 'ok' };
}

/** 跨日重置：`day` 与当前状态不同则回到空状态（不结转，§4.7）。 */
function rollover(state, day) {
  const st = state || emptyTasks();
  return st.day === day ? st : emptyTasks(day);
}

/** 归一化：把存储里读到的任意形态收敛成合法 TaskState（并按 day 做跨日重置）。 */
function normalizeTasks(raw, day) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const st = emptyTasks(r.day || '');
  st.progress = r.progress && typeof r.progress === 'object' ? { ...r.progress } : {};
  st.claimed = r.claimed && typeof r.claimed === 'object' ? { ...r.claimed } : {};
  st.chestClaimed = r.chestClaimed === true;
  return rollover(st, day);
}

/**
 * 由服务端回执还原 TaskState（§4.6 对账用）。
 * 服务端返回 `{ tasks: [{id, progress, claimed, ...}], chest: { claimed } }`（见 lib/tasks.summaryOf）。
 */
function fromServer(summary, day) {
  const list = summary && Array.isArray(summary.tasks) ? summary.tasks : [];
  const chest = (summary && summary.chest) || {};
  const progress = {};
  const claimed = {};
  for (let i = 0; i < list.length; i += 1) {
    const t = list[i];
    if (!t || !t.id) continue;
    progress[t.id] = Math.max(0, Math.floor(t.progress || 0));
    if (t.claimed === true) claimed[t.id] = true;
  }
  return { day: day || '', progress, claimed, chestClaimed: chest.claimed === true };
}

module.exports = {
  emptyTasks,
  metricValue,
  applyMatch,
  taskStates,
  allDone,
  chestState,
  chestClaimable,
  claimableIds,
  claim,
  claimChest,
  rollover,
  normalizeTasks,
  fromServer,
};
