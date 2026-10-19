'use strict';

/**
 * 顶部区域渲染：拔河比赛状态视图（《项目说明书》§2.1 / §3.1）
 *
 * 视觉元素（对齐视觉稿，不追求 1:1 复刻）：
 *   浅蓝天空（场景层铺底）→ 左右分阵营染色的透视地面 → 中央刻度尺 / 判定线
 *   → 两侧卡通小人拉绳 → 缠绕纹理的粗麻绳 → 中央发光光圈（绳结 = 位移焦点）
 *   → 顶部两枚阵营胶囊徽章 → 底部两条百分比能量条。
 *
 * **非静态**：小人拉拽律动与呼吸起伏、绳身缓慢起伏、光圈呼吸、刻度尺微闪，
 * 全部由 `view.tMs`（场景累计时间）驱动；命中 / 失误时通过 `view.impulse*`
 * 触发一次衰减的冲击反馈（拉拽爆发、光圈爆闪、领先侧地面闪亮、绳身抖振），
 * 因此 UI 与「颜色选择」实时联动。
 *
 * 手感要求（§3.1）：绳结位移必须**跟手且平滑**（线性映射，禁止 >100ms 阻尼延迟）；
 * 我方即将越线时判定线脉冲发光，对手即将越线时全屏轻微警示。
 *
 * 性能约定（§5.4）：帧内不新建对象 / 数组 —— 角色排布为模块级常量，
 * 曲线取点用纯数值函数，避免每帧产生临时对象。
 */

const { MACARON, OUR_OUTFITS, OPP_OUTFITS, HAIRS } = require('./theme.js');
const { roundRect } = require('./shape.js');
const { drawOutlinedText } = require('./decor.js');

/* 角色排布（模块级静态常量，避免帧内新建数组） */
const FIG_SLOT = 38; // 同侧相邻小人的横向间距
const FIG_EDGE = 24; // 距屏幕边缘的第一人位置
const FIG_SCALES = [1, 0.92, 0.86]; // 由外向内的体型（近大远小）
const FIG_PHASE = [0, 2.1, 4.2]; // 拉拽律动相位（错开，避免整齐划一）

/** 绳身曲线在参数 u∈[0,1] 处的高度（下垂近似正弦拱）。 */
function ropeYAt(u, y0, sag) {
  return y0 + sag * Math.sin(Math.PI * u);
}

/** 取某侧第 i 个小人的横坐标。 */
function figureX(layout, side, i) {
  return side > 0 ? FIG_EDGE + i * FIG_SLOT : layout.width - FIG_EDGE - i * FIG_SLOT;
}

/**
 * 透视地面：左右阵营染色（分界随绳结实时移动）+ 中央中性带 + 横纹 + 地平线。
 * @param {number} knotX 绳结横坐标（= 阵营分界）
 * @param {number} impulse 冲击强度 0~1
 * @param {string} kind 'hit' 我方命中 / 'miss' 我方失误
 */
function drawGround(ctx, layout, knotX, impulse, kind) {
  const r = layout.rope;
  const W = layout.width;
  const hz = r.horizonY;
  const bt = r.groundBottom;
  const inset = Math.round(W * 0.1);
  const split = Math.max(0, Math.min(W, knotX));

  ctx.save();
  // 地面为梯形（远处窄、近处宽），营造透视
  ctx.beginPath();
  ctx.moveTo(inset, hz);
  ctx.lineTo(W - inset, hz);
  ctx.lineTo(W, bt);
  ctx.lineTo(0, bt);
  ctx.closePath();
  ctx.clip();

  // 阵营染色：暖（我方）→ 冷（对方），分界即绳结位置
  ctx.fillStyle = MACARON.groundLeft;
  ctx.fillRect(0, hz, split, bt - hz);
  ctx.fillStyle = MACARON.groundRight;
  ctx.fillRect(split, hz, W - split, bt - hz);
  ctx.fillStyle = MACARON.groundCenter;
  ctx.fillRect(split - 14, hz, 28, bt - hz);

  // 命中 / 失误瞬间：领先一侧地面闪一下
  if (impulse > 0) {
    ctx.globalAlpha = impulse * 0.22;
    ctx.fillStyle = kind === 'hit' ? MACARON.our : MACARON.opp;
    if (kind === 'hit') ctx.fillRect(0, hz, split, bt - hz);
    else ctx.fillRect(split, hz, W - split, bt - hz);
    ctx.globalAlpha = 1;
  }

  // 透视横纹（越近越疏）
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 1; i <= 4; i += 1) {
    const u = i / 5;
    const y = hz + (bt - hz) * u * u;
    const x0 = inset * (1 - u);
    const x1 = W - inset * (1 - u);
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.strokeStyle = MACARON.groundFar;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(inset, hz);
  ctx.lineTo(W - inset, hz);
  ctx.stroke();

  ctx.strokeStyle = MACARON.horizon;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, hz);
  ctx.lineTo(W, hz);
  ctx.stroke();
}

/** 中央竖向刻度尺（中性参照，微闪呼吸）。 */
function drawRuler(ctx, layout, tMs) {
  const r = layout.rope;
  const y0 = r.horizonY + 8;
  const y1 = r.y + 40;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r.cx, y0);
  ctx.lineTo(r.cx, y1);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const n = 14;
  for (let i = 0; i <= n; i += 1) {
    const y = y0 + ((y1 - y0) * i) / n;
    const half = i % 2 === 0 ? 11 : 6;
    ctx.moveTo(r.cx - half, y);
    ctx.lineTo(r.cx + half, y);
  }
  ctx.stroke();

  // 顶端标记点：缓慢呼吸，让刻度尺"活"起来
  ctx.globalAlpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(tMs * 0.002));
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(r.cx, y0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 判定线（±maxPx）：将越线时高亮脉冲。 */
function drawJudge(ctx, layout, px) {
  const r = layout.rope;
  const nearWin = Math.abs(px) >= r.maxPx * 0.8;
  const y0 = r.horizonY + 12;
  const y1 = r.y + 34;
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i += 1) {
    const jx = i === 0 ? r.cx - r.maxPx : r.cx + r.maxPx;
    ctx.strokeStyle = nearWin ? MACARON.judgeHot : MACARON.judge;
    ctx.lineWidth = nearWin ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(jx, y0);
    ctx.lineTo(jx, y1);
    ctx.stroke();
    ctx.fillStyle = nearWin ? MACARON.judgeHot : MACARON.judge;
    ctx.beginPath();
    ctx.arc(jx, y0 - 6, nearWin ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 卡通小人（头 + 头发 + 表情 + 躯干 + 双臂 + 双腿 + 鞋）。
 * 待机时按相位呼吸起伏与拉拽律动；受击时 `kick` 决定被拽 / 站稳。
 * @param {number} dir +1 面向右（我方），-1 面向左（对方）
 * @param {number} lean 基础倾斜（正 = 向后站稳发力）
 * @param {number} kick 冲击附加姿态（正 = 发力后仰，负 = 被拽前扑）
 */
function drawBody(ctx, x, ropeY, s, dir, outfit, hair, phase, lean, tMs, kick) {
  const tug = Math.sin(tMs * 0.0055 + phase);
  const breath = Math.sin(tMs * 0.0032 + phase * 1.7);
  const torsoLean = Math.max(-0.8, Math.min(1, lean + tug * 0.05 + kick * 0.25));
  const feetY = ropeY + 30 * s + breath * 1.5 * s;
  const shY = feetY - 30 * s;
  const hipY = feetY - 14 * s;
  const headY = feetY - 46 * s;
  const shift = -torsoLean * 12 * s * dir;
  const bx = x + shift;
  const gx = x + dir * 20 * s;
  const gy = ropeY + 0.5 * s;

  // 地面投影
  ctx.fillStyle = 'rgba(58,74,107,0.15)';
  roundRect(ctx, x - 16 * s, feetY - 2 * s, 32 * s, 6 * s, 3 * s);
  ctx.fill();

  // 双腿 + 鞋
  ctx.lineCap = 'round';
  ctx.strokeStyle = MACARON.ink;
  ctx.lineWidth = 7 * s;
  ctx.beginPath();
  ctx.moveTo(bx, hipY);
  ctx.lineTo(bx - 9 * s, feetY);
  ctx.moveTo(bx, hipY);
  ctx.lineTo(bx + 9 * s, feetY);
  ctx.stroke();

  ctx.fillStyle = MACARON.shoe;
  roundRect(ctx, bx - 14 * s, feetY - 3 * s, 11 * s, 6 * s, 3 * s);
  ctx.fill();
  roundRect(ctx, bx + 3 * s, feetY - 3 * s, 11 * s, 6 * s, 3 * s);
  ctx.fill();

  // 躯干（阵营色上衣 + 浅色内衬）
  ctx.fillStyle = outfit;
  roundRect(ctx, bx - 12 * s, shY, 24 * s, 20 * s, 9 * s);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  roundRect(ctx, bx - 7 * s, shY + 5 * s, 14 * s, 10 * s, 4 * s);
  ctx.fill();

  // 双臂伸向绳（袖口与衣同色）
  ctx.strokeStyle = outfit;
  ctx.lineWidth = 5.5 * s;
  ctx.beginPath();
  ctx.moveTo(bx, shY + 3 * s);
  ctx.lineTo(gx, gy - 2 * s);
  ctx.moveTo(bx, shY + 9 * s);
  ctx.lineTo(gx - dir * 3 * s, gy + 3 * s);
  ctx.stroke();

  // 头
  const hx = bx + shift * 0.2;
  ctx.fillStyle = MACARON.skin;
  ctx.beginPath();
  ctx.arc(hx, headY, 12.5 * s, 0, Math.PI * 2);
  ctx.fill();

  // 头发（上半圆帽）
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.arc(hx, headY - 1.5 * s, 13.2 * s, Math.PI * 1.02, Math.PI * 1.98);
  ctx.closePath();
  ctx.fill();

  // 眼睛 / 微笑 / 腮红
  ctx.fillStyle = MACARON.eye;
  ctx.beginPath();
  ctx.arc(hx - 4.6 * s, headY + 0.8 * s, 1.9 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx + 4.6 * s, headY + 0.8 * s, 1.9 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = MACARON.eye;
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.arc(hx, headY + 3.4 * s, 3.6 * s, Math.PI * 0.18, Math.PI * 0.82);
  ctx.stroke();

  ctx.fillStyle = MACARON.blush;
  ctx.beginPath();
  ctx.arc(hx - 7.4 * s, headY + 4 * s, 2.4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx + 7.4 * s, headY + 4 * s, 2.4 * s, 0, Math.PI * 2);
  ctx.fill();
}

/** 双手（在绳之后绘制，形成"握住绳子"的前后关系）。 */
function drawHands(ctx, x, ropeY, s, dir) {
  ctx.fillStyle = MACARON.skin;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.4 * s;
  ctx.beginPath();
  ctx.arc(x + dir * 20 * s, ropeY - 2 * s, 4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + dir * 17 * s, ropeY + 3 * s, 4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * 麻绳：深色描边 + 金色绳体 + 顶部高光 + 滚动编织暗纹。
 * 绳身随 `tMs` 缓慢起伏，受击时瞬时绷紧（下垂变小）。
 */
function drawRopeLine(ctx, r, sag, tMs, impulse) {
  const x0 = r.leftAnchor - 16;
  const x1 = r.rightAnchor + 16;
  const midX = Math.round((x0 + x1) / 2 + Math.sin(tMs * 0.0016) * 3);

  ctx.lineCap = 'round';

  // 绳身投影（略下沉，制造立体）
  ctx.strokeStyle = 'rgba(122,86,44,0.4)';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(x0, r.y + 3);
  ctx.quadraticCurveTo(midX, r.y + 3 + sag * 2, x1, r.y + 3);
  ctx.stroke();

  // 金色绳体
  ctx.strokeStyle = '#E9A23B';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(x0, r.y);
  ctx.quadraticCurveTo(midX, r.y + sag * 2, x1, r.y);
  ctx.stroke();

  // 顶部高光
  ctx.strokeStyle = 'rgba(255,229,158,0.9)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x0, r.y - 2);
  ctx.quadraticCurveTo(midX, r.y - 2 + sag * 2, x1, r.y - 2);
  ctx.stroke();

  // 编织暗纹：沿绳散布的斜向短纹，随时间滚动（非静态）
  const ticks = 40;
  const frac = (tMs * 0.0004 + impulse * 0.3) % 1;
  ctx.strokeStyle = 'rgba(176,110,32,0.5)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let k = 0; k < ticks; k += 1) {
    const u = (k + frac) / ticks;
    if (u <= 0 || u >= 1) continue;
    const x = x0 + (x1 - x0) * u;
    const y = ropeYAt(u, r.y, sag);
    ctx.moveTo(x - 3, y - 4);
    ctx.lineTo(x + 3, y + 4);
  }
  ctx.stroke();
}

/**
 * 中央发光光圈（绳结位置标记）：呼吸 + 受击爆闪。
 * @param {number} pulse 呼吸/爆发倍率
 * @param {number} impulse 冲击强度 0~1
 */
function drawRing(ctx, knotX, knotY, pulse, impulse) {
  // 外光晕（同心圆叠加，避免每帧创建渐变对象）
  ctx.save();
  ctx.fillStyle = MACARON.ringGlow;
  const radii = [30, 24, 18];
  const alphas = [0.1, 0.16, 0.24];
  for (let i = 0; i < radii.length; i += 1) {
    ctx.globalAlpha = alphas[i] * pulse;
    ctx.beginPath();
    ctx.arc(knotX, knotY, radii[i] * pulse, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // 金色环 + 白色外描边
  ctx.save();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(knotX, knotY, 17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = MACARON.ring;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(knotX, knotY, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = MACARON.ringCore;
  ctx.beginPath();
  ctx.arc(knotX, knotY, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 受击扩散环
  if (impulse > 0) {
    ctx.save();
    ctx.strokeStyle = MACARON.ringGlow;
    ctx.lineWidth = 3;
    ctx.globalAlpha = impulse * 0.55;
    ctx.beginPath();
    ctx.arc(knotX, knotY, 20 + (1 - impulse) * 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = impulse * 0.3;
    ctx.beginPath();
    ctx.arc(knotX, knotY, 30 + (1 - impulse) * 80, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** 阵营胶囊徽章（对齐示例图的「红方 / 蓝方」）。 */
function drawBadge(ctx, cx, cy, w, h, fill, label) {
  ctx.save();
  ctx.shadowColor = 'rgba(46,102,180,0.3)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = fill;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  roundRect(ctx, cx - w / 2 + 1, cy - h / 2 + 1, w - 2, h - 2, (h - 2) / 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${Math.round(h * 0.52)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(40,42,66,0.35)';
  ctx.shadowBlur = 4;
  ctx.fillText(label, cx, cy + 1);
  ctx.restore();
}

/** 单条阵营能量条（胶囊轨道 + 阵营色填充 + 百分比文字）。 */
function drawCampBar(ctx, x, y, w, h, color, pct, fromLeft) {
  ctx.save();
  ctx.shadowColor = 'rgba(58,74,107,0.25)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.restore();

  const fillW = Math.max(h, Math.round(w * pct));
  const fx = fromLeft ? x : x + w - fillW;

  ctx.save();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.clip();
  ctx.fillStyle = color;
  roundRect(ctx, fx, y, fillW, h, h / 2);
  ctx.fill();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, fx + fillW * 0.06, y + h * 0.16, fillW * 0.88, h * 0.34, h * 0.17);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, (h - 2) / 2);
  ctx.stroke();

  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${Math.round(h * 0.68)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(40,42,66,0.4)';
  ctx.shadowBlur = 4;
  ctx.fillText(`${Math.round(pct * 100)}%`, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

/** 底部两侧能量条：数值口径为我方 / 对方能量占比（两者之和为 100%）。 */
function drawEnergyBars(ctx, layout, myEnergy, oppEnergy) {
  const r = layout.rope;
  const total = myEnergy + oppEnergy;
  const myPct = total > 0 ? myEnergy / total : 0.5;
  const leftX = 20;
  const rightX = layout.width - 20 - r.barW;
  drawCampBar(ctx, leftX, r.barY, r.barW, r.barH, MACARON.ourDeep, myPct, true);
  drawCampBar(ctx, rightX, r.barY, r.barW, r.barH, MACARON.oppDeep, 1 - myPct, false);
}

/**
 * 绘制顶部拔河视图（叠加在场景层已铺好的天空之上）。
 * @param {object} view {
 *   px, myEnergy, oppEnergy, phase, countdownLeftMs,
 *   tMs,                                    // 累计时间，驱动待机动效
 *   impulse, impulseKind, impulseSide       // 命中 / 失误冲击（0~1 衰减）
 * }
 */
function drawRope(ctx, layout, view) {
  const v = view || {};
  const r = layout.rope;
  const W = layout.width;
  const t = v.tMs || 0;
  const impulse = Math.max(0, Math.min(1, v.impulse || 0));
  const kind = v.impulseKind === 'miss' ? 'miss' : 'hit';

  const px = Math.max(-r.maxPx, Math.min(r.maxPx, v.px || 0));
  const leanOwn = r.maxPx ? Math.max(-1, Math.min(1, px / r.maxPx)) : 0;

  drawGround(ctx, layout, r.cx + px, impulse, kind);
  drawRuler(ctx, layout, t);
  drawJudge(ctx, layout, px);

  // 姿态：命中 → 我方发力后仰、对方被拽前扑；失误 → 反之
  const ownKick = kind === 'hit' ? impulse : -impulse * 0.6;
  const oppKick = kind === 'hit' ? -impulse * 0.6 : impulse;
  const ownLean = 0.25 + 0.5 * leanOwn;
  const oppLean = 0.25 - 0.5 * leanOwn;
  const shakeX = impulse > 0 ? (kind === 'hit' ? -1 : 1) * impulse * 5 * Math.sin(t * 0.05) : 0;
  const sag = 6 + impulse * 3 - Math.sin(t * 0.0025) * 1.6;

  ctx.save();
  ctx.translate(shakeX, 0);

  // ① 两侧卡通小人（身体）
  for (let i = 0; i < FIG_SCALES.length; i += 1) {
    const s = FIG_SCALES[i];
    const phase = FIG_PHASE[i];
    drawBody(ctx, figureX(layout, 1, i), r.y, s, 1, OUR_OUTFITS[i], HAIRS[i], phase, ownLean, t, ownKick);
    drawBody(ctx, figureX(layout, -1, i), r.y, s, -1, OPP_OUTFITS[i], HAIRS[i], phase, oppLean, t, oppKick);
  }

  // ② 绳子（在小人之后 → 绳子压在他们身前）
  drawRopeLine(ctx, r, sag, t, impulse);

  // ③ 双手（在绳子之后 → 形成"握住"的前后关系）
  for (let i = 0; i < FIG_SCALES.length; i += 1) {
    const s = FIG_SCALES[i];
    drawHands(ctx, figureX(layout, 1, i), r.y, s, 1);
    drawHands(ctx, figureX(layout, -1, i), r.y, s, -1);
  }

  // ④ 中央发光光圈（绳结位置 = 位移焦点）
  const knotX = r.cx + px;
  const knotY = ropeYAt((knotX - (r.leftAnchor - 16)) / (r.rightAnchor + 16 - (r.leftAnchor - 16)), r.y, sag);
  const pulse = 1 + 0.07 * Math.sin(t * 0.004) + impulse * 0.6;
  drawRing(ctx, knotX, knotY, pulse, impulse);

  ctx.restore();

  // 顶部阵营徽章
  const b = r.badge;
  drawBadge(ctx, 20 + b.w / 2, b.y, b.w, b.h, MACARON.badgeOur, '我方');
  drawBadge(ctx, W - 20 - b.w / 2, b.y, b.w, b.h, MACARON.badgeOpp, '对方');

  // 底部两条百分比能量条
  drawEnergyBars(ctx, layout, v.myEnergy || 0, v.oppEnergy || 0);

  // 即将越线：靠近我方 → 暖色描边脉冲；对手靠近 → 警示描边
  if (px >= r.maxPx * 0.8) {
    ctx.strokeStyle = 'rgba(255,180,61,0.75)';
    ctx.lineWidth = 12;
    ctx.strokeRect(0, 0, W, layout.height);
  } else if (px <= -r.maxPx * 0.8) {
    ctx.strokeStyle = 'rgba(255,122,138,0.7)';
    ctx.lineWidth = 12;
    ctx.strokeRect(0, 0, W, layout.height);
  }
}

/**
 * 开局倒计时浮层（整屏浅色蒙层 + 描边渐变大字）。
 *
 * **必须由场景在全屏最上层调用**（见 scenes/battle.js 的绘制顺序）。
 * 早期版本把它画在 drawRope 内部，导致中部/底部玻璃面板与目标色块后画、
 * 盖住蒙层和数字，倒计时看上去"没置顶"。
 * @param {object} view { phase, countdownLeftMs }
 */
function drawCountdown(ctx, layout, view) {
  const v = view || {};
  if (v.phase !== 'countdown') return;
  const seconds = Math.max(1, Math.ceil((v.countdownLeftMs || 0) / 1000));
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(0, 0, layout.width, layout.height);
  drawOutlinedText(ctx, String(seconds), layout.width / 2, layout.height / 2, {
    font: 'bold 92px sans-serif',
    fill: '#FF9E4A',
    outline: '#FFFFFF',
    outlineWidth: 10,
    glow: 'rgba(255,158,74,0.5)',
    glowBlur: 16,
  });
}

module.exports = { drawRope, drawCountdown };
