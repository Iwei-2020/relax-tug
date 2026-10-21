'use strict';

/**
 * 首页场景（《项目说明书》§4.1 开局匹配）
 *
 * 视觉：亮蓝渐变天空 + 云朵/星星/彩纸/彩带氛围装饰，白描边暖色渐变标题，
 * 磨砂玻璃资料卡片，粉→橙→琥珀渐变 + 金色绳圈的主 CTA（呼应拔河绳），
 * 三个纵向排列的糖果渐变 CTA。
 *
 * 按钮与文字原语统一取自 components/decor.js 的 `drawCtaButton / drawPillButton /
 * drawOutlinedText / drawGlassPanel`，与对局页、结算页共用同一套马卡龙观感。
 *
 * 交互：中央「开始对战」「挑战好友」「闯关挑战」入口；卡片显示我方昵称与当前胜场。
 * 3 秒看懂、一次点击即开局（§1.4 秒懂玩法）。
 *
 * 热区约束（§2.1）：所有可点击区域按最小 88×88 逻辑像素做命中扩展，
 * 仅扩大可点范围，不改变视觉尺寸。
 */

const { HOME, MIN_TOUCH } = require('../components/theme.js');
const decor = require('../components/decor.js');
const audio = require('../platform/audio.js');
const { EVENTS, track } = require('../utils/tracker.js');

/** 首页几何（全部按屏宽/屏高比例推导，适配 16:9 ~ 21:9）。 */
function computeHomeLayout(layout) {
  const W = layout.width;
  const H = layout.height;
  const cx = Math.round(W / 2);

  const cardW = Math.round(W * 0.836);
  const cardH = Math.round(H * 0.205);
  const card = {
    x: Math.round(cx - cardW / 2),
    y: Math.round(H * 0.3),
    w: cardW,
    h: cardH,
    r: Math.round(W * 0.077),
  };
  const soundToggle = {
    x: Math.round(card.x + card.w - W * 0.13),
    y: Math.round(card.y + H * 0.014),
    w: Math.round(Math.min(W * 0.09, 38)),
    h: Math.round(Math.min(W * 0.09, 38)),
  };

  const mainH = Math.round(H * 0.086);
  const mainW = Math.round(W * 0.72);
  const subH = Math.round(H * 0.078);
  const subW = Math.round(W * 0.7);
  const rowGap = Math.round(H * 0.022);
  const mainCy = Math.round(card.y + card.h);
  const main = { x: Math.round(cx - mainW / 2), y: Math.round(mainCy - mainH / 2), w: mainW, h: mainH };
  const levelsCy = Math.round(mainCy + mainH / 2 + rowGap + subH / 2);
  const levels = { x: Math.round(cx - subW / 2), y: Math.round(levelsCy - subH / 2), w: subW, h: subH };
  const challengeCy = Math.round(levelsCy + subH + rowGap);
  const challenge = { x: Math.round(cx - subW / 2), y: Math.round(challengeCy - subH / 2), w: subW, h: subH };

  return {
    W,
    H,
    cx,
    titleY: Math.round(H * 0.19),
    titleFont: Math.round(Math.min(W * 0.118, 48)),
    subY: Math.round(H * 0.245),
    subFont: Math.round(Math.min(W * 0.052, 22)),
    nameFont: Math.round(Math.min(W * 0.058, 24)),
    winsFont: Math.round(Math.min(W * 0.045, 19)),
    ctaFont: Math.round(Math.min(W * 0.085, 34)),
    pillFont: Math.round(Math.min(W * 0.074, 30)),
    card,
    soundToggle,
    main,
    challenge,
    levels,
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

function drawSoundToggle(ctx, rect, enabled, pressed) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const scale = rect.w / 38;

  ctx.save();
  ctx.fillStyle = pressed ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.38)';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, rect.w / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.4 * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 10 * scale, cy - 4 * scale);
  ctx.lineTo(cx - 5 * scale, cy - 4 * scale);
  ctx.lineTo(cx + 1 * scale, cy - 9 * scale);
  ctx.lineTo(cx + 1 * scale, cy + 9 * scale);
  ctx.lineTo(cx - 5 * scale, cy + 4 * scale);
  ctx.lineTo(cx - 10 * scale, cy + 4 * scale);
  ctx.closePath();
  ctx.fill();

  if (enabled) {
    ctx.beginPath();
    ctx.arc(cx - 3 * scale, cy, 11 * scale, -0.72, 0.72);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx + 5 * scale, cy - 5 * scale);
    ctx.lineTo(cx + 12 * scale, cy + 5 * scale);
    ctx.moveTo(cx + 12 * scale, cy - 5 * scale);
    ctx.lineTo(cx + 5 * scale, cy + 5 * scale);
    ctx.stroke();
  }
  ctx.restore();
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
 * @param {() => void} [options.onChallenge] 点击「挑战好友」
 * @param {() => void} [options.onLevels] 点击「闯关挑战」（§4.8 进入关卡选择页）
 * @param {{nickname?:string, wins?:number, rankName?:string, rankPoints?:number, lives?:number}} [options.profile]
 *   我方资料（本地存档 + 服务端对账后填充）
 */
function createHomeScene(options) {
  const opts = options || {};
  const layout = opts.layout;
  const L = computeHomeLayout(layout);
  const profile = opts.profile || {};
  const cache = {}; // 渐变缓存（只在首帧创建一次）
  const buttonCaches = { main: {}, challenge: {}, levels: {} };
  const hitMain = touchRect(L.main);
  const hitChallenge = touchRect(L.challenge);
  const hitLevels = touchRect(L.levels);
  const hitSound = touchRect(L.soundToggle);
  let pressed = null;
  let tMs = 0;

  /** 扩大的触摸区域可能重叠，取命中区域内中心距离最近的按钮。 */
  function targetAt(x, y) {
    if (hit(hitSound, x, y)) return 'sound';
    const targets = [
      { id: 'main', hitRect: hitMain, centerY: L.main.y + L.main.h / 2 },
      { id: 'challenge', hitRect: hitChallenge, centerY: L.challenge.y + L.challenge.h / 2 },
      { id: 'levels', hitRect: hitLevels, centerY: L.levels.y + L.levels.h / 2 },
    ];
    let closest = null;
    let closestDistance = Infinity;
    for (const target of targets) {
      const distance = Math.abs(y - target.centerY);
      if (hit(target.hitRect, x, y) && distance < closestDistance) {
        closest = target.id;
        closestDistance = distance;
      }
    }
    return closest;
  }

  return {
    name: 'home',

    update(dt) {
      tMs += Math.max(0, dt || 0); // 待机动画时间轴（云漂移 / 星星闪烁 / 按钮呼吸）
    },

    draw(ctx) {
      const cx = L.cx;
      const card = L.card;
      const idleBob = Math.sin(tMs * 0.0016) * 2.2;

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
      ctx.fillText(profile.nickname || '我', pCx, card.y + card.h * 0.3);
      // 段位胜点、总胜场与每日体力
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `${L.winsFont}px sans-serif`;
      const stamina = profile.lives === undefined ? 5 : profile.lives;
      ctx.fillText(
        `${profile.rankName || '青铜'} ${profile.rankPoints || 0} · 胜场 ${profile.wins || 0} · 体力 ${stamina}/5`,
        pCx,
        card.y + card.h * 0.58
      );
      ctx.restore();
      drawSoundToggle(ctx, L.soundToggle, audio.isEnabled(), pressed === 'sound');

      // 主 CTA（带轻微呼吸浮动）与次级入口
      decor.drawCtaButton(ctx, L.main, {
        label: '开始对战',
        font: `bold ${L.ctaFont}px sans-serif`,
        gradient: [HOME.ctaFrom, HOME.ctaMid, HOME.ctaTo],
        pressed: pressed === 'main',
        bob: pressed === 'main' ? 0 : idleBob,
        cache: buttonCaches.main,
      });
      decor.drawCtaButton(ctx, L.levels, {
        label: '闯关挑战',
        font: `bold ${L.pillFont}px sans-serif`,
        ring: false,
        gradient: HOME.levelsCta,
        pressed: pressed === 'levels',
        bob: pressed === 'levels' ? 0 : idleBob,
        cache: buttonCaches.levels,
      });
      decor.drawCtaButton(ctx, L.challenge, {
        label: '挑战好友',
        font: `bold ${L.pillFont}px sans-serif`,
        ring: false,
        gradient: HOME.challengeCta,
        pressed: pressed === 'challenge',
        bob: pressed === 'challenge' ? 0 : idleBob,
        cache: buttonCaches.challenge,
      });
    },

    onTouchStart(x, y) {
      pressed = targetAt(x, y);
    },

    onTouchEnd(x, y) {
      const target = targetAt(x, y);
      pressed = null;
      if (target === 'sound') {
        const wasEnabled = audio.isEnabled();
        if (wasEnabled) audio.play('tap');
        const nowEnabled = audio.toggle();
        if (!wasEnabled && nowEnabled) audio.play('tap');
      } else if (target === 'main') {
        audio.play('tap');
        track(EVENTS.MATCH_START, { from: 'home' });
        if (typeof opts.onStart === 'function') opts.onStart();
      } else if (target === 'challenge') {
        audio.play('tap');
        if (typeof opts.onChallenge === 'function') opts.onChallenge();
      } else if (target === 'levels') {
        audio.play('tap');
        if (typeof opts.onLevels === 'function') opts.onLevels();
      }
    },
  };
}

module.exports = { createHomeScene, computeHomeLayout };
