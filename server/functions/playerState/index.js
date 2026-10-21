'use strict';

/**
 * 云函数 playerState：恢复服务端权威成长与闯关进度。
 *
 * 同时维护每日生命值，支持查询、开局扣除和完整广告后的领奖。
 */

const { CODES, ok, fail, fromError } = require('../../lib/envelope.js');
const { openidFromContext } = require('../../lib/identity.js');
const { getStore } = require('../../lib/store-provider.js');
const { normalizeProgress, progressOf } = require('../../lib/progression.js');
const levels = require('../../lib/levels.js');
const livesCore = require('../../lib/lives.js');

function snapshot(profile, lives) {
  return {
    progress: progressOf(profile),
    levels: levels.normalizeLevels(profile && profile.levels),
    lives,
  };
}

module.exports = async function playerState(params, context) {
  try {
    const openid = openidFromContext(context);
    if (!openid) return fail(CODES.BAD_REQUEST, '缺少调用方身份（X-TT-OPENID）');

    const store = getStore();
    const nowMs = Date.now();
    const storedProfile = await store.getProfile(openid);
    let profile = storedProfile || {
      openid,
      nickname: '',
      wins: 0,
      matches: 0,
      createdAt: nowMs,
    };
    const normalizedProgress = normalizeProgress(profile);
    const needsMigration =
      ['coins', 'exp', 'level'].some((field) => Object.prototype.hasOwnProperty.call(profile, field)) ||
      profile.rankId !== normalizedProgress.rankId ||
      profile.rankPoints !== normalizedProgress.rankPoints ||
      profile.matches !== normalizedProgress.matches ||
      profile.wins !== normalizedProgress.wins;
    profile = { ...profile, ...normalizedProgress };
    delete profile.coins;
    delete profile.exp;
    delete profile.level;
    if (storedProfile && needsMigration) await store.saveProfile(profile);
    const action = params && params.action;
    const currentLives = livesCore.normalizeLives(profile.lives, nowMs);

    if (action === 'consumeLife') {
      const result = livesCore.consumeLife(currentLives, nowMs);
      if (result.ok) {
        profile = { ...profile, lives: result.state };
        await store.saveProfile(profile);
      }
      return ok({ ...snapshot(profile, result.state), consumed: result.ok });
    }

    if (action === 'rewardLife') {
      const result = livesCore.grantLife(currentLives, nowMs);
      if (result.ok) {
        profile = { ...profile, lives: result.state };
        await store.saveProfile(profile);
      }
      return ok({ ...snapshot(profile, result.state), granted: result.ok });
    }

    if (action !== undefined && action !== 'state') {
      return fail(CODES.BAD_REQUEST, 'action 非法');
    }

    if (profile.lives && profile.lives.day !== currentLives.day) {
      profile = { ...profile, lives: currentLives };
      await store.saveProfile(profile);
    }
    return ok(snapshot(profile, currentLives));
  } catch (err) {
    return fromError(err);
  }
};
