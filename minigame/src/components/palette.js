'use strict';

/**
 * 中部目标区 + 底部候选面板渲染（《项目说明书》§3.2 / §3.3 / §7.1 点击四态反馈）
 *
 * 风格：马卡龙（与首页统一）—— 两个分区都是磨砂玻璃面板叠在天空之上；
 * 玩法色块本身仍是 config.palette 的高饱和色（**不做马卡龙化**），
 * 只用白色厚描边 + 柔和投影与浅底拉开层次，保证 §3.2「目标色一眼可辨」。
 *
 * 中部：单个大色块居中（尺寸 ≥160px、圆角 16~24px），环形倒计时由绿渐变到红，上方显示连击。
 * 底部：候选色网格（4 / 6 / 9 格，受难度控制）；交互态四态 —— 默认 / 按下 / 命中正确 / 命中错误。
 */

const { MACARON, paletteGrid } = require('./theme.js');
const { hexOf } = require('../core/colors.js');
const { roundRect } = require('./shape.js');
const { drawOutlinedText } = require('./decor.js');

/** 色块通用投影（浅底上靠柔和灰蓝投影托起）。 */
function chipShadow(ctx, blur, offsetY) {
  ctx.shadowColor = 'rgba(58,74,107,0.28)';
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = offsetY;
}

/** 绘制中部目标区。 */
function drawTarget(ctx, layout, round, view) {
  const v = view || {};
  const t = layout.target;

  // 中部玻璃面板
  ctx.fillStyle = MACARON.panel;
  ctx.fillRect(layout.mid.x, layout.mid.y, layout.mid.w, layout.mid.h);

  ctx.fillStyle = MACARON.inkDim;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('目标颜色', t.cx, layout.mid.y + 16);

  const size = t.size;
  const x = t.cx - size / 2;
  const y = t.cy - size / 2;

  // 目标色块：高饱和填充 + 白色厚描边 + 顶部玻璃高光
  ctx.save();
  chipShadow(ctx, 20, 8);
  ctx.fillStyle = round ? hexOf(round.targetId) : '#8FA3C0';
  roundRect(ctx, x, y, size, size, t.radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, size, size, t.radius);
  ctx.clip();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, x + size * 0.08, y + size * 0.06, size * 0.84, size * 0.34, t.radius * 0.7);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 4;
  roundRect(ctx, x + 2, y + 2, size - 4, size - 4, t.radius);
  ctx.stroke();

  // 环形倒计时（剩余比例 1 → 0，颜色由绿渐变到红）
  const remaining = v.roundRemaining === undefined ? 1 : Math.max(0, Math.min(1, v.roundRemaining));
  const ringR = size / 2 + 22;
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(t.cx, t.cy, ringR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineCap = 'round';
  ctx.strokeStyle = remaining > 0.5 ? MACARON.win : remaining > 0.25 ? MACARON.warn : MACARON.lose;
  ctx.beginPath();
  ctx.arc(t.cx, t.cy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining);
  ctx.stroke();

  // 连击提示（命中时数字弹跳放大由渲染层按 comboPop 缩放）
  if (v.combo > 0) {
    const pop = 1 + Math.max(0, Math.min(0.6, v.comboPop || 0));
    ctx.save();
    ctx.translate(t.cx, y - 36);
    ctx.scale(pop, pop);
    drawOutlinedText(ctx, `连击 ×${v.combo}`, 0, 0, {
      font: 'bold 26px sans-serif',
      fill: MACARON.warn,
      outline: '#FFFFFF',
      outlineWidth: 6,
      glow: 'rgba(255,180,61,0.4)',
      glowBlur: 10,
    });
    ctx.restore();
  }

  ctx.fillStyle = MACARON.inkDim;
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('点下方同色块', t.cx, t.cy + ringR + 12);
}

/**
 * 绘制底部候选面板。
 * @param {object} view { pressedIndex, hitIndex, missIndex }
 */
function drawPalette(ctx, layout, round, view) {
  const v = view || {};
  ctx.fillStyle = MACARON.panelStrong;
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
    const radius = 16;

    ctx.save();
    if (hit) {
      ctx.shadowColor = MACARON.win;
      ctx.shadowBlur = 22;
    } else if (miss) {
      ctx.shadowColor = MACARON.lose;
      ctx.shadowBlur = 18;
    } else {
      chipShadow(ctx, 12, 5);
    }
    ctx.globalAlpha = miss ? 0.5 : 1;
    ctx.fillStyle = hexOf(id);
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.restore();

    // 顶部玻璃高光（与按钮同语言）
    if (!miss) {
      ctx.save();
      roundRect(ctx, x, y, w, h, radius);
      ctx.clip();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, x + w * 0.08, y + h * 0.06, w * 0.84, h * 0.32, radius * 0.7);
      ctx.fill();
      ctx.restore();
    }

    // 命中正确：白描边加粗 + 绿色爆闪；命中错误：白描边 + 红色
    ctx.save();
    ctx.globalAlpha = miss ? 0.6 : 1;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = hit || miss ? 5 : 3;
    roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, radius - 1.5);
    ctx.stroke();
    ctx.restore();
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
