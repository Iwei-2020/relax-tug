'use strict';

/**
 * Short sound effects for UI and gameplay. All playback is optional and must never block input.
 */

const ttApi = require('./tt.js');

const STORAGE_KEY = 'relax_tug_sfx_enabled_v1';
const SOUND_ROOT = 'assets/audio/';
const SOUNDS = {
  tap: { file: 'sfx_tap.wav', durationMs: 100, voices: 3, volume: 0.38 },
  hit: { file: 'sfx_hit.wav', durationMs: 150, voices: 2, volume: 0.48 },
  perfect: { file: 'sfx_perfect.wav', durationMs: 300, voices: 1, volume: 0.55 },
  miss: { file: 'sfx_miss.wav', durationMs: 180, voices: 1, volume: 0.42 },
  timeout: { file: 'sfx_timeout.wav', durationMs: 180, voices: 1, volume: 0.34 },
  countdown: { file: 'sfx_countdown.wav', durationMs: 180, voices: 1, volume: 0.4 },
  start: { file: 'sfx_start.wav', durationMs: 240, voices: 1, volume: 0.5 },
  combo: { file: 'sfx_combo.wav', durationMs: 300, voices: 1, volume: 0.52 },
  tension: { file: 'sfx_tension.wav', durationMs: 300, voices: 1, volume: 0.36 },
  event: { file: 'sfx_event.wav', durationMs: 320, voices: 1, volume: 0.42 },
  win: { file: 'sfx_win.wav', durationMs: 520, voices: 1, volume: 0.6 },
  lose: { file: 'sfx_lose.wav', durationMs: 520, voices: 1, volume: 0.52 },
  draw: { file: 'sfx_draw.wav', durationMs: 360, voices: 1, volume: 0.48 },
};

const pools = Object.create(null);
let initialized = false;
let enabled = true;

function listen(context, eventName, callback) {
  if (!context || typeof context[eventName] !== 'function') return;
  try {
    context[eventName](callback);
  } catch (err) {
    // Event hooks vary between host runtime versions.
  }
}

function createVoice(definition) {
  const context = ttApi.createInnerAudioContext();
  if (!context) return null;

  const voice = { context, busy: false, startedAt: 0, durationMs: definition.durationMs };
  try {
    context.src = `${SOUND_ROOT}${definition.file}`;
    context.volume = definition.volume;
    context.autoplay = false;
    context.loop = false;
    context.obeyMuteSwitch = true;
  } catch (err) {
    // A failed preload should not stop game startup.
  }
  listen(context, 'onEnded', () => { voice.busy = false; });
  listen(context, 'onError', () => { voice.busy = false; });
  return voice;
}

function init() {
  if (initialized) return Object.keys(pools).length > 0;
  if (!ttApi.isAvailable()) return false;

  enabled = ttApi.getStorageSync(STORAGE_KEY, true) !== false;
  initialized = true;
  for (const [name, definition] of Object.entries(SOUNDS)) {
    pools[name] = [];
    for (let i = 0; i < definition.voices; i += 1) {
      const voice = createVoice(definition);
      if (voice) pools[name].push(voice);
    }
  }
  return Object.values(pools).some((pool) => pool.length > 0);
}

function isEnabled() {
  if (!initialized) init();
  return enabled;
}

function setEnabled(value) {
  if (!initialized) init();
  enabled = value === true;
  ttApi.setStorageSync(STORAGE_KEY, enabled);
  if (!enabled) stopAll();
  return enabled;
}

function toggle() {
  return setEnabled(!isEnabled());
}

function play(name) {
  if (!isEnabled()) return false;
  const pool = pools[name];
  if (!pool || pool.length === 0) return false;

  const now = Date.now();
  let voice = pool.find((item) => !item.busy || now - item.startedAt > item.durationMs + 160);
  if (!voice) {
    voice = pool.reduce((oldest, item) => (item.startedAt < oldest.startedAt ? item : oldest), pool[0]);
    try {
      voice.context.stop();
    } catch (err) {
      // Reuse the voice even if stop is unsupported.
    }
  }

  try {
    if (typeof voice.context.seek === 'function') {
      try {
        voice.context.seek(0);
      } catch (err) {
        // Some hosts do not support seeking before the first play.
      }
    }
    voice.busy = true;
    voice.startedAt = now;
    voice.context.play();
    return true;
  } catch (err) {
    voice.busy = false;
    return false;
  }
}

function stopAll() {
  for (const pool of Object.values(pools)) {
    for (const voice of pool) {
      if (!voice.busy) continue;
      try {
        voice.context.stop();
      } catch (err) {
        // Ignore unsupported stop calls.
      }
      voice.busy = false;
    }
  }
}

function destroy() {
  stopAll();
  for (const pool of Object.values(pools)) {
    for (const voice of pool) {
      try {
        if (typeof voice.context.destroy === 'function') voice.context.destroy();
      } catch (err) {
        // Audio contexts are best-effort resources.
      }
    }
  }
  for (const key of Object.keys(pools)) delete pools[key];
  initialized = false;
}

module.exports = { STORAGE_KEY, SOUNDS, init, isEnabled, setEnabled, toggle, play, stopAll, destroy };
