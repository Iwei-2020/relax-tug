'use strict';

/**
 * 分享卡预览场景（《项目说明书》§4.5 分享卡 / §5.2 分享玩法）
 *
 * 职责：
 *   1) 用**同一套绘制函数**把战绩卡面画到主画布做预览；
 *   2) 若宿主支持 `tt.createOffscreenCanvas`，把同一卡面画到离屏画布并导出为临时图片，
 *      作为 `shareAppMessage.imageUrl` 交给分享层；
 *   3) 离屏能力缺失 / 导出失败时**降级为不带图的纯文案分享**，绝不中断流程（§4.5 硬性要求）。
 *
 * 性能（§5.4 帧内不新建对象）：卡面渐变按 ctx 缓存、每帧复用；离屏卡面只在进入场景时渲染一次。
 * 场景之间互不 import，分享动作通过 `onShare(imagePath)` 回调交给 boot 装配。
 */

const { HOME, MACARON } = require('../components/theme.js');
const decor = require('../components/decor.js');
const { roundRect } = require('../components/shape.js');
const { EVENTS, track } = require('../utils/tracker.js');
const ttApi = require('../platform/tt.js');

/** 离屏画布尺寸（比预览大，保证分享图清晰）。 */
const OFFSCREEN_W = 600;
const OFFSCREEN_H = 750;

/** 结果文案与配色（与结算页口径一致，§4.3）。 */
function resultOf(summary) {
  const r = summary && summary.result;
  if (r === 'win') return { label: '胜利', color: MACARON.resultWin[1] };
  if (r === 'draw') return { label: '平局', color: MACARON.resultDraw[1] };
  return { label: '失败', color: MACARON.resultLose[1] };
}

/**
 * 把战绩卡面画进 rect（预览与离屏共用同一实现，保证「所见即所分享」）。
 * 全部尺寸按 rect.w 相对缩放：rect.w = 300 为设计基准。
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {object} summary 见 core/battle.summary
 * @param {object} cache 渐变缓存（每个 ctx 一份，避免跨画布复用）
 */
function drawShareCard(ctx, rect, summary, cache) {
  const s = summary || {};
  const k = rect.w / 300; // 缩放系数
  const x = rect.x;
  const y = rect.y;
  const w = rect.w;
  const h = rect.h;
  const R = 22 * k;
  const res = resultOf(s);

  // 1) 卡片底：白色圆角 + 柔和投影
  ctx.save();
  ctx.shadowColor = 'rgba(31,90,180,0.35)';
  ctx.shadowBlur = 18 * k;
  ctx.shadowOffsetY = 6 * k;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, x, y, w, h, R);
  ctx.fill();
  ctx.restore();

  // 2) 顶部天空色带（裁剪进卡片圆角内）
  ctx.save();
  roundRect(ctx, x, y, w, h, R);
  ctx.clip();
  if (!cache.cardSky) {
    const g = ctx.createLinearGradient(x, y, x, y + 140 * k);
    g.addColorStop(0, MACARON.skyTop);
    g.addColorStop(1, MACARON.skyLow);
    cache.cardSky = g;
  }
  ctx.fillStyle = cache.cardSky;
  ctx.fillRect(x, y, w, 140 * k);
  ctx.restore();

  // 3) 标题 + 结果大字
  decor.drawOutlinedText(ctx, '解压拔河大作战', x + w / 2, y + 32 * k, {
    font: `bold ${Math.round(17 * k)}px sans-serif`,
    fill: '#FFFFFF',
    outline: 'rgba(46,102,180,0.35)',
    outlineWidth: 3 * k,
  });
  decor.drawOutlinedText(ctx, res.label, x + w / 2, y + 92 * k, {
    font: `bold ${Math.round(52 * k)}px sans-serif`,
    fill: res.color,
    outline: '#FFFFFF',
    outlineWidth: 7 * k,
    glow: 'rgba(46,102,180,0.28)',
    glowBlur: 10 * k,
    glowOffsetY: 3 * k,
  });

  // 4) 每日挑战角标（§4.4）
  if (s.challengeMode) {
    const bw = 62 * k;
    const bh = 20 * k;
    ctx.save();
    ctx.fillStyle = HOME.gold;
    roundRect(ctx, x + 14 * k, y + 14 * k, bw, bh, bh / 2);
    ctx.fill();
    ctx.restore();
    decor.drawOutlinedText(ctx, '每日挑战', x + 14 * k + bw / 2, y + 14 * k + bh / 2, {
      font: `bold ${Math.round(10 * k)}px sans-serif`,
      fill: '#FFFFFF',
    });
  }

  // 5) 数据行（与结算页同口径）
  const rows = [
    ['命中段数', String(s.hits || 0)],
    ['完美判定', String(s.perfectHits || 0)],
    ['最高连击', String(s.bestCombo || 0)],
    ['命中率', `${Math.round((s.accuracy || 0) * 100)}%`],
  ];
  const rowX = x + 26 * k;
  const rowRight = x + w - 26 * k;
  for (let i = 0; i < rows.length; i += 1) {
    const ry = y + 158 * k + i * 30 * k;
    ctx.font = `${Math.round(13 * k)}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = MACARON.inkDim;
    ctx.fillText(rows[i][0], rowX, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = MACARON.ink;
    ctx.font = `bold ${Math.round(14 * k)}px sans-serif`;
    ctx.fillText(rows[i][1], rowRight, ry);
    if (i < rows.length - 1) {
      ctx.strokeStyle = 'rgba(58,74,107,0.12)';
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      ctx.moveTo(rowX, ry + 15 * k);
      ctx.lineTo(rowRight, ry + 15 * k);
      ctx.stroke();
    }
  }

  // 6) 钩子文案 + 底部标识
  decor.drawOutlinedText(ctx, '敢不敢来比比手速？', x + w / 2, y + 300 * k, {
    font: `bold ${Math.round(16 * k)}px sans-serif`,
    fill: MACARON.ourDeep,
  });
  decor.drawOutlinedText(ctx, '30 秒一局 · 抖音小游戏', x + w / 2, y + 344 * k, {
    font: `${Math.round(11 * k)}px sans-serif`,
    fill: MACARON.inkDim,
  });
}

function computeCardLayout(layout) {
  const W = layout.width;
  const H = layout.height;
  const cx = Math.round(W / 2);
  const cardW = Math.round(Math.min(W * 0.68, 268));
  const cardH = Math.round(cardW * 1.25);
  const cardY = Math.round(H * 0.125);
  const btnW = Math.round(Math.min(W * 0.72, 300));
  const mainH = Math.round(H * 0.088);
  const main = { x: Math.round(cx - btnW / 2), y: cardY + cardH + Math.round(H * 0.05), w: btnW, h: mainH };
  const backW = Math.round(btnW * 0.8);
  const backH = Math.round(H * 0.068);
  const back = { x: Math.round(cx - backW / 2), y: main.y + mainH + Math.round(H * 0.02), w: backW, h: backH };
  return {
    W,
    H,
    cx,
    titleY: Math.round(layout.safeTop + 26),
    card: { x: Math.round(cx - cardW / 2), y: cardY, w: cardW, h: cardH },
    main,
    back,
    noteY: back.y + backH + Math.round(H * 0.026),
  };
}

function hit(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** 触摸扩展：视觉矩形扩到最小 88×88（仅用于触摸判定，§2.1）。 */
function touchRect(rect) {
  const w = Math.max(rect.w, 88);
  const h = Math.max(rect.h, 88);
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

/**
 * @param {object} options
 * @param {object} options.layout 见 theme.computeLayout
 * @param {object} options.summary 见 core/battle.summary
 * @param {(imagePath:string) => void} options.onShare 分享（imagePath 为空串＝降级为纯文案分享）
 * @param {() => void} options.onBack 返回结算页
 */
function createShareCardScene(options) {
  const opts = options || {};
  const layout = opts.layout;
  const summary = opts.summary || {};
  const L = computeCardLayout(layout);
  const cache = {}; // 预览使用的渐变缓存（离屏另用独立 cache，避免跨 ctx 复用）
  const hitMain = touchRect(L.main);
  const hitBack = touchRect(L.back);
  let pressed = null;
  let tMs = 0;

  // 离屏渲染：能力具备则渲染一次并导出临时图片；缺失 / 失败一律降级为空图片路径（§4.5）
  const shareRef = { imagePath: '' };
  const offscreen = ttApi.createOffscreenCanvas(OFFSCREEN_W, OFFSCREEN_H);
  let imageCapable = false;
  if (offscreen) {
    const octx = ttApi.createContext(offscreen);
    if (octx) {
      imageCapable = true;
      try {
        drawShareCard(octx, { x: 0, y: 0, w: OFFSCREEN_W, h: OFFSCREEN_H }, summary, {});
        ttApi.exportCanvasToTempFile(offscreen, (path) => {
          shareRef.imagePath = path || '';
        });
      } catch (err) {
        shareRef.imagePath = ''; // 渲染异常 → 降级
      }
    }
  }
  const noteText = imageCapable ? '' : '当前设备不支持图片分享，将以文案分享';

  track(EVENTS.SHARE_CARD_SHOWN, { result: summary.result, image: imageCapable });

  function doShare() {
    if (typeof opts.onShare === 'function') opts.onShare(shareRef.imagePath || '');
  }

  return {
    name: 'share-card',

    update(dt) {
      tMs += Math.max(0, Math.min(64, dt || 0));
    },

    draw(ctx) {
      decor.drawSky(ctx, layout, cache, MACARON);
      decor.drawDecor(ctx, layout, tMs);

      decor.drawOutlinedText(ctx, '分享卡预览', L.cx, L.titleY, {
        font: `bold ${Math.round(Math.min(L.W * 0.062, 24))}px sans-serif`,
        fill: MACARON.ink,
        outline: '#FFFFFF',
        outlineWidth: 5,
      });

      drawShareCard(ctx, L.card, summary, cache);

      decor.drawCtaButton(ctx, L.main, {
        label: '分享到抖音',
        font: `bold ${Math.round(Math.min(L.W * 0.088, 34))}px sans-serif`,
        pressed: pressed === 'main',
        cache,
      });
      decor.drawPillButton(ctx, L.back, {
        label: '返回结算',
        font: `bold ${Math.round(Math.min(L.W * 0.05, 21))}px sans-serif`,
        border: HOME.violet,
        glow: HOME.violetGlow,
        fill: HOME.violetFill,
        pressed: pressed === 'back',
      });

      if (noteText) {
        decor.drawOutlinedText(ctx, noteText, L.cx, L.noteY, {
          font: 'bold 14px sans-serif',
          fill: MACARON.warn,
          outline: '#FFFFFF',
          outlineWidth: 4,
        });
      }
    },

    onTouchStart(x, y) {
      if (hit(hitMain, x, y)) pressed = 'main';
      else if (hit(hitBack, x, y)) pressed = 'back';
    },

    onTouchEnd(x, y) {
      const wantShare = hit(hitMain, x, y);
      const wantBack = hit(hitBack, x, y);
      pressed = null;
      if (wantShare) doShare();
      else if (wantBack && typeof opts.onBack === 'function') opts.onBack();
    },
  };
}

module.exports = { createShareCardScene, drawShareCard };
