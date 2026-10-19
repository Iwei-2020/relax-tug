'use strict';

/**
 * 云函数 matchGhost —— 下发 AI 对手与难度参数（《项目说明书》§4.1 开局匹配 / §6.4）
 *
 * 平台契约：入口 `module.exports = async function (params, context)`，
 * `params` 即 HTTP 请求体本身，返回值作为 Response Body（调用路径 = 文件名 /matchGhost）。
 * 身份：从请求头 `X-TT-OPENID` 直读（见 lib/identity.js），无需 login 置换。
 */

const { ok, fromError } = require('../../lib/envelope.js');
const { openidFromContext } = require('../../lib/identity.js');
const { getStore } = require('../../lib/store-provider.js');
const { pickDifficulty } = require('../../lib/difficulty.js');
const { DIFFICULTY, MATCH_TIMEOUT_MS, DEFAULT_DIFFICULTY } = require('../../lib/constants.js');

module.exports = async function matchGhost(params, context) {
  try {
    const openid = openidFromContext(context);
    const store = getStore();
    const profile = openid ? await store.getProfile(openid) : null;

    const difficulty = DIFFICULTY[(params && params.difficulty) || ''] ? params.difficulty : pickDifficulty(profile, params && params.difficulty);

    return ok({
      difficulty,
      // 难度参数随难度 key 一并下发，客户端据此渲染候选色数量与输入窗口
      params: DIFFICULTY[difficulty] || DIFFICULTY[DEFAULT_DIFFICULTY],
      matchTimeoutMs: MATCH_TIMEOUT_MS,
      // 对局随机种子：客户端用它复现一条对局；未登录也照常发（服务端不阻塞开局）
      seed: Math.floor(Math.random() * 0x7fffffff),
    });
  } catch (err) {
    return fromError(err);
  }
};
