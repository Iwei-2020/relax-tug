'use strict';

/**
 * 云函数 reportEvents —— 埋点批量接收（《项目说明书》§8.1 F14 / §9.3 DoD）
 *
 * 需要回收的核心指标：平均对局时长、平均命中率、胜负比、广告观看率。
 * 客户端每约 2 秒批量上报一次（minigame/src/game/loop.js），失败即丢弃、不影响对局。
 *
 * 首版只做**接收与形态校验**（统计口径在数据侧处理）；后续接入数据仓库时在此落库。
 */

const { CODES, ok, fail, fromError } = require('../../lib/envelope.js');
const { openidFromContext } = require('../../lib/identity.js');

/** 单批上限：超过即视为异常上报（与客户端 tracker 队列上限同量级）。 */
const MAX_BATCH = 60;

module.exports = async function reportEvents(params, context) {
  try {
    const payload = params || {};
    const events = Array.isArray(payload.events) ? payload.events : null;
    if (!events) return fail(CODES.BAD_REQUEST, 'events 必须为数组');
    if (events.length > MAX_BATCH) return fail(CODES.BAD_REQUEST, `events 超过单批上限 ${MAX_BATCH}`);

    const openid = openidFromContext(context);
    return ok({ received: events.length, openid: openid || null });
  } catch (err) {
    return fromError(err);
  }
};
