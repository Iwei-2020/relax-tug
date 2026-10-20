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
    revivePerMatch: 1, // 失败复活：每局 1 次
    rewardDoublePerDay: 3, // 结算奖励翻倍：每日 3 次
    firstWinTriplePerDay: 1, // 每日首胜三倍：每日 1 次
    skinUnlockPerDay: 2, // 皮肤解锁：每日 2 次
  },

  /* ── §4.6 / §6.6 局外成长（等级 / 经验 / 金币 / 段位） ───────────── */
  // 奖励一律**由对局摘要推导**（结果 + 命中段数 + 完美段数）：客户端与服务端各自用
  // 这份参数重算（服务端另做单局 / 每日封顶，见 §6.6），**不接受**客户端自行上报奖励数字。
  progression: {
    maxLevel: 60,
    levelBase: 100, // 升到第 2 级所需经验
    levelStep: 100, // 每升一级所需经验的递增量（等差曲线）
    reward: {
      expByResult: { win: 20, draw: 12, lose: 8 }, // 结果基础经验
      coinsByResult: { win: 30, draw: 15, lose: 10 }, // 结果基础金币
      expPerHit: 1, // 每命中一段
      expPerPerfect: 2, // 每完美判定一段
      coinsPerPerfect: 2, // 每完美判定一段
      matchExpCap: 120, // 单局经验封顶（防刷）：重标定后单局 ≈36 命中 / 27 完美 ≈ 110 经验，故由 90 上调
      matchCoinCap: 120, // 单局金币封顶（防刷）
      dailyExpCap: 800, // 每日经验封顶（防刷）
      dailyCoinCap: 1000, // 每日金币封顶（防刷）
    },
    // 段位：由等级分段推导（取满足 minLevel ≤ level 的最后一段），只升不降
    ranks: [
      { id: 'bronze', name: '青铜', minLevel: 1 },
      { id: 'silver', name: '白银', minLevel: 6 },
      { id: 'gold', name: '黄金', minLevel: 12 },
      { id: 'platinum', name: '铂金', minLevel: 20 },
      { id: 'diamond', name: '钻石', minLevel: 30 },
      { id: 'master', name: '王者', minLevel: 45 },
    ],
  },

  /* ── §4.7 / §6.6 每日任务与宝箱（UTC+8 自然日刷新） ─────────────── */
  // metric：取对局摘要中的哪个字段；mode：'count'（每局 +0/1）/ 'sum'（累加）/ 'max'（取最大）。
  // 刷新口径与每日挑战（core/rng.dailyChallengeSeed）共用同一 UTC+8 dayKey —— 保证「今天」是同一个今天。
  dailyTasks: {
    enabled: true,
    pool: [
      { id: 'play3', name: '完成 3 局对战', metric: 'matches', mode: 'count', goal: 3, coins: 40 },
      { id: 'win2', name: '赢得 2 局', metric: 'wins', mode: 'count', goal: 2, coins: 60 },
      // 目标值随越线阈值重标定同步上调：单局命中段数由 ≈18 翻到 ≈36，原目标会在一局内达标。
      { id: 'perfect10', name: '累计 24 次完美判定', metric: 'perfectHits', mode: 'sum', goal: 24, coins: 50 },
      { id: 'combo8', name: '单局达成 15 连击', metric: 'bestCombo', mode: 'max', goal: 15, coins: 40 },
    ],
    chestCoins: 100, // 全部任务达成后可领的每日宝箱
  },

  /* ── §4.8 / §6.7 闯关模式（1-100 关，V1.1 本波） ─────────────────── */
  // 100 关**不为每关手配数值**：把 §6.4 的 4 档难度当作**关键帧**，在关卡之间连续插值（见 core/levels.js）。
  // 「局内进度」= 同一关内随轮次从「本关入门档」爬到「本关上限档」（roundRamp）。
  // 两个**闯关专用旋钮**（普通对战数值不变）：
  //   · winNetEnergy 随关卡 112 → 74：叠加「3 条生命」后容错极低，阈值恒 160 会导致中高关**数学上不可通关**；
  //   · oppHitScale = 0.35：关键帧插值出的 oppHit 再打折，让对手退化为「陪练」而非抢线的对手。
  // 硬约束：每轮候选数 ≥ 该轮段数（由 core/levels.js#levelConfig 内部兜底）。
  levelMode: {
    enabled: true,
    maxLevel: 100, // 1–100 关
    lives: 3, // 点错目标色 / 某段超时各扣 1 条；3 条耗尽 = 闯关失败
    maxRounds: 60, // 安全阀：防极端情况下轮次不收敛（正常由 45s 硬上限兜底）
    winNetEnergy: { from: 112, to: 74 }, // 只与关卡有关 → 服务端可按 level 单值重算（校验用）
    oppHitScale: 0.35, // 陪练 AI：插值出的 oppHit 再乘它，夹到 [0, 1]
    keyframes: [ // t ∈ [0,1]，按 at 升序且首尾为 0 / 1；tier 指向 difficulty 档
      { at: 0, tier: 'easy' },
      { at: 0.34, tier: 'normal' },
      { at: 0.67, tier: 'hard' },
      { at: 1, tier: 'hell' },
    ],
    roundRamp: { rounds: 8, span: 0.18 }, // 关内爬坡：最迟第 8 轮由「本关入门档」爬到「本关上限档」
    // 段数 / 候选两条爬坡都**拉满全区间**（to = 1）：曾用 to=0.85 / 0.65 时，L77 之后所有旋钮
    // 饱和、只剩 winNetEnergy 继续下降 → 难度反而变容易，出现「L74 比 L99 更难」的锯齿。
    // 拉满后曲线块均值单调下降（sim:levels 门禁），代价是最难的档位（6 段 / 9 格）推迟到高关才出现。
    seqLen: { min: 1, max: 6, from: 0, to: 1 }, // 段数曲线区间（u 在 [from, to] 内线性映射到 [min, max]）
    candidateTiers: [2, 4, 6, 9], // 候选档位（只允许这些值）
    candidateFrom: 0, // 候选档位推进区间起点（u=0 → 档位 2）
    candidateTo: 1, // 候选档位推进区间终点（u=1 → 档位 9；中点就近取档）
    sanity: { minWinNetEnergy: 40 }, // 阈值下限，防曲线被调成「一碰就赢」
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

/** 闯关模式：关卡上限 / 生命值 / 段数区间 / 候选档位（§4.8 / §6.7）。 */
const LEVEL_MAX = CONFIG.levelMode.maxLevel;
const LEVEL_LIVES = CONFIG.levelMode.lives;
const SEQ_LEN_MIN = CONFIG.levelMode.seqLen.min;
const SEQ_LEN_MAX = CONFIG.levelMode.seqLen.max;
const CANDIDATE_TIERS = CONFIG.levelMode.candidateTiers;

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
  DAILY_TASKS: CONFIG.dailyTasks,
  PALETTE: CONFIG.palette,

  LEVEL_MODE: CONFIG.levelMode,
  LEVEL_MAX,
  LEVEL_LIVES,
  SEQ_LEN_MIN,
  SEQ_LEN_MAX,
  CANDIDATE_TIERS,
  PALETTE_MAX,
};
