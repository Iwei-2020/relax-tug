'use strict';

/**
 * 顶部区域渲染：拔河比赛状态视图（《项目说明书》§2.1 / §3.1）
 *
 * 视觉元素：拔河绳 + 双方小人 + 拉扯进度（绳结位置 = 位移）+ 判定线 + 能量对比条。
 *
 * 风格：马卡龙（与首页统一）—— 天空由场景层铺底，本模块只负责在顶部叠加玻璃面板、
 * 薄荷赛道、金色拔河绳与糖果色小人；阵营色由「赛道左右染色 + 小人 + 能量条」承载。
 *
 * 手感要求（§3.1）：绳结位移必须**跟手且平滑**（线性映射，禁止 >100ms 阻尼延迟）；
 * 我方即将越线时判定线脉冲发光，对手即将越线时全屏轻微警示。
 */

const { MACARON } = require('./theme.js');
const { roundRect } = require('./shape.js');
const { drawOutlinedText } = require('./decor.js');

/** 能量对比条（我方左、对方右；糖果色胶囊 + 白描边）。 */
function drawEnergyBars(ctx, layout, myEnergy, oppEnergy) {
  const r = layout.rope;
  const max = Math.max(1, myEnergy, oppEnergy);
  const myW = Math.max(r.barH, Math.round((myEnergy / max) * r.barW));
  const oppW = Math.max(r.barH, Math.round((oppEnergy / max) * r.barW));
  const leftX = 24;
  const rightX = layout.width - 24 - r.barW;

  for (const x of [leftX, rightX]) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    roundRect(ctx, x, r.barY, r.barW, r.barH, r.barH / 2);
    ctx.fill();
  }

  ctx.fillStyle = MACARON.our;
  roundRect(ctx, leftX, r.barY, myW, r.barH, r.barH / 2);
  ctx.fill();
  ctx.fillStyle = MACARON.opp;
  roundRect(ctx, rightX, r.barY, oppW, r.barH, r.barH / 2);
  ctx.fill();

  ctx.fillStyle = MACARON.ink;
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`我方 ${myEnergy}`, leftX, r.barY + r.barH + 6);
  ctx.textAlign = 'right';
  ctx.fillText(`对手 ${oppEnergy}`, rightX + r.barW, r.barY + r.barH + 6);
}

/**
 * 小人（火柴人：头 + 躯干 + 四肢，带拉绳受力前倾/后仰姿态）。
 * @param {number} dir 朝向：+1 面向右（我方，绳子在右侧），-1 面向左（对方）
 * @param {number} lean 受力倾斜：正 = 被拉向自己，负 = 被拉向对方
 */
function drawFigure(ctx, x, y, color, dir, lean) {
  const tilt = Math.max(-0.6, Math.min(0.6, lean));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';

  // 头
  ctx.beginPath();
  ctx.arc(x, y - 30, 11, 0, Math.PI * 2);
  ctx.fill();

  // 躯干（前倾/后仰：tilt 为正时重心倒向朝向侧）
  const hipX = x - tilt * 16 * dir;
  ctx.beginPath();
  ctx.moveTo(x, y - 19);
  ctx.lineTo(hipX, y + 12);
  ctx.stroke();

  // 双腿
  ctx.beginPath();
  ctx.moveTo(hipX, y + 12);
  ctx.lineTo(hipX - 14, y + 38);
  ctx.moveTo(hipX, y + 12);
  ctx.lineTo(hipX + 14, y + 38);
  ctx.stroke();

  // 双手：抓向绳子一侧
  ctx.beginPath();
  ctx.moveTo(x, y - 13);
  ctx.lineTo(x + dir * 18, y - 2);
  ctx.moveTo(x, y - 7);
  ctx.lineTo(x + dir * 15, y + 4);
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制顶部拔河视图（叠加在场景层已铺好的天空之上）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} layout 见 theme.computeLayout
 * @param {object} view { px, myEnergy, oppEnergy, phase, countdownLeftMs }
 */
function drawRope(ctx, layout, view) {
  const v = view || {};
  const r = layout.rope;
  const top = layout.top;
  const W = layout.width;

  // 顶部玻璃面板（与中部/底部同材质，形成三分区）
  ctx.fillStyle = MACARON.panel;
  ctx.fillRect(top.x, top.y, top.w, top.h);

  // 薄荷赛道：左右阵营染色 + 双色地面
  const bandY = Math.round(r.y - top.h * 0.17);
  const bandH = Math.round(top.h * 0.3);
  ctx.fillStyle = MACARON.trackTop;
  roundRect(ctx, top.x + 6, bandY, top.w - 12, bandH, 22);
  ctx.fill();
  ctx.fillStyle = MACARON.trackBottom;
  roundRect(ctx, top.x + 6, bandY + bandH * 0.62, top.w - 12, bandH * 0.38 + 6, 20);
  ctx.fill();

  ctx.save();
  roundRect(ctx, top.x + 6, bandY, top.w - 12, bandH, 22);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,123,169,0.18)'; // 我方暖色侧
  ctx.fillRect(top.x, bandY, W / 2, bandH);
  ctx.fillStyle = 'rgba(97,194,242,0.18)'; // 对方冷色侧
  ctx.fillRect(W / 2, bandY, W / 2, bandH);
  ctx.restore();

  drawEnergyBars(ctx, layout, v.myEnergy || 0, v.oppEnergy || 0);

  // 判定线（±maxPx，越线时高亮）
  const px = Math.max(-r.maxPx, Math.min(r.maxPx, v.px || 0));
  const nearWin = Math.abs(px) >= r.maxPx * 0.8;
  for (const jx of [r.cx - r.maxPx, r.cx + r.maxPx]) {
    ctx.strokeStyle = nearWin ? MACARON.judgeHot : MACARON.judge;
    ctx.lineWidth = nearWin ? 5 : 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(jx, bandY - 6);
    ctx.lineTo(jx, bandY + bandH + 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(jx, bandY - 10, nearWin ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = nearWin ? MACARON.judgeHot : MACARON.judge;
    ctx.fill();
  }

  // 拔河绳：金色 + 编织虚线（与首页 CTA 绳圈同材质）
  ctx.lineCap = 'round';
  ctx.strokeStyle = MACARON.ourDeep;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(r.leftAnchor - 16, r.y);
  ctx.lineTo(r.cx + px, r.y);
  ctx.stroke();
  ctx.strokeStyle = MACARON.oppDeep;
  ctx.beginPath();
  ctx.moveTo(r.cx + px, r.y);
  ctx.lineTo(r.rightAnchor + 16, r.y);
  ctx.stroke();

  ctx.strokeStyle = '#F5B526';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(r.leftAnchor - 16, r.y);
  ctx.lineTo(r.rightAnchor + 16, r.y);
  ctx.stroke();
  if (typeof ctx.setLineDash === 'function') {
    ctx.setLineDash([6, 7]);
    ctx.strokeStyle = 'rgba(206,132,18,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r.leftAnchor - 16, r.y);
    ctx.lineTo(r.rightAnchor + 16, r.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 绳结（位移可视化的焦点）
  ctx.fillStyle = MACARON.knot;
  ctx.beginPath();
  ctx.arc(r.cx + px, r.y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(r.cx + px, r.y, 12, 0, Math.PI * 2);
  ctx.stroke();

  // 双方小人：位移偏向谁，谁的姿态更"站得住"（lean>0 表示被拉向己方）
  const lean = px / (r.maxPx || 1);
  drawFigure(ctx, r.leftAnchor - 10, r.y - 6, MACARON.ourDeep, 1, lean);
  drawFigure(ctx, r.rightAnchor + 10, r.y - 6, MACARON.oppDeep, -1, -lean);

  // 倒计时（开局阶段：浅色蒙层 + 描边渐变大字）
  if (v.phase === 'countdown') {
    const seconds = Math.max(1, Math.ceil((v.countdownLeftMs || 0) / 1000));
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(0, 0, W, layout.height);
    drawOutlinedText(ctx, String(seconds), W / 2, layout.height / 2, {
      font: 'bold 92px sans-serif',
      fill: '#FF9E4A',
      outline: '#FFFFFF',
      outlineWidth: 10,
      glow: 'rgba(255,158,74,0.5)',
      glowBlur: 16,
    });
  }

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

module.exports = { drawRope };
