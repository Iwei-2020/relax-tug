'use strict';

/**
 * 结算场景（《项目说明书》§4.3 结算页 + §5.1 激励广告）
 *
 * 元素：结果大字（配阵营色）、数据面板（命中/最高连击/命中率/时长/净能量差）、
 * 主按钮「再来一局」、分享按钮、返回首页。
 *
 * 广告规范（§5.1，硬性）：失败时「看广告复活」与「再来一局」**只呈现单一主 CTA**，
 * 避免误触 —— 故失败页主 CTA 为「看广告复活」，次 CTA 才是「再来一局」；
 * 胜利/平局页主 CTA 为「再来一局」，分享为次级。
 *
 * 结算情绪设计（§4.3）：失败页给"差一点"的措辞，最大化重开率。
 */

const { COLORS } = require('../components/theme.js');
const { roundRect } = require('../components/rope.js');
const { AD_UNITS, showRewardedVideo } = require('../platform/ad.js');
const { EVENTS, track } = require('../utils/tracker.js');

/** "差一点"文案：按净能量差给不同措辞（§4.3）。 */
function almostText(summary) {
  const gap = Math.abs(summary.netEnergy || 0);
  if (gap <= 12) return '就差 1 次命中！';
  if (gap <= 30) return '再快一点就翻盘了';
  return '差得不多，再来一局找回场子';
}

function computeButtons(layout) {
  const cx = layout.width / 2;
  const w = Math.min(260, layout.width - 72);
  const mainH = 72;
  const mainY = Math.round(layout.height * 0.66);
  return {
    main: { x: cx - w / 2, y: mainY, w, h: mainH },
    secondary: { x: cx - w / 2, y: mainY + mainH + 16, w, h: 56 },
    home: { x: cx - 60, y: layout.height - 74, w: 120, h: 44 },
  };
}

function hit(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * @param {object} options
 * @param {object} options.layout 见 theme.computeLayout
 * @param {object} options.summary 见 core/battle.summary
 * @param {() => void} options.onReplay 再来一局
 * @param {() => void} options.onRevive 复活续战（仅在失败页可用；由 boot 注入续战快照）
 * @param {() => void} options.onHome 返回首页
 * @param {() => void} [options.onShare] 分享战绩
 */
function createResultScene(options) {
  const opts = options || {};
  const layout = opts.layout;
  const summary = opts.summary || {};
  const buttons = computeButtons(layout);

  const isLose = summary.result === 'lose';
  const title = summary.result === 'win' ? '胜利' : summary.result === 'draw' ? '平局' : '失败';
  const titleColor = summary.result === 'win' ? COLORS.win : summary.result === 'draw' ? COLORS.warn : COLORS.lose;

  let reviveUsed = false;
  let pressed = null;
  let hintText = '';

  function replay() {
    track('replay_click', { result: summary.result });
    if (typeof opts.onReplay === 'function') opts.onReplay();
  }

  function revive() {
    if (reviveUsed) return;
    reviveUsed = true; // §5.1 复活每局限 1 次
    track(EVENTS.REVIVE_CLICK, { result: summary.result });
    showRewardedVideo({
      unitId: AD_UNITS.revive,
      scene: 'revive',
      onSuccess(detail) {
        if (detail && detail.fallback) track(EVENTS.AD_FALLBACK, { scene: 'revive' });
        if (typeof opts.onRevive === 'function') opts.onRevive();
        else replay();
      },
      onFail() {
        hintText = '广告暂时不可用，稍后再试或直接再来一局';
      },
    });
  }

  return {
    name: 'result',

    update() {
      /* 静态场景，无帧内逻辑 */
    },

    draw(ctx) {
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, layout.width, layout.height);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = titleColor;
      ctx.font = 'bold 56px sans-serif';
      ctx.fillText(title, layout.width / 2, layout.height * 0.16);

      ctx.fillStyle = COLORS.textDim;
      ctx.font = '18px sans-serif';
      ctx.fillText(isLose ? almostText(summary) : summary.result === 'draw' ? '势均力敌，再来一局决胜' : '漂亮，保持这个手感', layout.width / 2, layout.height * 0.24);

      // 数据面板（§4.3）
      const rows = [
        ['命中次数', String(summary.hits || 0)],
        ['最高连击', String(summary.bestCombo || 0)],
        ['命中率', `${Math.round((summary.accuracy || 0) * 100)}%`],
        ['对局时长', `${((summary.durationMs || 0) / 1000).toFixed(1)}s`],
        ['净能量差', String(summary.netEnergy || 0)],
      ];
      const panelW = Math.min(320, layout.width - 64);
      const panelX = layout.width / 2 - panelW / 2;
      const panelY = Math.round(layout.height * 0.31);
      const rowH = 38;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      roundRect(ctx, panelX, panelY, panelW, rows.length * rowH + 24, 16);
      ctx.fill();
      ctx.font = '18px sans-serif';
      for (let i = 0; i < rows.length; i += 1) {
        const y = panelY + 12 + rowH / 2 + i * rowH;
        ctx.fillStyle = COLORS.textDim;
        ctx.textAlign = 'left';
        ctx.fillText(rows[i][0], panelX + 20, y);
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'right';
        ctx.fillText(rows[i][1], panelX + panelW - 20, y);
      }

      // 主 CTA
      const m = buttons.main;
      const scale = pressed === 'main' ? 0.97 : 1;
      const mw = m.w * scale;
      const mh = m.h * scale;
      ctx.fillStyle = isLose ? COLORS.opp : COLORS.our;
      roundRect(ctx, m.x + (m.w - mw) / 2, m.y + (m.h - mh) / 2, mw, mh, 36);
      ctx.fill();
      ctx.fillStyle = COLORS.white;
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      const s = buttons.secondary;
      const mainLabel = isLose ? (reviveUsed ? '已使用复活' : '看广告复活') : '再来一局';
      ctx.fillText(mainLabel, layout.width / 2, m.y + m.h / 2);

      // 次 CTA
      ctx.fillStyle = COLORS.line;
      roundRect(ctx, s.x, s.y, s.w, s.h, 28);
      ctx.fill();
      ctx.fillStyle = COLORS.text;
      ctx.font = '20px sans-serif';
      ctx.fillText(isLose ? '再来一局' : '分享战绩', layout.width / 2, s.y + s.h / 2);

      // 返回首页
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '16px sans-serif';
      ctx.fillText('返回首页', layout.width / 2, buttons.home.y + buttons.home.h / 2);

      if (hintText) {
        ctx.fillStyle = COLORS.warn;
        ctx.font = '14px sans-serif';
        ctx.fillText(hintText, layout.width / 2, s.y + s.h + 24);
      }
    },

    onTouchStart(x, y) {
      if (hit(buttons.main, x, y)) pressed = 'main';
    },

    onTouchEnd(x, y) {
      const wantMain = hit(buttons.main, x, y);
      const wantSecondary = hit(buttons.secondary, x, y);
      const wantHome = hit(buttons.home, x, y);
      pressed = null;

      if (wantMain) {
        if (isLose) revive();
        else replay();
        return;
      }
      if (wantSecondary) {
        if (isLose) replay();
        else if (typeof opts.onShare === 'function') opts.onShare();
        return;
      }
      if (wantHome && typeof opts.onHome === 'function') opts.onHome();
    },
  };
}

module.exports = { createResultScene };
