'use strict';

/**
 * 激励视频广告适配（《项目说明书》§5.1 激励广告设计）
 *
 * 硬性规范：
 *   1) **用户主动触发**，不得强制、不得自动播放；
 *   2) 加载失败/播放失败必须**给兜底**（直接发放奖励或明确提示稍后再试），不可卡死流程；
 *   3) 体力补充广告由玩家在体力耗尽后主动点击重开时触发；
 *   4) 体力广告必须完整播放才发奖；广告位未配置时只提示，不发放奖励。
 *      其他广告场景仍由对应调用方按其奖励规则处理 fallback。
 *
 * 广告位 id 需在抖音开放平台创建后填入 `AD_UNITS`（首版留空，接入时补）。
 */

const ttApi = require('./tt.js');
const { track } = require('../utils/tracker.js');

/** 广告位配置：上线前在开放平台创建激励视频广告位并回填。 */
const AD_UNITS = {
  life: '', // 体力补充
  energyBoost: '', // 开局能量加成
  skinUnlock: '', // 皮肤解锁
  levelSkip: '', // 闯关跳关（§4.8：每次自由选关看一次，不永久解锁）
};

/** 连续失败计数（内存态 + 本地持久化）：连续 3 次失败说明广告链路不可用。 */
const AD_FAIL_STREAK_KEY = 'rt_ad_fail_streak';
const AD_FAIL_EXEMPT = 3;

/** 广告位是否已配置（未配置视为不可用，直接走奖励兜底）。 */
function hasUnit(unitId) {
  return typeof unitId === 'string' && unitId.length > 0;
}

/** 读取连续失败次数。 */
function getAdFailStreak() {
  const raw = ttApi.getStorageSync(AD_FAIL_STREAK_KEY, 0);
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

/** 记录一次失败 / 成功（成功后清零）。 */
function markAdFail() {
  const next = getAdFailStreak() + 1;
  ttApi.setStorageSync(AD_FAIL_STREAK_KEY, next);
  return next;
}
function markAdSuccess() {
  ttApi.setStorageSync(AD_FAIL_STREAK_KEY, 0);
}

/**
 * 展示激励视频。
 * @param {object} options
 * @param {string} options.unitId 广告位 id（见 AD_UNITS）
 * @param {string} options.scene 埋点场景名
 * @param {(detail:{fallback:boolean}) => void} options.onSuccess 完整观看（fallback=true 表示广告不可用时的兜底发放）
 * @param {(reason:string) => void} [options.onFail] 明确失败（含用户中途退出）
 */
function showRewardedVideo(options) {
  const opts = options || {};
  const unitId = opts.unitId;

  // 兜底 1：未配置广告位 / 宿主不支持 / 连续失败已达豁免阈值 → 直接发放（不卡流程）
  if (!hasUnit(unitId) || !ttApi.isAvailable() || getAdFailStreak() >= AD_FAIL_EXEMPT) {
    track('ad_fallback', { scene: opts.scene, reason: !hasUnit(unitId) ? 'unconfigured' : 'streak' });
    if (typeof opts.onSuccess === 'function') opts.onSuccess({ fallback: true });
    return;
  }

  const tt = ttApi.getTt();
  if (typeof tt.createRewardedVideoAd !== 'function') {
    if (typeof opts.onSuccess === 'function') opts.onSuccess({ fallback: true });
    return;
  }

  let settled = false;
  let ad = null;
  try {
    ad = tt.createRewardedVideoAd({ adUnitId: unitId });
  } catch (err) {
    markAdFail();
    track('ad_fallback', { scene: opts.scene, reason: 'create_failed' });
    if (typeof opts.onSuccess === 'function') opts.onSuccess({ fallback: true });
    return;
  }

  const finish = (ok, detail) => {
    if (settled) return;
    settled = true;
    if (ok) {
      markAdSuccess();
      track('ad_watch', { scene: opts.scene, unitId });
      if (typeof opts.onSuccess === 'function') opts.onSuccess(detail || { fallback: false });
    } else {
      const streak = markAdFail();
      track('ad_fail', { scene: opts.scene, unitId, streak });
      // 兜底 2：播放链路失败 → 按豁免阈值直接发放，或回调失败由调用方提示稍后再试
      if (streak >= AD_FAIL_EXEMPT) {
        if (typeof opts.onSuccess === 'function') opts.onSuccess({ fallback: true });
      } else if (typeof opts.onFail === 'function') {
        opts.onFail(detail && detail.reason ? detail.reason : 'ad_error');
      }
    }
  };

  if (typeof ad.onClose === 'function') {
    ad.onClose((res) => finish(!!(res && res.isEnded), { fallback: false }));
  }
  if (typeof ad.onError === 'function') {
    ad.onError(() => finish(false, { reason: 'ad_error' }));
  }

  if (typeof ad.show === 'function') {
    ad.show().catch(() => {
      // 展示失败：先尝试 load 再 show 一次，仍失败则走失败分支
      if (typeof ad.load === 'function') {
        ad.load()
          .then(() => ad.show())
          .catch(() => finish(false, { reason: 'load_failed' }));
      } else {
        finish(false, { reason: 'show_failed' });
      }
    });
  } else {
    finish(false, { reason: 'unsupported' });
  }
}

module.exports = { AD_UNITS, AD_FAIL_EXEMPT, hasUnit, showRewardedVideo, getAdFailStreak, markAdFail, markAdSuccess };
