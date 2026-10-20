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
 * 其下「每日挑战」金色胶囊（§4.4 固定种子同题局）；卡片显示我方昵称与当前胜场。
 * 3 秒看懂、一次点击即开局（§1.4 秒懂玩法）。
 *
 * 热区约束（§2.1）：所有可点击区域按最小 88×88 逻辑像素做命中扩展，
 * 仅扩大可点范围，不改变视觉尺寸。
 */

const { HOME, MACARON, MIN_TOUCH } = require('../components/theme.js');
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

  // 第三行（§4.4 每日挑战 + §4.7 每日任务）：沿用次级胶囊的双列几何，置于两个胶囊之下；
  // 矮屏时下移到「与上方胶囊触摸区刚好不重叠」的位置
  const row2Cy = Math.max(Math.round(H * 0.802), subCy + MIN_TOUCH);
  const daily = { x: Math.round(cx - subGap / 2 - subW), y: Math.round(row2Cy - subH / 2), w: subW, h: subH };
  const tasks = { x: Math.round(cx + subGap / 2), y: Math.round(row2Cy - subH / 2), w: subW, h: subH };

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
    dailyFont: Math.round(Math.min(W * 0.05, 20)),
    card,
    main,
    share,
    challenge,
    daily,
    tasks,
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
 * @param {() => void} [options.onDaily] 点击「每日挑战」（§4.4）
 * @param {() => void} [options.onTasks] 点击「每日任务」（§4.7）
 * @param {{nickname?:string, wins?:number, level?:number, rankName?:string, coins?:number,
 *          tasksClaimable?:number}} [options.profile] 我方资料（本地存档 + 服务端对账后填充）
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
  const hitDaily = touchRect(L.daily);
  const hitTasks = touchRect(L.tasks);
  let pressed = null;
  let tMs = 0;

  /** 命中目标（胶囊优先于下一行：矮屏两者触摸区相邻，交给上方胶囊，避免误触）。 */
  function targetAt(x, y) {
    if (hit(hitMain, x, y)) return 'main';
    if (hit(hitShare, x, y)) return 'share';
    if (hit(hitChallenge, x, y)) return 'challenge';
    if (hit(hitDaily, x, y)) return 'daily';
    if (hit(hitTasks, x, y)) return 'tasks';
    return null;
  }

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
      // §4.6 局外成长：段位 · 等级 · 胜场 · 金币
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `${L.winsFont}px sans-serif`;
      ctx.fillText(
        `${profile.rankName || '青铜'} Lv.${profile.level || 1} · 胜场 ${profile.wins || 0} · 金币 ${profile.coins || 0}`,
        pCx,
        card.y + card.h * 0.34
      );
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
      decor.drawPillButton(ctx, L.daily, {
        label: '每日挑战',
        font: `bold ${L.dailyFont}px sans-serif`,
        border: HOME.gold,
        glow: HOME.goldGlow,
        fill: HOME.goldFill,
        pressed: pressed === 'daily',
      });
      decor.drawPillButton(ctx, L.tasks, {
        label: '每日任务',
        font: `bold ${L.dailyFont}px sans-serif`,
        border: MACARON.our,
        glow: 'rgba(255,123,169,0.55)',
        fill: HOME.mintFill,
        pressed: pressed === 'tasks',
      });
      // 可领红点（§4.7：有未领奖励时提示）
      if ((profile.tasksClaimable || 0) > 0) {
        ctx.save();
        ctx.fillStyle = '#FF5A7A';
        ctx.beginPath();
        ctx.arc(L.tasks.x + L.tasks.w - 12, L.tasks.y + 12, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    },

    onTouchStart(x, y) {
      pressed = targetAt(x, y);
    },

    onTouchEnd(x, y) {
      const target = targetAt(x, y);
      pressed = null;
      if (target === 'main') {
        track(EVENTS.MATCH_START, { from: 'home' });
        if (typeof opts.onStart === 'function') opts.onStart();
      } else if (target === 'share') {
        if (typeof opts.onShare === 'function') opts.onShare();
      } else if (target === 'challenge') {
        if (typeof opts.onChallenge === 'function') opts.onChallenge();
      } else if (target === 'daily') {
        if (typeof opts.onDaily === 'function') opts.onDaily();
      } else if (target === 'tasks') {
        if (typeof opts.onTasks === 'function') opts.onTasks();
      }
    },
  };
}

module.exports = { createHomeScene };
