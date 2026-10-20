'use strict';

/**
 * 局外成长核心（《项目说明书》§4.6 局外成长 + §6.6 数值）
 *
 * 纯函数，一律返回新对象、绝不原地修改入参（与 core/energy.js 同约定）。
 * 数值全部取自 `config.progression`（唯一事实来源）；服务端 `server/lib/progression.js`
 * 用同一份镜像参数实现同一套公式，两端由 `test/progression.test.js` 交叉校验。
 *
 * 数据形状 Progress：
 *   { exp, coins, level, rankId, matches, wins }
 *   - exp / coins  累计经验 / 金币（服务端权威，客户端先做本地乐观写入）
 *   - level        由累计经验推导（不单独维护「升级事件」）
 *   - rankId       由等级推导的段位 id（只升不降）
 */

const { PROGRESSION } = require('../config/config.js');

/** 升到第 level 级所需经验（§6.6：`levelBase + levelStep × (level − 1)`）。 */
function expToNext(level, cfg) {
  const c = cfg || PROGRESSION;
  return c.levelBase + c.levelStep * (Math.max(1, Math.floor(level || 1)) - 1);
}

/** 由等级推导段位（取满足 `minLevel ≤ level` 的最后一段；只升不降）。 */
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

/** 空进度（新玩家）。 */
function emptyProgress() {
  return { exp: 0, coins: 0, level: 1, rankId: rankFor(1, PROGRESSION).id, matches: 0, wins: 0 };
}

/**
 * 由累计经验推导等级。
 * @returns {{level:number, expInLevel:number, expToNext:number, isMax:boolean}}
 *   - level      当前等级（≤ maxLevel）
 *   - expInLevel 当前等级内已积累的经验（满级时不再消耗，保留剩余量）
 *   - expToNext  升到下一级还需的经验（满级为 0）
 */
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

/**
 * 单局奖励（§6.6）：**只由对局摘要推导**，并施加单局封顶（防刷）。
 * 客户端与服务端用同一份参数各自重算，不存在「客户端上报奖励数字」的通道。
 * @param {object} summary core/battle.summary
 * @returns {{exp:number, coins:number}}
 */
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
 * 把一局的奖励并入进度（返回新对象）：累计经验 / 金币，重算等级与段位，累计场次与胜场。
 * @param {object} progress 原进度
 * @param {{exp:number, coins:number}} award awardFor 的结果
 * @param {'win'|'lose'|'draw'} result 本局结果
 */
function applyAward(progress, award, result, cfg) {
  const c = cfg || PROGRESSION;
  const p = progress || emptyProgress();
  const exp = Math.max(0, Math.floor(p.exp || 0) + Math.floor((award && award.exp) || 0));
  const coins = Math.max(0, Math.floor(p.coins || 0) + Math.floor((award && award.coins) || 0));
  const lv = levelFromExp(exp, c);
  return {
    exp,
    coins,
    level: lv.level,
    rankId: rankFor(lv.level, c).id,
    matches: Math.max(0, Math.floor(p.matches || 0)) + 1,
    wins: Math.max(0, Math.floor(p.wins || 0)) + (result === 'win' ? 1 : 0),
  };
}

/** 归一化：把存储里读到的任意形态收敛成合法 Progress，并重算等级 / 段位。 */
function normalizeProgress(raw, cfg) {
  const c = cfg || PROGRESSION;
  const r = raw && typeof raw === 'object' ? raw : {};
  const exp = Math.max(0, Math.floor(r.exp || 0));
  const lv = levelFromExp(exp, c);
  return {
    exp,
    coins: Math.max(0, Math.floor(r.coins || 0)),
    level: lv.level,
    rankId: rankFor(lv.level, c).id,
    matches: Math.max(0, Math.floor(r.matches || 0)),
    wins: Math.max(0, Math.floor(r.wins || 0)),
  };
}

module.exports = {
  expToNext,
  rankFor,
  emptyProgress,
  levelFromExp,
  awardFor,
  applyAward,
  normalizeProgress,
};
