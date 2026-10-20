'use strict';

/**
 * 服务端局外成长（《项目说明书》§4.6 局外成长 + §6.6 数值）
 *
 * 与客户端 `minigame/src/core/progression.js` **同一套公式、同一份参数**
 * （参数来自 constants.PROGRESSION 镜像），由 `test/progression.test.js` 交叉校验两端等价。
 * 服务端相对客户端的唯一增量：**每日封顶**（§6.6 防刷）——按当日已产出量削减本局奖励。
 */

const { PROGRESSION } = require('./constants.js');

/** 升到第 level 级所需经验（§6.6：`levelBase + levelStep × (level − 1)`）。 */
function expToNext(level, cfg) {
  const c = cfg || PROGRESSION;
  return c.levelBase + c.levelStep * (Math.max(1, Math.floor(level || 1)) - 1);
}

/** 由等级推导段位（取满足 `minLevel ≤ level` 的最后一段）。 */
function rankFor(level, cfg) {
  const c = cfg || PROGRESSION;
  const lv = Math.max(1, Math.floor(level || 1));
  const ranks = c.ranks;
  let picked = ranks[0];
  for (let i = 0; i < ranks.length; i += 1) {
    if (lv >= ranks[i].minLevel) picked = ranks[i];
  }
  return picked;
}

/** 由累计经验推导等级。 */
function levelFromExp(exp, cfg) {
  const c = cfg || PROGRESSION;
  let level = 1;
  let left = Math.max(0, Math.floor(exp || 0));
  while (level < c.maxLevel) {
    const need = expToNext(level, c);
    if (left < need) break;
    left -= need;
    level += 1;
  }
  const isMax = level >= c.maxLevel;
  return { level, expInLevel: left, expToNext: isMax ? 0 : expToNext(level, c), isMax };
}

/** 单局奖励（§6.6）：只由对局摘要推导 + 单局封顶。 */
function awardFor(summary, cfg) {
  const c = cfg || PROGRESSION;
  const r = c.reward;
  const s = summary || {};
  const result = s.result === 'win' ? 'win' : s.result === 'draw' ? 'draw' : 'lose';
  const hits = Math.max(0, Math.floor(s.hits || 0));
  const perfects = Math.max(0, Math.floor(s.perfectHits || 0));

  const exp = Math.min(r.matchExpCap, (r.expByResult[result] || 0) + hits * r.expPerHit + perfects * r.expPerPerfect);
  const coins = Math.min(r.matchCoinCap, (r.coinsByResult[result] || 0) + perfects * r.coinsPerPerfect);
  return { exp, coins };
}

/**
 * 单局奖励 + **每日封顶**（服务端权威，§6.6 防刷）。
 * @param {object} summary 对局摘要
 * @param {object} counter 当日计数器（含 `expEarned` / `coinsEarned` 已产出量）
 * @returns {{exp:number, coins:number}} 实际发放量（可能因当日额度耗尽而为 0）
 */
function awardWithDailyCaps(summary, counter, cfg) {
  const c = cfg || PROGRESSION;
  const r = c.reward;
  const base = awardFor(summary, c);
  const usedExp = Math.max(0, Math.floor((counter && counter.expEarned) || 0));
  const usedCoins = Math.max(0, Math.floor((counter && counter.coinsEarned) || 0));
  const exp = Math.max(0, Math.min(base.exp, r.dailyExpCap - usedExp));
  const coins = Math.max(0, Math.min(base.coins, r.dailyCoinCap - usedCoins));
  return { exp, coins };
}

/**
 * 把奖励并入档案（返回新档案）：累计经验 / 金币，重算等级与段位，累计场次与胜场。
 * @param {object} profile 原档案（可为 null）
 * @param {{exp:number, coins:number}} award
 * @param {'win'|'lose'|'draw'} result
 * @param {number} nowMs
 */
function applyAward(profile, award, result, nowMs, cfg) {
  const c = cfg || PROGRESSION;
  const p = profile || {};
  const exp = Math.max(0, Math.floor(p.exp || 0) + Math.floor((award && award.exp) || 0));
  const coins = Math.max(0, Math.floor(p.coins || 0) + Math.floor((award && award.coins) || 0));
  const lv = levelFromExp(exp, c);
  return {
    ...p,
    exp,
    coins,
    level: lv.level,
    rankId: rankFor(lv.level, c).id,
    matches: Math.max(0, Math.floor(p.matches || 0)) + 1,
    wins: Math.max(0, Math.floor(p.wins || 0)) + (result === 'win' ? 1 : 0),
    updatedAt: nowMs,
  };
}

/** 对外回执用的进度摘要。 */
function progressOf(profile, cfg) {
  const c = cfg || PROGRESSION;
  const exp = Math.max(0, Math.floor((profile && profile.exp) || 0));
  const lv = levelFromExp(exp, c);
  const rank = rankFor(lv.level, c);
  return {
    exp,
    coins: Math.max(0, Math.floor((profile && profile.coins) || 0)),
    level: lv.level,
    expInLevel: lv.expInLevel,
    expToNext: lv.expToNext,
    rankId: rank.id,
    rankName: rank.name,
    matches: Math.max(0, Math.floor((profile && profile.matches) || 0)),
    wins: Math.max(0, Math.floor((profile && profile.wins) || 0)),
  };
}

module.exports = {
  expToNext,
  rankFor,
  levelFromExp,
  awardFor,
  awardWithDailyCaps,
  applyAward,
  progressOf,
};
