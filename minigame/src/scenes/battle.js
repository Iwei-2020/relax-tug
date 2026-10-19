'use strict';

/**
 * 对局场景（《项目说明书》§2.2 对战流程 + §7 交互设计）
 *
 * 负责把 core/battle 的状态机接到渲染与触摸上，并维护两个**表现层计时器**：
 *   - 本轮输入窗口倒计时（roundLeftMs）：归零 → 以空轮结算（§6.2「空轮不计能量」）；
 *   - 轮间停顿（gapLeftMs）：≤150ms（§6.3），到点刷新下一轮，保持节奏连贯。
 *
 * 触摸：底部候选面板首次点击即结算本轮；命中/失误反馈由 core 返回的 lastRound 驱动。
 */

const { MACARON } = require('../components/theme.js');
const decor = require('../components/decor.js');
const { drawRope, drawCountdown } = require('../components/rope.js');
const { drawTarget, drawPalette, hitTest } = require('../components/palette.js');
const { createRng } = require('../core/rng.js');
const {
  createMatch,
  advanceCountdown,
  nextRound,
  submit,
  isOver,
  summary,
} = require('../core/battle.js');
const { ROUND_GAP_MS, GAME_HARD_LIMIT_MS } = require('../config/config.js');
const { EVENTS, track } = require('../utils/tracker.js');
const ttApi = require('../platform/tt.js');

/** 结算前的结果展示延时（越线动画 §7.2 约 400ms，这里留 600ms 让玩家看清） */
const END_DELAY_MS = 600;
/** 命中/失误高亮持续时长（§7.1 即时反馈） */
const FEEDBACK_MS = 260;
/** 命中/失误对拔河视图的冲击反馈时长（连续命中会叠加更长的余韵，见 resolve） */
const IMPULSE_MS = 380;
/** 「完美判定」反馈持续时长（§7.1：金色描边 + "完美!" 提示） */
const PERFECT_MS = 500;

/**
 * @param {object} options
 * @param {object} options.layout 见 theme.computeLayout
 * @param {string} [options.difficulty] 难度档（服务端下发失败时用本地默认档兜底）
 * @param {number} [options.seed] 伪随机种子（每日挑战同题局 / 测试 / 回放用）
 * @param {boolean} [options.challenge] 是否每日挑战局（§4.4：结算摘要打 challengeMode 标记）
 * @param {object} [options.resume] 续战快照（看广告复活用：保留双方已积攒能量）
 * @param {(summary:object, match:object) => void} options.onFinish 对局结束回调
 */
function createBattleScene(options) {
  const opts = options || {};
  const layout = opts.layout;
  const rand = opts.seed === undefined ? createRng(Date.now() & 0x7fffffff) : createRng(opts.seed);

  // 续战（§5.1 失败复活）：保留能量与连击，仅把阶段复位为对局中并等一轮刷新
  const resumed = opts.resume && opts.resume.phase ? { ...opts.resume, phase: 'playing', result: null, countdownLeftMs: 0 } : null;
  let match = resumed || createMatch({ difficulty: opts.difficulty, challenge: opts.challenge === true });
  let roundLeftMs = 0;
  let gapLeftMs = resumed ? ROUND_GAP_MS : 0;
  let endDelayMs = 0;
  let finished = false;
  // 自上次结算以来消耗的时间（含轮间停顿），作为 submit 的 dtMs。
  // 必须累计「已消耗」而不是「剩余」，否则超时结算会传入负值，导致对局计时停摆、
  // 45s 硬上限永远不触发。
  let spentMs = 0;

  let pressedIndex = -1;
  let hitIndex = -1;
  let missIndex = -1;
  let feedbackLeftMs = 0;
  let comboPop = 0;
  let perfectLeftMs = 0; // 「完美判定」反馈剩余时长（§7.1）
  // 拔河视图的动效状态：累计时间驱动待机律动，impulse 驱动命中/失误冲击
  let tMs = 0;
  let impulseLeftMs = 0;
  let impulseKind = 'hit';
  const cache = {}; // 天空渐变缓存（只建一次）

  // 拔河视图共享入参：一帧只复用同一个对象（避免每帧新建对象，§5.4）
  const ropeView = {
    px: 0,
    myEnergy: 0,
    oppEnergy: 0,
    phase: 'countdown',
    countdownLeftMs: 0,
    tMs: 0,
    impulse: 0,
    impulseKind: 'hit',
  };

  track(EVENTS.MATCH_START, { difficulty: match.difficulty, phase: resumed ? 'resume' : 'countdown' });

  /**
   * 结算序列中的**一段**：
   *   - 点对且未走完 → 本轮继续（窗口按段重置为满，不等停顿，节奏连贯）；
   *   - 点对且走完最后一段 / 点错 / 超时 → 本轮结束（进入轮间停顿）；
   *   - 对局已结束 → 启动结束延时，交给结算页。
   */
  function resolve(clickedId) {
    const beforeRound = match.roundIndex;
    const beforeSeq = match.round ? match.round.seqIndex : 0;
    match = submit(match, clickedId, spentMs, rand);
    spentMs = 0;

    const seqAdvanced = match.round ? match.round.seqIndex > beforeSeq : false;
    const roundEnded = match.roundIndex !== beforeRound;
    if (!seqAdvanced && !roundEnded) return; // 未发生结算（无当前轮）

    const last = match.lastRound;
    if (last.kind === 'hit') {
      hitIndex = match.round.optionIds.indexOf(last.clickedId);
      comboPop = last.comboAfter >= 3 ? 0.35 : 0.2;
      if (last.perfect) perfectLeftMs = PERFECT_MS; // 完美判定：金色描边 + "完美!" 提示（§7.1）
      ttApi.vibrateShort();
      track(EVENTS.ROUND_HIT, { combo: last.comboAfter, gain: last.playerGain, perfect: last.perfect === true });
    } else if (last.kind === 'miss') {
      missIndex = match.round.optionIds.indexOf(last.clickedId);
      track(EVENTS.ROUND_MISS, { penalty: last.playerGain });
    } else {
      track(EVENTS.ROUND_TIMEOUT, {});
    }
    feedbackLeftMs = FEEDBACK_MS;

    // 拔河视图冲击：命中 → 我方拉拽爆发（连击越高余韵越长）；失误/超时 → 反向
    impulseKind = last.kind === 'hit' ? 'hit' : 'miss';
    impulseLeftMs = IMPULSE_MS * (last.kind === 'hit' ? 1 + Math.min(1, last.comboAfter / 10) : 1);

    if (isOver(match)) {
      endDelayMs = END_DELAY_MS;
    } else {
      roundLeftMs = match.round.windowMs; // 每段一格时间：推进到下一段或新轮都重置为满
      if (roundEnded) gapLeftMs = ROUND_GAP_MS;
    }
  }

  return {
    name: 'battle',

    update(dtMs) {
      const dt = Math.max(0, Math.min(100, dtMs)); // 夹住长帧，避免后台切回时一次结算多轮

      // 待机律动时间轴 + 冲击衰减（与对局阶段无关，结算延时期间也继续动）
      tMs += dt;
      if (impulseLeftMs > 0) impulseLeftMs = Math.max(0, impulseLeftMs - dt);
      if (perfectLeftMs > 0) perfectLeftMs = Math.max(0, perfectLeftMs - dt);

      if (feedbackLeftMs > 0) {
        feedbackLeftMs -= dt;
        if (feedbackLeftMs <= 0) {
          hitIndex = -1;
          missIndex = -1;
        }
        comboPop = Math.max(0, comboPop - dt / 400);
      }

      if (match.phase === 'countdown') {
        match = advanceCountdown(match, dt);
        if (match.phase === 'playing') {
          match = nextRound(match, rand);
          roundLeftMs = match.round.windowMs;
          spentMs = 0;
        }
        return;
      }

      if (match.phase !== 'playing') {
        // 已结束：等待表现层延时后交给结算页
        if (!finished && endDelayMs > 0) {
          endDelayMs -= dt;
          if (endDelayMs <= 0) {
            finished = true;
            const s = summary(match);
            track(EVENTS.MATCH_END, {
              result: s.result,
              durationMs: s.durationMs,
              rounds: s.rounds,
              accuracy: s.accuracy,
              bestCombo: s.bestCombo,
            });
            if (typeof opts.onFinish === 'function') opts.onFinish(s, match);
          }
        }
        return;
      }

      // 轮间停顿（§6.3：≤150ms，保持节奏连贯）
      if (gapLeftMs > 0) {
        gapLeftMs -= dt;
        spentMs += dt;
        if (gapLeftMs <= 0) {
          match = nextRound(match, rand);
          roundLeftMs = match.round.windowMs;
        }
        return;
      }

      // 输入窗口倒计时（§2.2 每轮判定时序）
      roundLeftMs -= dt;
      spentMs += dt;
      if (roundLeftMs <= 0) resolve(null); // 空轮：窗口内未操作
    },

    draw(ctx) {
      const W = layout.width;

      // 马卡龙天空打底（三分区面板叠在其上，与首页同一套观感）
      decor.drawSky(ctx, layout, cache, MACARON);

      // 顶部拔河视图的共享入参（复用同一对象，供拔河与倒计时浮层共享）
      ropeView.px = match.px;
      ropeView.myEnergy = match.player.energy;
      ropeView.oppEnergy = match.ghost.state.energy;
      ropeView.phase = match.phase;
      ropeView.countdownLeftMs = match.phase === 'countdown' ? match.countdownLeftMs : 0;
      ropeView.tMs = tMs;
      ropeView.impulse = impulseLeftMs / IMPULSE_MS;
      ropeView.impulseKind = impulseKind;

      drawRope(ctx, layout, ropeView);

      drawTarget(ctx, layout, match.round, {
        roundRemaining: match.round && roundLeftMs > 0 ? roundLeftMs / match.round.windowMs : 0,
        combo: match.player.combo,
        comboPop,
        perfect: perfectLeftMs > 0,
      });

      drawPalette(ctx, layout, match.round, { pressedIndex, hitIndex, missIndex });

      // 分区细分隔线（§2.1：视觉上分区清晰但不断裂）
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      for (const y of [layout.mid.y, layout.bottom.y]) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // 剩余对局时间（硬上限 §6.3）：居中显示在两枚阵营徽章之间
      const leftSec = Math.max(0, Math.ceil((GAME_HARD_LIMIT_MS - match.elapsedMs) / 1000));
      ctx.fillStyle = MACARON.ink;
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${leftSec}s`, W / 2, layout.rope.badge.y);

      // 倒计时浮层：必须最后画，盖住三分区面板与目标色块（§4.1 开局 3-2-1）
      drawCountdown(ctx, layout, ropeView);
    },

    onTouchStart(x, y) {
      if (match.phase !== 'playing' || gapLeftMs > 0 || !match.round) return;
      const index = hitTest(layout, match.round, x, y);
      if (index < 0) return;
      pressedIndex = index;
      resolve(match.round.optionIds[index]);
      pressedIndex = -1;
    },

    onTouchEnd() {
      pressedIndex = -1;
    },

    /** 当前对局状态快照（供调试/复活续战使用）。 */
    snapshot() {
      return match;
    },

    /** 复位到倒计时（重开一局时复用同一难度与模式标记）。 */
    reset() {
      match = createMatch({ difficulty: opts.difficulty, challenge: opts.challenge === true });
      roundLeftMs = 0;
      gapLeftMs = 0;
      endDelayMs = 0;
      finished = false;
      hitIndex = -1;
      missIndex = -1;
      impulseLeftMs = 0;
      perfectLeftMs = 0;
      tMs = 0;
    },
  };
}

module.exports = { createBattleScene };
