'use strict';

/**
 * 首页场景（《项目说明书》§4.1 开局匹配）
 *
 * 中央大按钮「开始对战」（主 CTA）；副入口「挑战好友 / 分享」、「设置」；
 * 显示我方昵称与当前胜场。3 秒看懂、一次点击即开局（§1.4 秒懂玩法）。
 */

const { COLORS } = require('../components/theme.js');
const { roundRect } = require('../components/rope.js');
const { EVENTS, track } = require('../utils/tracker.js');

/** 生成首页按钮几何（居中大按钮 + 底部两个次级按钮）。 */
function computeButtons(layout) {
  const cx = layout.width / 2;
  const mainW = Math.min(260, layout.width - 72);
  const mainH = 78;
  const mainY = Math.round(layout.height * 0.56);
  const subW = Math.min(160, (layout.width - 60) / 2);
  const subH = 52;
  const subY = mainY + mainH + 22;
  return {
    main: { x: cx - mainW / 2, y: mainY, w: mainW, h: mainH },
    share: { x: cx - subW - 8, y: subY, w: subW, h: subH },
    challenge: { x: cx + 8, y: subY, w: subW, h: subH },
  };
}

function hit(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * @param {object} options
 * @param {object} options.layout 见 theme.computeLayout
 * @param {() => void} options.onStart 点击「开始对战」
 * @param {() => void} [options.onShare] 点击「分享战绩」
 * @param {() => void} [options.onChallenge] 点击「挑战好友」
 * @param {{nickname?:string, wins?:number}} [options.profile] 我方资料（接入服务端后填充）
 */
function createHomeScene(options) {
  const opts = options || {};
  const layout = opts.layout;
  const buttons = computeButtons(layout);
  const profile = opts.profile || {};
  let pressed = null;

  return {
    name: 'home',

    update() {
      /* 首页为静态场景，无需帧内逻辑 */
    },

    draw(ctx) {
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, layout.width, layout.height);

      // 顶部装饰：两侧阵营色带（与对局界面视觉延续）
      ctx.fillStyle = 'rgba(255,107,53,0.16)';
      ctx.fillRect(0, 0, layout.width / 2, layout.height * 0.22);
      ctx.fillStyle = 'rgba(47,168,225,0.16)';
      ctx.fillRect(layout.width / 2, 0, layout.width / 2, layout.height * 0.22);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = COLORS.text;
      ctx.font = 'bold 44px sans-serif';
      ctx.fillText('解压拔河大作战', layout.width / 2, layout.height * 0.22);

      ctx.fillStyle = COLORS.textDim;
      ctx.font = '18px sans-serif';
      ctx.fillText('点对颜色，把绳子拉过来', layout.width / 2, layout.height * 0.22 + 44);

      // 我方资料
      ctx.fillStyle = COLORS.text;
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(profile.nickname || '我', layout.width / 2, layout.height * 0.36);
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '16px sans-serif';
      ctx.fillText(`胜场 ${profile.wins || 0}`, layout.width / 2, layout.height * 0.36 + 30);

      // 主 CTA
      const scale = pressed === 'main' ? 0.97 : 1;
      const m = buttons.main;
      const mw = m.w * scale;
      const mh = m.h * scale;
      const mx = m.x + (m.w - mw) / 2;
      const my = m.y + (m.h - mh) / 2;
      ctx.fillStyle = COLORS.our;
      roundRect(ctx, mx, my, mw, mh, 39);
      ctx.fill();
      ctx.fillStyle = COLORS.white;
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText('开始对战', layout.width / 2, m.y + m.h / 2);

      // 次级入口
      ctx.fillStyle = COLORS.line;
      roundRect(ctx, buttons.share.x, buttons.share.y, buttons.share.w, buttons.share.h, 26);
      ctx.fill();
      roundRect(ctx, buttons.challenge.x, buttons.challenge.y, buttons.challenge.w, buttons.challenge.h, 26);
      ctx.fill();
      ctx.fillStyle = COLORS.text;
      ctx.font = '18px sans-serif';
      ctx.fillText('分享战绩', buttons.share.x + buttons.share.w / 2, buttons.share.y + buttons.share.h / 2);
      ctx.fillText('挑战好友', buttons.challenge.x + buttons.challenge.w / 2, buttons.challenge.y + buttons.challenge.h / 2);
    },

    onTouchStart(x, y) {
      if (hit(buttons.main, x, y)) pressed = 'main';
    },

    onTouchEnd(x, y) {
      const target = hit(buttons.main, x, y) ? 'main' : hit(buttons.share, x, y) ? 'share' : hit(buttons.challenge, x, y) ? 'challenge' : null;
      pressed = null;
      if (target === 'main') {
        track(EVENTS.MATCH_START, { from: 'home' });
        if (typeof opts.onStart === 'function') opts.onStart();
      } else if (target === 'share') {
        if (typeof opts.onShare === 'function') opts.onShare();
      } else if (target === 'challenge') {
        if (typeof opts.onChallenge === 'function') opts.onChallenge();
      }
    },
  };
}

module.exports = { createHomeScene };
