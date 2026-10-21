'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMatch, nextRound, submit } = require('../minigame/src/core/battle.js');
const { createRng } = require('../minigame/src/core/rng.js');
const classicMode = require('../minigame/src/core/classic.js');
const { CLASSIC_MODE, PROGRESSION } = require('../minigame/src/config/config.js');

test('普通对战难度随开局段位提高，序列和候选不下降', () => {
  const params = PROGRESSION.ranks.map((rank) => classicMode.paramsAt(rank.id, 0));
  for (let i = 1; i < params.length; i += 1) {
    assert.ok(params[i].intensity >= params[i - 1].intensity);
    assert.ok(params[i].seqLen >= params[i - 1].seqLen);
    assert.ok(params[i].candidates >= params[i - 1].candidates);
    assert.ok(params[i].windowMs <= params[i - 1].windowMs);
    assert.ok(params[i].oppHit >= params[i - 1].oppHit);
    assert.ok(params[i].oppMiss <= params[i - 1].oppMiss);
  }
});

test('普通对战局内难度与能量倍率随时长升高，90 秒后保持最高档但不强制结束', () => {
  const samples = [0, 45000, 90000, 180000].map((elapsedMs) => classicMode.paramsAt('bronze', elapsedMs));
  for (let i = 1; i < samples.length; i += 1) {
    assert.ok(samples[i].intensity >= samples[i - 1].intensity);
    assert.ok(samples[i].energyScale >= samples[i - 1].energyScale);
  }
  assert.equal(samples[2].intensity, 1);
  assert.equal(samples[3].intensity, 1);
  assert.equal(samples[3].energyScale, samples[2].energyScale);
  assert.equal(samples[3].seqLen, CLASSIC_MODE.sequenceLength.max);
  assert.ok(samples[3].seqLen > classicMode.paramsAt('bronze', 0).seqLen);
  assert.equal(samples[3].candidates, 9);
});

test('普通对战实际命中能量随对局时长增大', () => {
  const hitAt = (elapsedMs) => {
    const rand = createRng(77);
    let match = nextRound(createMatch({ rankId: 'bronze' }), rand);
    match = { ...match, elapsedMs };
    const target = match.round.targetIds[match.round.seqIndex];
    return submit(match, target, 100, rand).player.lastGain;
  };
  assert.ok(hitAt(90000) > hitAt(0));
});
