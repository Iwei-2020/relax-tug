'use strict';

/**
 * 中部目标区 + 底部候选面板渲染（《项目说明书》§3.2 / §3.3 / §7.1 点击四态反馈）
 *
 * 中部：单个大色块居中（尺寸 ≥160px、圆角 16~24px），环形倒计时由绿渐变到红，上方显示连击。
 * 底部：候选色网格（4 / 6 / 9 格，受难度控制）；交互态四态 —— 默认 / 按下 / 命中正确 / 命中错误。
 */

const { COLORS, paletteGrid } = require('./theme.js');
const { hexOf } = require('../core/colors.js');
const { roundRect } = require('./rope.js');

/** 绘制中部目标区。 */
function drawTarget(ctx, layout, round, view) {
  const v = view || {};
  const t = layout.target;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(layout.mid.x, layout.mid.y, layout.mid.w, layout.mid.h);

  ctx.fillStyle = COLORS.textDim;
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('目标颜色', t.cx, layout.mid.y + 16);

  const size = t.size;
  const x = t.cx - size / 2;
  const y = t.cy - size / 2;

  // 目标色块（带内阴影与描边）
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = round ? hexOf(round.targetId) : '#556070';
  roundRect(ctx, x, y, size, size, t.radius);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, size, size, t.radius);
  ctx.stroke();

  // 环形倒计时（剩余比例 1 → 0，颜色由绿渐变到红）
  const remaining = v.roundRemaining === undefined ? 1 : Math.max(0, Math.min(1, v.roundRemaining));
  const ringR = size / 2 + 22;
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(t.cx, t.cy, ringR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = remaining > 0.5 ? COLORS.win : remaining > 0.25 ? COLORS.warn : COLORS.lose;
  ctx.beginPath();
  ctx.arc(t.cx, t.cy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining);
  ctx.stroke();

  // 连击提示（命中时数字弹跳放大由渲染层按 comboPop 缩放）
  if (v.combo > 0) {
    const pop = 1 + Math.max(0, Math.min(0.6, (v.comboPop || 0)));
    ctx.save();
    ctx.translate(t.cx, y - 34);
    ctx.scale(pop, pop);
    ctx.fillStyle = COLORS.warn;
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`连击 ×${v.combo}`, 0, 0);
    ctx.restore();
  }

  ctx.fillStyle = COLORS.textDim;
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('点下方同色块', t.cx, t.cy + ringR + 10);
}

/**
 * 绘制底部候选面板。
 * @param {object} view { pressedIndex, hitIndex, missIndex, feedbackTtl }
 */
function drawPalette(ctx, layout, round, view) {
  const v = view || {};
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(layout.bottom.x, layout.bottom.y, layout.bottom.w, layout.bottom.h);

  if (!round) return;
  const grid = paletteGrid(layout.bottomArea, round.optionIds.length);

  for (let i = 0; i < round.optionIds.length; i += 1) {
    const rc = grid.rect(i);
    const id = round.optionIds[i];
    const pressed = v.pressedIndex === i;
    const hit = v.hitIndex === i;
    const miss = v.missIndex === i;

    // 按下缩放 0.92（§7.1）
    const scale = pressed ? 0.92 : 1;
    const w = rc.w * scale;
    const h = rc.h * scale;
    const x = rc.x + (rc.w - w) / 2;
    const y = rc.y + (rc.h - h) / 2;

    ctx.globalAlpha = miss ? 0.55 : 1;
    ctx.fillStyle = hexOf(id);
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();

    // 命中正确：绿色描边爆闪；命中错误：红色描边
    ctx.lineWidth = hit || miss ? 5 : 2;
    ctx.strokeStyle = hit ? COLORS.win : miss ? COLORS.lose : 'rgba(255,255,255,0.18)';
    roundRect(ctx, x, y, w, h, 14);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/**
 * 命中测试：返回被点击的候选色下标（未命中任何色块返回 -1）。
 * 触摸坐标需已换算为逻辑像素（见 game/loop.js）。
 */
function hitTest(layout, round, x, y) {
  if (!round) return -1;
  const grid = paletteGrid(layout.bottomArea, round.optionIds.length);
  for (let i = 0; i < round.optionIds.length; i += 1) {
    if (grid.contains(i, x, y)) return i;
  }
  return -1;
}

module.exports = { drawTarget, drawPalette, hitTest };
