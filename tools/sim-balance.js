'use strict';

/**
 * 平衡模拟器（《项目说明书》§6.3 对局时长 / §6.4 难度曲线 / §6.5 随机事件）
 *
 * 用途：在没有真机数据的情况下，用**纯 core** 驱动大量对局，量化「开局段位 / 局内升压 /
 * 能量变化曲线 / 随机事件」对普通对局时长分布与收官方式的影响。
 *
 * 设计要点：
 *   1) 纯 core 驱动：只 require `config.js` 与 `src/core/*`，**不加载 tt 宿主**
 *      （core 全部可被 Node 直接 require，见各模块头部注释）；
 *   2) 两条独立随机流：`randCore`（轮序列 / 随机事件 / AI 掷骰）与 `randPlayer`（玩家行为），
 *      两者互不干扰 → 同一组种子必然复现同一条统计结果；
 *   3) **忠实还原客户端计时口径**：轮间停顿（`ROUND_GAP_MS`）计入**本轮第一段**的 `dtMs`
 *      —— 见 `scenes/battle.js`，`spentMs` 在轮间停顿期间持续累加，并作为 `submit` 的 `dtMs` 传入；
 *   4) 玩家模型按每轮实际候选数、窗口和难度档计算准确率，并按开局段位分组；
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

/* ── 合成玩家模型（只用于数值回归，不代表线上用户数据） ─────────────── */

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
function accuracyOf(cfg, difficultyKey, candidateCount) {
  const diff = cfg.DIFFICULTY[difficultyKey];
  const candidates = candidateCount === undefined ? diff.candidates : candidateCount;
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
  const classicOpponentHit = cfg.CLASSIC_MODE.opponentHit;
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
    classicOpponentHitStart: classicOpponentHit.start,
    classicOpponentHitEnd: classicOpponentHit.end,
  };

  const ov = overrides || {};
  if (ov.N !== undefined) {
    cfg.WIN_NET_ENERGY = ov.N;
    cfg.CONFIG.winNetEnergy = ov.N;
    cfg.DISPLACEMENT_FACTOR = cfg.DISPLACEMENT_MAX_PX / ov.N;
  }
  // 普通对战 Ghost 命中率曲线覆盖。
  if (ov.oppHit !== undefined) {
    classicOpponentHit.start = ov.oppHit;
    classicOpponentHit.end = ov.oppHit;
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
    classicOpponentHit.start = saved.classicOpponentHitStart;
    classicOpponentHit.end = saved.classicOpponentHitEnd;
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
 * @returns {{durationMs:number, result:string, endKind:'cross', rounds:number,
 *            hits:number, perfectHits:number, px:number, pinnedSegments:number, segments:number,
 *            summary:object, valid:boolean, errors:string[]}}
 */
function simulateMatch(battle, cfg, rankId, seedCore, seedPlayer, opts) {
  const o = opts || {};
  const randCore = req('minigame/src/core/rng.js').createRng(seedCore);
  const randPlayer = req('minigame/src/core/rng.js').createRng(seedPlayer);

  let m = battle.beginPlaying(battle.createMatch({ rankId }));
  m = battle.nextRound(m, randCore);

  let segments = 0;
  let pinned = 0;
  let guard = 0;
  while (!battle.isOver(m) && guard < 4000) {
    guard += 1;
    const round = m.round;
    const target = round.targetIds[round.seqIndex];
    const firstSegOfRound = round.seqIndex === 0;
    const acc = o.acc === undefined ? accuracyOf(cfg, round.difficulty, round.optionIds.length) : o.acc;
    const step = playerSegment(cfg.DIFFICULTY[round.difficulty], round.windowMs, acc, randPlayer);
    // 轮间停顿计入本轮第一段的耗时；它也推动本局动态难度曲线。
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
    p20: percentile(durs, 20),
    p50: percentile(durs, 50),
    p80: percentile(durs, 80),
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

function runBatch(battle, cfg, rankId, count, seedBase, opts) {
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    runs.push(simulateMatch(battle, cfg, rankId, (seedBase + i * 7919) >>> 0, (seedBase + i * 104729 + 17) >>> 0, opts));
  }
  return summarizeRuns(runs);
}

function secs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function pad(s, w) {
  return String(s).padEnd(w, ' ');
}

/* ── 模式一：--check（进 verify；按段位抽样） ──────────────────────── */

// 中位时长与 P20–P80 主体分布落在目标带，保留少量极端样本不作为门禁依据。
const CHECK = {
  medianMinMs: 45000,
  medianMaxMs: 90000,
  p20MinMs: 30000,
  p80MaxMs: 90000,
  sampleCount: 120,
};

function runCheck() {
  const problems = [];
  withConfig({}, (battle, cfg) => {
    console.log('── sim:check（按段位分组；期望时长 45–90 秒，排除极端尾部）──');
    for (const rank of cfg.PROGRESSION.ranks) {
      const r = runBatch(battle, cfg, rank.id, CHECK.sampleCount, 20261020 + rank.id.length * 97);
      if (r.validRate < 1) problems.push(`${rank.name}存在服务端拒绝的摘要：${r.invalidSample.join('；')}`);
      if (r.p50 < CHECK.medianMinMs || r.p50 > CHECK.medianMaxMs) {
        problems.push(`${rank.name} P50 ${secs(r.p50)} 不在 [45s, 90s]`);
      }
      if (r.p20 < CHECK.p20MinMs) problems.push(`${rank.name} P20 ${secs(r.p20)} < 30s`);
      if (r.p80 > CHECK.p80MaxMs) problems.push(`${rank.name} P80 ${secs(r.p80)} > 90s`);
      if (r.crossRate < 1) problems.push(`${rank.name}存在未通过能量越线结束的对局`);
      console.log(
        `  ${rank.name}：P20 ${secs(r.p20)} · P50 ${secs(r.p50)} · P80 ${secs(r.p80)} · 平均序列 ${r.avgRounds.toFixed(1)} 轮`
      );
    }
  });

  if (problems.length > 0) {
    console.error('sim:check 未通过：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('sim:check 通过：各段位摘要有效、P50 在 45–90 秒、P20≥30 秒、P80≤90 秒，均由能量越线结束');
}

/* ── 模式二：越线阈值扫描（不进 verify） ─────────────────────────────── */

function runSweep() {
  const ds = [80, 140, 200, 240, 280];
  const count = 400;
  console.log('参数扫描（每段位 %d 局；普通对战没有总计时器）', count);
  console.log(pad('N', 6) + pad('oppHit', 8) + pad('段位', 8) + pad('P20', 8) + pad('P80', 8) + pad('轮数', 8) + pad('命中', 8) + '契约');

  for (const N of ds) {
    for (const oppHit of [0.7, 0.85, 0.95]) {
      withConfig({ N, oppHit }, (battle, cfg) => {
        for (const rank of cfg.PROGRESSION.ranks) {
          const r = runBatch(battle, cfg, rank.id, count, 20261019 + N + Math.round(oppHit * 100));
          console.log(
            pad(N, 6) + pad(oppHit, 8) + pad(rank.name, 8) + pad(secs(r.p20), 8) + pad(secs(r.p80), 8) +
              pad(r.avgRounds.toFixed(1), 7) + pad(r.avgHits.toFixed(1), 7) +
              (r.validRate === 1 ? 'ok' : `FAIL ${r.invalidSample.join('/')}`)
          );
        }
      });
    }
  }

  console.log('');
  console.log('── 现状基线（当前 config，不做任何覆盖） ──');
  withConfig({}, (battle, cfg) => {
    for (const rank of cfg.PROGRESSION.ranks) {
      const r = runBatch(battle, cfg, rank.id, count, 20261019 + rank.id.length);
      console.log(
        pad('now', 6) + pad(rank.name, 8) + pad(secs(r.p20), 8) + pad(secs(r.p50), 8) + pad(secs(r.p80), 8) +
          pad(r.avgRounds.toFixed(1), 7) + pad(r.avgHits.toFixed(1), 7) +
          (r.validRate === 1 ? 'ok' : `FAIL ${r.invalidSample.join('/')}`)
      );
    }
  });
}

/* ── 模式三：--baseline（校准玩家模型用；只跑当前 config） ─────────────── */

function runBaseline() {
  const count = 600;
  console.log('当前段位曲线基线（每段位 %d 局）', count);
  console.log(pad('段位', 8) + pad('P20', 8) + pad('P50', 8) + pad('P80', 8) + pad('轮数', 8) + pad('命中', 8) + pad('完美', 8) + '契约');
  withConfig({}, (battle, cfg) => {
    for (const rank of cfg.PROGRESSION.ranks) {
      const runs = [];
      for (let i = 0; i < count; i += 1) {
        runs.push(simulateMatch(battle, cfg, rank.id, (20261019 + i * 7919) >>> 0, (20261019 + i * 104729 + 17) >>> 0));
      }
      const r = summarizeRuns(runs);
      const perfectAvg = runs.reduce((a, x) => a + x.perfectHits, 0) / runs.length;
      console.log(
        pad(rank.name, 8) + pad(secs(r.p20), 8) + pad(secs(r.p50), 8) + pad(secs(r.p80), 8) +
          pad(r.avgRounds.toFixed(1), 7) + pad(r.avgHits.toFixed(1), 7) + pad(perfectAvg.toFixed(1), 7) +
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
    console.log(pad('段位', 8) + pad('P20', 8) + pad('P50', 8) + pad('P80', 8) + pad('轮数', 8) + pad('命中', 8) + '契约');
    for (const rank of cfg.PROGRESSION.ranks) {
      const rr = runBatch(battle, cfg, rank.id, runs, 20261021 + rank.id.length);
      console.log(
        pad(rank.name, 8) + pad(secs(rr.p20), 8) + pad(secs(rr.p50), 8) + pad(secs(rr.p80), 8) +
          pad(rr.avgRounds.toFixed(1), 8) + pad(rr.avgHits.toFixed(1), 8) +
          (rr.validRate === 1 ? 'ok' : `FAIL ${rr.invalidSample.join('/')}`)
      );
    }
  });
}

if (process.argv.includes('--check')) runCheck();
else if (process.argv.includes('--baseline')) runBaseline();
else if (process.argv.includes('--tune')) runTune();
else runSweep();
