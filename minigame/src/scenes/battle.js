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

const { HOME, MACARON } = require('../components/theme.js');
const decor = require('../components/decor.js');
const { roundRect } = require('../components/shape.js');
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
const { activeEvent } = require('../core/events.js');
const { ROUND_GAP_MS, GAME_HARD_LIMIT_MS, LEVEL_LIVES, DISPLACEMENT_MAX_PX } = require('../config/config.js');
const { EVENTS, track } = require('../utils/tracker.js');
const ttApi = require('../platform/tt.js');
const audio = require('../platform/audio.js');

/** 结算前的结果展示延时（越线动画 §7.2 约 400ms，这里留 600ms 让玩家看清） */
const END_DELAY_MS = 600;
/** 命中/失误高亮持续时长（§7.1 即时反馈） */
const FEEDBACK_MS = 260;
/** 命中/失误对拔河视图的冲击反馈时长（连续命中会叠加更长的余韵，见 resolve） */
const IMPULSE_MS = 380;
/** 「完美判定」反馈持续时长（§7.1：金色描边 + "完美!" 提示） */
const PERFECT_MS = 500;
/** 随机事件触发时的横幅脉冲时长（§7.1：顶部弹出事件横幅 + 淡入缩放脉冲） */
const EVENT_POP_MS = 700;

/** 闯关 HUD 几何（§4.8）：左上「第 N 关」胶囊 + 右上剩余机会点阵。 */
const HUD_PAD = 14;
const HUD_H = 26;
const HUD_PILL_W = 96;
const HUD_DOT_R = 6;
const HUD_DOT_GAP = 20;

/**
 * 闯关模式 HUD（§4.8）：左上「第 N 关」，右上「机会」+ 点阵（剩余实心 / 已失空心）。
 * 绘在**中部面板顶部的空白带**，不遮挡拔河视图的阵营徽章与目标色带。
 */
function drawLevelHud(ctx, layout, match) {
  const y = Math.round(layout.mid.y + 10);
  const my = y + HUD_H / 2;

  // 关卡胶囊（白色磨砂 + 金色描边，与首页「闯关挑战」同色系）
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  roundRect(ctx, HUD_PAD, y, HUD_PILL_W, HUD_H, HUD_H / 2);
  ctx.fill();
  ctx.strokeStyle = HOME.gold;
  ctx.lineWidth = 3;
  roundRect(ctx, HUD_PAD + 1.5, y + 1.5, HUD_PILL_W - 3, HUD_H - 3, HUD_H / 2 - 1.5);
  ctx.stroke();
  ctx.fillStyle = MACARON.ink;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`第 ${match.level} 关`, HUD_PAD + HUD_PILL_W / 2, my + 1);
  ctx.restore();

  // 机会点阵（自右向左：实心 = 剩余，空心 = 已失）
  const left = Math.max(0, Math.min(LEVEL_LIVES, match.livesLeft === null ? 0 : match.livesLeft));
  const dotCount = LEVEL_LIVES;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = MACARON.inkDim;
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('机会', layout.width - HUD_PAD - (dotCount - 1) * HUD_DOT_GAP - HUD_DOT_R * 2 - 6, my + 1);
  for (let i = 0; i < dotCount; i += 1) {
    const x = layout.width - HUD_PAD - HUD_DOT_R - i * HUD_DOT_GAP;
    if (i < left) {
      ctx.fillStyle = MACARON.ourDeep;
      ctx.beginPath();
      ctx.arc(x, my, HUD_DOT_R, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(58,74,107,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, my, HUD_DOT_R - 1, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * @param {object} options
 * @param {object} options.layout 见 theme.computeLayout
 * @param {string} [options.difficulty] 难度档（服务端下发失败时用本地默认档兜底）
 * @param {string} [options.rankId] 普通对战开始时的玩家段位
 * @param {number} [options.seed] 伪随机种子（闯关每关固定种子 / 测试 / 回放用）
 * @param {boolean} [options.challenge] 是否每日挑战局（§4.4 已下线，仅历史兼容）
 * @param {'classic'|'level'} [options.mode] 对局模式（§4.8：'level' 为闯关模式）
 * @param {number} [options.level] 闯关关卡号（mode === 'level' 时生效，1–100）
 * @param {(summary:object, match:object) => void} options.onFinish 对局结束回调
 */
function createBattleScene(options) {
  const opts = options || {};
  const layout = opts.layout;
  const rand = opts.seed === undefined ? createRng(Date.now() & 0x7fffffff) : createRng(opts.seed);

  let match = createMatch({
    difficulty: opts.difficulty,
    rankId: opts.rankId,
    challenge: opts.challenge === true,
    mode: opts.mode,
    level: opts.level,
  });
  if (match.phase === 'countdown') audio.play('countdown');
  let roundLeftMs = 0;
  let gapLeftMs = 0;
  let endDelayMs = 0;
  let finished = false;
  // 自上次结算以来消耗的时间（含轮间停顿），作为 submit 的 dtMs。
  let spentMs = 0;

  let pressedIndex = -1;
  let hitIndex = -1;
  let missIndex = -1;
  let feedbackLeftMs = 0;
  let comboPop = 0;
  let perfectLeftMs = 0; // 「完美判定」反馈剩余时长（§7.1）
  let lastFired = match.events ? match.events.fired : 0; // 已播报的随机事件次数（§6.5）
  let eventPopLeftMs = 0; // 随机事件横幅脉冲剩余时长
  // 拔河视图的动效状态：累计时间驱动待机律动，impulse 驱动命中/失误冲击
  let tMs = 0;
  let countdownSecond = match.phase === 'countdown' ? Math.ceil(match.countdownLeftMs / 1000) : 0;
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

  /**
   * 轮间刷新：把「窗口重置 + 随机事件播报」合并到一处（§6.5 触发检查点在轮间）。
   * 事件由 core 在 nextRound 内确定性触发，这里只负责表现层反馈（横幅脉冲 + 震动 + 埋点）。
   */
  function refreshRound() {
    roundLeftMs = match.round ? match.round.windowMs : 0;
    const fired = match.events ? match.events.fired : 0;
    if (fired !== lastFired) {
      lastFired = fired;
      eventPopLeftMs = EVENT_POP_MS;
      const ev = activeEvent(match.events);
      ttApi.vibrateShort();
      audio.play('event');
      track(EVENTS.RANDOM_EVENT, { id: ev ? ev.id : '', round: match.roundIndex });
    }
  }

  if (match.phase === 'playing') {
    match = nextRound(match, rand);
    refreshRound();
  }
  track(EVENTS.MATCH_START, {
    mode: match.mode,
    level: match.level,
    difficulty: match.difficulty,
    phase: match.phase,
  });

  /**
   * 结算序列中的**一段**：
   *   - 点对且未走完 → 本轮继续（窗口按段重置为满，不等停顿，节奏连贯）；
   *   - 点对且走完最后一段 / 点错 / 超时 → 本轮结束（进入轮间停顿）；
   *   - 对局已结束 → 启动结束延时，交给结算页。
   */
  function resolve(clickedId) {
    const beforeRound = match.roundIndex;
    const beforeSeq = match.round ? match.round.seqIndex : 0;
    const previousPx = match.px;
    match = submit(match, clickedId, spentMs, rand);
    spentMs = 0;

    const last = match.lastRound;
    if (last && last.kind === 'hit') {
      audio.play(last.perfect ? 'perfect' : 'hit');
      if ([3, 5, 8].includes(last.comboAfter)) audio.play('combo');
    } else if (last && last.kind === 'miss') {
      audio.play('miss');
    } else if (last && last.kind === 'timeout') {
      audio.play('timeout');
    }

    if (
      Math.abs(previousPx) < DISPLACEMENT_MAX_PX * 0.65 &&
      Math.abs(match.px) >= DISPLACEMENT_MAX_PX * 0.65
    ) {
      audio.play('tension');
    }

    if (isOver(match)) {
      endDelayMs = END_DELAY_MS;
      return;
    }

    const seqAdvanced = match.round ? match.round.seqIndex > beforeSeq : false;
    const roundEnded = match.roundIndex !== beforeRound;
    if (!seqAdvanced && !roundEnded) return; // 未发生结算（无当前轮）

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

    roundLeftMs = match.round.windowMs; // 每段一格时间：推进到下一段或新轮都重置为满
    if (roundEnded) gapLeftMs = ROUND_GAP_MS;
  }

  return {
    name: 'battle',

    update(dtMs) {
      const dt = Math.max(0, Math.min(100, dtMs)); // 夹住长帧，避免后台切回时一次结算多轮

      // 待机律动时间轴 + 冲击衰减（与对局阶段无关，结算延时期间也继续动）
      tMs += dt;
      if (impulseLeftMs > 0) impulseLeftMs = Math.max(0, impulseLeftMs - dt);
      if (perfectLeftMs > 0) perfectLeftMs = Math.max(0, perfectLeftMs - dt);
      if (eventPopLeftMs > 0) eventPopLeftMs = Math.max(0, eventPopLeftMs - dt);

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
        const nextSecond = Math.ceil(match.countdownLeftMs / 1000);
        if (nextSecond > 0 && nextSecond < countdownSecond) audio.play('countdown');
        countdownSecond = nextSecond;
        if (match.phase === 'playing') {
          audio.play('start');
          match = nextRound(match, rand);
          refreshRound();
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
          refreshRound();
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
      const ev = activeEvent(match.events); // 当前生效的随机事件（§6.5，无则 null）

      // 马卡龙天空打底（三分区面板叠在其上，与首页同一套观感）
      decor.drawSky(ctx, layout, cache, MACARON);

      // 顶部拔河视图的共享入参（复用同一对象，供拔河与倒计时浮层共享）
      ropeView.px = match.px;
      ropeView.myEnergy = match.player.energy;
      ropeView.oppEnergy = match.ghost ? match.ghost.state.energy : 0;
      ropeView.mode = match.mode;
      ropeView.progressPct = match.mode === 'level' ? match.player.energy : 0;
      ropeView.phase = match.phase;
      ropeView.countdownLeftMs = match.phase === 'countdown' ? match.countdownLeftMs : 0;
      ropeView.tMs = tMs;
      ropeView.impulse = impulseLeftMs / IMPULSE_MS;
      ropeView.impulseKind = impulseKind;

      drawRope(ctx, layout, ropeView);

      // 随机事件横幅（§6.5 / §7.1）：生效期间常驻显示「事件名 · 效果 · 剩余秒数」，触发瞬间缩放脉冲
      if (ev) {
        const bh = 28;
        const bw = Math.min(Math.round(W * 0.82), 320);
        const by = Math.round(layout.rope.badge.y + layout.rope.badge.h / 2 + 10);
        const pop = eventPopLeftMs > 0 ? eventPopLeftMs / EVENT_POP_MS : 0;
        const sec = Math.max(1, Math.ceil(match.events.activeLeftMs / 1000));
        const k = 1 + 0.06 * pop;
        ctx.save();
        ctx.translate(W / 2, by + bh / 2);
        ctx.scale(k, k);
        ctx.shadowColor = 'rgba(46,102,180,0.3)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = 'rgba(255,255,255,0.74)';
        roundRect(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
        ctx.fill();
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = MACARON.ring;
        ctx.lineWidth = 3;
        roundRect(ctx, -bw / 2 + 2, -bh / 2 + 2, bw - 4, bh - 4, bh / 2 - 2);
        ctx.stroke();
        decor.drawOutlinedText(ctx, `${ev.name} · ${ev.desc} · ${sec}s`, 0, 0, {
          font: 'bold 13px sans-serif',
          fill: MACARON.ink,
        });
        ctx.restore();
      }

      drawTarget(ctx, layout, match.round, {
        roundRemaining: match.round && roundLeftMs > 0 ? roundLeftMs / match.round.windowMs : 0,
        combo: match.player.combo,
        comboPop,
        perfect: perfectLeftMs > 0,
        tMs,
      });

      drawPalette(ctx, layout, match.round, { pressedIndex, hitIndex, missIndex });

      // 随机事件「迷雾干扰」（§6.5）：纯视觉遮挡，不改任何数值；覆盖在候选面板之上
      if (ev && ev.fog) {
        const b = layout.bottom;
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#DEF0FA';
        roundRect(ctx, b.x + 6, b.y + 4, b.w - 12, b.h - 4, 16);
        ctx.fill();
        ctx.restore();
      }

      // 分区细分隔线（§2.1：视觉上分区清晰但不断裂）
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      for (const y of [layout.mid.y, layout.bottom.y]) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // 仅闯关模式显示固定 45 秒剩余时间；普通对战没有整局倒计时或时限。
      if (match.mode === 'level') {
        const leftSec = Math.max(0, Math.ceil((GAME_HARD_LIMIT_MS - match.elapsedMs) / 1000));
        ctx.fillStyle = MACARON.ink;
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${leftSec}s`, W / 2, layout.rope.badge.y);
      }

      // 闯关模式 HUD（§4.8）：关卡号 + 剩余机会（普通对战不呈现）
      if (match.mode === 'level') drawLevelHud(ctx, layout, match);

      // 普通对战和闯关模式都显示 3-2-1 开场。
      if (match.phase === 'countdown') drawCountdown(ctx, layout, ropeView);
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

    /** 当前对局状态快照（供调试与回放工具使用）。 */
    snapshot() {
      return match;
    },

    /** 重开一局，重新播放 3 秒开场倒计时。 */
    reset() {
      match = createMatch({
        difficulty: opts.difficulty,
        rankId: opts.rankId,
        challenge: opts.challenge === true,
        mode: opts.mode,
        level: opts.level,
      });
      roundLeftMs = 0;
      spentMs = 0;
      gapLeftMs = 0;
      endDelayMs = 0;
      finished = false;
      hitIndex = -1;
      missIndex = -1;
      impulseLeftMs = 0;
      perfectLeftMs = 0;
      lastFired = 0;
      eventPopLeftMs = 0;
      tMs = 0;
      countdownSecond = match.phase === 'countdown' ? Math.ceil(match.countdownLeftMs / 1000) : 0;
      if (match.phase === 'countdown') audio.play('countdown');
      if (match.phase === 'playing') {
        match = nextRound(match, rand);
        refreshRound();
      }
    },
  };
}

module.exports = { createBattleScene };
