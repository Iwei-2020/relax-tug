'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeLayout, paletteGrid, GAP } = require('../minigame/src/components/theme.js');

test('3x3 候选色网格在常见小屏尺寸内完整显示', () => {
  const viewports = [
    { windowWidth: 390, windowHeight: 667, safeArea: { top: 20, bottom: 633 } },
    { windowWidth: 430, windowHeight: 812, safeArea: { top: 24, bottom: 778 } },
    { windowWidth: 750, windowHeight: 1334, safeArea: { top: 24, bottom: 1300 } },
  ];

  for (const viewport of viewports) {
    const layout = computeLayout(viewport);
    const grid = paletteGrid(layout.bottomArea, 9);
    assert.equal(grid.rows, 3);
    const maxCell = Math.min(
      Math.floor((layout.bottomArea.w - 24 - GAP * 2) / 3),
      Math.floor((layout.bottomArea.h - GAP * 2) / 3)
    );
    assert.ok(grid.cell < maxCell, '候选色块应略微缩小');
    assert.equal(grid.gap, 10, '颜色间距应小幅缩小');
    for (let i = 0; i < 9; i += 1) {
      const cell = grid.rect(i);
      assert.ok(cell.x >= layout.bottomArea.x, `候选 ${i} 超出左边界`);
      assert.ok(cell.y >= layout.bottomArea.y, `候选 ${i} 超出上边界`);
      assert.ok(cell.x + cell.w <= layout.bottomArea.x + layout.bottomArea.w, `候选 ${i} 超出右边界`);
      assert.ok(cell.y + cell.h <= layout.bottomArea.y + layout.bottomArea.h, `候选 ${i} 超出下边界`);
    }
    assert.ok(layout.rope && layout.top.h > viewport.windowHeight * 0.3, '顶部拔河区应恢复部分高度');
    assert.ok(layout.target.cy < layout.mid.y + layout.mid.h / 2, '目标序列应上移');
  }
});
