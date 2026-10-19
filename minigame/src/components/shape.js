'use strict';

/**
 * 基础几何绘制原语
 *
 * 低版本 canvas 无 `roundRect`，统一自绘圆角矩形路径。
 * 单独成模块的原因：rope / decor / palette / 场景层都需要它，若继续留在 rope.js，
 * 则 rope → decor（玻璃面板）与 decor → rope（圆角矩形）会形成循环依赖。
 */

/** 圆角矩形路径（不含 fill / stroke，由调用方决定）。 */
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
  ctx.arcTo(x, y + radius, x + radius, y, radius);
  ctx.closePath();
}

module.exports = { roundRect };
