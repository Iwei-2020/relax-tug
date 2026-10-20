'use strict';

/**
 * 平衡模拟器（《项目说明书》§6.3 对局时长 / §6.4 难度曲线 / §6.5 随机事件）
 *
 * 用途：在没有真机数据的情况下，用**纯 core** 驱动大量对局，量化「越线阈值 N / 难度命中率 /
 * 平衡兜底 / 随机事件」对**对局时长分布**与**收官方式**的影响，作为数值重标定的门禁。
 *
 * 设计要点：
 *   1) 纯 core 驱动：只 require `config.js` 与 `src/core/*`，**不加载 tt 宿主**
 *      （core 全部可被 Node 直接 require，见各模块头部注释）；
 *   2) 两条独立随机流：`randCore`（轮序列 / 随机事件 / AI 掷骰）与 `randPlayer`（玩家行为），
 *      两者互不干扰 → 同一组种子必然复现同一条统计结果；
 *   3) **忠实还原客户端计时口径**：轮间停顿（`ROUND_GAP_MS`）计入**本轮第一段**的 `dtMs`
 *      —— 见 `scenes/battle.js`，`spentMs` 在轮间停顿期间持续累加，并作为 `submit` 的 `dtMs` 传入；
 *   4) 玩家模型与难度档挂钩（候选色数量 / 输入窗口 / 色差），并以「N=80 时普通档 P50 ≈ 8~10s」
 *      为**校准目标**（对齐线上体感，见计划「阶段 0」）；
 *   5) 直接把产出的对局摘要喂给 `server/lib/result.js#validate`，验证数值改动不会破坏
 *      客户端-服务端契约（该函数为纯 Node，不触碰 store）。
 *
 * 用法：
 *   node tools/sim-balance.js            # 大扫描：多组参数对照（不进 verify）
 *   node tools/sim-balance.js --check    # 固定种子小样断言（进 verify）
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
const req = (p) => require(path.join(ROOT, p));

const CONFIG_PATH = path.join(ROOT, 'minigame/src/config/config.js');
const CORE_PATHS = [
  'minigame/src/core/colors.js',
  'minigame/src/core/matcher.js',
  'minigame/src/core/energy.js',
  'minigame/src/core/ghost.js',
  'minigame/src/core/events.js',
  'minigame/src/core/battle.js',
].map((rel) => path.join(ROOT, rel));

const BATTLE_PATH = path.join(ROOT, 'minigame/src/core/battle.js');
const VALIDATE_PATH = path.join(ROOT, 'server/lib/result.js');
const SERVER_CONST_PATH = path.join(ROOT, 'server/lib/constants.js');

/* ── 玩家模型（可调旋钮；校准目标：N=80 时普通档 P50 ≈ 8~10s） ───────────── */

const PLAYER = {
  // 反应时间：中位数 = reactionMedian × 该段输入窗口；对数正态，sigma 控制个体波动
  reactionMedian: 0.36,
  reactionSigma: 0.3,
  // 准确率：基础值 − 每多 1 个候选色的惩罚 − 难度色差惩罚（近似色干扰）
  accBase: 0.92,
  accPerCandidate: 0.04,
  colorPenalty: { easy: 0, normal: 0.035, hard: 0.09, hell: 0.13 },
  accFloor: 0.5,
};

/**
 * 玩家单段行为：返回 { dtMs, clickedTarget }。
 *   - `dtMs` 为本段耗时（对数正态，中位数随输入窗口成比例）；
 *   - 超过窗口按「空轮」结算（点击为 null）；
 *   - 窗口内按准确率决定是否点中当前段目标色，未中则点一个非目标候选。
 */
function playerSegment(diff, windowMs, acc, rand) {
  // 对数正态：median × exp(sigma × z)，z ~ N(0,1)（Box-Muller）
  const u1 = Math.max(1e-9, rand());
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const dtMs = Math.max(80, Math.round(PLAYER.reactionMedian * windowMs * Math.exp(PLAYER.reactionSigma * z)));
  if (dtMs > windowMs) return { dtMs, clickedTarget: false, timedOut: true };
  const ok = rand() < acc;
  return { dtMs, clickedTarget: ok, timedOut: false };
}

/** 该难度档下玩家模型的准确率。 */
function accuracyOf(cfg, difficultyKey) {
  const diff = cfg.DIFFICULTY[difficultyKey];
  const candidates = diff.candidates;
  const penalty = PLAYER.colorPenalty[difficultyKey] || 0;
  const acc = PLAYER.accBase - PLAYER.accPerCandidate * Math.max(0, candidates - 4) - penalty;
  return Math.max(PLAYER.accFloor, Math.min(0.97, acc));
}

/* ── 参数覆盖：在内存中改写已加载的 config 导出，再重载依赖它的 core 模块 ── */
// config 的派生常量（DISPLACEMENT_FACTOR）在**加载时**算出，因此必须先改导出、再重载 core，
// 才能让 energy.js 重新解构到新值；RANDOM_EVENTS 是共享对象引用，原地改 chance 即生效。

function withConfig(overrides, fn) {
  const cfg = require(CONFIG_PATH);
  const balance = cfg.BALANCE;
  const saved = {
    n: cfg.WIN_NET_ENERGY,
    cfgN: cfg.CONFIG.winNetEnergy,
    factor: cfg.DISPLACEMENT_FACTOR,
    winThreshold: balance.winThreshold,
    loseThreshold: balance.loseThreshold,
    winThresholdRatio: balance.winThresholdRatio,
    loseThresholdRatio: balance.loseThresholdRatio,
    winAid: balance.winAid,
    chance: cfg.RANDOM_EVENTS.chance,
    oppHit: {},
  };
  const savedOppHit = saved.oppHit;

  const ov = overrides || {};
  if (ov.N !== undefined) {
    cfg.WIN_NET_ENERGY = ov.N;
    cfg.CONFIG.winNetEnergy = ov.N;
    cfg.DISPLACEMENT_FACTOR = cfg.DISPLACEMENT_MAX_PX / ov.N;
  }
  // 难度表：原地改写 oppHit（保持对象引用不变，否则 core 解构到的仍是旧表）
  if (ov.oppHit !== undefined) {
    for (const k of Object.keys(cfg.DIFFICULTY)) {
      savedOppHit[k] = cfg.DIFFICULTY[k].oppHit;
      cfg.DIFFICULTY[k].oppHit = ov.oppHit;
    }
  }
  // 平衡兜底阈值：兼容「绝对阈值」与「比例阈值」两种配置形态
  if (ov.winThresholdRatio !== undefined && balance.winThresholdRatio !== undefined) {
    balance.winThresholdRatio = ov.winThresholdRatio;
    balance.loseThresholdRatio = ov.loseThresholdRatio !== undefined ? ov.loseThresholdRatio : ov.winThresholdRatio;
  }
  if (ov.winThreshold !== undefined && balance.winThreshold !== undefined) {
    balance.winThreshold = ov.winThreshold;
    balance.loseThreshold = ov.loseThreshold !== undefined ? ov.loseThreshold : ov.winThreshold;
  }
  if (ov.loseAid !== undefined) balance.loseAid = ov.loseAid;
  if (ov.winAid !== undefined) balance.winAid = ov.winAid;
  if (ov.chance !== undefined) cfg.RANDOM_EVENTS.chance = ov.chance;

  // 服务端镜像常量（server/lib/constants.js 为生成物）：只在内存中同步同一批覆盖值，
  // 使 validate() 与「被覆盖后的客户端数值」同口径 —— 扫描才有意义（不落盘、不改生成物）。
  const sc = require(SERVER_CONST_PATH);
  const savedSc = { n: sc.WIN_NET_ENERGY, factor: sc.DISPLACEMENT_FACTOR };
  if (ov.N !== undefined) {
    sc.WIN_NET_ENERGY = ov.N;
    sc.DISPLACEMENT_FACTOR = sc.DISPLACEMENT_MAX_PX / ov.N;
  }

  for (const p of CORE_PATHS) delete require.cache[p];
  delete require.cache[VALIDATE_PATH];

  try {
    return fn(require(BATTLE_PATH), cfg, require(VALIDATE_PATH));
  } finally {
    // 还原并再次清空缓存，避免污染后续调用
    cfg.WIN_NET_ENERGY = saved.n;
    cfg.CONFIG.winNetEnergy = saved.cfgN;
    cfg.DISPLACEMENT_FACTOR = saved.factor;
    if (balance.winThreshold !== undefined) balance.winThreshold = saved.winThreshold;
    if (balance.loseThreshold !== undefined) balance.loseThreshold = saved.loseThreshold;
    if (balance.winThresholdRatio !== undefined) balance.winThresholdRatio = saved.winThresholdRatio;
    if (balance.loseThresholdRatio !== undefined) balance.loseThresholdRatio = saved.loseThresholdRatio;
    balance.winAid = saved.winAid;
    cfg.RANDOM_EVENTS.chance = saved.chance;
    for (const k of Object.keys(savedOppHit)) cfg.DIFFICULTY[k].oppHit = savedOppHit[k];
    sc.WIN_NET_ENERGY = savedSc.n;
    sc.DISPLACEMENT_FACTOR = savedSc.factor;
    for (const p of CORE_PATHS) delete require.cache[p];
    delete require.cache[VALIDATE_PATH];
  }
}

/* ── 单局模拟 ───────────────────────────────────────────────────────────── */

// 390pt 屏幕下拔河视图的真实可动范围（theme.js：min(220, (width-68)/2-40) = 121）
// 用于统计「视觉贴线占比」：位移超过它时渲染层会把绳子夹住，玩家看不到继续变化。
const VISUAL_MAX_PX = 121;

/**
 * 跑一局。
 * @returns {{durationMs:number, result:string, endKind:'cross'|'limit', rounds:number,
 *            hits:number, perfectHits:number, px:number, pinnedSegments:number, segments:number,
 *            summary:object, valid:boolean, errors:string[]}}
 */
function simulateMatch(battle, cfg, difficulty, seedCore, seedPlayer, opts) {
  const o = opts || {};
  const randCore = req('minigame/src/core/rng.js').createRng(seedCore);
  const randPlayer = req('minigame/src/core/rng.js').createRng(seedPlayer);
  const acc = o.acc === undefined ? accuracyOf(cfg, difficulty) : o.acc;

  let m = battle.beginPlaying(battle.createMatch({ difficulty }));
  m = battle.nextRound(m, randCore);

  let segments = 0;
  let pinned = 0;
  let guard = 0;
  while (!battle.isOver(m) && guard < 4000) {
    guard += 1;
    const round = m.round;
    const target = round.targetIds[round.seqIndex];
    const firstSegOfRound = round.seqIndex === 0;
    const step = playerSegment(cfg.DIFFICULTY[difficulty], round.windowMs, acc, randPlayer);
    // §6.3：轮间停顿计入本轮第一段的 dtMs（客户端 spentMs 在停顿期间持续累加）
    const dtMs = step.dtMs + (firstSegOfRound ? cfg.ROUND_GAP_MS : 0);

    let clickedId = null;
    if (!step.timedOut) {
      if (step.clickedTarget) clickedId = target;
      else {
        const wrong = round.optionIds.find((id) => id !== target);
        clickedId = wrong === undefined ? target : wrong;
      }
    }

    m = battle.submit(m, clickedId, dtMs, randCore);
    segments += 1;
    if (Math.abs(m.px) >= VISUAL_MAX_PX) pinned += 1;
    if (!battle.isOver(m)) m = battle.nextRound(m, randCore);
  }
  if (guard >= 4000) throw new Error('对局未在有限段内结束（疑似死循环）');

  const s = battle.summary(m);
  const crossed = Math.abs(m.px) >= cfg.DISPLACEMENT_MAX_PX;
  const check = require(VALIDATE_PATH).validate(s);
  return {
    durationMs: s.durationMs,
    result: s.result,
    endKind: crossed ? 'cross' : 'limit',
    rounds: s.rounds,
    hits: s.hits,
    perfectHits: s.perfectHits,
    bestCombo: s.bestCombo,
    px: s.displacementPx,
    pinnedSegments: pinned,
    segments,
    summary: s,
    valid: check.ok,
    errors: check.errors,
  };
}

/* ── 统计 ──────────────────────────────────────────────────────────────── */

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarizeRuns(runs) {
  const durs = runs.map((r) => r.durationMs).sort((a, b) => a - b);
  const cross = runs.filter((r) => r.endKind === 'cross').length;
  const win = runs.filter((r) => r.result === 'win').length;
  const lose = runs.filter((r) => r.result === 'lose').length;
  const draw = runs.filter((r) => r.result === 'draw').length;
  const pinned = runs.reduce((a, r) => a + r.pinnedSegments, 0);
  const segs = runs.reduce((a, r) => a + r.segments, 0);
  const hits = runs.reduce((a, r) => a + r.hits, 0);
  const perfect = runs.reduce((a, r) => a + r.perfectHits, 0);
  const bestCombo = runs.reduce((a, r) => a + r.bestCombo, 0);
  const rounds = runs.reduce((a, r) => a + r.rounds, 0);
  const bad = runs.filter((r) => !r.valid);
  return {
    n: runs.length,
    p50: percentile(durs, 50),
    p90: percentile(durs, 90),
    crossRate: cross / runs.length,
    winRate: win / runs.length,
    loseRate: lose / runs.length,
    drawRate: draw / runs.length,
    avgRounds: rounds / runs.length,
    avgHits: hits / runs.length,
    avgPerfect: perfect / runs.length,
    avgBestCombo: bestCombo / runs.length,
    visualPinnedRate: segs === 0 ? 0 : pinned / segs,
    validRate: (runs.length - bad.length) / runs.length,
    invalidSample: bad.length > 0 ? bad[0].errors : [],
  };
}

function runBatch(battle, cfg, difficulty, count, seedBase, opts) {
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    runs.push(simulateMatch(battle, cfg, difficulty, (seedBase + i * 7919) >>> 0, (seedBase + i * 104729 + 17) >>> 0, opts));
  }
  return summarizeRuns(runs);
}

function secs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function pad(s, w) {
  return String(s).padEnd(w, ' ');
}

/* ── 模式一：--check（进 verify；固定种子小样断言） ──────────────────────── */

// 断言口径来自实测（见计划「阶段 0」）：
//   - 普通档（默认档）P50 ∈ [18s, 32s]：对齐 §6.3 的 20~30s 目标带；
//   - 越线收官 ≥ 55%：多数对局由越线决出，而非全靠硬上限；
//   - 截断 ≤ 25%：45s 硬上限是**长尾兜底**，§6.3 目标带「20~40s」本就容许常态贴顶；
//   - 各档 P50 ≥ 10s：避免出现退化到 10s 以内的档位。
const CHECK = {
  normalP50MinMs: 18000,
  normalP50MaxMs: 32000,
  crossRateMin: 0.55,
  truncationMax: 0.25,
  anyP50MinMs: 10000,
};

function runCheck() {
  const problems = [];
  withConfig({}, (battle, cfg) => {
    const normal = runBatch(battle, cfg, 'normal', 300, 20261020);
    if (normal.validRate < 1) problems.push(`普通档存在未被服务端接受的摘要：${normal.invalidSample.join('；')}`);
    if (normal.p50 < CHECK.normalP50MinMs || normal.p50 > CHECK.normalP50MaxMs) {
      problems.push(`普通档 P50 时长 ${secs(normal.p50)} 不在 [18s, 32s]`);
    }
    if (normal.crossRate < CHECK.crossRateMin) {
      problems.push(`普通档越线收官占比 ${(normal.crossRate * 100).toFixed(1)}% < 55%`);
    }
    if (1 - normal.crossRate > CHECK.truncationMax) {
      problems.push(`普通档硬上限截断占比 ${((1 - normal.crossRate) * 100).toFixed(1)}% > 25%`);
    }

    // 四档都要能被服务端接受（契约一致性），且时长不退化
    for (const d of ['easy', 'normal', 'hard', 'hell']) {
      const r = runBatch(battle, cfg, d, 120, 20261020 + d.length);
      if (r.validRate < 1) problems.push(`${d} 档存在未被服务端接受的摘要：${r.invalidSample.join('；')}`);
      if (r.p50 < CHECK.anyP50MinMs) problems.push(`${d} 档 P50 时长 ${secs(r.p50)} < 10s`);
    }

    console.log('── sim:check ──');
    console.log(`  普通档：P50 ${secs(normal.p50)} · P90 ${secs(normal.p90)} · 越线收官 ${(normal.crossRate * 100).toFixed(1)}% · 平均轮数 ${normal.avgRounds.toFixed(1)} · 平均命中 ${normal.avgHits.toFixed(1)}`);
  });

  if (problems.length > 0) {
    console.error('sim:check 未通过：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('sim:check 通过：契约一致、普通档时长落在 18~32s、越线收官 ≥ 55%、截断 ≤ 25%');
}

/* ── 模式二：大扫描（不进 verify） ─────────────────────────────────────── */

function runSweep() {
  const ds = [80, 140, 200, 240, 280];
  const count = 400;
  console.log('参数扫描（每格 %d 局；时长不含开局倒计时）', count);
  console.log(pad('N', 6) + pad('oppHit', 8) + pad('难度', 8) + pad('P50', 8) + pad('P90', 8) + pad('越线%', 8) + pad('胜/负/平', 14) + pad('轮数', 7) + pad('命中', 7) + pad('贴线%', 7) + '契约');

  for (const N of ds) {
    for (const oppHit of [0.7, 0.85, 0.95]) {
      withConfig({ N, oppHit }, (battle, cfg) => {
        for (const d of ['easy', 'normal', 'hard', 'hell']) {
          const r = runBatch(battle, cfg, d, count, 20261019 + N + Math.round(oppHit * 100));
          const res = `${(r.winRate * 100).toFixed(0)}/${(r.loseRate * 100).toFixed(0)}/${(r.drawRate * 100).toFixed(0)}`;
          console.log(
            pad(N, 6) + pad(oppHit, 8) + pad(d, 8) + pad(secs(r.p50), 8) + pad(secs(r.p90), 8) +
              pad((r.crossRate * 100).toFixed(1), 8) + pad(res, 14) + pad(r.avgRounds.toFixed(1), 7) +
              pad(r.avgHits.toFixed(1), 7) + pad((r.visualPinnedRate * 100).toFixed(1), 7) +
              (r.validRate === 1 ? 'ok' : `FAIL ${r.invalidSample.join('/')}`)
          );
        }
      });
    }
  }

  console.log('');
  console.log('── 现状基线（当前 config，不做任何覆盖） ──');
  withConfig({}, (battle, cfg) => {
    for (const d of ['easy', 'normal', 'hard', 'hell']) {
      const r = runBatch(battle, cfg, d, count, 20261019);
      console.log(
        pad('now', 6) + pad(cfg.DIFFICULTY[d].oppHit, 8) + pad(d, 8) + pad(secs(r.p50), 8) + pad(secs(r.p90), 8) +
          pad((r.crossRate * 100).toFixed(1), 8) +
          pad(`${(r.winRate * 100).toFixed(0)}/${(r.loseRate * 100).toFixed(0)}/${(r.drawRate * 100).toFixed(0)}`, 14) +
          pad(r.avgRounds.toFixed(1), 7) + pad(r.avgHits.toFixed(1), 7) + pad((r.visualPinnedRate * 100).toFixed(1), 7) +
          (r.validRate === 1 ? 'ok' : `FAIL ${r.invalidSample.join('/')}`)
      );
    }
  });
}

/* ── 模式三：--baseline（校准玩家模型用；只跑当前 config） ─────────────── */

function runBaseline() {
  const count = 600;
  console.log('现状基线（当前 config，不做任何覆盖；每档 %d 局）', count);
  console.log(pad('难度', 8) + pad('oppHit', 8) + pad('P50', 8) + pad('P90', 8) + pad('越线%', 8) + pad('胜/负/平', 14) + pad('轮数', 7) + pad('命中', 7) + pad('完美', 7) + pad('贴线%', 7) + '契约');
  withConfig({}, (battle, cfg) => {
    for (const d of ['easy', 'normal', 'hard', 'hell']) {
      const runs = [];
      for (let i = 0; i < count; i += 1) {
        runs.push(simulateMatch(battle, cfg, d, (20261019 + i * 7919) >>> 0, (20261019 + i * 104729 + 17) >>> 0));
      }
      const r = summarizeRuns(runs);
      const perfectAvg = runs.reduce((a, x) => a + x.perfectHits, 0) / runs.length;
      console.log(
        pad(d, 8) + pad(cfg.DIFFICULTY[d].oppHit, 8) + pad(secs(r.p50), 8) + pad(secs(r.p90), 8) +
          pad((r.crossRate * 100).toFixed(1), 8) +
          pad(`${(r.winRate * 100).toFixed(0)}/${(r.loseRate * 100).toFixed(0)}/${(r.drawRate * 100).toFixed(0)}`, 14) +
          pad(r.avgRounds.toFixed(1), 7) + pad(r.avgHits.toFixed(1), 7) + pad(perfectAvg.toFixed(1), 7) +
          pad((r.visualPinnedRate * 100).toFixed(1), 7) +
          (r.validRate === 1 ? 'ok' : `FAIL ${r.invalidSample.join('/')}`)
      );
    }
  });
}

/* ── 模式四：--tune（按候选参数微调：N / 兜底阈值比例 / winAid / 事件概率） ── */

function flagNum(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : Number(hit.split('=')[1]);
}

function runTune() {
  const N = flagNum('n') || undefined;
  const ratio = flagNum('ratio');
  const runs = flagNum('runs') || 800;
  const ov = { N };
  if (flagNum('winAid') !== undefined) ov.winAid = flagNum('winAid');
  if (flagNum('loseAid') !== undefined) ov.loseAid = flagNum('loseAid');
  if (flagNum('chance') !== undefined) ov.chance = flagNum('chance');
  if (ratio !== undefined) {
    // 兼容两种配置形态：比例键存在时用比例，否则按 ratio×N 折算成绝对阈值
    ov.winThresholdRatio = ratio;
    ov.winThreshold = N === undefined ? undefined : Math.round(ratio * N);
  }

  console.log('候选参数：%s（每档 %d 局）', JSON.stringify(ov), runs);
  withConfig(ov, (battle, cfg) => {
    console.log(
      '生效值：N=%d 兜底阈值=%s winAid=%s chance=%s',
      cfg.WIN_NET_ENERGY,
      cfg.BALANCE.winThresholdRatio !== undefined
        ? `${cfg.BALANCE.winThresholdRatio}×N = ${Math.round(cfg.BALANCE.winThresholdRatio * cfg.WIN_NET_ENERGY)}`
        : `${cfg.BALANCE.winThreshold}（绝对）`,
      cfg.BALANCE.winAid,
      cfg.RANDOM_EVENTS.chance
    );
    console.log(pad('难度', 8) + pad('oppHit', 8) + pad('P50', 8) + pad('P90', 8) + pad('越线%', 8) + pad('截断%', 8) + pad('胜/负/平', 14) + pad('轮数', 7) + pad('命中', 7) + pad('完美', 7) + pad('最高连击', 9) + pad('贴线%', 7) + '契约');
    for (const d of ['easy', 'normal', 'hard', 'hell']) {
      const rr = runBatch(battle, cfg, d, runs, 20261021 + d.length);
      console.log(
        pad(d, 8) + pad(cfg.DIFFICULTY[d].oppHit, 8) + pad(secs(rr.p50), 8) + pad(secs(rr.p90), 8) +
          pad((rr.crossRate * 100).toFixed(1), 8) + pad(((1 - rr.crossRate) * 100).toFixed(1), 8) +
          pad(`${(rr.winRate * 100).toFixed(0)}/${(rr.loseRate * 100).toFixed(0)}/${(rr.drawRate * 100).toFixed(0)}`, 14) +
          pad(rr.avgRounds.toFixed(1), 7) + pad(rr.avgHits.toFixed(1), 7) + pad(rr.avgPerfect.toFixed(1), 7) +
          pad(rr.avgBestCombo.toFixed(1), 9) + pad((rr.visualPinnedRate * 100).toFixed(1), 7) +
          (rr.validRate === 1 ? 'ok' : `FAIL ${rr.invalidSample.join('/')}`)
      );
    }
  });
}

if (process.argv.includes('--check')) runCheck();
else if (process.argv.includes('--baseline')) runBaseline();
else if (process.argv.includes('--tune')) runTune();
else runSweep();
