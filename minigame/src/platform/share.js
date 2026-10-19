'use strict';

/**
 * 分享适配（《项目说明书》§5.2 分享玩法）
 *
 * 合规红线：分享**必须由用户主动操作后触发**，不得以奖励强制绑定分享。
 *
 * 分享卡片钩子（§5.2）：对手头像 + 胜负结果 + 「你敢来吗」文案；落地页直达对局，减少中间步骤。
 */

const ttApi = require('./tt.js');
const { track } = require('../utils/tracker.js');

/** 默认分享文案（与附录 C 引流话术同源）。 */
const DEFAULT_TITLE = '30 秒解压拔河 PK，眼快的来';

/**
 * 生成分享标题：带胜负结果与最高连击，制造对抗钩子。
 * @param {{result?:string, bestCombo?:number, nickname?:string}} summary 对局摘要
 */
function buildTitle(summary) {
  const s = summary || {};
  if (!s.result) return DEFAULT_TITLE;
  const label = s.result === 'win' ? '我赢了' : s.result === 'draw' ? '打平了' : '我输了';
  const combo = s.bestCombo ? `最高连击 ${s.bestCombo}` : '';
  const name = s.nickname ? `${s.nickname} ` : '';
  return `${name}${label}！${combo}，敢不敢来比比手速？`;
}

/**
 * 主动分享战绩。
 * @param {object} options
 * @param {object} [options.summary] 对局摘要（见 core/battle.summary）
 * @param {string} [options.imageUrl] 分享卡片图（战绩截图，由渲染层生成后传入）
 * @param {string} [options.query] 附加参数（如 `?challenge=openid` 实现「挑战好友」异步 PK）
 * @param {() => void} [options.onDone] 分享发起后的回调（抖音端内无成功/失败强信号，仅作提示）
 */
function shareBattle(options) {
  const opts = options || {};
  const title = opts.title || buildTitle(opts.summary);
  const tt = ttApi.getTt();

  track('share_click', { result: opts.summary && opts.summary.result });

  if (!tt || typeof tt.shareAppMessage !== 'function') {
    if (typeof opts.onDone === 'function') opts.onDone();
    return;
  }

  tt.shareAppMessage({
    title,
    desc: opts.desc || '1v1 实时拔河，点色块定胜负',
    imageUrl: opts.imageUrl || '',
    query: opts.query || '',
    success: () => {
      track('share_success', { result: opts.summary && opts.summary.result });
      if (typeof opts.onDone === 'function') opts.onDone();
    },
    fail: () => {
      track('share_fail', {});
      if (typeof opts.onDone === 'function') opts.onDone();
    },
  });
}

module.exports = { DEFAULT_TITLE, buildTitle, shareBattle };
