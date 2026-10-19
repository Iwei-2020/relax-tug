'use strict';

/**
 * 首页场景（《项目说明书》§4.1 开局匹配）
 *
 * 视觉：亮蓝渐变天空 + 云朵/星星/彩纸/彩带氛围装饰，白描边暖色渐变标题，
 * 磨砂玻璃资料卡片，粉→橙→琥珀渐变 + 金色绳圈的主 CTA（呼应拔河绳），
 * 两个彩色描边玻璃胶囊次级入口。
 *
 * 按钮与文字原语统一取自 components/decor.js 的 `drawCtaButton / drawPillButton /
 * drawOutlinedText / drawGlassPanel`，与对局页、结算页共用同一套马卡龙观感。
 *
 * 交互：中央大按钮「开始对战」（主 CTA）；副入口「分享战绩 / 挑战好友」；
 * 卡片显示我方昵称与当前胜场。3 秒看懂、一次点击即开局（§1.4 秒懂玩法）。
 *
 * 热区约束（§2.1）：所有可点击区域按最小 88×88 逻辑像素做命中扩展，
 * 仅扩大可点范围，不改变视觉尺寸。
 */

const { HOME, MIN_TOUCH } = require('../components/theme.js');
const decor = require('../components/decor.js');
const { EVENTS, track } = require('../utils/tracker.js');

/** 首页几何（全部按屏宽/屏高比例推导，适配 16:9 ~ 21:9）。 */
function computeHomeLayout(layout) {
  const W = layout.width;
  const H = layout.height;
  const cx = Math.round(W / 2);

  const cardW = Math.round(W * 0.836);
  const cardH = Math.round(H * 0.246);
  const card = {
    x: Math.round(cx - cardW / 2),
    y: Math.round(H * 0.332),
    w: cardW,
    h: cardH,
    r: Math.round(W * 0.077),
  };

  const mainH = Math.round(H * 0.098);
  const mainW = Math.round(W * 0.755);
  const mainCy = Math.round(H * 0.578);
  const main = { x: Math.round(cx - mainW / 2), y: Math.round(mainCy - mainH / 2), w: mainW, h: mainH };

  const subH = Math.round(H * 0.082);
  const subCy = Math.round(H * 0.698);
  const subGap = Math.round(W * 0.041);
  const subW = Math.round((W * 0.878 - subGap) / 2);
  const share = { x: Math.round(cx - subGap / 2 - subW), y: Math.round(subCy - subH / 2), w: subW, h: subH };
  const challenge = { x: Math.round(cx + subGap / 2), y: Math.round(subCy - subH / 2), w: subW, h: subH };

  return {
    W,
    H,
    cx,
    titleY: Math.round(H * 0.213),
    titleFont: Math.round(Math.min(W * 0.118, 48)),
    subY: Math.round(H * 0.271),
    subFont: Math.round(Math.min(W * 0.052, 22)),
    nameFont: Math.round(Math.min(W * 0.058, 24)),
    winsFont: Math.round(Math.min(W * 0.045, 19)),
    ctaFont: Math.round(Math.min(W * 0.102, 40)),
    pillFont: Math.round(Math.min(W * 0.056, 22)),
    card,
    main,
    share,
    challenge,
  };
}

/** 命中扩展：把视觉矩形扩到最小 88×88（仅用于触摸判定）。 */
function touchRect(rect) {
  const w = Math.max(rect.w, MIN_TOUCH);
  const h = Math.max(rect.h, MIN_TOUCH);
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

function hit(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** 标题渐变（缓存，避免每帧新建渐变对象）。 */
function titleGradient(ctx, L, cache) {
  if (!cache.titleGrad) {
    const g = ctx.createLinearGradient(0, L.titleY - L.titleFont * 0.62, 0, L.titleY + L.titleFont * 0.62);
    g.addColorStop(0, HOME.titleTop);
    g.addColorStop(1, HOME.titleBottom);
    cache.titleGrad = g;
  }
  return cache.titleGrad;
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
  const L = computeHomeLayout(layout);
  const profile = opts.profile || {};
  const cache = {}; // 渐变缓存（只在首帧创建一次）
  const hitMain = touchRect(L.main);
  const hitShare = touchRect(L.share);
  const hitChallenge = touchRect(L.challenge);
  let pressed = null;
  let tMs = 0;

  return {
    name: 'home',

    update(dt) {
      tMs += Math.max(0, dt || 0); // 待机动画时间轴（云漂移 / 星星闪烁 / 按钮呼吸）
    },

    draw(ctx) {
      const cx = L.cx;
      const card = L.card;

      decor.drawSky(ctx, layout, cache);
      decor.drawDecor(ctx, layout, tMs);

      // 标题 + 副标题
      decor.drawOutlinedText(ctx, '解压拔河大作战', cx, L.titleY, {
        font: `bold ${L.titleFont}px sans-serif`,
        fill: titleGradient(ctx, L, cache),
        outline: HOME.titleOutline,
        outlineWidth: Math.max(6, Math.round(L.titleFont * 0.16)),
        glow: HOME.titleGlow,
        glowBlur: 16,
        glowOffsetY: 4,
      });
      decor.drawOutlinedText(ctx, '点对颜色，把绳子拉过来', cx, L.subY, {
        font: `bold ${L.subFont}px sans-serif`,
        fill: HOME.subtitle,
        outline: 'rgba(42,84,158,0.8)',
        outlineWidth: 4,
        glow: 'rgba(26,64,132,0.35)',
        glowBlur: 6,
        glowOffsetY: 2,
      });

      // 磨砂玻璃资料卡片
      decor.drawGlassPanel(ctx, card);
      const pCx = card.x + card.w / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(38,72,140,0.4)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${L.nameFont}px sans-serif`;
      ctx.fillText(profile.nickname || '我', pCx, card.y + card.h * 0.16);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `${L.winsFont}px sans-serif`;
      ctx.fillText(`胜场 ${profile.wins || 0}`, pCx, card.y + card.h * 0.34);
      ctx.restore();

      // 主 CTA（带轻微呼吸浮动）与次级入口
      decor.drawCtaButton(ctx, L.main, {
        label: '开始对战',
        font: `bold ${L.ctaFont}px sans-serif`,
        pressed: pressed === 'main',
        bob: pressed === 'main' ? 0 : Math.sin(tMs * 0.0016) * 2.2,
        cache,
      });
      decor.drawPillButton(ctx, L.share, {
        label: '分享战绩',
        font: `bold ${L.pillFont}px sans-serif`,
        border: HOME.mint,
        glow: HOME.mintGlow,
        fill: HOME.mintFill,
        pressed: pressed === 'share',
      });
      decor.drawPillButton(ctx, L.challenge, {
        label: '挑战好友',
        font: `bold ${L.pillFont}px sans-serif`,
        border: HOME.violet,
        glow: HOME.violetGlow,
        fill: HOME.violetFill,
        pressed: pressed === 'challenge',
      });
    },

    onTouchStart(x, y) {
      pressed = hit(hitMain, x, y) ? 'main' : hit(hitShare, x, y) ? 'share' : hit(hitChallenge, x, y) ? 'challenge' : null;
    },

    onTouchEnd(x, y) {
      const target = hit(hitMain, x, y) ? 'main' : hit(hitShare, x, y) ? 'share' : hit(hitChallenge, x, y) ? 'challenge' : null;
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
