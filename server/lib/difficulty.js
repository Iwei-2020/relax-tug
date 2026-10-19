'use strict';

/**
 * 难度档选择（《项目说明书》§6.4 难度曲线）
 *
 * 「难度随对局内轮次递增（前 5 轮为热身），同时随玩家段位/胜率动态调整（ELO 式匹配）」。
 * 服务端根据玩家档案做粗粒度定档，具体难度参数（候选色数量 / 窗口 / 对手命中率）由客户端
 * 从 config 读取，服务端只下发难度 **key**，避免两处硬编码数值。
 */

const { DEFAULT_DIFFICULTY } = require('./constants.js');

/** 新手保护局数（前 3 局固定简单档）。 */
const ROOKIE_MATCHES = 3;
/** 连败保护：胜率低于此值回落简单档。 */
const LOSE_PROTECT_RATE = 0.35;
/** 高段位门槛。 */
const HARD_MATCHES = 20;
const HARD_RATE = 0.6;
const HELL_RATE = 0.75;

/**
 * @param {{matches?:number, wins?:number}|null} profile 玩家档案（无档案视为新玩家）
 * @param {string} [requested] 客户端请求的难度（仅调试/挑战模式使用）
 * @returns {string} 难度 key（easy | normal | hard | hell）
 */
function pickDifficulty(profile, requested) {
  const p = profile || {};
  const matches = p.matches || 0;
  const wins = p.wins || 0;
  const winRate = matches > 0 ? wins / matches : 0;

  if (matches < ROOKIE_MATCHES || winRate < LOSE_PROTECT_RATE) return 'easy';
  if (matches >= HARD_MATCHES && winRate >= HELL_RATE) return 'hell';
  if (matches >= HARD_MATCHES && winRate >= HARD_RATE) return 'hard';
  if (requested && requested !== DEFAULT_DIFFICULTY) return requested; // 挑战模式显式指定
  return DEFAULT_DIFFICULTY;
}

module.exports = { pickDifficulty, ROOKIE_MATCHES, LOSE_PROTECT_RATE, HARD_MATCHES, HARD_RATE, HELL_RATE };
