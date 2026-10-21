'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLevelsScene, computeLevelsLayout } = require('../minigame/src/scenes/levels.js');

test('关卡选择页的翻页、选关和返回交互保持正确', () => {
  const viewport = { width: 390, height: 667 };
  const layout = computeLevelsLayout(viewport);
  const calls = { picked: [], back: 0 };
  const scene = createLevelsScene({
    layout: viewport,
    getState: () => ({ max: 0 }),
    onPick: (level) => calls.picked.push(level),
    onBack: () => { calls.back += 1; },
  });
  const tap = (rect) => {
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    scene.onTouchStart(x, y);
    scene.onTouchEnd(x, y);
  };

  tap(layout.next);
  tap({ x: layout.x0, y: layout.y0, w: layout.cell, h: layout.cell });
  assert.deepEqual(calls.picked, [21], '第二页第一个关卡应为第 21 关');
  tap(layout.prev);
  tap({ x: layout.x0, y: layout.y0, w: layout.cell, h: layout.cell });
  assert.deepEqual(calls.picked, [21, 1], '返回第一页后首个关卡应为第 1 关');
  tap(layout.back);
  assert.equal(calls.back, 1);
});
