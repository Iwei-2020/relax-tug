'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeResultLayout } = require('../minigame/src/scenes/result.js');

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
      const secondaryBottom = layout.secondary.y + layout.secondary.h;

      assert.ok(panelBottom < layout.main.y, `${viewport.height}px/${rows}行：面板与主按钮不能重叠`);
      assert.ok(layout.main.y - panelBottom >= viewport.height * 0.01, '面板与主按钮应留出间距');
      assert.ok(layout.secondary.y > mainBottom, '主次按钮不能重叠');
      assert.ok(layout.secondary.y - mainBottom >= viewport.height * 0.02, '主次按钮间距应更舒展');
      assert.ok(layout.home.y > secondaryBottom, '返回首页入口不能与次按钮重叠');
    }
  }
});
