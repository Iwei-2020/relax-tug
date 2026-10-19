'use strict';

/**
 * 顶部区域渲染：拔河比赛状态视图（《项目说明书》§2.1 / §3.1）
 *
 * 视觉元素：拔河绳 + 双方小人 + 拉扯进度（绳结位置 = 位移）+ 判定线 + 能量对比条。
 *
 * 手感要求（§3.1）：绳结位移必须**跟手且平滑**（线性映射，禁止 >100ms 阻尼延迟）；
 * 我方即将越线时判定线脉冲发光，对手即将越线时全屏轻微红色边缘警示。
 */

const { COLORS } = require('./theme.js');

/** 圆角矩形路径（低版本 canvas 无 roundRect，统一自绘）。 */
function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/** 能量对比条（我方左、对方右）。 */
function drawEnergyBars(ctx, layout, myEnergy, oppEnergy) {
  const r = layout.rope;
  const max = Math.max(1, myEnergy, oppEnergy);
  const myW = Math.max(4, Math.round((myEnergy / max) * r.barW));
  const oppW = Math.max(4, Math.round((oppEnergy / max) * r.barW));

  ctx.fillStyle = COLORS.line;
  roundRect(ctx, 24, r.barY, r.barW, r.barH, r.barH / 2);
  ctx.fill();
  roundRect(ctx, layout.width - 24 - r.barW, r.barY, r.barW, r.barH, r.barH / 2);
  ctx.fill();

  ctx.fillStyle = COLORS.our;
  roundRect(ctx, 24, r.barY, myW, r.barH, r.barH / 2);
  ctx.fill();
  ctx.fillStyle = COLORS.opp;
  roundRect(ctx, layout.width - 24 - oppW, r.barY, oppW, r.barH, r.barH / 2);
  ctx.fill();

  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`我方 ${myEnergy}`, 24, r.barY + r.barH + 6);
  ctx.textAlign = 'right';
  ctx.fillText(`对手 ${oppEnergy}`, layout.width - 24, r.barY + r.barH + 6);
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
 * 绘制顶部拔河视图。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} layout 见 theme.computeLayout
 * @param {object} view { px, myEnergy, oppEnergy, phase, countdownLeftMs, flash }
 */
function drawRope(ctx, layout, view) {
  const v = view || {};
  const r = layout.rope;

  // 背景：深色渐变，两侧阵营分色（§3.1）
  const grad = ctx.createLinearGradient(0, layout.top.y, 0, layout.top.y + layout.top.h);
  grad.addColorStop(0, COLORS.bgTop);
  grad.addColorStop(1, COLORS.ground);
  ctx.fillStyle = grad;
  ctx.fillRect(layout.top.x, layout.top.y, layout.top.w, layout.top.h);

  ctx.fillStyle = 'rgba(255,107,53,0.10)';
  ctx.fillRect(layout.top.x, layout.top.y, layout.width / 2, layout.top.h);
  ctx.fillStyle = 'rgba(47,168,225,0.10)';
  ctx.fillRect(layout.width / 2, layout.top.y, layout.width / 2, layout.top.h);

  drawEnergyBars(ctx, layout, v.myEnergy || 0, v.oppEnergy || 0);

  // 地面线
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r.leftAnchor - 10, r.y + 44);
  ctx.lineTo(r.rightAnchor + 10, r.y + 44);
  ctx.stroke();

  // 判定线（±maxPx，越线时高亮闪烁）
  const px = Math.max(-r.maxPx, Math.min(r.maxPx, v.px || 0));
  const judgeL = r.cx - r.maxPx;
  const judgeR = r.cx + r.maxPx;
  const nearWin = Math.abs(px) >= r.maxPx * 0.8;
  for (const jx of [judgeL, judgeR]) {
    ctx.strokeStyle = nearWin ? COLORS.warn : COLORS.line;
    ctx.lineWidth = nearWin ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(jx, r.y - 26);
    ctx.lineTo(jx, r.y + 34);
    ctx.stroke();
  }

  // 拔河绳：左半我方色、右半对方色，绳结随位移移动
  ctx.lineWidth = 8;
  ctx.strokeStyle = COLORS.our;
  ctx.beginPath();
  ctx.moveTo(r.leftAnchor, r.y);
  ctx.lineTo(r.cx + px, r.y);
  ctx.stroke();
  ctx.strokeStyle = COLORS.opp;
  ctx.beginPath();
  ctx.moveTo(r.cx + px, r.y);
  ctx.lineTo(r.rightAnchor, r.y);
  ctx.stroke();

  // 绳结
  ctx.fillStyle = COLORS.knot;
  ctx.beginPath();
  ctx.arc(r.cx + px, r.y, 9, 0, Math.PI * 2);
  ctx.fill();

  // 双方小人：位移偏向谁，谁的姿态更"站得住"（lean>0 表示被拉向己方）
  const lean = px / (r.maxPx || 1);
  drawFigure(ctx, r.leftAnchor - 6, r.y - 6, COLORS.our, 1, lean);
  drawFigure(ctx, r.rightAnchor + 6, r.y - 6, COLORS.opp, -1, -lean);

  // 倒计时（开局阶段）
  if (v.phase === 'countdown') {
    const seconds = Math.max(1, Math.ceil((v.countdownLeftMs || 0) / 1000));
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.fillStyle = COLORS.white;
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(seconds), layout.width / 2, layout.height / 2);
  }

  // 对手即将越线时的全屏红色边缘警示（§3.1）
  if (px <= -r.maxPx * 0.8) {
    ctx.strokeStyle = 'rgba(255,77,79,0.55)';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, layout.width, layout.height);
  }
  if (px >= r.maxPx * 0.8) {
    ctx.strokeStyle = 'rgba(255,197,61,0.55)';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, layout.width, layout.height);
  }
}

module.exports = { drawRope, roundRect };
