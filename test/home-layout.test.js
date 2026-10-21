'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeHomeLayout, createHomeScene } = require('../minigame/src/scenes/home.js');

const viewports = [
  { width: 360, height: 640 },
  { width: 390, height: 667 },
  { width: 430, height: 812 },
  { width: 750, height: 1334 },
];

test('首页按钮区上移并与资料卡相交，闯关入口提前且 CTA 单列排列', () => {
  for (const viewport of viewports) {
    const layout = computeHomeLayout(viewport);
    const buttons = [layout.main, layout.challenge, layout.levels];
    const centerX = layout.cx;

    assert.ok(layout.titleY < viewport.height * 0.213);
    assert.ok(layout.subY < viewport.height * 0.271);
    assert.ok(layout.card.y < viewport.height * 0.332);
    assert.equal(layout.card.w, Math.round(viewport.width * 0.836), '资料卡宽度恢复原布局');
    assert.equal(layout.card.h, Math.round(viewport.height * 0.205), '资料卡高度恢复原布局');
    const cardBottom = layout.card.y + layout.card.h;
    assert.ok(Math.abs(layout.main.y + layout.main.h / 2 - cardBottom) <= 1, '开始对战中心与资料卡底部对齐');
    assert.ok(layout.main.y < cardBottom && layout.main.y + layout.main.h > cardBottom, '开始对战与资料卡底部重叠');
    assert.ok(layout.levels.y + layout.levels.h / 2 < viewport.height * 0.664, '闯关挑战提前到好友挑战之前');
    assert.ok(layout.challenge.y + layout.challenge.h / 2 < viewport.height * 0.756, '按钮组尾部相较旧布局上移');
    assert.ok(layout.main.w < viewport.width * 0.755);
    assert.ok(layout.main.h < viewport.height * 0.098);
    assert.equal(Object.hasOwn(layout, 'share'), false, '首页不再布局分享战绩入口');

    for (const button of buttons) {
      assert.ok(Math.abs(button.x + button.w / 2 - centerX) <= 1, '每个按钮单独居中排列');
    }
    assert.ok(layout.main.y + layout.main.h < layout.levels.y, '开始对战与闯关挑战视觉上分离');
    assert.ok(layout.levels.y + layout.levels.h < layout.challenge.y, '闯关挑战与挑战好友视觉上分离');
  }
});

test('首页纵向 CTA 的触摸热区重叠时仍触发最近入口，不再触发分享战绩', () => {
  const layout = computeHomeLayout(viewports[0]);
  const calls = { start: 0, challenge: 0, levels: 0, share: 0 };
  const scene = createHomeScene({
    layout: viewports[0],
    onStart: () => { calls.start += 1; },
    onChallenge: () => { calls.challenge += 1; },
    onLevels: () => { calls.levels += 1; },
    onShare: () => { calls.share += 1; },
  });

  for (const [key, rect] of [
    ['start', layout.main],
    ['challenge', layout.challenge],
    ['levels', layout.levels],
  ]) {
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    scene.onTouchStart(x, y);
    scene.onTouchEnd(x, y);
    assert.equal(calls[key], 1, `${key} 入口应命中自身回调`);
  }
  assert.equal(calls.share, 0, '首页不保留分享战绩回调入口');
});
