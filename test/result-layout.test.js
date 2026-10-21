'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createResultScene, computeResultLayout } = require('../minigame/src/scenes/result.js');
const decor = require('../minigame/src/components/decor.js');

test('结算页面板、主次按钮与首页入口保持纵向间距', () => {
  const viewports = [
    { width: 360, height: 640 },
    { width: 390, height: 667 },
    { width: 430, height: 812 },
    { width: 750, height: 1334 },
  ];

  for (const viewport of viewports) {
    for (const rows of [6, 8]) {
      const layout = computeResultLayout(viewport, rows);
      const panelBottom = layout.panel.y + layout.panel.h;
      const mainBottom = layout.main.y + layout.main.h;

      assert.ok(panelBottom < layout.main.y, `${viewport.height}px/${rows}行：面板与主按钮不能重叠`);
      assert.ok(layout.main.y - panelBottom >= viewport.height * 0.01, '面板与主按钮应留出间距');
      if (rows > 6) {
        const secondaryBottom = layout.secondary.y + layout.secondary.h;
        assert.ok(layout.secondary.y > mainBottom, '闯关次按钮不能与主按钮重叠');
        assert.ok(layout.secondary.y - mainBottom >= viewport.height * 0.02, '闯关按钮间距应更舒展');
        assert.ok(layout.home.y > secondaryBottom, '返回首页入口不能与次按钮重叠');
      } else {
        assert.ok(layout.home.y > mainBottom, '普通结算的返回首页入口应位于重开按钮下方');
      }
    }
  }
});

test('普通结算页直接重开，返回首页走 CTA，不再提供广告复活回调', () => {
  const viewport = { width: 390, height: 667 };
  const layout = computeResultLayout(viewport, 6);
  const calls = { replay: 0, home: 0, share: 0 };
  const scene = createResultScene({
    layout: viewport,
    summary: { result: 'lose', netEnergy: 0 },
    onReplay: () => { calls.replay += 1; },
    onHome: () => { calls.home += 1; },
    onShare: () => { calls.share += 1; },
  });

  const tap = (rect) => {
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    scene.onTouchStart(x, y);
    scene.onTouchEnd(x, y);
  };
  tap(layout.main);
  tap(layout.home);

  assert.equal(calls.replay, 1);
  assert.equal(calls.home, 1);
  assert.equal(calls.share, 0, '普通结算页不保留分享战绩入口');

  const originalDrawers = {
    drawSky: decor.drawSky,
    drawDecor: decor.drawDecor,
    drawOutlinedText: decor.drawOutlinedText,
    drawGlassPanel: decor.drawGlassPanel,
    drawCtaButton: decor.drawCtaButton,
    drawPillButton: decor.drawPillButton,
    drawConfetti: decor.drawConfetti,
  };
  const ctaLabels = [];
  try {
    decor.drawSky = () => {};
    decor.drawDecor = () => {};
    decor.drawOutlinedText = () => {};
    decor.drawGlassPanel = () => {};
    decor.drawCtaButton = (_ctx, _rect, options) => ctaLabels.push(options.label);
    decor.drawPillButton = () => {};
    decor.drawConfetti = () => {};
    scene.draw({
      createLinearGradient: () => ({ addColorStop() {} }),
      fillText() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      save() {},
      restore() {},
      translate() {},
    });
    assert.deepEqual(ctaLabels, ['再来一局', '返回首页']);
  } finally {
    Object.assign(decor, originalDrawers);
  }
});
