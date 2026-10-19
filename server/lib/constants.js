'use strict';

/**
 * 服务端常量镜像 —— **构建期生成，禁止手改**
 *
 * 源：minigame/src/config/config.js（客户端 / 服务端唯一事实来源）
 * 生成：node tools/gen-constants.js（校验：node tools/gen-constants.js --check）
 *
 * 变更流程：改客户端 config → 重跑本脚本 → 提交。忘记重跑会被 npm run verify 的 --check 拦截。
 * 字段对应《解压拔河大作战 · 项目说明书》§6（数值规划）与 §5.1（广告频次上限）。
 * PALETTE（配色）属渲染专用，不进本镜像。
 */
module.exports = {
  "WIN_NET_ENERGY": 80,
  "DISPLACEMENT_MAX_PX": 220,
  "DISPLACEMENT_FACTOR": 2.75,
  "DRAW_BAND_PX": 20,
  "HIT_ENERGY": 12,
  "MISS_PENALTY": 6,
  "MIN_ENERGY": 0,
  "COMBO_BONUS": {
    "3": 2,
    "5": 4,
    "8": 6
  },
  "COMBO_HIGH_FROM": 8,
  "COMBO_BONUS_MAX": 6,
  "COUNTDOWN_MS": 3000,
  "ROUND_GAP_MS": 150,
  "MATCH_TIMEOUT_MS": 3000,
  "GAME_HARD_LIMIT_MS": 45000,
  "BALANCE": {
    "loseThreshold": 60,
    "loseAid": 0.08,
    "winThreshold": 60,
    "winAid": 0.05
  },
  "DIFFICULTY": {
    "easy": {
      "candidates": 4,
      "windowMs": 1600,
      "oppHit": 0.6,
      "oppMiss": 0.15
    },
    "normal": {
      "candidates": 6,
      "windowMs": 1400,
      "oppHit": 0.7,
      "oppMiss": 0.1
    },
    "hard": {
      "candidates": 6,
      "windowMs": 1200,
      "oppHit": 0.82,
      "oppMiss": 0.06
    },
    "hell": {
      "candidates": 9,
      "windowMs": 1100,
      "oppHit": 0.9,
      "oppMiss": 0.04
    }
  },
  "DEFAULT_DIFFICULTY": "normal",
  "MONETIZATION": {
    "revivePerMatch": 1,
    "rewardDoublePerDay": 3,
    "firstWinTriplePerDay": 1,
    "skinUnlockPerDay": 2
  }
};
