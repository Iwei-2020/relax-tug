'use strict';

/**
 * 首页氛围装饰与绘制原语（《项目说明书》§3.4 全局视觉规范 / §4.1 主界面）
 *
 * 首页视觉目标（对齐视觉稿）：亮蓝渐变天空 + 卡通云 + 五角星 / 彩纸 / 彩带点缀 +
 * 白描边暖色渐变标题 + 磨砂玻璃卡片。
 *
 * 性能约定（§5.4「帧内不得新建对象/数组」）：
 *   - 所有装饰位置以**归一化坐标（0~1）写死**在数据表中，避免每帧随机导致闪烁；
 *   - 渐变一律由调用方缓存（`drawSky(ctx, layout, cache)` 只建一次）；
 *   - 彩带用「同路径多层描边」伪造多色，避免每帧创建渐变对象。
 */

const { HOME, MACARON } = require('./theme.js');
const { roundRect } = require('./shape.js');

/* ------------------------------------------------------------------ *
 * 装饰数据（x 相对屏宽、y 相对屏高；尺寸亦以屏宽为基准比例）
 * ------------------------------------------------------------------ */

/** 卡通云：{x, y, w(整体宽度占屏宽比), a(透明度)} */
const CLOUDS = [
  { x: 0.15, y: 0.115, w: 0.30, a: 0.98 },
  { x: 0.93, y: 0.075, w: 0.22, a: 0.95 },
  { x: 0.0, y: 0.305, w: 0.16, a: 0.72 },
  { x: 1.0, y: 0.605, w: 0.18, a: 0.7 },
  { x: 0.2, y: 0.965, w: 0.42, a: 1 },
  { x: 0.84, y: 0.94, w: 0.4, a: 1 },
  { x: 0.55, y: 0.895, w: 0.14, a: 0.55 },
];

/** 五角星：{x, y, r(外接半径占屏宽比), rot, a} */
const STARS = [
  { x: 0.085, y: 0.278, r: 0.034, rot: -0.18, a: 1 },
  { x: 0.155, y: 0.945, r: 0.034, rot: -0.24, a: 1 },
  { x: 0.355, y: 0.102, r: 0.026, rot: 0.2, a: 1 },
  { x: 0.982, y: 0.163, r: 0.024, rot: 0.36, a: 1 },
  { x: 0.055, y: 0.718, r: 0.026, rot: 0.24, a: 1 },
  { x: 0.175, y: 0.072, r: 0.02, rot: -0.3, a: 1 },
  { x: 0.475, y: 0.182, r: 0.016, rot: 0.1, a: 1 },
  { x: 0.6, y: 0.856, r: 0.018, rot: 0.3, a: 0.95 },
];

/** 圆点彩纸：{x, y, r, c(HOME.confetti 下标), a} */
const DOTS = [
  { x: 0.325, y: 0.418, r: 0.011, c: 0, a: 1 },
  { x: 0.095, y: 0.442, r: 0.012, c: 2, a: 1 },
  { x: 0.862, y: 0.445, r: 0.012, c: 0, a: 1 },
  { x: 0.946, y: 0.396, r: 0.009, c: 0, a: 1 },
  { x: 0.615, y: 0.598, r: 0.009, c: 3, a: 1 },
  { x: 0.235, y: 0.946, r: 0.013, c: 0, a: 1 },
  { x: 0.52, y: 0.988, r: 0.012, c: 2, a: 1 },
  { x: 0.3, y: 0.362, r: 0.008, c: 5, a: 1 },
  { x: 0.72, y: 0.356, r: 0.008, c: 1, a: 1 },
  { x: 0.9, y: 0.846, r: 0.01, c: 4, a: 1 },
];

/** 方形彩纸：{x, y, w, h(占屏宽比), rot, c, a} */
const CONFETTI = [
  { x: 0.09, y: 0.515, w: 0.02, h: 0.03, rot: 0.5, c: 0, a: 1 },
  { x: 0.545, y: 0.702, w: 0.017, h: 0.026, rot: -0.4, c: 2, a: 1 },
  { x: 0.125, y: 0.722, w: 0.016, h: 0.024, rot: 0.7, c: 1, a: 1 },
  { x: 0.758, y: 0.718, w: 0.02, h: 0.028, rot: -0.55, c: 0, a: 1 },
  { x: 0.325, y: 0.8, w: 0.022, h: 0.014, rot: 0.35, c: 3, a: 1 },
  { x: 0.1, y: 0.862, w: 0.026, h: 0.016, rot: -0.5, c: 0, a: 1 },
  { x: 0.878, y: 0.602, w: 0.017, h: 0.026, rot: 0.6, c: 5, a: 1 },
  { x: 0.055, y: 0.6, w: 0.014, h: 0.02, rot: -0.3, c: 4, a: 1 },
];

/**
 * 曲面彩带：二次贝塞尔三点 + 宽度 + 三层配色（由宽到窄依次描边伪造多色）。
 * {x0,y0,qx,qy,x1,y1, w(占屏宽比), c1/c2/c3, rot}
 */
const RIBBONS = [
  { x0: 0.47, y0: 0.094, qx: 0.555, qy: 0.062, x1: 0.615, y1: 0.1, w: 0.05, c1: '#B472F0', c2: '#FF9E4A', c3: '#FFE066' },
  { x0: 0.79, y0: 0.53, qx: 0.905, qy: 0.54, x1: 1.0, y1: 0.59, w: 0.062, c1: '#FF6FB5', c2: '#FFD84D', c3: '#5CE1B0' },
  { x0: 0.655, y0: 0.775, qx: 0.75, qy: 0.845, x1: 0.935, y1: 0.845, w: 0.075, c1: '#FF6FB5', c2: '#FF9E4A', c3: '#FFE066' },
  { x0: 0.18, y0: 0.782, qx: 0.24, qy: 0.808, x1: 0.335, y1: 0.788, w: 0.06, c1: '#FF6FB5', c2: '#B98CFF', c3: '#8ED0FF' },
];

/* ------------------------------------------------------------------ *
 * 基础绘制原语
 * ------------------------------------------------------------------ */

/**
 * 天空渐变（渐变对象由调用方 cache 缓存，只创建一次）。
 * @param {object} [palette] 取色板，默认 HOME；对局/结算页传 MACARON 以得到更淡的天空
 */
function drawSky(ctx, layout, cache, palette) {
  const c = cache || {};
  const p = palette || HOME;
  const key = p === HOME ? 'sky' : 'skyMacaron';
  if (!c[key]) {
    const g = ctx.createLinearGradient(0, 0, 0, layout.height);
    g.addColorStop(0, p.skyTop);
    g.addColorStop(0.34, p.skyMid);
    g.addColorStop(0.72, p.skyLow);
    g.addColorStop(1, p.skyBottom);
    c[key] = g;
  }
  ctx.fillStyle = c[key];
  ctx.fillRect(0, 0, layout.width, layout.height);
}

/** 卡通云（多个圆形取并集 + 圆角底座压平下缘）。 */
function drawCloud(ctx, cx, cy, wPx, alpha) {
  const s = wPx / 136; // 设计基准宽度 136px（390 宽屏下 = 0.30 屏宽）
  if (s <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.fillStyle = HOME.cloud;
  ctx.beginPath();
  ctx.arc(cx - 48 * s, cy + 2 * s, 22 * s, 0, Math.PI * 2);
  ctx.arc(cx - 14 * s, cy - 14 * s, 34 * s, 0, Math.PI * 2);
  ctx.arc(cx + 18 * s, cy - 6 * s, 28 * s, 0, Math.PI * 2);
  ctx.arc(cx + 46 * s, cy + 4 * s, 20 * s, 0, Math.PI * 2);
  ctx.fill();
  roundRect(ctx, cx - 66 * s, cy - 2 * s, 132 * s, 24 * s, 12 * s);
  ctx.fill();
  ctx.restore();
}

/** 五角星（含柔光）。 */
function drawStar(ctx, cx, cy, r, rot, alpha) {
  if (r <= 0) return;
  const inner = r * 0.46;
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const ang = rot + (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : inner;
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.shadowColor = HOME.starGlow;
  ctx.shadowBlur = r * 0.9;
  ctx.fillStyle = HOME.star;
  ctx.fill();
  ctx.restore();
}

/** 圆点彩纸。 */
function drawDot(ctx, cx, cy, r, color, alpha) {
  if (r <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 方形彩纸（旋转小矩形；用 fillRect 不依赖 roundRect）。 */
function drawConfetti(ctx, cx, cy, w, h, rot, color, alpha) {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

/** 曲面彩带（同路径三层描边伪造多色管状质感）。 */
function drawRibbon(ctx, p, wPx) {
  if (wPx <= 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const layers = [
    { c: p.c1, k: 1 },
    { c: p.c2, k: 0.6 },
    { c: p.c3, k: 0.28 },
  ];
  for (let i = 0; i < layers.length; i += 1) {
    ctx.strokeStyle = layers[i].c;
    ctx.lineWidth = wPx * layers[i].k;
    ctx.beginPath();
    ctx.moveTo(p.x0, p.y0);
    ctx.quadraticCurveTo(p.qx, p.qy, p.x1, p.y1);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 描边 + 渐变/发光文字（标题与文字按钮统一走这里）。
 * @param {object} opts
 * @param {string} opts.font 见 ctx.font
 * @param {string|CanvasGradient} opts.fill 填充色或已缓存的渐变对象
 * @param {string} [opts.outline] 描边色（不传则无描边）
 * @param {number} [opts.outlineWidth] 描边厚度
 * @param {string} [opts.glow] 外发光/阴影色
 * @param {number} [opts.glowBlur] 发光模糊半径
 * @param {number} [opts.glowOffsetY] 阴影垂直偏移
 * @param {number} [opts.offsetY] 整体下移量
 */
function drawOutlinedText(ctx, text, x, y, opts) {
  const o = opts || {};
  const dy = o.offsetY || 0;
  const hasOutline = !!o.outline && o.outlineWidth > 0;
  ctx.save();
  ctx.font = o.font || 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  if (hasOutline) {
    // 第 1 遍：更粗的描边 + 外发光投影，形成「描边外一圈光晕」
    if (o.glow) {
      ctx.shadowColor = o.glow;
      ctx.shadowBlur = o.glowBlur || 0;
      ctx.shadowOffsetY = o.glowOffsetY || 0;
    }
    ctx.strokeStyle = o.outline;
    ctx.lineWidth = o.outlineWidth + (o.glow ? 2 : 0);
    ctx.strokeText(text, x, y + dy);
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    // 第 2 遍：干净的白色粗描边
    ctx.lineWidth = o.outlineWidth;
    ctx.strokeText(text, x, y + dy);
  } else if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = o.glowBlur || 0;
    ctx.shadowOffsetY = o.glowOffsetY || 0;
  }

  ctx.fillStyle = o.fill || '#FFFFFF';
  ctx.fillText(text, x, y + dy);
  ctx.restore();
}

/** 磨砂玻璃面板（半透明白 + 顶部高光 + 亮描边 + 外投影）。 */
function drawGlassPanel(ctx, rect) {
  const r = rect.r || Math.min(rect.w, rect.h) * 0.14;
  ctx.save();
  ctx.shadowColor = HOME.cardGlow;
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = HOME.card;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  roundRect(ctx, rect.x + 2, rect.y + 2, rect.w - 4, rect.h * 0.5, r);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = HOME.cardBorder;
  ctx.lineWidth = 2;
  roundRect(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, r - 1);
  ctx.stroke();
}

/* ------------------------------------------------------------------ *
 * 场景级装饰绘制
 * ------------------------------------------------------------------ */

/**
 * 绘制全部氛围装饰（天空之后、内容之前调用）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} layout 见 theme.computeLayout
 * @param {number} tMs 待机动画时间（毫秒），用于云朵缓慢漂移 / 星星闪烁
 */
function drawDecor(ctx, layout, tMs) {
  const W = layout.width;
  const H = layout.height;
  const t = tMs || 0;

  // 云（后层，先画）
  for (let i = 0; i < CLOUDS.length; i += 1) {
    const c = CLOUDS[i];
    if (c.y < 0.5) {
      const drift = Math.sin(t * 0.00011 + i * 1.3) * 0.012;
      drawCloud(ctx, (c.x + drift) * W, c.y * H, c.w * W, c.a);
    }
  }

  // 彩带
  for (let i = 0; i < RIBBONS.length; i += 1) {
    const p = RIBBONS[i];
    drawRibbon(
      ctx,
      { x0: p.x0 * W, y0: p.y0 * H, qx: p.qx * W, qy: p.qy * H, x1: p.x1 * W, y1: p.y1 * H, c1: p.c1, c2: p.c2, c3: p.c3 },
      p.w * W
    );
  }

  // 五角星（轻微闪烁）
  for (let i = 0; i < STARS.length; i += 1) {
    const s = STARS[i];
    const twinkle = 0.78 + 0.22 * Math.sin(t * 0.0026 + i * 1.7);
    drawStar(ctx, s.x * W, s.y * H, s.r * W, s.rot, s.a * twinkle);
  }

  // 圆点 / 方形彩纸（轻微起伏）
  for (let i = 0; i < DOTS.length; i += 1) {
    const d = DOTS[i];
    const bob = Math.sin(t * 0.0013 + i * 0.9) * 0.004;
    drawDot(ctx, d.x * W, (d.y + bob) * H, d.r * W, HOME.confetti[d.c % HOME.confetti.length], d.a);
  }
  for (let i = 0; i < CONFETTI.length; i += 1) {
    const f = CONFETTI[i];
    const bob = Math.sin(t * 0.0015 + i * 1.1) * 0.005;
    drawConfetti(
      ctx,
      f.x * W,
      (f.y + bob) * H,
      f.w * W,
      f.h * W,
      f.rot + Math.sin(t * 0.001 + i) * 0.12,
      HOME.confetti[f.c % HOME.confetti.length],
      f.a
    );
  }

  // 云（前层，压住底部装饰）
  for (let i = 0; i < CLOUDS.length; i += 1) {
    const c = CLOUDS[i];
    if (c.y >= 0.5) {
      const drift = Math.sin(t * 0.00013 + i * 1.1) * 0.01;
      drawCloud(ctx, (c.x + drift) * W, c.y * H, c.w * W, c.a);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 通用按钮原语（首页 / 对局 / 结算共用，保证「统一观感」）
 * ------------------------------------------------------------------ */

/**
 * 主 CTA（糖果渐变胶囊 + 可选金色绳圈，呼应拔河绳）。
 * @param {object} rect {x,y,w,h}
 * @param {object} opts {label, font, ring, pressed, bob, cache, textGlow, gradient}
 */
function drawCtaButton(ctx, rect, opts) {
  const o = opts || {};
  const cache = o.cache || {};
  const scale = o.pressed ? 0.972 : 1;
  const w = rect.w * scale;
  const h = rect.h * scale;
  const x = rect.x + (rect.w - w) / 2;
  const y = rect.y + (rect.h - h) / 2 + (o.bob || 0);
  const r = h / 2;

  // 1) 金色绳圈 + 编织虚线 + 顶部高光（被胶囊压住中间，形成外圈）
  if (o.ring !== false) {
    const gap = Math.round(h * 0.11);
    const ropeW = Math.round(h * 0.115);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = HOME.ropeGold;
    ctx.lineWidth = ropeW;
    roundRect(ctx, x - gap, y - gap, w + gap * 2, h + gap * 2, r + gap);
    ctx.stroke();
    if (typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([Math.round(ropeW), Math.round(ropeW * 0.9)]);
      ctx.strokeStyle = HOME.ropeWeave;
      ctx.lineWidth = Math.max(2, ropeW * 0.5);
      roundRect(ctx, x - gap, y - gap, w + gap * 2, h + gap * 2, r + gap);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 上半圈高光
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - gap - ropeW * 3, y - gap - 6, w + (gap + ropeW * 3) * 2, h * 0.5 + gap + 6);
    ctx.clip();
    ctx.strokeStyle = HOME.ropeGoldLight;
    ctx.lineWidth = Math.max(2, ropeW * 0.26);
    roundRect(ctx, x - gap, y - gap, w + gap * 2, h + gap * 2, r + gap);
    ctx.stroke();
    ctx.restore();
    // 两端绳尾
    ctx.strokeStyle = HOME.ropeGold;
    ctx.lineWidth = ropeW;
    ctx.beginPath();
    ctx.moveTo(x - gap, y + h * 0.5 - ropeW * 0.2);
    ctx.quadraticCurveTo(x - gap - ropeW * 2.4, y + h * 0.5 - ropeW * 0.6, x - gap - ropeW * 1.5, y + h * 0.5 + ropeW * 1.1);
    ctx.moveTo(x + w + gap, y + h * 0.5 - ropeW * 0.2);
    ctx.quadraticCurveTo(x + w + gap + ropeW * 2.4, y + h * 0.5 - ropeW * 0.6, x + w + gap + ropeW * 1.5, y + h * 0.5 + ropeW * 1.1);
    ctx.stroke();
    ctx.restore();
  }

  // 2) 渐变胶囊 + 白色亮边（渐变缓存一次，避免每帧新建）
  const colors = o.gradient || [HOME.ctaFrom, HOME.ctaMid, HOME.ctaTo];
  const gkey = `${o.pressed ? 'cta_on' : 'cta'}_${colors.join('_')}`;
  if (!cache[gkey]) {
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, colors[0]);
    g.addColorStop(0.52, colors[1]);
    g.addColorStop(1, colors[2]);
    cache[gkey] = g;
  }
  ctx.fillStyle = cache[gkey];
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = HOME.ctaBrink;
  ctx.lineWidth = 3;
  roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r - 1.5);
  ctx.stroke();

  // 3) 顶部玻璃高光
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, x + 7, y + 5, w - 14, h * 0.4, h * 0.2);
  ctx.fill();
  ctx.restore();

  // 4) 文案
  drawOutlinedText(ctx, o.label || '', x + w / 2, y + h / 2 - h * 0.02, {
    font: o.font || `bold ${Math.round(h * 0.45)}px sans-serif`,
    fill: HOME.ctaText,
    glow: o.textGlow || HOME.ctaTextGlow,
    glowBlur: 12,
    glowOffsetY: 3,
  });
}

/**
 * 次级胶囊按钮（彩色描边玻璃 + 白字）。
 * @param {object} rect {x,y,w,h}
 * @param {object} opts {label, font, border, glow, fill, textFill, textGlow, pressed}
 */
function drawPillButton(ctx, rect, opts) {
  const o = opts || {};
  const scale = o.pressed ? 0.972 : 1;
  const w = rect.w * scale;
  const h = rect.h * scale;
  const x = rect.x + (rect.w - w) / 2;
  const y = rect.y + (rect.h - h) / 2;
  const r = h / 2;

  ctx.save();
  ctx.shadowColor = o.fill || MACARON.panelStrong;
  ctx.shadowBlur = 6;
  ctx.fillStyle = o.fill || MACARON.panelStrong;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = o.glow || 'rgba(255,255,255,0.65)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = o.border || MACARON.panelBorder;
  ctx.lineWidth = 4;
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, r - 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, x + 8, y + 5, w - 16, h * 0.36, h * 0.18);
  ctx.fill();
  ctx.restore();

  drawOutlinedText(ctx, o.label || '', x + w / 2, y + h / 2 - h * 0.02, {
    font: o.font || `bold ${Math.round(h * 0.34)}px sans-serif`,
    fill: o.textFill || '#FFFFFF',
    glow: o.textGlow || HOME.subTextGlow,
    glowBlur: 8,
    glowOffsetY: 2,
  });
}

module.exports = {
  drawSky,
  drawCloud,
  drawStar,
  drawDot,
  drawConfetti,
  drawRibbon,
  drawOutlinedText,
  drawGlassPanel,
  drawDecor,
  drawCtaButton,
  drawPillButton,
};
