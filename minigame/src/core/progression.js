'use strict';

/**
 * 段位胜点核心（《项目说明书》§4.6）
 *
 * 纯函数，一律返回新对象、绝不原地修改入参（与 core/energy.js 同约定）。
 * 数值全部取自 `config.progression`；服务端 `server/lib/progression.js` 使用同一份镜像。
 *
 * 数据形状 Progress：{ rankId, rankPoints, matches, wins }
 */

const { PROGRESSION } = require('../config/config.js');

function rankIndexOf(rankId, cfg) {
  const c = cfg || PROGRESSION;
  const index = c.ranks.findIndex((rank) => rank.id === rankId);
  return index < 0 ? 0 : index;
}

/** Resolve a rank id, defaulting missing or legacy values to Bronze. */
function rankFor(rankId, cfg) {
  const c = cfg || PROGRESSION;
  return c.ranks[rankIndexOf(rankId, c)];
}

/** 空进度（新玩家）。 */
function emptyProgress() {
  return {
    rankId: PROGRESSION.ranks[0].id,
    rankPoints: 0,
    matches: 0,
    wins: 0,
  };
}

/** 根据对局胜负派发胜点变化；闯关只记录胜负，不影响竞技段位。 */
function awardFor(summary, cfg) {
  const c = cfg || PROGRESSION;
  const s = summary || {};
  if (s.mode === 'level') return { rankPoints: 0 };
  if (s.result === 'win') return { rankPoints: c.pointsPerWin };
  if (s.result === 'lose') return { rankPoints: -c.pointsPerLoss };
  return { rankPoints: 0 };
}

function applyRankPoints(rankId, rankPoints, delta, cfg) {
  const c = cfg || PROGRESSION;
  const ranks = c.ranks;
  let rankIndex = rankIndexOf(rankId, c);
  let points = Math.floor(Number(rankPoints) || 0) + Math.floor(Number(delta) || 0);
  const threshold = c.pointsPerRank;

  while (points >= threshold && rankIndex < ranks.length - 1) {
    rankIndex += 1;
    points -= threshold;
  }
  while (points < 0 && rankIndex > 0) {
    rankIndex -= 1;
    points += threshold;
  }

  if (rankIndex === 0) points = Math.max(0, points);
  if (rankIndex === ranks.length - 1) points = Math.min(threshold, Math.max(0, points));
  return { rankId: ranks[rankIndex].id, rankPoints: points };
}

/** 累计胜点和统计场次；胜点达到 100 晋级，跌破 0 降级。 */
function applyAward(progress, award, result, cfg) {
  const c = cfg || PROGRESSION;
  const p = normalizeProgress(progress, c);
  const rank = applyRankPoints(p.rankId, p.rankPoints, award && award.rankPoints, c);
  return {
    ...rank,
    matches: Math.max(0, Math.floor(p.matches || 0)) + 1,
    wins: Math.max(0, Math.floor(p.wins || 0)) + (result === 'win' ? 1 : 0),
  };
}

/** 移除旧经验/等级字段，并保留老玩家当前段位、胜点从 0 开始。 */
function normalizeProgress(raw, cfg) {
  const c = cfg || PROGRESSION;
  const r = raw && typeof raw === 'object' ? raw : {};
  const rank = applyRankPoints(rankFor(r.rankId, c).id, r.rankPoints, 0, c);
  return {
    ...rank,
    matches: Math.max(0, Math.floor(r.matches || 0)),
    wins: Math.max(0, Math.floor(r.wins || 0)),
  };
}

/** 服务端回执使用的段位展示数据。 */
function progressOf(progress, cfg) {
  const c = cfg || PROGRESSION;
  const p = normalizeProgress(progress, c);
  return { ...p, rankName: rankFor(p.rankId, c).name };
}

module.exports = {
  rankFor,
  applyRankPoints,
  emptyProgress,
  awardFor,
  applyAward,
  normalizeProgress,
  progressOf,
};
