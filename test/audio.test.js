'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const AUDIO_PATH = require.resolve('../minigame/src/platform/audio.js');

function loadAudio(storageSeed) {
  const storage = { ...(storageSeed || {}) };
  const contexts = [];
  globalThis.GameGlobal = {
    tt: {
      getStorageSync(key) {
        return Object.hasOwn(storage, key) ? storage[key] : '';
      },
      setStorageSync(key, value) {
        storage[key] = value;
      },
      createInnerAudioContext() {
        const context = {
          playCount: 0,
          stopCount: 0,
          destroyCount: 0,
          seekPositions: [],
          handlers: {},
          play() { this.playCount += 1; },
          stop() { this.stopCount += 1; },
          seek(position) { this.seekPositions.push(position); },
          destroy() { this.destroyCount += 1; },
          onEnded(callback) { this.handlers.ended = callback; },
          onError(callback) { this.handlers.error = callback; },
        };
        contexts.push(context);
        return context;
      },
    },
  };
  delete require.cache[AUDIO_PATH];
  return { audio: require(AUDIO_PATH), contexts, storage };
}

function unloadAudio(audio) {
  audio.destroy();
  delete require.cache[AUDIO_PATH];
  delete globalThis.GameGlobal;
}

test('音效管理器预建上下文、播放、静音持久化并释放资源', () => {
  const { audio, contexts, storage } = loadAudio();
  try {
    assert.equal(audio.init(), true);
    assert.equal(contexts.length, Object.values(audio.SOUNDS).reduce((sum, item) => sum + item.voices, 0));
    assert.equal(audio.isEnabled(), true);

    const hitContext = contexts[audio.SOUNDS.tap.voices];
    assert.equal(hitContext.src, 'assets/audio/sfx_hit.wav');
    assert.equal(hitContext.obeyMuteSwitch, true);
    assert.equal(hitContext.autoplay, false);
    assert.equal(audio.play('hit'), true);
    assert.equal(hitContext.playCount, 1);
    assert.deepEqual(hitContext.seekPositions, [0]);

    assert.equal(audio.setEnabled(false), false);
    assert.equal(storage[audio.STORAGE_KEY], false);
    assert.equal(hitContext.stopCount, 1, '关闭音效应停止正在播放的声音');
    assert.equal(audio.play('hit'), false);

    assert.equal(audio.toggle(), true);
    assert.equal(storage[audio.STORAGE_KEY], true);
    assert.equal(audio.play('hit'), true);
    audio.destroy();
    assert.ok(contexts.every((context) => context.destroyCount === 1), '销毁时释放全部音频上下文');
  } finally {
    unloadAudio(audio);
  }
});

test('音效管理器恢复本地静音状态，宿主不支持音频时安全降级', () => {
  const { audio } = loadAudio({ relax_tug_sfx_enabled_v1: false });
  try {
    assert.equal(audio.init(), true);
    assert.equal(audio.isEnabled(), false);
    assert.equal(audio.play('tap'), false);
  } finally {
    unloadAudio(audio);
  }

  globalThis.GameGlobal = {
    tt: {
      getStorageSync() { return ''; },
      setStorageSync() {},
    },
  };
  delete require.cache[AUDIO_PATH];
  const unsupportedAudio = require(AUDIO_PATH);
  try {
    assert.equal(unsupportedAudio.init(), false);
    assert.equal(unsupportedAudio.isEnabled(), true);
    assert.equal(unsupportedAudio.play('tap'), false);
  } finally {
    unloadAudio(unsupportedAudio);
  }
});
