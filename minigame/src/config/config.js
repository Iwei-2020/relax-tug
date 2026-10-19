'use strict';

/**
 * 全局数值配置 —— **唯一事实来源**
 *
 * 依据：《解压拔河大作战 · 项目说明书》§6（数值规划）+ 附录 A（关键数值速查表）。
 *
 * 变更流程（重要）：
 *   1) 只改本文件（客户端/服务端共用的数值口径都在这里）；
 *   2) 运行 `node tools/gen-constants.js` 重新生成服务端镜像 `server/lib/constants.js`；
 *   3) 运行 `node tools/gen-constants.js --check` 校验无漂移（已纳入 `npm run verify`）。
 *
 * 本文件是**纯数据 + 纯计算**，不引用任何 `tt` / 平台 API，因此可被 Node 直接 require（单测与
 * 服务端常量生成都依赖这一点）。
 */

const CONFIG = {
  /* ── §6.1 / §2.4 越线判定与绳子位移 ───────────────────────────── */
  // 越线所需「净能量差」（首版按 §6.4 末尾的调优结论取 80，而非 §6.1 的 100）
  winNetEnergy: 80,
  // 绳子中心相对屏幕中线的最大偏移（逻辑像素）
  displacementMaxPx: 220,
  // 平局判定带宽：倒计时结束且位移落在 ±20px 内判平局
  drawBandPx: 20,

  /* ── §6.2 匹配成功 / 失败数值 ─────────────────────────────────── */
  hitEnergy: 12, // 单次匹配成功基础能量
  missPenalty: 6, // 单次匹配失败扣减（不低于 0，无负能量）
  minEnergy: 0, // 能量下限
  comboBonus: { 3: 2, 5: 4, 8: 6 }, // 连击加成：第 3 / 5 / 8 次命中起
  comboHighFrom: 8, // 「连击 8 次及以上，每次额外 +6」的起始点
  comboBonusMax: 6, // 单次命中最高加成（12 + 6 = 18）

  /* ── §2.2 目标颜色序列 ────────────────────────────────────────── */
  // 一轮 = 一条 N 段颜色序列，玩家需按序逐段点中；固定 3 段（每段仍享 §6.4 的输入窗口）。
  // 序列内颜色互不重复 → 底部候选面板中每个目标色恰好一块，保留「唯一且明确」的正确答案（§3.2）。
  sequenceLength: 3,

  /* ── §6.3 对局时长 ───────────────────────────────────────────── */
  countdownMs: 3000, // 开局 3-2-1
  roundGapMs: 150, // 轮次刷新停顿上限（保持节奏连贯）
  matchTimeoutMs: 3000, // 匹配超时后进入 AI 对局
  gameHardLimitMs: 45000, // 单局硬性时长上限（超时按位移判定）

  /* ── §6.4 平衡兜底（对玩家不可见） ─────────────────────────────── */
  balance: {
    loseThreshold: 60, // 玩家落后超过 60 → 对手命中率下调
    loseAid: 0.08, // 连败保护：下调 8%
    winThreshold: 60, // 玩家领先超过 60 → 对手命中率上调
    winAid: 0.05, // 防碾压：上调 5%
  },

  /* ── §6.4 难度曲线 ────────────────────────────────────────────── */
  difficulty: {
    easy: { candidates: 4, windowMs: 1600, oppHit: 0.6, oppMiss: 0.15 },
    normal: { candidates: 6, windowMs: 1400, oppHit: 0.7, oppMiss: 0.1 },
    hard: { candidates: 6, windowMs: 1200, oppHit: 0.82, oppMiss: 0.06 },
    hell: { candidates: 9, windowMs: 1100, oppHit: 0.9, oppMiss: 0.04 },
  },
  defaultDifficulty: 'normal',

  /* ── §5.1 激励广告频次上限（服务端记账校验，客户端只做入口控制） ── */
  monetization: {
    revivePerMatch: 1, // 失败复活：每局 1 次
    rewardDoublePerDay: 3, // 结算奖励翻倍：每日 3 次
    firstWinTriplePerDay: 1, // 每日首胜三倍：每日 1 次
    skinUnlockPerDay: 2, // 皮肤解锁：每日 2 次
  },

  /* ── §3.2 / §3.3 调色板（9 色；颜色即唯一标识，禁止纯文字标色名） ── */
  palette: [
    { id: 'red', name: '红', hex: '#F44336' },
    { id: 'orange', name: '橙', hex: '#FF9800' },
    { id: 'yellow', name: '黄', hex: '#FFEB3B' },
    { id: 'green', name: '绿', hex: '#4CAF50' },
    { id: 'cyan', name: '青', hex: '#00BCD4' },
    { id: 'blue', name: '蓝', hex: '#3F51B5' },
    { id: 'purple', name: '紫', hex: '#9C27B0' },
    { id: 'pink', name: '粉', hex: '#E91E63' },
    { id: 'brown', name: '棕', hex: '#795548' },
  ],
};

/* ── 派生值（保持「单一来源」：改上面的数字，这里自动跟随） ───────── */

/** 位移系数 = 位移上限 / 越线净能量差（§2.4 公式）。首版 = 220 / 80 = 2.75 px/能量点。 */
const DISPLACEMENT_FACTOR = CONFIG.displacementMaxPx / CONFIG.winNetEnergy;

module.exports = {
  CONFIG,

  WIN_NET_ENERGY: CONFIG.winNetEnergy,
  DISPLACEMENT_MAX_PX: CONFIG.displacementMaxPx,
  DISPLACEMENT_FACTOR,
  DRAW_BAND_PX: CONFIG.drawBandPx,

  HIT_ENERGY: CONFIG.hitEnergy,
  MISS_PENALTY: CONFIG.missPenalty,
  MIN_ENERGY: CONFIG.minEnergy,
  COMBO_BONUS: CONFIG.comboBonus,
  COMBO_HIGH_FROM: CONFIG.comboHighFrom,
  COMBO_BONUS_MAX: CONFIG.comboBonusMax,

  SEQUENCE_LENGTH: CONFIG.sequenceLength,

  COUNTDOWN_MS: CONFIG.countdownMs,
  ROUND_GAP_MS: CONFIG.roundGapMs,
  MATCH_TIMEOUT_MS: CONFIG.matchTimeoutMs,
  GAME_HARD_LIMIT_MS: CONFIG.gameHardLimitMs,

  BALANCE: CONFIG.balance,
  DIFFICULTY: CONFIG.difficulty,
  DEFAULT_DIFFICULTY: CONFIG.defaultDifficulty,
  MONETIZATION: CONFIG.monetization,
  PALETTE: CONFIG.palette,
};
