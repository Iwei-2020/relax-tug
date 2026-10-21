'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeLayout } = require('../minigame/src/components/theme.js');
const audio = require('../minigame/src/platform/audio.js');
const { createBattleScene } = require('../minigame/src/scenes/battle.js');

test('对局开场从 3 秒开始提示，并在倒计时结束时播放开始音', () => {
  const played = [];
  const originalPlay = audio.play;
  audio.play = (name) => {
    played.push(name);
    return true;
  };

  try {
    const scene = createBattleScene({
      layout: computeLayout({ windowWidth: 390, windowHeight: 667 }),
      seed: 7,
      onFinish() {},
    });
    assert.deepEqual(played, ['countdown'], '进入场景立即提示 3 秒倒计时');
    for (let i = 0; i < 30; i += 1) scene.update(100);
    assert.deepEqual(played, ['countdown', 'countdown', 'countdown', 'start']);

    scene.reset();
    assert.equal(played.at(-1), 'countdown', '重开对局重新提示倒计时');
  } finally {
    audio.play = originalPlay;
  }
});
