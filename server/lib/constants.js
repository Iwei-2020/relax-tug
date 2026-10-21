'use strict';

/**
 * 服务端常量镜像 —— **构建期生成，禁止手改**
 *
 * 源：minigame/src/config/config.js（客户端 / 服务端唯一事实来源）
 * 生成：node tools/gen-constants.js（校验：node tools/gen-constants.js --check）
 *
 * 变更流程：改客户端 config → 重跑本脚本 → 提交。忘记重跑会被 npm run verify 的 --check 拦截。
 * 字段对应《解压拔河大作战 · 项目说明书》§6（数值规划）、§6.5（随机事件）、§6.6（局外成长）、
 * §6.7（闯关模式）与 §5.1（广告频次上限）。PALETTE（配色明细）属客户端专用，不进本镜像
 * （只镜像其派生标量 PALETTE_MAX）。
 */
module.exports = {
  "WIN_NET_ENERGY": 160,
  "DISPLACEMENT_MAX_PX": 220,
  "DISPLACEMENT_FACTOR": 1.375,
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
  "PERFECT_WINDOW_RATIO": 0.5,
  "PERFECT_MULTIPLIER": 1.5,
  "SEQUENCE_LENGTH": 3,
  "COUNTDOWN_MS": 3000,
  "ROUND_GAP_MS": 150,
  "MATCH_TIMEOUT_MS": 3000,
  "GAME_HARD_LIMIT_MS": 45000,
  "BALANCE": {
    "loseThresholdRatio": 0.5,
    "loseAid": 0.08,
    "winThresholdRatio": 0.5,
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
  "EVENT_MAX_ENERGY_SCALE": 1.5,
  "EVENT_MAX_PER_MATCH": 2,
  "MONETIZATION": {
    "skinUnlockPerDay": 2
  },
  "PROGRESSION": {
    "pointsPerWin": 10,
    "pointsPerLoss": 10,
    "pointsPerRank": 100,
    "ranks": [
      {
        "id": "bronze",
        "name": "青铜"
      },
      {
        "id": "silver",
        "name": "白银"
      },
      {
        "id": "gold",
        "name": "黄金"
      },
      {
        "id": "platinum",
        "name": "铂金"
      },
      {
        "id": "diamond",
        "name": "钻石"
      },
      {
        "id": "master",
        "name": "王者"
      }
    ]
  },
  "LEVEL_MODE": {
    "maxLevel": 100,
    "lives": 3,
    "energyMax": 100,
    "energyScale": 0.13,
    "keyframes": [
      {
        "at": 0,
        "tier": "easy"
      },
      {
        "at": 0.34,
        "tier": "normal"
      },
      {
        "at": 0.67,
        "tier": "hard"
      },
      {
        "at": 1,
        "tier": "hell"
      }
    ],
    "roundRamp": {
      "rounds": 8,
      "span": 0.18
    },
    "seqLen": {
      "min": 1,
      "max": 6,
      "from": 0,
      "to": 1
    },
    "candidateTiers": [
      2,
      4,
      6,
      9
    ],
    "candidateFrom": 0,
    "candidateTo": 1
  },
  "LEVEL_MAX": 100,
  "LEVEL_LIVES": 3,
  "DAILY_LIVES": 5,
  "SEQ_LEN_MIN": 1,
  "SEQ_LEN_MAX": 6,
  "CANDIDATE_TIERS": [
    2,
    4,
    6,
    9
  ],
  "PALETTE_MAX": 9
};
