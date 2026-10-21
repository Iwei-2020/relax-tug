'use strict';

/** 服务端段位胜点逻辑，与客户端 `minigame/src/core/progression.js` 使用相同配置。 */

const { PROGRESSION } = require('./constants.js');

function rankIndexOf(rankId, cfg) {
  const c = cfg || PROGRESSION;
  const index = c.ranks.findIndex((rank) => rank.id === rankId);
  return index < 0 ? 0 : index;
}

function rankFor(rankId, cfg) {
  const c = cfg || PROGRESSION;
  return c.ranks[rankIndexOf(rankId, c)];
}

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

/** 累计胜点和统计场次；经验及玩家等级不再参与成长。 */
function applyAward(profile, award, result, nowMs, cfg) {
  const c = cfg || PROGRESSION;
  const p = profile || {};
  const rank = applyRankPoints(p.rankId, p.rankPoints, award && award.rankPoints, c);
  const updated = {
    ...p,
    ...rank,
    matches: Math.max(0, Math.floor(p.matches || 0)) + 1,
    wins: Math.max(0, Math.floor(p.wins || 0)) + (result === 'win' ? 1 : 0),
    updatedAt: nowMs,
  };
  delete updated.coins;
  delete updated.exp;
  delete updated.level;
  return updated;
}

function normalizeProgress(raw, cfg) {
  const c = cfg || PROGRESSION;
  const p = raw && typeof raw === 'object' ? raw : {};
  const rank = applyRankPoints(rankFor(p.rankId, c).id, p.rankPoints, 0, c);
  return {
    ...rank,
    matches: Math.max(0, Math.floor(p.matches || 0)),
    wins: Math.max(0, Math.floor(p.wins || 0)),
  };
}

function progressOf(profile, cfg) {
  const c = cfg || PROGRESSION;
  const p = normalizeProgress(profile, c);
  return { ...p, rankName: rankFor(p.rankId, c).name };
}

module.exports = {
  rankFor,
  applyRankPoints,
  awardFor,
  applyAward,
  normalizeProgress,
  progressOf,
};
