'use strict';

/**
 * 随机事件核心（《项目说明书》§6.5 随机事件）
 *
 * 定位：在「点色块 → 涨能量」的稳定循环里注入**局内临时修饰**，制造"这一局不一样"
 * 的新鲜感，同时**绝不改变胜负条件**（越线净能量差 / 平局带宽一律不动）。
 *
 * 设计原则（与 core 其它模块一致）：
 *   1) **纯函数**：全部返回新状态，绝不原地修改入参（便于单测与状态快照序列化）；
 *   2) **种子驱动**：触发时机与具体事件全部来自调用方传入的 `rand`（`createRng(seed)`），
 *      与回合序列共用同一随机流 → 每日挑战局「同日同题」的自然延续，可复现、可回放；
 *   3) **频率上限**：每局最多 maxPerMatch 次，前 firstCheckRound 轮热身，之后每
 *      checkEveryRounds 轮检查一次，已有事件生效时不叠加。
 *
 * 事件效果只允许三类：`energyScale`（我方命中能量倍率）、`windowScale`（每段输入窗口缩放）、
 * `fog`（纯视觉遮挡）。任何试图修改胜负判定的字段都不在事件池的合法取值内。
 */

const { RANDOM_EVENTS } = require('../config/config.js');

/** 事件定义查表；未命中返回 null。 */
function findEvent(id) {
  const pool = RANDOM_EVENTS.pool;
  if (!id || !pool) return null;
  for (let i = 0; i < pool.length; i += 1) {
    if (pool[i].id === id) return pool[i];
  }
  return null;
}

/** 初始事件状态（挂在对局状态 `match.events` 上）。 */
function createEventState() {
  return {
    fired: 0, // 本局已触发次数（用于频率上限与结算上报）
    nextCheckRound: RANDOM_EVENTS.firstCheckRound, // 下一次检查所在的轮次下标
    activeId: null, // 当前生效的事件 id；null 表示无事件
    activeLeftMs: 0, // 当前事件剩余时长
    firedIds: [], // 本局触发过的事件 id 序列（回放 / 埋点用）
  };
}

/** 当前生效的事件定义（直接返回事件池条目，稳定引用，不产生新对象）。 */
function activeEvent(state) {
  return state && state.activeId ? findEvent(state.activeId) : null;
}

/**
 * 按真实时间衰减当前事件；到期自动失效。
 * @param {object} state 事件状态
 * @param {number} dtMs 本次经过的时间（毫秒）
 * @returns {object} 新事件状态
 */
function tick(state, dtMs) {
  if (!state || state.activeLeftMs <= 0) return state;
  const left = state.activeLeftMs - Math.max(0, dtMs || 0);
  if (left > 0) return { ...state, activeLeftMs: left };
  return { ...state, activeId: null, activeLeftMs: 0 };
}

/** 按权重确定性抽取一个事件（rand 驱动；池为空返回 null）。 */
function pickWeighted(pool, rand) {
  if (!pool || pool.length === 0) return null;
  let total = 0;
  for (let i = 0; i < pool.length; i += 1) total += pool[i].weight || 1;
  if (total <= 0) return null;
  let r = rand() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= pool[i].weight || 1;
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * 轮间检查是否触发随机事件（在每轮刷新前调用）。
 *
 * 不触发的三种情形一律**原样返回入参**（不新建对象）：
 *   - 功能关闭 / 已用满上限；
 *   - 已有事件生效中（不叠加）；
 *   - 未到检查轮次。
 * 到了检查轮次但掷骰未中时，只推进 `nextCheckRound`。
 *
 * @param {object} state 事件状态
 * @param {number} roundIndex 当前已完成的轮次下标（= 即将开始的新一轮的序号）
 * @param {() => number} rand 伪随机源
 * @returns {object} 新事件状态
 */
function maybeTrigger(state, roundIndex, rand) {
  const cfg = RANDOM_EVENTS;
  const s = state || createEventState();
  if (!cfg.enabled) return s;
  if (s.fired >= cfg.maxPerMatch) return s;
  if (s.activeLeftMs > 0) return s;
  if (roundIndex < s.nextCheckRound) return s;

  const nextCheckRound = roundIndex + cfg.checkEveryRounds;
  if (rand() >= cfg.chance) return { ...s, nextCheckRound };

  const ev = pickWeighted(cfg.pool, rand);
  if (!ev) return { ...s, nextCheckRound };

  return {
    ...s,
    fired: s.fired + 1,
    nextCheckRound,
    activeId: ev.id,
    activeLeftMs: cfg.durationMs,
    firedIds: s.firedIds.concat([ev.id]),
  };
}

module.exports = { createEventState, findEvent, activeEvent, tick, maybeTrigger };
