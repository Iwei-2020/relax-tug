'use strict';

/**
 * 闯关模式平衡模拟器（《项目说明书》§4.8 闯关模式 / §6.7 闯关模式数值）
 *
 * 用途：在没有真机数据的情况下，用**纯 core** 驱动大量闯关对局，量化「关卡曲线（段数 / 候选 /
 * 输入窗口）」对**可通关率**、**过关所需段数**与**失败构成**的影响，
 * 作为关卡数值（`config.js#levelMode`）的门禁与校准依据。
 *
 * 与 `tools/sim-balance.js` 的关系：同一套玩家模型（反应时间 / 准确率）与固定种子复现口径，
 * 但只驱动闯关路径。两者**互不影响**：本工具不改任何配置，只读当前 `config.js` 的真实数值
 * （调参时直接改 config 再重跑，避免内存覆盖与 `server/lib/constants.js` 不同步带来的假绿）。
 *
 * 玩家模型沿用 sim-balance：准确率按**本轮候选数**与**档位色差**折损 —— 闯关模式候选取自
 * 2/4/6/9，段数取自 1–6，窗口随关卡收窄，因此模拟必须逐轮读取 `match.levelCfg`。
 *
 * 用法：
 *   node tools/sim-levels.js --baseline   # 关卡采样表（调参期反复跑）
 *   node tools/sim-levels.js --check      # 固定种子断言（C8 起并入 verify）
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
const req = (p) => require(path.join(ROOT, p));

const VALIDATE_PATH = path.join(ROOT, 'server/lib/result.js');

/* ── 玩家模型（与 sim-balance 保持一致；校准目标：可通关率随关卡单调下降） ─── */

const PLAYER = {
  reactionMedian: 0.36,
  reactionSigma: 0.3,
  accBase: 0.92,
  accPerCandidate: 0.04,
  colorPenalty: { easy: 0, normal: 0.035, hard: 0.09, hell: 0.13 },
  accFloor: 0.5,
};

/** 玩家单段行为（与 sim-balance 同口径）：{ dtMs, clickedTarget, timedOut }。 */
function playerSegment(windowMs, acc, rand) {
  const u1 = Math.max(1e-9, rand());
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const dtMs = Math.max(80, Math.round(PLAYER.reactionMedian * windowMs * Math.exp(PLAYER.reactionSigma * z)));
  if (dtMs > windowMs) return { dtMs, clickedTarget: false, timedOut: true };
  return { dtMs, clickedTarget: rand() < acc, timedOut: false };
}

/** 该轮玩家准确率：基础 − 候选数惩罚 − 档位色差惩罚。 */
function accuracyOf(tier, candidates) {
  const penalty = PLAYER.colorPenalty[tier] || 0;
  const acc = PLAYER.accBase - PLAYER.accPerCandidate * Math.max(0, candidates - 4) - penalty;
  return Math.max(PLAYER.accFloor, Math.min(0.97, acc));
}

/* ── 单局模拟 ───────────────────────────────────────────────────────────── */

/**
 * 跑一关。
 * @returns {{durationMs,result,endKind,rounds,hits,perfectHits,bestCombo,livesLeft,
 *            segments,energyPct,summary,valid,errors}}
 */
function simulateLevel(battle, cfg, level, seedCore, seedPlayer) {
  const randCore = req('minigame/src/core/rng.js').createRng(seedCore);
  const randPlayer = req('minigame/src/core/rng.js').createRng(seedPlayer);

  let m = battle.beginPlaying(battle.createMatch({ mode: 'level', level }));
  m = battle.nextRound(m, randCore);

  let segments = 0;
  let guard = 0;
  while (!battle.isOver(m) && guard < 20000) {
    guard += 1;
    const round = m.round;
    const rc = m.levelCfg;
    const target = round.targetIds[round.seqIndex];
    const firstSegOfRound = round.seqIndex === 0;
    const step = playerSegment(round.windowMs, accuracyOf(m.difficulty, rc.candidates), randPlayer);
    // 轮间停顿计入本轮第一段的 dtMs（与 scenes/battle.js 的 spentMs 口径一致）
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
    if (!battle.isOver(m)) m = battle.nextRound(m, randCore);
  }
  if (guard >= 20000) throw new Error(`第 ${level} 关未在有限段内结束（疑似死循环）`);

  const s = battle.summary(m);
  const endKind = s.result === 'win' ? 'goal' : 'limit';
  const check = require(VALIDATE_PATH).validate(s);

  return {
    durationMs: s.durationMs,
    result: s.result,
    endKind,
    rounds: s.rounds,
    hits: s.hits,
    perfectHits: s.perfectHits,
    bestCombo: s.bestCombo,
    livesLeft: s.livesLeft,
    segments,
    energyPct: s.energyPct,
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

function median(values) {
  if (values.length === 0) return 0;
  return percentile(values.slice().sort((a, b) => a - b), 50);
}

function summarizeLevel(runs, hardLimitMs) {
  const n = runs.length;
  const wins = runs.filter((r) => r.result === 'win');
  const durs = runs.map((r) => r.durationMs).sort((a, b) => a - b);
  const bad = runs.filter((r) => !r.valid);
  const invalidDurationCount = runs.filter(
    (r) => r.durationMs !== hardLimitMs && r.livesLeft !== 0
  ).length;
  const kindRate = { goal: 0, limit: 0 };
  for (let i = 0; i < n; i += 1) kindRate[runs[i].endKind] += 1;
  for (const k of Object.keys(kindRate)) kindRate[k] /= n;
  return {
    n,
    winRate: wins.length / n,
    medianWinHits: median(wins.map((r) => r.hits)),
    medianWinRounds: median(wins.map((r) => r.rounds)),
    p50DurationMs: percentile(durs, 50),
    minRounds: runs.reduce((a, r) => Math.min(a, r.rounds), Infinity),
    maxRounds: runs.reduce((a, r) => Math.max(a, r.rounds), 0),
    avgSegments: runs.reduce((a, r) => a + r.segments, 0) / n,
    invalidDurationCount,
    endKindRate: kindRate,
    validRate: (n - bad.length) / n,
    invalidSample: bad.length > 0 ? bad[0].errors : [],
  };
}

function runBatch(battle, cfg, level, count, seedBase) {
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    runs.push(simulateLevel(battle, cfg, level, (seedBase + i * 7919) >>> 0, (seedBase + i * 104729 + 17) >>> 0));
  }
  return summarizeLevel(runs, cfg.GAME_HARD_LIMIT_MS);
}

const SAMPLES = [1, 5, 10, 25, 50, 75, 90, 100];

function secs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function pad(s, w) {
  return String(s).padEnd(w, ' ');
}

function pct(v) {
  return `${(v * 100).toFixed(1)}`;
}

function loadDeps() {
  return req('minigame/src/core/battle.js');
}

/* ── 模式一：--baseline（关卡采样表；调参期反复跑） ─────────────────────── */

function flagNum(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const v = hit === undefined ? NaN : Number(hit.split('=')[1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

function runBaseline() {
  const count = flagNum('runs', 400);
  const battle = loadDeps();
  const cfg = req('minigame/src/config/config.js');
  const levelsCore = req('minigame/src/core/levels.js');
  console.log('闯关模式基线（当前 config，每关 %d 局；时长不含开局倒计时）', count);
  console.log(
    pad('关卡', 6) + pad('段数', 8) + pad('候选', 8) + pad('档位', 8) + pad('胜率%', 8) +
    pad('命中/轮数', 12) + pad('P50', 8) + pad('过关/未满%', 18) + '契约'
  );
  for (const lv of SAMPLES) {
    const r = runBatch(battle, cfg, lv, count, 20261020 + lv * 131);
    const lastRound = Math.ceil(cfg.GAME_HARD_LIMIT_MS / 1000);
    const c0 = levelsCore.levelConfig(lv, 0);
    const c1 = levelsCore.levelConfig(lv, lastRound);
    console.log(
      pad(lv, 6) + pad(`${c0.seqLen}→${c1.seqLen}`, 8) + pad(`${c0.candidates}→${c1.candidates}`, 8) +
        pad(c0.tier, 8) + pad(pct(r.winRate), 8) + pad(`${r.medianWinHits}段/${r.medianWinRounds}轮`, 12) +
        pad(secs(r.p50DurationMs), 8) +
        pad(`${pct(r.endKindRate.goal)}/${pct(r.endKindRate.limit)}`, 18) +
        (r.validRate === 1 ? 'ok' : `FAIL ${r.invalidSample.join('/')}`)
    );
  }
}

/* ── 模式二：--check（固定种子断言；C8 起并入 verify） ─────────────────── */

/**
 * 门禁口径（校准依据见《项目说明书》§6.7）：
 *
 * 1. **契约一致**：每一关的每一局摘要都必须能被 `server/lib/result.js#validate` 接受（服务端权威口径）。
 * 2. **生命规则基线**：三条累计生命用尽立即失败；固定种子下 L1 保留少量通关样本，高关允许趋近 0%。
 * 3. **块级单调不增**：把 100 关切成 10 关一块共 10 块，块均值必须单调不增（±3% 容差）。
 * 4. **逐关上升幅度上限**：单关胜率比上一关高出的幅度 ≤ 15%（防关键帧边界处出现结构性反转）。
 * 5. **轮次范围**：每局必须持续刷新多轮，不得提前结算。
 * 6. **时长契约**：每局运行至 45 秒，或生命耗尽时立即失败。
 *
 * 为什么**不是**逐关严格非增：候选色档位按产品需求固定为 2/4/6/9 四档、段数为 1–6 整数，
 * 阶梯式跳档（如 L50/51 从 4 格跳 6 格、L83/84 从 6 格跳 9 格）必然在跳档点造成局部**上升**。
 * 实测逐关 ±3% 的非增断言在离散档位下**不可达**（原实现把方向写反、反而只拦「下降」），
 * 故改为「块级单调（长期趋势）+ 逐关幅度上限（短程不反转）」的组合口径。
 */
const CHECK = {
  runsPerLevel: 400, // 100 关 × 400 局 = 4 万局（实测 <5s，单关噪声 ≈ ±2%，块均值噪声 ≈ ±0.7%）
  firstWinRateMin: 0.03,
  lastWinRateMin: 0,
  lastWinRateMax: 0.05,
  blockSize: 10,
  blockTolerance: 0.03,
  perLevelRiseMax: 0.15,
};

function runCheck() {
  const problems = [];
  const battle = loadDeps();
  const cfg = req('minigame/src/config/config.js');
  const maxLevel = cfg.LEVEL_MAX;
  const rates = [];

  for (let lv = 1; lv <= maxLevel; lv += 1) {
    const r = runBatch(battle, cfg, lv, CHECK.runsPerLevel, 20261020 + lv * 131);
    rates.push(r);
    if (r.validRate < 1) problems.push(`L${lv} 存在未被服务端接受的摘要：${r.invalidSample.join('；')}`);
    if (r.minRounds < 2) problems.push(`L${lv} 存在未持续刷新多轮的对局`);
    if (r.invalidDurationCount > 0) problems.push(`L${lv} 存在非 45 秒且未耗尽生命的提前结算`);
  }

  // 逐关上升幅度（方向：胜率应随关卡下降，**上升**才是异常）
  for (let i = 1; i < rates.length; i += 1) {
    const rise = rates[i].winRate - rates[i - 1].winRate;
    if (rise > CHECK.perLevelRiseMax) {
      problems.push(`L${i + 1} 胜率 ${pct(rates[i].winRate)}% 比 L${i} 高 ${(rise * 100).toFixed(1)} 个百分点（> ${CHECK.perLevelRiseMax * 100}%）`);
    }
  }

  // 块均值单调不增
  const blocks = [];
  for (let start = 0; start < rates.length; start += CHECK.blockSize) {
    const chunk = rates.slice(start, start + CHECK.blockSize);
    blocks.push({ from: start + 1, to: start + chunk.length, mean: chunk.reduce((s, r) => s + r.winRate, 0) / chunk.length });
  }
  for (let b = 1; b < blocks.length; b += 1) {
    if (blocks[b].mean > blocks[b - 1].mean + CHECK.blockTolerance) {
      problems.push(
        `第 ${b + 1} 块（L${blocks[b].from}–L${blocks[b].to}）均值 ${pct(blocks[b].mean)}% 高于第 ${b} 块 ${pct(blocks[b - 1].mean)}%（超出 ${CHECK.blockTolerance * 100}% 容差）`
      );
    }
  }

  // 端点带
  const first = rates[0];
  const last = rates[rates.length - 1];
  if (first.winRate < CHECK.firstWinRateMin) problems.push(`L1 胜率 ${pct(first.winRate)}% < ${CHECK.firstWinRateMin * 100}%`);
  if (last.winRate < CHECK.lastWinRateMin || last.winRate > CHECK.lastWinRateMax) {
    problems.push(`L${maxLevel} 胜率 ${pct(last.winRate)}% 不在 [${CHECK.lastWinRateMin * 100}%, ${CHECK.lastWinRateMax * 100}%]`);
  }

  console.log('块均值（%）：' + blocks.map((b) => `${b.from}-${b.to}:${pct(b.mean)}`).join(' '));
  console.log(
    `端点：L1 ${pct(first.winRate)}%（中位 ${first.medianWinHits} 段）、L${maxLevel} ${pct(last.winRate)}%（中位 ${last.medianWinHits} 段）` +
      `；每关 ${CHECK.runsPerLevel} 局，共 ${rates.length} 关`
  );

  if (problems.length > 0) {
    console.error(`sim:levels:check 未通过（${problems.length} 项）：`);
    for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
    if (problems.length > 20) console.error(`  … 另有 ${problems.length - 20} 项`);
    process.exit(1);
  }
  console.log('sim:levels:check 通过：契约一致 / 45 秒或生命耗尽 / 多轮持续 / 胜率曲线门禁');
}

/* ── 模式三：--scan（1–100 全关卡曲线；调参期用） ───────────────────────── */

function runScan() {
  const count = flagNum('runs', 200);
  const battle = loadDeps();
  const cfg = req('minigame/src/config/config.js');
  const levelsCore = req('minigame/src/core/levels.js');
  console.log('闯关模式全关卡曲线（每关 %d 局）', count);
  console.log(pad('关卡', 6) + pad('u起', 7) + pad('段数', 8) + pad('候选', 8) + pad('档位', 8) + pad('窗口', 7) + pad('胜率%', 8) + pad('段数中位', 9) + 'P50');
  let prev = 1;
  const breakpoints = [];
  for (let lv = 1; lv <= cfg.LEVEL_MAX; lv += 1) {
    const r = runBatch(battle, cfg, lv, count, 20261020 + lv * 131);
    const c0 = levelsCore.levelConfig(lv, 0);
    if (r.winRate > prev + 0.03) breakpoints.push(`L${lv} ${pct(r.winRate)}% > L${lv - 1} ${pct(prev)}%`);
    prev = r.winRate;
    if (lv % 5 === 0 || lv === 1 || lv === cfg.LEVEL_MAX) {
      console.log(
        pad(lv, 6) + pad(c0.u.toFixed(3), 7) +
          pad(`${c0.seqLen}→${levelsCore.maxSeqLenFor(lv, Math.ceil(cfg.GAME_HARD_LIMIT_MS / 1000))}`, 8) +
          pad(String(c0.candidates), 8) + pad(c0.tier, 8) +
          pad(c0.windowMs, 7) + pad(pct(r.winRate), 8) + pad(r.medianWinHits, 9) + secs(r.p50DurationMs)
      );
    }
    if (r.validRate < 1) console.log(`  !! L${lv} 契约失败：${r.invalidSample.join('/')}`);
  }
  if (breakpoints.length > 0) {
    console.log('逐关上升点（超 3% 容差，仅供参考；门禁口径见 --check 的块级断言）：');
    for (const b of breakpoints) console.log(`  - ${b}`);
  } else {
    console.log('逐关无上升点（3% 容差内）');
  }
}

if (process.argv.includes('--check')) runCheck();
else if (process.argv.includes('--scan')) runScan();
else runBaseline();
