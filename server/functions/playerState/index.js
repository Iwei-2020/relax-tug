'use strict';

/**
 * 云函数 playerState：恢复服务端权威成长与闯关进度。
 *
 * 此接口只读玩家档案，用于跨设备恢复成长与闯关进度。
 */

const { CODES, ok, fail, fromError } = require('../../lib/envelope.js');
const { openidFromContext } = require('../../lib/identity.js');
const { getStore } = require('../../lib/store-provider.js');
const { progressOf } = require('../../lib/progression.js');
const levels = require('../../lib/levels.js');

module.exports = async function playerState(_params, context) {
  try {
    const openid = openidFromContext(context);
    if (!openid) return fail(CODES.BAD_REQUEST, '缺少调用方身份（X-TT-OPENID）');

    const profile = await getStore().getProfile(openid);
    return ok({
      progress: progressOf(profile),
      levels: levels.normalizeLevels(profile && profile.levels),
    });
  } catch (err) {
    return fromError(err);
  }
};
