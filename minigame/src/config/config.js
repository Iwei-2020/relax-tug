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
  // 越线所需「净能量差」。**重标定**：原值 80 时，一轮 3 段完美峰值 = 3×27 = 81 ≥ 80，
  // 即「一轮内即可越线」，实测单局常常 <10s；本轮上调到 160（详见说明书 §6.4「对局时长目标验证」）。
  winNetEnergy: 160,
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

  /* ── §6.2 判定分档（完美 / 普通） ─────────────────────────────── */
  // 点对一段还按「时机」分档：窗口前 ratio 比例内点中 = 完美，能量 ×multiplier；其余 = 普通 ×1.0。
  // 只作用于该段的「基础能量 + 连击加成」，不改变失误 / 空轮口径；AI 对手不做分档（见 §6.4）。
  perfectWindowRatio: 0.5, // 完美窗口占输入窗口的比例（窗口前 50%）
  perfectMultiplier: 1.5, // 完美判定能量倍率（含连击加成后四舍五入取整）

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
  // 阈值以**越线阈值的比例**表达（而非绝对值），随 winNetEnergy 自动跟随 —— 否则阈值上调后
  // 兜底会退化为「几乎不触发」。当前 = 160 × 0.5 = 80（相对介入点由原来的 60/80 = 75% 提前到 50%）。
  // winAid 保持 0.05：实测上调到 0.12 / 0.15 / 0.22 会把中位时长顶到 41s / 45s / 45s，末段锁死在硬上限。
  balance: {
    loseThresholdRatio: 0.5, // 玩家落后超过 0.5 × 越线阈值 → 对手命中率下调
    loseAid: 0.08, // 连败保护：下调 8%
    winThresholdRatio: 0.5, // 玩家领先超过 0.5 × 越线阈值 → 对手命中率上调
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

  /* ── §6.5 随机事件（局内临时修饰，由种子驱动，不改胜负条件） ──────── */
  // 硬性约束（§6.5）：事件只做「局内临时修饰」——能量倍率 / 输入窗口缩放 / 视觉遮挡；
  // **绝不**改变越线净能量差（winNetEnergy）与平局带宽，保证竞技公平与数值口径稳定。
  // 触发时机与具体事件全部由 createRng(seed) 决定（与回合序列共用同一随机流），
  // 每日挑战局因此能做到「同日同难度全球同一套事件」，可复现、可回放。
  events: {
    enabled: true,
    maxPerMatch: 2, // 每局触发上限（避免局局必刷）
    firstCheckRound: 2, // 前 2 轮为热身，不打扰
    checkEveryRounds: 2, // 之后每 2 轮检查一次
    chance: 0.3, // 每次检查的触发概率（rng 驱动）：单局轮数涨到 ≈18.6 后，0.45 会「局局必刷」
    durationMs: 6000, // 单个事件持续时长（按真实时间衰减）
    // 事件池：weight 为相对权重；效果字段仅允许 energyScale / windowScale / fog
    pool: [
      { id: 'frenzy', name: '手速狂潮', desc: '命中能量 ×1.5', weight: 3, energyScale: 1.5 },
      { id: 'rush', name: '疾风时刻', desc: '输入窗口收窄 25%', weight: 3, windowScale: 0.75 },
      { id: 'breather', name: '喘息时刻', desc: '输入窗口加宽 30%', weight: 2, windowScale: 1.3 },
      { id: 'fog', name: '迷雾干扰', desc: '候选色块被薄雾遮挡', weight: 2, fog: true },
    ],
  },

  /* ── §5.1 激励广告频次上限（服务端记账校验，客户端只做入口控制） ── */
  monetization: {
    skinUnlockPerDay: 2, // 皮肤解锁：每日 2 次
  },

  /* ── §4.6 段位胜点 ───────────────────────────────────────────── */
  progression: {
    pointsPerWin: 10,
    pointsPerLoss: 10,
    pointsPerRank: 100,
    // 段位按顺序晋级；青铜最低 0 点，王者最高 100 点。
    ranks: [
      { id: 'bronze', name: '青铜' },
      { id: 'silver', name: '白银' },
      { id: 'gold', name: '黄金' },
      { id: 'platinum', name: '铂金' },
      { id: 'diamond', name: '钻石' },
      { id: 'master', name: '王者' },
    ],
  },

  /* ── §4.8 闯关模式（1-100 关） ─────────────────────────────────── */
  // 100 关不为每关手配数值：用难度档关键帧插值窗口时长，段数与候选随关卡 / 局内轮次爬坡。
  // 「局内进度」= 同一关内随轮次从「本关入门档」爬到「本关上限档」（roundRamp）。
  // 闯关胜负独立于对战：单边能量 0–100%，对局固定持续 45 秒后结算。
  // 硬约束：每轮候选数 ≥ 该轮段数（由 core/levels.js#levelConfig 内部兜底）。
  levelMode: {
    maxLevel: 100, // 1–100 关
    lives: 3, // 点错目标色 / 某段超时各扣 1；归零后仍继续游戏至 45 秒
    energyMax: 100, // 能量进度达到 100% 即过关
    energyScale: 0.13, // 缩小单次能量变化，让进度由更多轮次逐步累积
    keyframes: [ // t ∈ [0,1]，按 at 升序且首尾为 0 / 1；tier 指向 difficulty 档
      { at: 0, tier: 'easy' },
      { at: 0.34, tier: 'normal' },
      { at: 0.67, tier: 'hard' },
      { at: 1, tier: 'hell' },
    ],
    roundRamp: { rounds: 8, span: 0.18 }, // 关内爬坡：最迟第 8 轮由「本关入门档」爬到「本关上限档」
    // 段数 / 候选两条爬坡都拉满全区间（to = 1），避免高关卡过早进入参数平台期。
    // 拉满后曲线块均值单调下降（sim:levels 门禁），代价是最难的档位（6 段 / 9 格）推迟到高关才出现。
    seqLen: { min: 1, max: 6, from: 0, to: 1 }, // 段数曲线区间（u 在 [from, to] 内线性映射到 [min, max]）
    candidateTiers: [2, 4, 6, 9], // 候选档位（只允许这些值）
    candidateFrom: 0, // 候选档位推进区间起点（u=0 → 档位 2）
    candidateTo: 1, // 候选档位推进区间终点（u=1 → 档位 9；中点就近取档）
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

/** 位移系数 = 位移上限 / 越线净能量差（§2.4 公式）。重标定后 = 220 / 160 = 1.375 px/能量点。 */
const DISPLACEMENT_FACTOR = CONFIG.displacementMaxPx / CONFIG.winNetEnergy;

/**
 * 随机事件中的最高能量倍率（由事件池派生，避免手工维护第二处数字）。
 * 用途：服务端能量上限校验需乘上它，否则「手速狂潮」局里的合法上报会被误判为篡改（§6.5）。
 */
const EVENT_MAX_ENERGY_SCALE = CONFIG.events.pool.reduce(
  (max, ev) => Math.max(max, ev && ev.energyScale ? ev.energyScale : 1),
  1
);

/** 每局随机事件触发上限（§6.5）：服务端校验 eventsFired 的上界。 */
const EVENT_MAX_PER_MATCH = CONFIG.events.maxPerMatch;

/** 调色板色数（§3.2 / §3.3）：候选档位的物理上限（9 色 → 最多 9 格）。 */
const PALETTE_MAX = CONFIG.palette.length;

/** 闯关模式：关卡上限 / 机会次数 / 段数区间 / 候选档位（§4.8 / §6.7）。 */
const LEVEL_MAX = CONFIG.levelMode.maxLevel;
const LEVEL_LIVES = CONFIG.levelMode.lives;
const LEVEL_ENERGY_MAX = CONFIG.levelMode.energyMax;
const LEVEL_ENERGY_SCALE = CONFIG.levelMode.energyScale;
const SEQ_LEN_MIN = CONFIG.levelMode.seqLen.min;
const SEQ_LEN_MAX = CONFIG.levelMode.seqLen.max;
const CANDIDATE_TIERS = CONFIG.levelMode.candidateTiers;
const DAILY_LIVES = 5;

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
  PERFECT_WINDOW_RATIO: CONFIG.perfectWindowRatio,
  PERFECT_MULTIPLIER: CONFIG.perfectMultiplier,

  SEQUENCE_LENGTH: CONFIG.sequenceLength,

  COUNTDOWN_MS: CONFIG.countdownMs,
  ROUND_GAP_MS: CONFIG.roundGapMs,
  MATCH_TIMEOUT_MS: CONFIG.matchTimeoutMs,
  GAME_HARD_LIMIT_MS: CONFIG.gameHardLimitMs,

  BALANCE: CONFIG.balance,
  DIFFICULTY: CONFIG.difficulty,
  DEFAULT_DIFFICULTY: CONFIG.defaultDifficulty,
  RANDOM_EVENTS: CONFIG.events,
  EVENT_MAX_ENERGY_SCALE,
  EVENT_MAX_PER_MATCH,
  MONETIZATION: CONFIG.monetization,
  PROGRESSION: CONFIG.progression,
  PALETTE: CONFIG.palette,

  LEVEL_MODE: CONFIG.levelMode,
  LEVEL_MAX,
  LEVEL_LIVES,
  DAILY_LIVES,
  LEVEL_ENERGY_MAX,
  LEVEL_ENERGY_SCALE,
  SEQ_LEN_MIN,
  SEQ_LEN_MAX,
  CANDIDATE_TIERS,
  PALETTE_MAX,
};
