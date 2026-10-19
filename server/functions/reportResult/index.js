'use strict';

/**
 * 云函数 reportResult —— 对局结果校验与记账（《项目说明书》§5.4）
 *
 * 平台契约：入口 `module.exports = async function (params, context)`，
 * 返回值作为 Response Body；`params` 为对局摘要（core/battle.summary 的字段）。
 * 身份：请求头 `X-TT-OPENID`（见 lib/identity.js）。
 *
 * 客户端约定：本函数失败**不影响玩法** —— 客户端 net/cloud.js 永不 reject，
 * 失败即走本地记账（见 minigame/src/net/cloud.js）。
 */

const { fromError } = require('../../lib/envelope.js');
const { openidFromContext } = require('../../lib/identity.js');
const { getStore } = require('../../lib/store-provider.js');
const { recordResult } = require('../../lib/result.js');

module.exports = async function reportResult(params, context) {
  try {
    const openid = openidFromContext(context);
    return await recordResult(getStore(), openid, params || {}, Date.now());
  } catch (err) {
    return fromError(err);
  }
};
