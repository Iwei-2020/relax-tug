'use strict';

/**
 * 随机事件单测（《项目说明书》§6.5 随机事件）
 *
 * 覆盖：种子驱动的确定性（同种子同事件序列）、频率上限、生命周期衰减、
 *      三类修饰（能量倍率 / 窗口缩放 / 视觉迷雾）实际生效，
 *      以及最关键的硬性约束 —— **事件不改变胜负条件**。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEventState,
  findEvent,
  activeEvent,
  tick,
  maybeTrigger,
} = require('../minigame/src/core/events.js');
const {
  createMatch,
  beginPlaying,
  nextRound,
  submit,
  isOver,
  summary,
} = require('../minigame/src/core/battle.js');
const { createRng } = require('../minigame/src/core/rng.js');
const {
  RANDOM_EVENTS,
  EVENT_MAX_ENERGY_SCALE,
  WIN_NET_ENERGY,
  CLASSIC_MODE,
} = require('../minigame/src/config/config.js');

function curTarget(m) {
  return m.round ? m.round.targetIds[m.round.seqIndex] : null;
}

/**
 * 单段耗时（模拟「熟练玩家快速连点」）：以固定小 dt 驱动 playOut，
 * 使确定性用例在有限步数内因能量越线收官，不依赖普通对战的时长上限。
 */
const FAST_SEG_MS = 100;

/** 把一局跑到结束（全命中）。 */
function playOut(match, rand) {
  let m = match;
  let guard = 0;
  while (!isOver(m) && guard < 800) {
    m = submit(m, curTarget(m), FAST_SEG_MS, rand);
    if (!isOver(m)) m = nextRound(m, rand);
    guard += 1;
  }
  assert.ok(guard < 800, '对局应在有限轮次内结束');
  return m;
}

test('事件池：全部事件只做局内修饰，不含任何改变胜负条件的字段（§6.5 硬约束）', () => {
  assert.ok(RANDOM_EVENTS.pool.length > 0, '首版应有事件池');
  for (const ev of RANDOM_EVENTS.pool) {
    assert.ok(typeof ev.id === 'string' && ev.id.length > 0, '事件必须有 id');
    assert.ok(typeof ev.name === 'string' && ev.name.length > 0, '事件必须有可展示的名称');
    assert.ok(ev.weight > 0, '事件权重必须为正');
    // 合法效果字段：energyScale / windowScale / fog；不得出现触碰胜负口径的字段
    for (const key of Object.keys(ev)) {
      assert.ok(
        ['id', 'name', 'desc', 'weight', 'energyScale', 'windowScale', 'fog'].includes(key),
        `事件 ${ev.id} 含非法字段 ${key}`
      );
    }
    assert.equal(ev.winNetEnergy, undefined, '事件不得改变越线净能量差');
  }
  assert.equal(WIN_NET_ENERGY, 160, '越线净能量差不受随机事件影响');
  assert.equal(EVENT_MAX_ENERGY_SCALE, Math.max(...RANDOM_EVENTS.pool.map((e) => e.energyScale || 1)));
});

test('maybeTrigger：同种子得到同一事件序列（确定性，§6.5 可复现）', () => {
  function run(seed) {
    const rand = createRng(seed);
    let s = createEventState();
    for (let r = 0; r < 24; r += 1) s = maybeTrigger(s, r, rand);
    return s;
  }
  const a = run(20261019);
  const b = run(20261019);
  assert.deepEqual(b.firedIds, a.firedIds, '同种子必须得到同一事件序列');
  assert.equal(b.nextCheckRound, a.nextCheckRound);
  assert.equal(b.fired, a.fired);
});

test('maybeTrigger：每局触发次数不超过上限，且已达上限后不再触发（§6.5 频率上限）', () => {
  const rand = createRng(777);
  let s = createEventState();
  for (let r = 0; r < 60; r += 1) {
    s = maybeTrigger(s, r, rand);
    assert.ok(s.fired <= RANDOM_EVENTS.maxPerMatch, '触发次数不得超过每局上限');
  }
  assert.equal(s.firedIds.length, s.fired, 'fired 计数与事件序列长度一致');
});

test('maybeTrigger：有事件生效期间不叠加新事件；未到检查轮次不触发', () => {
  const rand = createRng(31);
  let s = createEventState();
  // 未到检查轮次（firstCheckRound 之前）不触发
  s = maybeTrigger(s, 0, rand);
  assert.equal(s.fired, 0);

  // 手工制造一个生效中的事件，再推进到检查轮次，应保持原状（不叠加）
  const active = { ...s, activeId: 'frenzy', activeLeftMs: RANDOM_EVENTS.durationMs, nextCheckRound: 0 };
  const after = maybeTrigger(active, 5, rand);
  assert.equal(after, active, '已有事件生效时原样返回，不新建对象也不叠加');
});

test('tick：事件按真实时间衰减，到期自动失效（§6.5 生命周期）', () => {
  let s = createEventState();
  s = { ...s, activeId: 'fog', activeLeftMs: 1000 };
  const half = tick(s, 400);
  assert.equal(half.activeId, 'fog');
  assert.equal(half.activeLeftMs, 600);

  const expired = tick(half, 700);
  assert.equal(expired.activeId, null, '到期后失效');
  assert.equal(expired.activeLeftMs, 0);
  assert.equal(activeEvent(expired), null, '失效后取不到生效事件（能量倍率 / 迷雾随之归零）');

  assert.equal(tick(expired, 500), expired, '已失效状态无需新建对象');
});

test('findEvent / activeEvent：查表与事件读取正确', () => {
  assert.equal(findEvent('not-exist'), null);
  assert.equal(findEvent(null), null);
  const frenzy = findEvent('frenzy');
  assert.equal(frenzy.energyScale, 1.5);
  const s = { ...createEventState(), activeId: 'rush', activeLeftMs: 100 };
  assert.equal(activeEvent(s).id, 'rush');
  assert.equal(activeEvent(s).windowScale, 0.75);
  assert.equal(activeEvent(s).energyScale, undefined, '未声明的事件效果即视为无该修饰');
});

test('能量倍率事件：命中能量按倍率放大（§6.5 手速狂潮），且只作用于玩家侧', () => {
  const rand = createRng(41);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  m = { ...m, elapsedMs: 90000 };
  const w = m.round.windowMs;
  // 注入生效中的「手速狂潮」（等同轮间触发后的状态）
  const withEvent = { ...m, events: { ...m.events, activeId: 'frenzy', activeLeftMs: RANDOM_EVENTS.durationMs } };
  // 用整窗耗时点中 → 普通判定（基准 12），乘 1.5 → 18
  const hit = submit(withEvent, curTarget(withEvent), w, rand);
  const base = submit(m, curTarget(m), w, rand);
  assert.equal(hit.lastRound.grade, 'good');
  assert.ok(hit.player.lastGain > base.player.lastGain, '能量应按事件倍率放大');
  assert.equal(hit.player.energy, hit.player.lastGain);

  // 同样条件、无事件：能量为基准值
  assert.ok(hit.player.energy > base.player.energy, '有事件时应更高');
});

test('窗口缩放事件：新轮每段输入窗口按倍率缩放（§6.5 疾风 / 喘息）', () => {
  const push = (id) => {
    const rand = createRng(51);
    let m = beginPlaying(createMatch({ difficulty: 'normal' }));
    if (id) m = { ...m, events: { ...m.events, activeId: id, activeLeftMs: RANDOM_EVENTS.durationMs } };
    return nextRound(m, rand);
  };
  const base = push(null);
  const rush = push('rush');
  const breather = push('breather');
  const baseWindow = base.round.windowMs;
  assert.equal(rush.round.windowMs, Math.round(baseWindow * 0.75), '疾风时刻窗口收窄');
  assert.equal(breather.round.windowMs, Math.round(baseWindow * 1.3), '喘息时刻窗口加宽');
});

test('随机事件不改变胜负条件：全命中仍必胜、越线阈值不变（§6.5 硬约束）', () => {
  // 用同一批种子跑完整对局，验证胜负口径与位移公式不因事件而改变
  for (const seed of [20261019, 777, 12345]) {
    const rand = createRng(seed);
    let m = beginPlaying(createMatch({ difficulty: 'normal' }));
    m = nextRound(m, rand);
    const done = playOut(m, rand);
    assert.equal(done.result, 'win', '全命中在开启随机事件后仍必胜');
    assert.equal(done.px, 220, '越线阈值对应的位移仍为 ±上限');
    const s = summary(done);
    assert.ok(s.eventsFired <= RANDOM_EVENTS.maxPerMatch, '结算上报的事件次数不超过上限');
    assert.equal(s.netEnergy, s.myEnergy - s.oppEnergy);
    assert.ok(s.hits <= s.rounds * CLASSIC_MODE.sequenceLength.max, '轮次一致性口径不受事件影响');
  }
});

test('summary：eventsFired 与 eventIds 与事件状态一致（§6.5 结算归类）', () => {
  const rand = createRng(20261019);
  let m = beginPlaying(createMatch({ difficulty: 'normal' }));
  m = nextRound(m, rand);
  const done = playOut(m, rand);
  const s = summary(done);
  assert.equal(s.eventsFired, done.events.fired);
  assert.deepEqual(s.eventIds, done.events.firedIds);
  assert.equal(summary(createMatch({})).eventsFired, 0, '未开局时事件次数为 0');
});
