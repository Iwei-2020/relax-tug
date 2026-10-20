'use strict';

/**
 * 云函数 dailyTasks —— 每日任务状态与领奖（《项目说明书》§4.7 每日任务与宝箱）
 *
 * 平台契约：入口 `module.exports = async function (params, context)`，`params` 即 HTTP 请求体，
 * 返回值作为 Response Body（调用路径 = 文件名 `/dailyTasks`）。身份：请求头 `X-TT-OPENID`（lib/identity.js）。
 *
 * action：
 *   - `state`（默认）：返回当日任务进度与宝箱状态 + 权威进度（金币等）
 *   - `claim`：领取单条任务（需 `taskId`），幂等
 *   - `chest`：领取每日宝箱（全部任务达成时），幂等
 *
 * 刷新口径：与每日挑战、广告频次同一天 —— 复用 `lib/result.js` 的 `dayKey`（UTC+8 自然日），
 * 计数器文档 `openid:day` 即「今天」的任务状态载体（§4.7「同一把尺子」）。
 */

const { CODES, ok, fail, fromError } = require('../../lib/envelope.js');
const { openidFromContext } = require('../../lib/identity.js');
const { getStore } = require('../../lib/store-provider.js');
const { emptyCounter } = require('../../lib/store.js');
const { dayKey } = require('../../lib/result.js');
const { stateFromCounter, counterFields, summaryOf, claim, claimChest } = require('../../lib/tasks.js');
const { progressOf } = require('../../lib/progression.js');

/** 档案兜底（首次交互的玩家尚无档案）。 */
function emptyProfile(openid, nowMs) {
  return { openid, nickname: '', wins: 0, matches: 0, exp: 0, coins: 0, createdAt: nowMs };
}

module.exports = async function dailyTasks(params, context) {
  try {
    const openid = openidFromContext(context);
    if (!openid) return fail(CODES.BAD_REQUEST, '缺少调用方身份（X-TT-OPENID）');

    const p = params || {};
    const action = p.action || 'state';
    const store = getStore();
    const nowMs = Date.now();
    const day = dayKey(nowMs);

    const profile = (await store.getProfile(openid)) || emptyProfile(openid, nowMs);
    const counter = (await store.countersOf(openid, day)) || emptyCounter();
    const state = stateFromCounter(counter, day);

    if (action === 'state') {
      return ok({ day, granted: 0, reason: 'state', tasks: summaryOf(state), progress: progressOf(profile) });
    }

    let result;
    if (action === 'claim') result = claim(state, p.taskId);
    else if (action === 'chest') result = claimChest(state);
    else return fail(CODES.BAD_REQUEST, `未知 action：${action}`);

    // 幂等语义：未达成 / 已领过都不算失败 —— 返回当前状态与原因，客户端据此刷新按钮（不重复发奖）
    if (!result.ok) {
      return ok({ day, granted: 0, reason: result.reason, tasks: summaryOf(result.state), progress: progressOf(profile) });
    }

    // 发奖：金币只增不减（§4.6）；任务 / 宝箱金币为固定发放，不计入「对局产出」的每日封顶口径
    const nextProfile = {
      ...profile,
      coins: Math.max(0, Math.floor(profile.coins || 0)) + result.coins,
      updatedAt: nowMs,
    };
    const nextCounter = { ...counter, ...counterFields(result.state) };
    await store.saveProfile(nextProfile);
    await store.saveCounters(openid, day, nextCounter);

    return ok({
      day,
      granted: result.coins,
      reason: 'ok',
      tasks: summaryOf(result.state),
      progress: progressOf(nextProfile),
    });
  } catch (err) {
    return fromError(err);
  }
};
