'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'minigame/assets/audio');
const SAMPLE_RATE = 22050;

const CLIPS = {
  tap: {
    duration: 0.075,
    noise: 0.12,
    notes: [{ start: 0, duration: 0.072, from: 980, to: 620, gain: 0.52, wave: 'sine' }],
  },
  hit: {
    duration: 0.115,
    noise: 0.07,
    notes: [{ start: 0, duration: 0.11, from: 1180, to: 760, gain: 0.45, wave: 'sine' }],
  },
  perfect: {
    duration: 0.27,
    notes: [
      { start: 0, duration: 0.13, from: 880, to: 1040, gain: 0.3, wave: 'sine' },
      { start: 0.105, duration: 0.16, from: 1320, to: 1120, gain: 0.25, wave: 'sine' },
    ],
  },
  miss: {
    duration: 0.15,
    noise: 0.09,
    notes: [{ start: 0, duration: 0.145, from: 310, to: 145, gain: 0.48, wave: 'triangle' }],
  },
  timeout: {
    duration: 0.14,
    notes: [{ start: 0, duration: 0.13, from: 420, to: 250, gain: 0.34, wave: 'triangle' }],
  },
  countdown: {
    duration: 0.14,
    notes: [{ start: 0, duration: 0.13, from: 620, to: 510, gain: 0.36, wave: 'sine' }],
  },
  start: {
    duration: 0.24,
    notes: [{ start: 0, duration: 0.22, from: 760, to: 1120, gain: 0.34, wave: 'sine' }],
  },
  combo: {
    duration: 0.28,
    notes: [
      { start: 0, duration: 0.1, from: 620, to: 700, gain: 0.27, wave: 'sine' },
      { start: 0.085, duration: 0.1, from: 830, to: 910, gain: 0.24, wave: 'sine' },
      { start: 0.17, duration: 0.1, from: 1080, to: 980, gain: 0.22, wave: 'sine' },
    ],
  },
  tension: {
    duration: 0.28,
    noise: 0.025,
    notes: [{ start: 0, duration: 0.27, from: 150, to: 250, gain: 0.38, wave: 'triangle' }],
  },
  event: {
    duration: 0.3,
    notes: [
      { start: 0, duration: 0.16, from: 740, to: 980, gain: 0.23, wave: 'sine' },
      { start: 0.13, duration: 0.16, from: 1240, to: 1060, gain: 0.2, wave: 'sine' },
    ],
  },
  win: {
    duration: 0.5,
    notes: [
      { start: 0, duration: 0.16, from: 523, to: 523, gain: 0.24, wave: 'sine' },
      { start: 0.105, duration: 0.16, from: 659, to: 659, gain: 0.23, wave: 'sine' },
      { start: 0.21, duration: 0.16, from: 784, to: 784, gain: 0.22, wave: 'sine' },
      { start: 0.315, duration: 0.18, from: 1047, to: 1047, gain: 0.2, wave: 'sine' },
    ],
  },
  lose: {
    duration: 0.43,
    notes: [
      { start: 0, duration: 0.17, from: 440, to: 410, gain: 0.28, wave: 'triangle' },
      { start: 0.14, duration: 0.17, from: 349, to: 320, gain: 0.25, wave: 'triangle' },
      { start: 0.28, duration: 0.14, from: 262, to: 220, gain: 0.22, wave: 'triangle' },
    ],
  },
  draw: {
    duration: 0.28,
    notes: [
      { start: 0, duration: 0.12, from: 520, to: 520, gain: 0.22, wave: 'sine' },
      { start: 0.13, duration: 0.13, from: 500, to: 460, gain: 0.2, wave: 'sine' },
    ],
  },
};

function waveform(phase, type) {
  if (type === 'triangle') return (2 / Math.PI) * Math.asin(Math.sin(phase));
  if (type === 'square') return Math.sin(phase) >= 0 ? 1 : -1;
  return Math.sin(phase);
}

function renderWav(clip) {
  const frameCount = Math.ceil(clip.duration * SAMPLE_RATE);
  const dataBytes = frameCount * 2;
  const output = Buffer.alloc(44 + dataBytes);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write('WAVE', 8);
  output.write('fmt ', 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(SAMPLE_RATE, 24);
  output.writeUInt32LE(SAMPLE_RATE * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(dataBytes, 40);

  let noiseState = 0x6d2b79f5;
  for (let i = 0; i < frameCount; i += 1) {
    const time = i / SAMPLE_RATE;
    let sample = 0;
    for (const note of clip.notes) {
      const elapsed = time - note.start;
      if (elapsed < 0 || elapsed >= note.duration) continue;
      const progress = elapsed / note.duration;
      const phase = 2 * Math.PI * (note.from * elapsed + ((note.to - note.from) * elapsed * elapsed) / (2 * note.duration));
      const envelope = Math.min(1, elapsed / 0.006) * Math.pow(1 - progress, 2.1);
      sample += waveform(phase, note.wave) * envelope * note.gain;
    }
    if (clip.noise) {
      noiseState ^= noiseState << 13;
      noiseState ^= noiseState >>> 17;
      noiseState ^= noiseState << 5;
      const noise = ((noiseState >>> 0) / 0xffffffff) * 2 - 1;
      sample += noise * clip.noise * Math.exp(-time * 52);
    }
    const pcm = Math.max(-1, Math.min(1, sample)) * 32767;
    output.writeInt16LE(Math.round(pcm), 44 + i * 2);
  }
  return output;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  if (!checkOnly) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const errors = [];
  let totalBytes = 0;

  for (const [name, definition] of Object.entries(CLIPS)) {
    const filePath = path.join(OUTPUT_DIR, `sfx_${name}.wav`);
    const expected = renderWav(definition);
    totalBytes += expected.length;
    if (checkOnly) {
      if (!fs.existsSync(filePath) || !fs.readFileSync(filePath).equals(expected)) {
        errors.push(`缺失或过期: minigame/assets/audio/sfx_${name}.wav`);
      }
    } else {
      fs.writeFileSync(filePath, expected);
    }
  }

  if (errors.length > 0) {
    console.error('[gen-audio] 检查失败：');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(
    checkOnly
      ? `[gen-audio] --check 通过：${Object.keys(CLIPS).length} 个短音效资源 (${totalBytes} bytes)`
      : `[gen-audio] 已生成 ${Object.keys(CLIPS).length} 个短音效资源 (${totalBytes} bytes)`
  );
}

if (require.main === module) main();

module.exports = { CLIPS, renderWav };
