'use strict';

/**
 * 闯关模式核心（《项目说明书》§4.8 闯关模式 + §6.7 闯关模式数值）
 *
 * 纯函数，一律返回新对象、绝不原地修改入参（与 core/progression.js 同约定）。
 * 数值全部取自 `config.levelMode`（唯一事实来源）；服务端 `server/lib/levels.js`
 * 用**同一份镜像参数**实现**同一套公式**，两端由 `test/levels.test.js` 交叉校验。
 *
 * 设计口径：
 *   · 100 关不手配：用难度关键帧插值输入窗口时长，段数与候选随关卡和轮次爬坡；
 *   · 闯关胜负独立于对战，单边能量达到 100% 即满足过关条件；
 *   · 硬约束：每轮候选数 ≥ 该轮段数（levelConfig 内部兜底，不可省）。
 */

const { LEVEL_MODE, DIFFICULTY } = require('../config/config.js');

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
 * 与服务端镜像 `server/lib/levels.js` 逐字对应；`test/levels.test.js` 有断言钉死它与 rng 的等价）。
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
