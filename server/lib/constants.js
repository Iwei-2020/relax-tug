'use strict';

/**
 * 服务端常量镜像 —— **构建期生成，禁止手改**
 *
 * 源：minigame/src/config/config.js（客户端 / 服务端唯一事实来源）
 * 生成：node tools/gen-constants.js（校验：node tools/gen-constants.js --check）
 *
 * 变更流程：改客户端 config → 重跑本脚本 → 提交。忘记重跑会被 npm run verify 的 --check 拦截。
 * 字段对应《解压拔河大作战 · 项目说明书》§6（数值规划）、§6.5（随机事件）、§6.6（局外成长 / 每日任务）
 * 与 §5.1（广告频次上限）。PALETTE（配色）与事件池明细属客户端专用，不进本镜像（只镜像 §6.5 的派生标量）。
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
  "PERFECT_WINDOW_RATIO": 0.5,
  "PERFECT_MULTIPLIER": 1.5,
  "SEQUENCE_LENGTH": 3,
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
  "EVENT_MAX_ENERGY_SCALE": 1.5,
  "EVENT_MAX_PER_MATCH": 2,
  "MONETIZATION": {
    "revivePerMatch": 1,
    "rewardDoublePerDay": 3,
    "firstWinTriplePerDay": 1,
    "skinUnlockPerDay": 2
  },
  "PROGRESSION": {
    "maxLevel": 60,
    "levelBase": 100,
    "levelStep": 100,
    "reward": {
      "expByResult": {
        "win": 20,
        "draw": 12,
        "lose": 8
      },
      "coinsByResult": {
        "win": 30,
        "draw": 15,
        "lose": 10
      },
      "expPerHit": 1,
      "expPerPerfect": 2,
      "coinsPerPerfect": 2,
      "matchExpCap": 90,
      "matchCoinCap": 120,
      "dailyExpCap": 800,
      "dailyCoinCap": 1000
    },
    "ranks": [
      {
        "id": "bronze",
        "name": "青铜",
        "minLevel": 1
      },
      {
        "id": "silver",
        "name": "白银",
        "minLevel": 6
      },
      {
        "id": "gold",
        "name": "黄金",
        "minLevel": 12
      },
      {
        "id": "platinum",
        "name": "铂金",
        "minLevel": 20
      },
      {
        "id": "diamond",
        "name": "钻石",
        "minLevel": 30
      },
      {
        "id": "master",
        "name": "王者",
        "minLevel": 45
      }
    ]
  },
  "DAILY_TASKS": {
    "enabled": true,
    "pool": [
      {
        "id": "play3",
        "name": "完成 3 局对战",
        "metric": "matches",
        "mode": "count",
        "goal": 3,
        "coins": 40
      },
      {
        "id": "win2",
        "name": "赢得 2 局",
        "metric": "wins",
        "mode": "count",
        "goal": 2,
        "coins": 60
      },
      {
        "id": "perfect10",
        "name": "累计 10 次完美判定",
        "metric": "perfectHits",
        "mode": "sum",
        "goal": 10,
        "coins": 50
      },
      {
        "id": "combo8",
        "name": "单局达成 8 连击",
        "metric": "bestCombo",
        "mode": "max",
        "goal": 8,
        "coins": 40
      }
    ],
    "chestCoins": 100
  }
};
