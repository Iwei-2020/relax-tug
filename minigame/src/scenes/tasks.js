'use strict';

/**
 * 每日任务面板（《项目说明书》§4.7 每日任务与宝箱）
 *
 * 视觉：与首页/结算页同一套马卡龙语言——天空 + 氛围装饰打底、磨砂玻璃面板、
 * 复用 components/decor.js 的 `drawGlassPanel / drawPillButton / drawOutlinedText`。
 *
 * 内容：4 条每日任务（名称 + 进度条 + 进度值 + 领取按钮）与底部「每日宝箱」；
 * 领奖一律交由 boot 的 onClaim / onChest（本地乐观 + 服务端权威对账，§4.7）。
 *
 * 性能约定（§5.4）：任务状态只在**进入面板与操作后**读取缓存，不在每帧重算数组；
 * 触控热区按最小 88×88 逻辑像素做命中扩展（§2.1）。
 */

const { HOME, MACARON, MIN_TOUCH } = require('../components/theme.js');
const decor = require('../components/decor.js');
const { roundRect } = require('../components/shape.js');

function computeTasksLayout(layout, count) {
  const W = layout.width;
  const H = layout.height;
  const cx = Math.round(W / 2);

  const panelW = Math.round(Math.min(W * 0.88, 340));
  const rowH = Math.round(H * 0.082);
  const padY = Math.round(H * 0.02);
  const panel = {
    x: Math.round(cx - panelW / 2),
    y: Math.round(H * 0.215),
    w: panelW,
    h: count * rowH + padY * 2,
    r: Math.round(W * 0.048),
  };

  const buttonW = Math.round(Math.min(W * 0.22, 76));
  const buttonH = Math.round(Math.min(H * 0.05, 34));

  const chestH = Math.round(H * 0.068);
  const chestW = Math.round(Math.min(W * 0.72, 280));
  const chest = {
    x: Math.round(cx - chestW / 2),
    y: panel.y + panel.h + Math.round(H * 0.035),
    w: chestW,
    h: chestH,
  };

  const backW = Math.round(Math.min(W * 0.34, 140));
  const backH = Math.round(H * 0.058);
  const back = { x: Math.round(cx - backW / 2), y: Math.round(H * 0.885), w: backW, h: backH };

  return {
    W,
    H,
    cx,
    panel,
    rowH,
    padY,
    buttonW,
    buttonH,
    chest,
    back,
    titleY: Math.round(H * 0.115),
    titleFont: Math.round(Math.min(W * 0.11, 42)),
    subY: Math.round(H * 0.168),
    subFont: Math.round(Math.min(W * 0.04, 15)),
    rowFont: Math.round(Math.min(W * 0.042, 16)),
    smallFont: Math.round(Math.min(W * 0.036, 14)),
    chestFont: Math.round(Math.min(W * 0.044, 17)),
  };
}

/** 命中扩展：把视觉矩形扩到最小 88×88（仅用于触摸判定）。 */
function touchRect(rect) {
  const w = Math.max(rect.w, MIN_TOUCH);
  const h = Math.max(rect.h, MIN_TOUCH);
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

function hit(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * @param {object} options
 * @param {object} options.layout 见 theme.computeLayout
 * @param {() => {tasks:object[], chest:object, coins:number}} options.getState 读取当前任务状态
 * @param {(taskId:string) => void} [options.onClaim] 领取单条任务
 * @param {() => void} [options.onChest] 领取宝箱
 * @param {() => void} [options.onBack] 返回首页
 */
function createTasksScene(options) {
  const opts = options || {};
  const layout = opts.layout;
  const state0 = typeof opts.getState === 'function' ? opts.getState() : { tasks: [], chest: {} };
  const L = computeTasksLayout(layout, Math.max(1, (state0.tasks || []).length));
  const cache = {}; // 渐变缓存（只在首帧创建一次）
  let state = state0;
  let pressed = null;
  let tMs = 0;
  let hintText = '';

  /** 每个任务的领取按钮矩形（按行布局推导）。 */
  function claimRectAt(index) {
    const rowY = L.panel.y + L.padY + index * L.rowH;
    const right = L.panel.x + L.panel.w - Math.round(L.panel.w * 0.04);
    return {
      x: right - L.buttonW,
      y: rowY + Math.round((L.rowH - L.buttonH) / 2),
      w: L.buttonW,
      h: L.buttonH,
    };
  }

  /** 命中目标：任务行按钮（`task:<id>`）/ 宝箱 / 返回。 */
  function targetAt(x, y) {
    const tasks = state.tasks || [];
    for (let i = 0; i < tasks.length; i += 1) {
      if (hit(touchRect(claimRectAt(i)), x, y)) return `task:${tasks[i].id}`;
    }
    if (hit(touchRect(L.chest), x, y)) return 'chest';
    if (hit(touchRect(L.back), x, y)) return 'back';
    return null;
  }

  function refresh() {
    state = typeof opts.getState === 'function' ? opts.getState() : state;
  }

  return {
    name: 'tasks',
    refresh,

    update(dt) {
      tMs += Math.max(0, dt || 0);
    },

    draw(ctx) {
      decor.drawSky(ctx, layout, cache);
      decor.drawDecor(ctx, layout, tMs);

      decor.drawOutlinedText(ctx, '每日任务', L.cx, L.titleY, {
        font: `bold ${L.titleFont}px sans-serif`,
        fill: HOME.titleTop,
        outline: HOME.titleOutline,
        outlineWidth: Math.max(5, Math.round(L.titleFont * 0.15)),
        glow: HOME.titleGlow,
        glowBlur: 14,
        glowOffsetY: 3,
      });

      const tasks = state.tasks || [];
      const chest = state.chest || {};
      decor.drawOutlinedText(ctx, `自然日（UTC+8）刷新 · 金币 ${state.coins || 0}`, L.cx, L.subY, {
        font: `bold ${L.subFont}px sans-serif`,
        fill: MACARON.ink,
        glow: 'rgba(255,255,255,0.85)',
        glowBlur: 6,
        glowOffsetY: 1,
      });

      decor.drawGlassPanel(ctx, L.panel);
      const rowX = L.panel.x + Math.round(L.panel.w * 0.05);
      const rowRight = L.panel.x + L.panel.w - Math.round(L.panel.w * 0.04);
      const textW = rowRight - L.buttonW - 12 - rowX;

      for (let i = 0; i < tasks.length; i += 1) {
        const task = tasks[i];
        const rowY = L.panel.y + L.padY + i * L.rowH;

        // 名称 + 进度值
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = MACARON.ink;
        ctx.font = `bold ${L.rowFont}px sans-serif`;
        ctx.fillText(task.name, rowX, rowY + L.rowH * 0.32);
        ctx.textAlign = 'right';
        ctx.fillStyle = task.done ? MACARON.win : MACARON.inkDim;
        ctx.fillText(`${task.progress}/${task.goal}`, rowX + textW, rowY + L.rowH * 0.32);

        // 进度条
        const barY = rowY + L.rowH * 0.62;
        const barH = 9;
        const ratio = task.goal > 0 ? Math.max(0, Math.min(1, task.progress / task.goal)) : 0;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        roundRect(ctx, rowX, barY, textW, barH, barH / 2);
        ctx.fill();
        if (ratio > 0) {
          ctx.fillStyle = task.done ? HOME.mint : HOME.gold;
          roundRect(ctx, rowX, barY, Math.max(barH, textW * ratio), barH, barH / 2);
          ctx.fill();
        }

        // 领取按钮（可领 = 金色可点；其余为状态文字）
        const rect = claimRectAt(i);
        if (task.claimable) {
          decor.drawPillButton(ctx, rect, {
            label: `+${task.coins}`,
            font: `bold ${L.smallFont}px sans-serif`,
            border: HOME.gold,
            glow: HOME.goldGlow,
            fill: HOME.goldFill,
            pressed: pressed === `task:${task.id}`,
          });
        } else {
          decor.drawOutlinedText(ctx, task.claimed ? '已领' : '进行中', rect.x + rect.w / 2, rect.y + rect.h / 2, {
            font: `bold ${L.smallFont}px sans-serif`,
            fill: task.claimed ? MACARON.win : MACARON.inkDim,
            glow: 'rgba(255,255,255,0.8)',
            glowBlur: 4,
          });
        }
      }

      // 每日宝箱
      const chestLabel = chest.claimable
        ? `领取宝箱 +${chest.coins || 0}`
        : chest.claimed
          ? '宝箱已领'
          : `全部完成可领 +${chest.coins || 0}`;
      decor.drawPillButton(ctx, L.chest, {
        label: chestLabel,
        font: `bold ${L.chestFont}px sans-serif`,
        border: chest.claimable ? HOME.gold : HOME.violet,
        glow: chest.claimable ? HOME.goldGlow : HOME.violetGlow,
        fill: chest.claimed ? HOME.mintFill : chest.claimable ? HOME.goldFill : HOME.violetFill,
        pressed: pressed === 'chest',
      });

      // 返回
      decor.drawPillButton(ctx, L.back, {
        label: '返回',
        font: `bold ${L.smallFont}px sans-serif`,
        border: HOME.mint,
        glow: HOME.mintGlow,
        fill: HOME.mintFill,
        pressed: pressed === 'back',
      });

      if (hintText) {
        decor.drawOutlinedText(ctx, hintText, L.cx, L.chest.y + L.chest.h + Math.round(L.H * 0.03), {
          font: 'bold 14px sans-serif',
          fill: MACARON.warn,
          outline: '#FFFFFF',
          outlineWidth: 4,
        });
      }
    },

    onTouchStart(x, y) {
      pressed = targetAt(x, y);
    },

    onTouchEnd(x, y) {
      const target = targetAt(x, y);
      pressed = null;
      hintText = '';
      if (!target) return;
      if (target === 'back') {
        if (typeof opts.onBack === 'function') opts.onBack();
        return;
      }
      if (target === 'chest') {
        const chest = state.chest || {};
        if (!chest.claimable) {
          hintText = chest.claimed ? '今天的宝箱已经领过啦' : '先完成全部任务再来领宝箱';
          return;
        }
        if (typeof opts.onChest === 'function') opts.onChest();
        refresh();
        return;
      }
      const id = target.slice('task:'.length);
      const task = (state.tasks || []).find((t) => t.id === id);
      if (!task) return;
      if (!task.claimable) {
        hintText = task.claimed ? '这条已经领过啦' : '还没完成哦';
        return;
      }
      if (typeof opts.onClaim === 'function') opts.onClaim(id);
      refresh();
    },
  };
}

module.exports = { createTasksScene };
