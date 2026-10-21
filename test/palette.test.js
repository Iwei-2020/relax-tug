'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { drawTarget } = require('../minigame/src/components/palette.js');
const { computeLayout } = require('../minigame/src/components/theme.js');

test('目标颜色段不绘制专属描边或阴影遮罩', () => {
  const strokes = [];
  const fillStyles = [];
  const shadowColors = [];
  const ctx = new Proxy(
    {},
    {
      get(target, key) {
        if (key === 'stroke') {
          return () => strokes.push({
            color: target.strokeStyle,
            width: target.lineWidth,
            glow: target.shadowBlur,
          });
        }
        if (key in target) return target[key];
        return () => {};
      },
      set(target, key, value) {
        if (key === 'fillStyle') fillStyles.push(value);
        if (key === 'shadowColor') shadowColors.push(value);
        target[key] = value;
        return true;
      },
    }
  );
  const layout = computeLayout({
    windowWidth: 390,
    windowHeight: 844,
    safeArea: { top: 24, bottom: 810 },
  });

  drawTarget(
    ctx,
    layout,
    { targetIds: ['red', 'blue', 'green'], seqIndex: 1 },
    { roundRemaining: 1, tMs: 200, perfect: true }
  );

  assert.ok(!strokes.some((s) => s.color === '#FFC83D' || s.color === '#FFB43D'));
  assert.ok(!fillStyles.includes('#FFC83D'), '当前目标段不应使用金色遮罩');
  assert.ok(!shadowColors.includes('rgba(255,180,35,0.98)'), '当前目标段不应使用金色阴影');
  assert.ok(!fillStyles.includes('rgba(35,48,72,0.24)'), '其他目标段不应额外压暗');
});
