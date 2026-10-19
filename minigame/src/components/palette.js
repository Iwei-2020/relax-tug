'use strict';

/**
 * 中部目标区 + 底部候选面板渲染（《项目说明书》§3.2 / §3.3 / §7.1 点击四态反馈）
 *
 * 风格：马卡龙（与首页统一）—— 两个分区都是磨砂玻璃面板叠在天空之上；
 * 玩法色块本身仍是 config.palette 的高饱和色（**不做马卡龙化**），
 * 只用白色厚描边 + 柔和投影与浅底拉开层次，保证 §3.2「目标色一眼可辨」。
 *
 * 中部：一条横向彩色条带，按序列段数等宽分段（§2.2 目标是一段一段的颜色序列），
 *       已点对的段压白、当前待点段白色粗描边高亮，条状倒计时表示「当前段」的剩余时间。
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

/**
 * 绘制中部目标区：一条横向彩色条带（= 本轮的目标颜色序列）。
 *
 * 三种段状态（§2.2 按序点击）：
 *   - 已点对 → 压白降饱和，表示"这段已经走过"；
 *   - 当前待点 → 白色粗描边 + 外发光，指出"现在该点哪一段"；
 *   - 尚未轮到 → 保持高饱和原色。
 *
 * 倒计时用**条状**而非环形（§3.2 两者皆可）：序列模式下时间属于「当前段」，
 * 横条能直观表达"每段一格时间"，且不会在宽条带上套出一个畸形的圆。
 *
 * @param {object} view { roundRemaining, combo, comboPop, perfect }
 */
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
  ctx.fillText('目标颜色序列', t.cx, layout.mid.y + 16);

  const seq = round ? round.targetIds : null;
  const n = seq ? seq.length : 0;
  const cleared = round ? Math.min(round.seqIndex, n) : 0;
  const x = t.cx - t.bandW / 2;
  const y = t.cy - t.bandH / 2;
  const segW = n > 0 ? t.bandW / n : t.bandW;

  // 条带整体投影（浅底上靠柔和灰蓝投影托起）
  ctx.save();
  chipShadow(ctx, 20, 8);
  ctx.fillStyle = '#8FA3C0';
  roundRect(ctx, x, y, t.bandW, t.bandH, t.radius);
  ctx.fill();
  ctx.restore();

  if (n > 0) {
    // 逐段填色：clip 到圆角内，段落用 fillRect + 1px 冗余避免出现细缝
    ctx.save();
    roundRect(ctx, x, y, t.bandW, t.bandH, t.radius);
    ctx.clip();
    ctx.lineCap = 'butt';
    for (let i = 0; i < n; i += 1) {
      ctx.fillStyle = hexOf(seq[i]);
      ctx.fillRect(x + i * segW, y, Math.ceil(segW) + 1, t.bandH);
    }
    if (cleared > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x, y, segW * cleared, t.bandH);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    for (let i = 1; i < n; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x + i * segW, y + 4);
      ctx.lineTo(x + i * segW, y + t.bandH - 4);
      ctx.stroke();
    }
    // 顶部玻璃高光
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, x + t.bandW * 0.03, y + t.bandH * 0.06, t.bandW * 0.94, t.bandH * 0.3, t.radius * 0.7);
    ctx.fill();
    ctx.restore();

    // 条带整体白描边
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    roundRect(ctx, x + 2, y + 2, t.bandW - 4, t.bandH - 4, t.radius);
    ctx.stroke();

    // 当前待点段：白色粗描边 + 外发光
    if (cleared < n) {
      ctx.save();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 6;
      ctx.shadowColor = 'rgba(255,255,255,0.95)';
      ctx.shadowBlur = 18;
      roundRect(ctx, x + cleared * segW + 2, y + 2, Math.max(8, segW - 4), t.bandH - 4, t.radius * 0.6);
      ctx.stroke();
      ctx.restore();
    }

    // 完美判定（§7.1）：刚点过的段追加金色描边 + 外发光，与普通命中一眼可辨
    if (v.perfect && cleared > 0) {
      ctx.save();
      ctx.strokeStyle = MACARON.warn;
      ctx.lineWidth = 6;
      ctx.shadowColor = 'rgba(255,180,61,0.95)';
      ctx.shadowBlur = 20;
      roundRect(ctx, x + (cleared - 1) * segW + 2, y + 2, Math.max(8, segW - 4), t.bandH - 4, t.radius * 0.6);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 当前段的剩余时间（条状，颜色由绿渐变到红）
  const remaining = v.roundRemaining === undefined ? 1 : Math.max(0, Math.min(1, v.roundRemaining));
  const barH = 12;
  const barY = y + t.bandH + 20;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  roundRect(ctx, x, barY, t.bandW, barH, barH / 2);
  ctx.fill();
  if (remaining > 0) {
    ctx.fillStyle = remaining > 0.5 ? MACARON.win : remaining > 0.25 ? MACARON.warn : MACARON.lose;
    roundRect(ctx, x, barY, Math.max(barH, t.bandW * remaining), barH, barH / 2);
    ctx.fill();
  }

  // 连击提示（命中时数字弹跳放大由渲染层按 comboPop 缩放）
  if (v.combo > 0) {
    const pop = 1 + Math.max(0, Math.min(0.6, v.comboPop || 0));
    ctx.save();
    ctx.translate(t.cx, y - 38);
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

  ctx.fillStyle = v.perfect ? MACARON.warn : MACARON.inkDim;
  ctx.font = v.perfect ? 'bold 16px sans-serif' : '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(
    v.perfect ? '完美！反应真快' : n > 0 ? `按顺序点下方同色块（${cleared}/${n}）` : '按顺序点下方同色块',
    t.cx,
    barY + barH + 10,
  );
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
