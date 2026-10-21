/**
 * 抖音云函数服务产物：playerState.js
 *
 * **构建期生成，禁止手改**。源：server/lib/constants.js / server/lib/difficulty.js / server/lib/envelope.js / server/lib/identity.js / server/lib/levels.js / server/lib/lives.js / server/lib/progression.js / server/lib/result.js / server/lib/store-cloud.js / server/lib/store-provider.js / server/lib/store.js / server/functions/playerState/index.js
 * 改完源后重跑 `node tools/gen-cloud-functions.js`（生成脚本：tools/gen-cloud-functions.js）。
 *
 * 平台契约：入口 `module.exports = async function (params, context)`，`params` 即 HTTP 请求体本身，
 * 返回值作为 Response Body；调用路径 = 文件名，即 `/playerState`。
 * 身份：从请求头 `X-TT-OPENID` 直读，无需 login 置换（见 lib/identity.js）。
 */
'use strict';

(function () {
  var __registry = {};
  var __cache = {};

  /** 内部模块解析：命中注册表用打包实现，未命中回落 Node 解析（如 npm 依赖）。 */
  function __req(id) {
    if (!Object.prototype.hasOwnProperty.call(__registry, id)) return require(id);
    if (!__cache[id]) {
      var m = { exports: {} };
      __registry[id](m, m.exports, __req);
      __cache[id] = m.exports;
    }
    return __cache[id];
  }

  // ── server/lib/constants.js
  __registry["server/lib/constants.js"] = function (module, exports, require) {
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
  "CLASSIC_MODE": {
    "timeRampMs": 90000,
    "rankStart": {
      "bronze": 0.25,
      "silver": 0.32,
      "gold": 0.39,
      "platinum": 0.46,
      "diamond": 0.53,
      "master": 0.6
    },
    "sequenceLength": {
      "min": 3,
      "max": 6
    },
    "candidateTiers": [
      6,
      6,
      9
    ],
    "windowMs": {
      "start": 1600,
      "end": 900
    },
    "opponentHit": {
      "start": 0.58,
      "end": 0.78
    },
    "opponentMiss": {
      "start": 0.15,
      "end": 0.1
    },
    "energyScale": {
      "start": 0.05,
      "end": 1.8
    }
  },
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
  };

  // ── server/lib/difficulty.js
  __registry["server/lib/difficulty.js"] = function (module, exports, require) {
'use strict';

/**
 * 难度档选择（《项目说明书》§6.4 难度曲线）
 *
 * 「难度随对局内轮次递增（前 5 轮为热身），同时随玩家段位/胜率动态调整（ELO 式匹配）」。
 * 服务端根据玩家档案做粗粒度定档，具体难度参数（候选色数量 / 窗口 / 对手命中率）由客户端
 * 从 config 读取，服务端只下发难度 **key**，避免两处硬编码数值。
 */

const { DEFAULT_DIFFICULTY } = __req('server/lib/constants.js');

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
  };

  // ── server/lib/envelope.js
  __registry["server/lib/envelope.js"] = function (module, exports, require) {
'use strict';

/**
 * 统一响应信封（《项目说明书》§8.1 F14 数据 / 服务端契约）
 *
 * 形态：`{ code, msg, data }`，`code === 0` 为成功。
 *
 * 平台事实：抖音云函数服务把入口函数的返回值直接作为 Response Body，
 * 客户端（minigame/src/net/cloud.js）拿到后自行 JSON 解析并归一为 `{ ok, code, msg, data }`，
 * 因此服务端只需保证信封结构稳定，不要指望平台帮忙封装。
 */

/** 数值错误码（区间约定：4xxx 客户端可归因，5xxx 服务端内部）。 */
const CODES = {
  OK: 0,
  BAD_REQUEST: 4000,
  NOT_FOUND: 4004,
  CONFLICT: 4009,
  RATE_LIMIT: 4029,
  SERVER_ERROR: 5000,
};

/** 成功信封。 */
function ok(data) {
  return { code: CODES.OK, msg: 'ok', data: data === undefined ? {} : data };
}

/** 失败信封（detail 面向日志，不面向用户）。 */
function fail(code, detail, meta) {
  return {
    code,
    msg: detail ? `${code}: ${detail}` : String(code),
    data: meta === undefined ? null : meta,
  };
}

/** 把任意异常收敛为失败信封，避免把内部细节泄漏给客户端。 */
function fromError(err) {
  const message = err && err.message ? String(err.message) : 'unknown error';
  return fail(CODES.SERVER_ERROR, message);
}

/** 判断信封是否成功。 */
function isOk(envelope) {
  return !!envelope && envelope.code === CODES.OK;
}

module.exports = { CODES, ok, fail, fromError, isOk };
  };

  // ── server/lib/identity.js
  __registry["server/lib/identity.js"] = function (module, exports, require) {
'use strict';

/**
 * 调用方身份（《项目说明书》§5.3 实名/防沉迷 + §5.4 服务端只做校验与排名）
 *
 * 平台事实：抖音云函数服务会在请求头注入 `X-TT-OPENID`（以及 unionid / appid 等），
 * 服务端**直接读取即可**，无需再调 code2Session 换登录态 —— 这是已在同仓「月老办事处」
 * 项目中实测确认的结论，不要再自造登录置换流程。
 *
 * 容错：平台在不同入口（函数服务 / 云托管）下 header 的承载位置不完全一致，
 * 这里做一次宽容查找，命中第一个可用形态即可；查找失败返回 null，由调用方按未登录处理。
 */

const OPENID_HEADERS = ['x-tt-openid', 'x-tt-open-id', 'openid'];

/** 大小写不敏感地取 header。 */
function headerOf(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      return value === undefined || value === null ? null : String(value);
    }
  }
  return null;
}

/** 从请求上下文里宽容取 openid（依次尝试 event.headers / context.headers / context）。 */
function openidFromContext(context) {
  if (!context) return null;
  const candidates = [
    context.headers,
    context.event && context.event.headers,
    context.request && context.request.headers,
    context,
  ];
  for (const headers of candidates) {
    for (const name of OPENID_HEADERS) {
      const value = headerOf(headers, name);
      if (value) return value;
    }
  }
  return null;
}

module.exports = { OPENID_HEADERS, headerOf, openidFromContext };
  };

  // ── server/lib/levels.js
  __registry["server/lib/levels.js"] = function (module, exports, require) {
'use strict';

/**
 * 服务端闯关模式（《项目说明书》§4.8 闯关模式 + §6.7 闯关模式数值）
 *
 * 与客户端 `minigame/src/core/levels.js` **同一套公式、同一份参数**
 * （参数来自 constants.LEVEL_MODE 镜像），由 `test/levels.test.js` 交叉校验两端等价。
 * 本文件与客户端版本**逐字对应**，唯一差异是数值来源（服务端走 `./constants.js` 镜像）。
 *
 * 设计口径：
 *   · 100 关不手配：用难度关键帧插值输入窗口时长，段数与候选随关卡和轮次爬坡；
 *   · 闯关胜负独立于对战，单边能量达到 100% 即满足过关条件；
 *   · 硬约束：每轮候选数 ≥ 该轮段数（levelConfig 内部兜底，不可省）。
 */

const { LEVEL_MODE, DIFFICULTY } = __req('server/lib/constants.js');

/** 夹到 [0, 1]（非有限值一律 0）。 */
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** 夹到 [min, max] 的整数（非有限值取 min）。 */
function clampInt(x, min, max) {
  const n = Math.floor(x);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * FNV-1a 32 位字符串哈希 —— **与 core/rng.js#hashSeed 字节一致**（此处内联是为了让本文件
 * 与客户端镜像 `minigame/src/core/levels.js` 逐字对应；`test/levels.test.js` 有断言钉死它与 rng 的等价）。
 * @param {string} key
 * @returns {number} 32 位无符号整数
 */
function hashSeed(key) {
  const s = String(key);
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h >>> 0;
}

/** 关卡号夹到 [1, maxLevel] 的整数（NaN / 越界 / 小数一律兜底）。 */
function clampLevel(level) {
  const m = LEVEL_MODE.maxLevel;
  const n = Math.floor(level);
  if (!Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > m) return m;
  return n;
}

/** 取「不大于 u 的最大关键帧 at」对应的难度档（u 恰好落在某关键帧上时取该档）。 */
function tierAt(u) {
  const kfs = LEVEL_MODE.keyframes;
  const t = clamp01(u);
  let picked = kfs[0].tier;
  for (let i = 0; i < kfs.length; i += 1) {
    if (t >= kfs[i].at) picked = kfs[i].tier;
  }
  return picked;
}

/** 关键帧线性插值：返回 `{ windowMs, tier }`（tier 见 tierAt）。 */
function keyframeParams(u) {
  const kfs = LEVEL_MODE.keyframes;
  const t = clamp01(u);
  let lo = kfs[0];
  let hi = kfs[kfs.length - 1];
  for (let i = 0; i < kfs.length - 1; i += 1) {
    if (t >= kfs[i].at && t <= kfs[i + 1].at) {
      lo = kfs[i];
      hi = kfs[i + 1];
    }
  }
  const span = hi.at - lo.at;
  const k = span <= 0 ? 1 : (t - lo.at) / span;
  const a = DIFFICULTY[lo.tier];
  const b = DIFFICULTY[hi.tier];
  const lerp = (x, y) => x + (y - x) * k;
  return {
    windowMs: Math.round(lerp(a.windowMs, b.windowMs)),
    tier: tierAt(t),
  };
}

/** 关卡内强度区间 `{ entry, cap }`：`entry = (L−1)/(max−1)`，`cap = min(1, entry + span)`。 */
function levelBand(level) {
  const m = LEVEL_MODE.maxLevel;
  const L = clampLevel(level);
  const entry = (L - 1) / Math.max(1, m - 1);
  const cap = Math.min(1, entry + LEVEL_MODE.roundRamp.span);
  return { entry, cap };
}

/**
 * 关卡 + 局内轮次 → 强度 `u ∈ [0, 1]`。
 * 第 1 轮为「本关入门档」，最迟第 `roundRamp.rounds` 轮爬到「本关上限档」。
 */
function levelIntensity(level, roundIndex) {
  const band = levelBand(level);
  const r = LEVEL_MODE.roundRamp.rounds;
  const k = r <= 0 ? 1 : clamp01(Math.max(0, Math.floor(roundIndex || 0)) / r);
  return band.entry + (band.cap - band.entry) * k;
}

/** 段数曲线：u → 整数 `[seqLen.min, seqLen.max]`（区间 [from, to] 线性映射）。 */
function seqLenAt(u) {
  const c = LEVEL_MODE.seqLen;
  const t = clamp01((clamp01(u) - c.from) / Math.max(1e-9, c.to - c.from));
  const v = Math.round(c.min + (c.max - c.min) * t);
  return clampInt(v, c.min, c.max);
}

/** 候选档位：u → `candidateTiers` 中**就近取档**（区间 [candidateFrom, candidateTo] 线性映射后 round）。 */
function candidatesAt(u) {
  const c = LEVEL_MODE;
  const tiers = c.candidateTiers;
  const t = clamp01((clamp01(u) - c.candidateFrom) / Math.max(1e-9, c.candidateTo - c.candidateFrom));
  const idx = Math.round(t * (tiers.length - 1));
  return tiers[clampInt(idx, 0, tiers.length - 1)];
}

/** 把段数向上吸附到合法候选档位（`candidates ≥ seqLen` 硬约束的兜底）。 */
function snapUp(seqLen) {
  const tiers = LEVEL_MODE.candidateTiers;
  for (let i = 0; i < tiers.length; i += 1) {
    if (tiers[i] >= seqLen) return tiers[i];
  }
  return tiers[tiers.length - 1];
}

/**
 * 单关单轮的完整派生参数（含硬约束兜底）。
 * @returns {{level:number, roundIndex:number, u:number, seqLen:number, candidates:number,
 *   windowMs:number, tier:string}}
 */
function levelConfig(level, roundIndex) {
  const L = clampLevel(level);
  const ri = Math.max(0, Math.floor(roundIndex || 0));
  const u = levelIntensity(L, ri);
  const kf = keyframeParams(u);
  const seqLen = seqLenAt(u);
  let candidates = candidatesAt(u);
  if (candidates < seqLen) candidates = snapUp(seqLen); // 硬约束：候选 ≥ 段数（不可省）
  return {
    level: L,
    roundIndex: ri,
    u,
    seqLen,
    candidates,
    windowMs: kf.windowMs,
    tier: kf.tier,
  };
}

/** 该轮段数上界（服务端 `validate` 与客户端同口径）。 */
function maxSeqLenFor(level, roundIndex) {
  return levelConfig(level, roundIndex).seqLen;
}

/** 前 `rounds` 轮的段数上界之和（服务端 `hits` 上界：客户端**不上报段数计划**）。 */
function maxSeqCapFor(level, rounds) {
  const n = Math.max(0, Math.floor(rounds || 0));
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += maxSeqLenFor(level, i);
  return sum;
}

/** 空进度。 */
function emptyLevels() {
  return { max: 0 };
}

/** 归一化进度：损坏 / 缺失 → `{ max: 0 }`，夹在 `0..maxLevel`。 */
function normalizeLevels(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const n = Math.floor(src.max);
  if (!Number.isFinite(n) || n < 0) return { max: 0 };
  return { max: Math.min(LEVEL_MODE.maxLevel, n) };
}

/** 推进进度：把已通关的关卡写入（只在更高时推进 `max`）。 */
function withClearedLevel(levels, level) {
  const cur = normalizeLevels(levels);
  return { max: Math.max(cur.max, clampLevel(level)) };
}

/** 免费可挑战关：全部通关 → `null`（任意关免费复盘）；否则「已通关的最大关 + 1」。 */
function freeLevel(levels) {
  const { max } = normalizeLevels(levels);
  if (max >= LEVEL_MODE.maxLevel) return null;
  return max + 1;
}

/** 该关是否需要看广告（≠ 免费关即需要；已全通则可自由复盘，不需广告）。 */
function needsAd(level, levels) {
  const free = freeLevel(levels);
  if (free === null) return false;
  return clampLevel(level) !== free;
}

/** 每关固定种子（§4.8）：同一关在任何设备 / 任何日期都得到同一题目。 */
function levelSeed(level) {
  return hashSeed(`level:${clampLevel(level)}`);
}

module.exports = {
  clampLevel,
  tierAt,
  keyframeParams,
  levelBand,
  levelIntensity,
  seqLenAt,
  candidatesAt,
  snapUp,
  levelConfig,
  maxSeqLenFor,
  maxSeqCapFor,
  emptyLevels,
  normalizeLevels,
  withClearedLevel,
  freeLevel,
  needsAd,
  levelSeed,
};
  };

  // ── server/lib/lives.js
  __registry["server/lib/lives.js"] = function (module, exports, require) {
'use strict';

const { DAILY_LIVES } = __req('server/lib/constants.js');

function dayKey(nowMs) {
  return new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function normalizeLives(raw, nowMs) {
  const day = dayKey(nowMs);
  if (!raw || raw.day !== day) return { day, count: DAILY_LIVES };
  const count = Number(raw.count);
  return {
    day,
    count: Number.isFinite(count) ? Math.max(0, Math.min(DAILY_LIVES, Math.floor(count))) : DAILY_LIVES,
  };
}

function consumeLife(raw, nowMs) {
  const state = normalizeLives(raw, nowMs);
  if (state.count <= 0) return { ok: false, state };
  return { ok: true, state: { ...state, count: state.count - 1 } };
}

function grantLife(raw, nowMs) {
  const state = normalizeLives(raw, nowMs);
  if (state.count >= DAILY_LIVES) return { ok: false, state };
  return { ok: true, state: { ...state, count: state.count + 1 } };
}

module.exports = { dayKey, normalizeLives, consumeLife, grantLife };
  };

  // ── server/lib/progression.js
  __registry["server/lib/progression.js"] = function (module, exports, require) {
'use strict';

/** 服务端段位胜点逻辑，与客户端 `minigame/src/core/progression.js` 使用相同配置。 */

const { PROGRESSION } = __req('server/lib/constants.js');

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
  };

  // ── server/lib/result.js
  __registry["server/lib/result.js"] = function (module, exports, require) {
'use strict';

/**
 * 对局结果校验与记账（《项目说明书》§2.3 胜负规则 + §4.6 段位胜点）
 *
 * 定位：**服务端权威校验**，用于
 *   1) 反作弊：按 core 的同口径公式重算位移与能量上限，拒绝篡改上报；
 *   2) 记账：累计胜场与段位胜点；
 *   3) 供排行榜与埋点回收（§9.3 DoD：平均时长 / 命中率 / 胜负比）。
 *
 * 数值口径来自 server/lib/constants.js（由 tools/gen-constants.js 从小游戏 config 生成），
 * 保证客户端与服务端**同一套数字**，不存在第二处硬编码。
 */

const {
  HIT_ENERGY,
  COMBO_BONUS_MAX,
  PERFECT_MULTIPLIER,
  DISPLACEMENT_FACTOR,
  DISPLACEMENT_MAX_PX,
  GAME_HARD_LIMIT_MS,
  CLASSIC_MODE,
  DIFFICULTY,
  PROGRESSION,
  EVENT_MAX_ENERGY_SCALE,
  EVENT_MAX_PER_MATCH,
  LEVEL_MAX,
  LEVEL_LIVES,
  LEVEL_MODE,
  MONETIZATION,
} = __req('server/lib/constants.js');
const { CODES, ok, fail } = __req('server/lib/envelope.js');
const { emptyCounter } = __req('server/lib/store.js');
const { awardFor, applyAward, progressOf } = __req('server/lib/progression.js');
const levels = __req('server/lib/levels.js');

/** 判定结果集合。 */
const RESULTS = ['win', 'lose', 'draw'];
/** 对局模式集合（§4.8）：classic 普通对战 / level 闯关模式。 */
const MODES = ['classic', 'level'];
/** 上报缺省模式：历史客户端不带 mode 字段时按普通对战场处理。 */
const DEFAULT_MODE = 'classic';

/** UTC+8 的 yyyy-mm-dd（服务端记账按北京时间自然日切分）。 */
function dayKey(nowMs) {
  const shifted = new Date(nowMs + 8 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

function clampPx(value) {
  return Math.max(-DISPLACEMENT_MAX_PX, Math.min(DISPLACEMENT_MAX_PX, value));
}

/** 上报模式（缺省 classic，容忍历史客户端）。 */
function modeOf(payload) {
  return payload && payload.mode !== undefined ? payload.mode : DEFAULT_MODE;
}

/** 关卡号是否合法（闯关模式的位移系数与段数上界都依赖它）。 */
function validLevel(level) {
  return isInt(level) && level >= 1 && level <= LEVEL_MAX;
}

/**
 * 校验上报的对局摘要。
 * @returns {{ok:boolean, errors:string[]}}
 */
function validate(payload) {
  const p = payload || {};
  const errors = [];
  const mode = modeOf(p);
  const isLevel = mode === 'level';

  if (!MODES.includes(mode)) errors.push('mode 非法');
  if (!RESULTS.includes(p.result)) errors.push('result 非法');
  if (!isInt(p.hits) || p.hits < 0) errors.push('hits 非法');
  if (!isInt(p.misses) || p.misses < 0) errors.push('misses 非法');
  if (!isInt(p.timeouts) || p.timeouts < 0) errors.push('timeouts 非法');
  if (!isInt(p.bestCombo) || p.bestCombo < 0) errors.push('bestCombo 非法');
  if (isInt(p.bestCombo) && isInt(p.hits) && p.bestCombo > p.hits) errors.push('bestCombo 超过 hits');
  if (isLevel) {
    if (!isInt(p.energyPct) || p.energyPct < 0 || p.energyPct > LEVEL_MODE.energyMax) errors.push('energyPct 非法');
    else if (
      isInt(p.hits) &&
      p.energyPct >
        Math.min(
          LEVEL_MODE.energyMax,
          p.hits *
            Math.round(
              Math.round(
                Math.round((HIT_ENERGY + COMBO_BONUS_MAX) * PERFECT_MULTIPLIER) * EVENT_MAX_ENERGY_SCALE
              ) * LEVEL_MODE.energyScale
            )
        )
    ) {
      errors.push('energyPct 超过理论上限');
    }
    if (
      p.myEnergy !== undefined ||
      p.oppEnergy !== undefined ||
      p.netEnergy !== undefined ||
      p.displacementPx !== undefined
    ) {
      errors.push('闯关摘要包含对战字段');
    }
  } else {
    if (!isInt(p.myEnergy) || p.myEnergy < 0) errors.push('myEnergy 非法');
    if (!isInt(p.oppEnergy) || p.oppEnergy < 0) errors.push('oppEnergy 非法');
  }
  if (!Number.isSafeInteger(p.durationMs) || p.durationMs < 0) {
    errors.push('durationMs 非法');
  }
  if (DIFFICULTY[p.difficulty] === undefined) errors.push('difficulty 非法');
  if (
    p.rankId !== undefined &&
    p.rankId !== null &&
    !PROGRESSION.ranks.some((rank) => rank.id === p.rankId)
  ) {
    errors.push('rankId 非法');
  }
  // 判定分档与每日挑战标记（§6.2 / §4.4）：均为可选字段，出现时只做存在性/一致性校验。
  if (p.perfectHits !== undefined) {
    if (!isInt(p.perfectHits) || p.perfectHits < 0) errors.push('perfectHits 非法');
    else if (isInt(p.hits) && p.perfectHits > p.hits) errors.push('perfectHits 超过 hits');
  }
  if (p.challengeMode !== undefined && typeof p.challengeMode !== 'boolean') errors.push('challengeMode 非法');
  // 随机事件触发次数（§6.5）：可选字段，出现时只做存在性/上界校验。
  if (p.eventsFired !== undefined) {
    if (!isInt(p.eventsFired) || p.eventsFired < 0) errors.push('eventsFired 非法');
    else if (p.eventsFired > EVENT_MAX_PER_MATCH) errors.push('eventsFired 超过每局上限');
  }

  // §4.8 闯关模式：关卡号与剩余机会必填并落在合法区间；难度须与该关「入门档」一致
  // （客户端 summary.difficulty 取的就是 levelConfig(level, 0).tier，服务端按同一镜像重算）。
  if (isLevel) {
    if (!validLevel(p.level)) errors.push('level 非法');
    if (!isInt(p.livesLeft) || p.livesLeft < 0 || p.livesLeft > LEVEL_LIVES) errors.push('livesLeft 非法');
    if (
      isInt(p.durationMs) &&
      p.durationMs !== GAME_HARD_LIMIT_MS &&
      !(p.result === 'lose' && p.livesLeft === 0)
    ) {
      errors.push('闯关时长必须为 45 秒，机会耗尽失败除外');
    }
    if (validLevel(p.level) && DIFFICULTY[p.difficulty] !== undefined) {
      if (p.difficulty !== levels.levelConfig(p.level, 0).tier) errors.push('difficulty 与关卡入门档不一致');
    }
  }

  // 能量上限：每次命中最高 +（基础 + 最高连击加成），完美判定（§6.2）再乘倍率，
  // 随机事件「手速狂潮」（§6.5）能量倍率再乘一次 —— 三档倍率都必须计入，否则合法上报会被误判为篡改。
  const maxClassicHitEnergy = Math.round(
    Math.round(
      Math.round((HIT_ENERGY + COMBO_BONUS_MAX) * PERFECT_MULTIPLIER) * EVENT_MAX_ENERGY_SCALE
    ) * CLASSIC_MODE.energyScale.end
  );
  if (!isLevel && isInt(p.hits) && isInt(p.myEnergy) && p.myEnergy > p.hits * maxClassicHitEnergy) {
    errors.push('myEnergy 超过理论上限');
  }

  // 普通对战位移必须与双方能量差一致；闯关只使用单边百分比进度。
  if (!isLevel && isInt(p.myEnergy) && isInt(p.oppEnergy)) {
    const expectedPx = clampPx((p.myEnergy - p.oppEnergy) * DISPLACEMENT_FACTOR);
    if (p.displacementPx !== expectedPx) errors.push('位移与能量不一致');
  }

  // 轮次一致性（§2.2 目标为颜色序列）：
  //   每轮必然以「走完序列 / 点错 / 超时」之一结束；闯关还可能由 45 秒硬上限截断，且：
  //     · 一轮最多贡献「该轮段数」次命中（上界）；
  //     · 未以失误/空轮结束的轮次（走完序列或截断）至少贡献 1 次命中（下界）。
  //   注意：下界**不能**写成「走完的轮数 × N」——闯关硬上限截断的轮次不足 N 段，会把合法上报误判为篡改。
  //   闯关模式的段数随「关卡 + 局内轮次」变化 ⇒ 上界用 levels.maxSeqCapFor(level, rounds) 重算
  //   （客户端**不上报段数计划**，减少协议面与伪造面）。
  if (isInt(p.rounds) && isInt(p.hits) && isInt(p.misses) && isInt(p.timeouts)) {
    const clean = p.rounds - p.misses - p.timeouts; // 非「失误/空轮」结束的轮次
    const hitsMax =
      isLevel && validLevel(p.level)
        ? levels.maxSeqCapFor(p.level, p.rounds)
        : p.rounds * CLASSIC_MODE.sequenceLength.max;
    if (clean < 0) errors.push('rounds 小于失误与空轮之和，口径不一致');
    else if (p.hits < clean || p.hits > hitsMax) errors.push('hits 与轮次/序列长度不一致');
  }

  // 闯关只按单边 0–100% 能量校验胜负；时长必须恰为 45 秒。
  if (isLevel && RESULTS.includes(p.result)) {
    if (p.result === 'draw') errors.push('闯关模式不支持平局');
    if (p.result === 'win') {
      if (p.energyPct !== LEVEL_MODE.energyMax) errors.push('能量未满却判胜');
      if (p.durationMs !== GAME_HARD_LIMIT_MS) errors.push('闯关胜利必须持续 45 秒');
      if (p.livesLeft === 0) errors.push('机会耗尽却判胜');
    }
    if (p.result === 'lose') {
      if (p.energyPct === LEVEL_MODE.energyMax && p.livesLeft !== 0) errors.push('能量已满却判负');
      if (p.durationMs !== GAME_HARD_LIMIT_MS && p.livesLeft !== 0) errors.push('未到 45 秒且机会未耗尽却判负');
    }
    if (p.livesLeft === 0 && p.result !== 'lose') errors.push('机会耗尽却未判负');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 记账并落库。
 * @param {object} store 见 server/lib/store.js / store-cloud.js
 * @param {string} openid 调用方身份
 * @param {object} payload 对局摘要（core/battle.summary）
 * @param {number} nowMs 当前时间
 * @returns {Promise<object>} 信封
 */
async function recordResult(store, openid, payload, nowMs) {
  const check = validate(payload);
  if (!check.ok) {
    return fail(CODES.BAD_REQUEST, check.errors.join('；'));
  }
  if (!openid) {
    return fail(CODES.BAD_REQUEST, '缺少调用方身份（X-TT-OPENID）');
  }

  const day = dayKey(nowMs);
  const isWin = payload.result === 'win';
  const mode = modeOf(payload);
  const isLevel = mode === 'level';

  // 档案与当日计数器：先读旧值（计数器读不到时补空默认值）
  const prevProfile = (await store.getProfile(openid)) || {
    openid,
    nickname: '',
    wins: 0,
    matches: 0,
    createdAt: nowMs,
  };
  const prevCounter = (await store.countersOf(openid, day)) || emptyCounter();

  // §4.6 段位胜点只由胜负推导，客户端不可上报胜点变化。
  const award = awardFor(payload);
  let profile = applyAward(prevProfile, award, payload.result, nowMs);

  // §4.8 闯关进度：只在**过关**时推进 `levels.max`（服务端权威；客户端本地乐观 + 回执覆盖）
  if (isLevel && isWin && validLevel(payload.level)) {
    profile = { ...profile, levels: levels.withClearedLevel(profile.levels, payload.level) };
  }
  const levelsProgress = levels.normalizeLevels(profile.levels);

  const counter = {
    ...prevCounter,
    match: prevCounter.match + 1,
    win: prevCounter.win + (isWin ? 1 : 0),
    lastMatchAt: nowMs,
  };
  delete counter.expEarned;
  delete counter.coinsEarned;
  delete counter.firstWinUsed;
  delete counter.rewardDouble;
  delete counter.coins;
  delete counter.taskProgress;
  delete counter.taskClaimed;
  delete counter.chestClaimed;

  await store.saveProfile(profile);
  await store.saveCounters(openid, day, counter);
  await store.addResult({
    openid,
    day,
    mode, // 'classic' | 'level'（§4.8，对局归类口径 §5.4）
    level: validLevel(payload.level) ? payload.level : null, // 闯关关卡号
    rankId: payload.rankId || null, // 普通对战开局段位（动态难度归因）
    result: payload.result,
    difficulty: payload.difficulty,
    challengeMode: payload.challengeMode === true, // 每日挑战局单独归类（§4.4 已下线，仅历史兼容）
    durationMs: payload.durationMs,
    rounds: payload.rounds,
    hits: payload.hits,
    perfectHits: isInt(payload.perfectHits) ? payload.perfectHits : 0, // 完美判定段数（§6.2）
    eventsFired: isInt(payload.eventsFired) ? payload.eventsFired : 0, // 随机事件触发次数（§6.5）
    misses: payload.misses,
    timeouts: payload.timeouts,
    bestCombo: payload.bestCombo,
    accuracy: payload.accuracy,
    ...(isLevel
      ? { energyPct: payload.energyPct }
      : {
          myEnergy: payload.myEnergy,
          oppEnergy: payload.oppEnergy,
          netEnergy: payload.netEnergy,
          displacementPx: payload.displacementPx,
        }),
    awardRankPoints: award.rankPoints,
    createdAt: nowMs,
  });

  return ok({
    wins: profile.wins,
    matches: profile.matches,
    award, // 本局实发奖励（§4.6）
    progress: progressOf(profile), // 权威进度（客户端据此对账，§4.6）
    levels: levelsProgress, // 权威闯关进度 `{ max }`（客户端本地乐观 + 此值覆盖，§4.8）
    daily: {
      match: counter.match,
      win: counter.win,
      skinUnlockLeft: Math.max(0, MONETIZATION.skinUnlockPerDay - counter.skinUnlock),
    },
  });
}

module.exports = { RESULTS, dayKey, validate, recordResult };
  };

  // ── server/lib/store-cloud.js
  __registry["server/lib/store-cloud.js"] = function (module, exports, require) {
'use strict';

/**
 * 云数据库存储实现（《项目说明书》§5.4 服务端只做校验与排名）
 *
 * 依据：抖音云云数据库（文档型）的服务端**唯一通道**是官方 Node SDK
 * `@open-dy/node-server-sdk` → `dySDK.database()`。
 * ⚠️ 部署前置条件：部署前**必须在抖音云控制台对应环境开启云数据库组件**，
 * 否则 SDK 调用会失败 / 服务退化为内存存储（见 store-provider.js），
 * 且多实例下跨函数状态互不可见。**不要臆造注入式 db 适配器。**
 *
 * 与内存实现（store.js）签名一一对应，差异只在载体语义：
 *   1) 全部方法返回 Promise（云库 IO 异步）；
 *   2) 文档 `_id` 承担唯一键：profiles 用 openid、counters 用 `openid:day`；
 *   3) `set` 为**替换式写入**且不接受 `_id`，故写入前统一 stripId；
 *   4) **没有「原地改字段即落库」语义**：读出的计数 / 档案改动后必须显式回写，
 *      否则只改内存副本。
 *
 * 集合（首次写入即创建；需先在控制台开启「云数据库」组件）：
 *   - rt_profiles  _id = openid
 *   - rt_counters  _id = openid:day
 *   - rt_results   _id = SDK 自动生成
 */

const C_PROFILES = 'rt_profiles';
const C_RESULTS = 'rt_results';
const C_COUNTERS = 'rt_counters';

/** 去掉库侧 `_id`，使读出口径与内存实现一致。 */
function stripId(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

/** `collection.doc(id).get()` → 单条记录（已剔除 `_id`）或 null。 */
async function readDoc(collection, id) {
  const res = await collection.doc(id).get();
  const rows = (res && res.data) || [];
  return rows.length > 0 ? stripId(rows[0]) : null;
}

/** `collection.get()` / `where(...).get()` → 记录数组（已剔除 `_id`）。 */
function readRows(res) {
  const rows = (res && res.data) || [];
  return rows.map(stripId);
}

const keyOfCounter = (openid, day) => `${openid}:${day}`;

/**
 * @param {{database:()=>object}} dySDK 官方 SDK 的 `dySDK`（其 `database()` 返回数据库实例）
 */
function createCloudStore(dySDK) {
  const database = dySDK.database();
  const profiles = () => database.collection(C_PROFILES);
  const counters = () => database.collection(C_COUNTERS);
  const results = () => database.collection(C_RESULTS);

  return {
    kind: 'cloud',
    available: true,
    COLLECTIONS: { C_PROFILES, C_RESULTS, C_COUNTERS },

    async getProfile(openid) {
      return readDoc(profiles(), openid);
    },
    async saveProfile(profile) {
      await profiles().doc(profile.openid).set(stripId(profile));
      return { ...profile };
    },

    async countersOf(openid, day) {
      const doc = await readDoc(counters(), keyOfCounter(openid, day));
      return doc || null; // null 由上层补空默认值（server/lib/result.js）
    },
    async saveCounters(openid, day, counter) {
      await counters().doc(keyOfCounter(openid, day)).set(stripId(counter));
      return { ...counter };
    },

    async addResult(record) {
      await results().add({ ...record });
      return { ...record };
    },
    async listResults(openid, limit) {
      const res = await results().where({ openid }).limit(limit || 20).get();
      return readRows(res);
    },
  };
}

module.exports = { createCloudStore, C_PROFILES, C_RESULTS, C_COUNTERS };
  };

  // ── server/lib/store-provider.js
  __registry["server/lib/store-provider.js"] = function (module, exports, require) {
'use strict';

/**
 * 存储选择（《项目说明书》§5.4）
 *
 * 优先级：能加载官方 `@open-dy/node-server-sdk` → 云数据库实现；否则退化为内存实现。
 *
 * 注意：该依赖**只声明在部署产物 build/cloud-functions/relax-tug-api/package.json 中**，
 * 由抖音云平台在部署时安装（既不进小游戏包，也不在仓库根安装），
 * 因此本地/单测环境通常加载不到，走内存分支属预期行为，这里只打印一次告警。
 */

const { createMemoryStore } = __req('server/lib/store.js');
const { createCloudStore } = __req('server/lib/store-cloud.js');

let cached = null;
let warned = false;

/** 创建（或复用）存储实例。 */
function getStore() {
  if (cached) return cached;
  try {
    const dySDK = require('@open-dy/node-server-sdk');
    cached = createCloudStore(dySDK);
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(
        '[store-provider] 未加载到 @open-dy/node-server-sdk，降级为内存存储：' +
          '仅适用于本地调试；多实例下跨函数状态不可见，禁止用于生产。' +
          '（部署产物中已声明该依赖，由平台在部署时安装。）'
      );
    }
    cached = createMemoryStore();
  }
  return cached;
}

/** 重置缓存（仅单测使用）。 */
function resetStore(store) {
  cached = store || null;
  warned = false;
}

module.exports = { getStore, resetStore };
  };

  // ── server/lib/store.js
  __registry["server/lib/store.js"] = function (module, exports, require) {
'use strict';

/**
 * 内存存储实现（**仅本地调试 / 单测**）
 *
 * ⚠️ 云函数为多实例运行，内存实现**不保证跨实例状态可见，禁止用于生产**。
 * 生产必须走官方 SDK（见 store-cloud.js），由 store-provider.js 自动选择。
 *
 * 与云端实现的关系：**方法签名一一对应**，且全部返回 Promise；
 * 读出的对象一律返回**浅拷贝**（模拟云端「读到的不是同一引用」的语义，
 * 逼迫上层显式回写，避免「原地改字段就以为落库了」的经典陷阱）。
 */

const C_PROFILES = 'rt_profiles';
const C_RESULTS = 'rt_results';
const C_COUNTERS = 'rt_counters';

/** 空计数器（与 store-cloud.js 口径一致）。 */
function emptyCounter() {
  return {
    match: 0, // 当日对局数
    win: 0, // 当日胜场
    skinUnlock: 0, // 当日皮肤解锁已用次数
    lastMatchAt: 0,
  };
}

/** @param {object} [seed] 预置数据，便于单测直接构造状态 */
function createMemoryStore(seed) {
  const data = seed || {};
  const profiles = new Map(Object.entries(data.profiles || {}));
  const counters = new Map(Object.entries(data.counters || {}));
  const results = [];

  const keyOfCounter = (openid, day) => `${openid}:${day}`;

  return {
    kind: 'memory',
    available: false,
    COLLECTIONS: { C_PROFILES, C_RESULTS, C_COUNTERS },

    async getProfile(openid) {
      const p = profiles.get(openid);
      return p ? { ...p } : null;
    },
    async saveProfile(profile) {
      profiles.set(profile.openid, { ...profile });
      return { ...profile };
    },

    async countersOf(openid, day) {
      const c = counters.get(keyOfCounter(openid, day));
      return { ...(c || emptyCounter()) };
    },
    async saveCounters(openid, day, counter) {
      counters.set(keyOfCounter(openid, day), { ...counter });
      return { ...counter };
    },

    async addResult(record) {
      const stored = { ...record, id: `rt_${results.length + 1}` };
      results.push(stored);
      return { ...stored };
    },
    async listResults(openid, limit) {
      const rows = results.filter((r) => r.openid === openid);
      const size = limit === undefined ? rows.length : limit;
      return rows.slice(Math.max(0, rows.length - size)).map((r) => ({ ...r }));
    },
  };
}

module.exports = { createMemoryStore, emptyCounter, C_PROFILES, C_RESULTS, C_COUNTERS };
  };

  // ── server/functions/playerState/index.js
  __registry["server/functions/playerState/index.js"] = function (module, exports, require) {
'use strict';

/**
 * 云函数 playerState：恢复服务端权威成长与闯关进度。
 *
 * 同时维护每日生命值，支持查询、开局扣除和完整广告后的领奖。
 */

const { CODES, ok, fail, fromError } = __req('server/lib/envelope.js');
const { openidFromContext } = __req('server/lib/identity.js');
const { getStore } = __req('server/lib/store-provider.js');
const { normalizeProgress, progressOf } = __req('server/lib/progression.js');
const levels = __req('server/lib/levels.js');
const livesCore = __req('server/lib/lives.js');

function snapshot(profile, lives) {
  return {
    progress: progressOf(profile),
    levels: levels.normalizeLevels(profile && profile.levels),
    lives,
  };
}

module.exports = async function playerState(params, context) {
  try {
    const openid = openidFromContext(context);
    if (!openid) return fail(CODES.BAD_REQUEST, '缺少调用方身份（X-TT-OPENID）');

    const store = getStore();
    const nowMs = Date.now();
    const storedProfile = await store.getProfile(openid);
    let profile = storedProfile || {
      openid,
      nickname: '',
      wins: 0,
      matches: 0,
      createdAt: nowMs,
    };
    const normalizedProgress = normalizeProgress(profile);
    const needsMigration =
      ['coins', 'exp', 'level'].some((field) => Object.prototype.hasOwnProperty.call(profile, field)) ||
      profile.rankId !== normalizedProgress.rankId ||
      profile.rankPoints !== normalizedProgress.rankPoints ||
      profile.matches !== normalizedProgress.matches ||
      profile.wins !== normalizedProgress.wins;
    profile = { ...profile, ...normalizedProgress };
    delete profile.coins;
    delete profile.exp;
    delete profile.level;
    if (storedProfile && needsMigration) await store.saveProfile(profile);
    const action = params && params.action;
    const currentLives = livesCore.normalizeLives(profile.lives, nowMs);

    if (action === 'consumeLife') {
      const result = livesCore.consumeLife(currentLives, nowMs);
      if (result.ok) {
        profile = { ...profile, lives: result.state };
        await store.saveProfile(profile);
      }
      return ok({ ...snapshot(profile, result.state), consumed: result.ok });
    }

    if (action === 'rewardLife') {
      const result = livesCore.grantLife(currentLives, nowMs);
      if (result.ok) {
        profile = { ...profile, lives: result.state };
        await store.saveProfile(profile);
      }
      return ok({ ...snapshot(profile, result.state), granted: result.ok });
    }

    if (action !== undefined && action !== 'state') {
      return fail(CODES.BAD_REQUEST, 'action 非法');
    }

    if (profile.lives && profile.lives.day !== currentLives.day) {
      profile = { ...profile, lives: currentLives };
      await store.saveProfile(profile);
    }
    return ok(snapshot(profile, currentLives));
  } catch (err) {
    return fromError(err);
  }
};
  };

  module.exports = __req("server/functions/playerState/index.js");
})();
