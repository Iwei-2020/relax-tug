'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const clientLives = require('../minigame/src/core/lives.js');
const serverLives = require('../server/lib/lives.js');
const { createMemoryStore } = require('../server/lib/store.js');
const { resetStore } = require('../server/lib/store-provider.js');
const playerStateFn = require('../server/functions/playerState/index.js');

const CTX = { headers: { 'x-tt-openid': 'u-life' } };

test('每日生命值：UTC+8 零点刷新至 5 条，不结转并限制在 0 到 5', () => {
  const beforeMidnight = Date.UTC(2026, 9, 20, 15, 59, 59);
  const afterMidnight = Date.UTC(2026, 9, 20, 16, 0, 0);
  let state = clientLives.emptyLives(beforeMidnight);
  assert.equal(state.count, 5);

  for (let i = 0; i < 5; i += 1) {
    const result = clientLives.consumeLife(state, beforeMidnight);
    assert.equal(result.ok, true);
    state = result.state;
  }
  assert.equal(clientLives.consumeLife(state, beforeMidnight).ok, false);
  assert.deepEqual(clientLives.normalizeLives(state, afterMidnight), {
    day: '2026-10-21',
    count: 5,
  });

  const full = clientLives.grantLife(clientLives.emptyLives(beforeMidnight), beforeMidnight);
  assert.equal(full.ok, false, '生命值已满时不能继续累积');
});

test('客户端和服务端每日生命规则一致', () => {
  const now = Date.UTC(2026, 9, 20, 16, 0, 0);
  const samples = [
    null,
    { day: '2026-10-20', count: 2 },
    { day: '2026-10-21', count: 0 },
    { day: '2026-10-21', count: 99 },
    { day: '2026-10-21', count: -4 },
  ];
  for (const sample of samples) {
    assert.deepEqual(clientLives.normalizeLives(sample, now), serverLives.normalizeLives(sample, now));
  }
});

test('playerState：服务端扣减生命、拒绝耗尽后的开局，并支持广告领奖', async () => {
  const store = createMemoryStore();
  resetStore(store);

  let result = await playerStateFn({}, CTX);
  assert.equal(result.code, 0);
  assert.equal(result.data.lives.count, 5);

  for (let remaining = 4; remaining >= 0; remaining -= 1) {
    result = await playerStateFn({ action: 'consumeLife' }, CTX);
    assert.equal(result.data.consumed, true);
    assert.equal(result.data.lives.count, remaining);
  }
  result = await playerStateFn({ action: 'consumeLife' }, CTX);
  assert.equal(result.data.consumed, false);
  assert.equal(result.data.lives.count, 0);

  result = await playerStateFn({ action: 'rewardLife' }, CTX);
  assert.equal(result.data.granted, true);
  assert.equal(result.data.lives.count, 1);

  result = await playerStateFn({ action: 'rewardLife' }, CTX);
  assert.equal(result.data.lives.count, 2);
});

test('playerState：读取玩家状态时迁移旧金币字段', async () => {
  const store = createMemoryStore({
    profiles: {
      'u-life': {
        openid: 'u-life',
        exp: 120,
        level: 7,
        rankId: 'silver',
        coins: 999,
        wins: 2,
        matches: 3,
      },
    },
  });
  resetStore(store);

  const result = await playerStateFn({}, CTX);
  assert.equal(result.data.progress.rankId, 'silver');
  assert.equal(result.data.progress.rankPoints, 0);
  assert.equal(Object.hasOwn(result.data.progress, 'exp'), false);
  assert.equal(Object.hasOwn(result.data.progress, 'level'), false);
  assert.equal(Object.hasOwn(result.data.progress, 'coins'), false);
  const profile = await store.getProfile('u-life');
  assert.equal(Object.hasOwn(profile, 'coins'), false);
  assert.equal(Object.hasOwn(profile, 'exp'), false);
  assert.equal(Object.hasOwn(profile, 'level'), false);
});
