'use strict';

/**
 * 关卡选择页（《项目说明书》§4.8 闯关模式 1–100 关）
 *
 * 规则（§4.8 硬口径）：
 *   · 玩家必须**一关接着一关**闯：唯一免费关是「已通关的最大关 + 1」（`levels.freeLevel`）；
 *   · 其它关每次点选都要看一次激励视频（`AD_UNITS.levelSkip`）——**不永久解锁**；
 *   · 全部 100 关通关后无免费关，任意关可自由复盘（不再需要广告）。
 *
 * 交互：工程无滚动基建，故用**分页**（每页 4×5 = 20 关，共 5 页）。
 * 三态由 `levels.max` 派生：`≤ max` 已通关（打勾）/ `=== max+1` 可挑战（金色高亮呼吸）/ `> max+1` 锁定（挂锁）。
 * 是否需要广告由 boot 判定（本场景只上报 `onPick(level)`），保证广告逻辑集中在装配层。
 *
 * 性能约定（§5.4）：关卡进度只在**进入与翻页时**读取，不在每帧重算；渐变缓存在首帧建一次。
 * 热区按最小 88×88 逻辑像素做命中扩展（§2.1）。
 */

const { HOME, MACARON, MIN_TOUCH } = require('../components/theme.js');
const decor = require('../components/decor.js');
const { roundRect } = require('../components/shape.js');
const audio = require('../platform/audio.js');

const COLS = 4;
const ROWS = 5;
const PER_PAGE = COLS * ROWS; // 每页 20 关

function computeLevelsLayout(layout) {
  const W = layout.width;
  const H = layout.height;
  const cx = Math.round(W / 2);

  const gridTop = Math.round(H * 0.215);
  const navH = Math.round(Math.min(H * 0.052, 36));
  const backH = Math.round(H * 0.058);
  const areaH = Math.round(H * 0.9) - backH - navH - Math.round(H * 0.03) - gridTop;

  const gap = Math.round(W * 0.026);
  const areaW = Math.min(Math.round(W * 0.88), 360);
  const cellW = Math.floor((areaW - gap * (COLS - 1)) / COLS);
  const cellH = Math.floor((areaH - gap * (ROWS - 1)) / ROWS);
  const cell = Math.max(40, Math.min(cellW, cellH));
  const gridW = cell * COLS + gap * (COLS - 1);
  const gridH = cell * ROWS + gap * (ROWS - 1);
  const x0 = Math.round(cx - gridW / 2);
  const y0 = gridTop;

  const navW = Math.round(Math.min(W * 0.24, 92));
  const navY = y0 + gridH + Math.round(gap * 1.6);
  const prev = { x: x0, y: navY, w: navW, h: navH };
  const next = { x: x0 + gridW - navW, y: navY, w: navW, h: navH };

  const backW = Math.round(Math.min(W * 0.34, 140));
  const back = { x: Math.round(cx - backW / 2), y: Math.round(H * 0.9), w: backW, h: backH };

  return {
    W,
    H,
    cx,
    cell,
    gap,
    x0,
    y0,
    gridW,
    gridH,
    prev,
    next,
    back,
    dotY: navY + navH / 2,
    dotR: Math.max(4, Math.round(W * 0.012)),
    dotGap: Math.round(W * 0.05),
    titleY: Math.round(H * 0.108),
    titleFont: Math.round(Math.min(W * 0.105, 40)),
    subY: Math.round(H * 0.172),
    subFont: Math.round(Math.min(W * 0.042, 16)),
    numFont: Math.round(Math.min(W * 0.062, 24)),
    navFont: Math.round(Math.min(W * 0.04, 15)),
    backFont: Math.round(Math.min(W * 0.036, 14)),
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

/** 瓦片矩形（页内索引 0–19）。 */
function tileRect(L, index) {
  const r = Math.floor(index / COLS);
  const c = index % COLS;
  return {
    x: L.x0 + c * (L.cell + L.gap),
    y: L.y0 + r * (L.cell + L.gap),
    w: L.cell,
    h: L.cell,
  };
}

/** 对勾（已通关瓦片右上角）。 */
function drawCheckMark(ctx, cx, cy, s) {
  ctx.save();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(2, s * 0.17);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.42, cy + s * 0.02);
  ctx.lineTo(cx - s * 0.12, cy + s * 0.34);
  ctx.lineTo(cx + s * 0.44, cy - s * 0.34);
  ctx.stroke();
  ctx.restore();
}

/** 挂锁（未解锁瓦片右上角）。 */
function drawLock(ctx, cx, cy, s) {
  ctx.save();
  ctx.strokeStyle = 'rgba(58,74,107,0.72)';
  ctx.lineWidth = Math.max(2, s * 0.14);
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.24, s * 0.28, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = 'rgba(58,74,107,0.72)';
  roundRect(ctx, cx - s * 0.4, cy - s * 0.08, s * 0.8, s * 0.6, s * 0.16);
  ctx.fill();
  ctx.restore();
}

/**
 * @param {object} options
 * @param {object} options.layout 见 theme.computeLayout
 * @param {() => {max:number}} options.getState 读取闯关进度（`levels.max`）
 * @param {(level:number) => void} options.onPick 选中某关（是否需看广告由 boot 判定）
 * @param {() => void} [options.onBack] 返回首页
 */
function createLevelsScene(options) {
  const opts = options || {};
  const layout = opts.layout;
  const L = computeLevelsLayout(layout);
  const cache = {}; // 渐变缓存（只在首帧创建一次）

  let state = typeof opts.getState === 'function' ? opts.getState() : { max: 0 };
  let page = Math.min(4, Math.floor(Math.max(0, (state.max || 0)) / PER_PAGE)); // 默认停在「当前可挑战关」所在页
  let pressed = null;
  let tMs = 0;

  /** 页内第 index 个瓦片对应的关卡号。 */
  function levelAt(index) {
    return page * PER_PAGE + index + 1;
  }

  /** 三态：'cleared' 已通关 / 'current' 可挑战 / 'locked' 未解锁（§4.8）。 */
  function stateOf(level) {
    const max = Math.max(0, Math.min(100, Math.floor(state.max || 0)));
    if (level <= max) return 'cleared';
    if (level === max + 1) return 'current';
    return 'locked';
  }

  function targetAt(x, y) {
    if (hit(touchRect(L.prev), x, y)) return 'prev';
    if (hit(touchRect(L.next), x, y)) return 'next';
    if (hit(touchRect(L.back), x, y)) return 'back';
    for (let i = 0; i < PER_PAGE; i += 1) {
      if (hit(touchRect(tileRect(L, i)), x, y)) return `tile:${i}`;
    }
    return null;
  }

  function refresh() {
    state = typeof opts.getState === 'function' ? opts.getState() : state;
  }

  function flip(delta) {
    page = Math.max(0, Math.min(4, page + delta));
  }

  return {
    name: 'levels',
    refresh,

    update(dt) {
      tMs += Math.max(0, dt || 0);
    },

    draw(ctx) {
      decor.drawSky(ctx, layout, cache);
      decor.drawDecor(ctx, layout, tMs);

      decor.drawOutlinedText(ctx, '闯关挑战', L.cx, L.titleY, {
        font: `bold ${L.titleFont}px sans-serif`,
        fill: HOME.titleTop,
        outline: HOME.titleOutline,
        outlineWidth: Math.max(5, Math.round(L.titleFont * 0.15)),
        glow: HOME.titleGlow,
        glowBlur: 14,
        glowOffsetY: 3,
      });
      const max = Math.max(0, Math.min(100, Math.floor(state.max || 0)));
      decor.drawOutlinedText(ctx, `已通关 ${max} / 100`, L.cx, L.subY, {
        font: `bold ${L.subFont}px sans-serif`,
        fill: MACARON.ink,
        glow: 'rgba(255,255,255,0.85)',
        glowBlur: 6,
        glowOffsetY: 1,
      });

      // 关卡瓦片（4×5）
      const breathe = 1 + 0.035 * Math.sin(tMs * 0.004);
      for (let i = 0; i < PER_PAGE; i += 1) {
        const level = levelAt(i);
        const rect = tileRect(L, i);
        const st = stateOf(level);
        const rr = rect.w * 0.22;
        ctx.save();

        if (st === 'current') {
          // 可挑战：金色高亮 + 轻微呼吸（引导玩家进入下一关）
          ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
          ctx.scale(breathe, breathe);
          ctx.translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
        }

        ctx.shadowColor = 'rgba(46,102,180,0.25)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = st === 'cleared' ? HOME.mint : st === 'current' ? HOME.gold : 'rgba(255,255,255,0.34)';
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rr);
        ctx.fill();
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        ctx.strokeStyle = st === 'locked' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2.5;
        roundRect(ctx, rect.x + 1.5, rect.y + 1.5, rect.w - 3, rect.h - 3, rr - 1.5);
        ctx.stroke();

        // 顶部高光（与 pill 按钮同一套质感）
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#FFFFFF';
        roundRect(ctx, rect.x + rect.w * 0.12, rect.y + rect.h * 0.1, rect.w * 0.76, rect.h * 0.26, rect.h * 0.13);
        ctx.fill();
        ctx.globalAlpha = 1;

        // 关卡号
        ctx.fillStyle = st === 'locked' ? MACARON.inkDim : '#FFFFFF';
        ctx.font = `bold ${L.numFont}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = st === 'locked' ? 'rgba(0,0,0,0)' : 'rgba(40,42,66,0.3)';
        ctx.shadowBlur = st === 'locked' ? 0 : 4;
        ctx.fillText(String(level), rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.shadowBlur = 0;

        // 角标：已通关打勾 / 未解锁挂锁
        if (st === 'cleared') drawCheckMark(ctx, rect.x + rect.w * 0.74, rect.y + rect.h * 0.24, rect.w * 0.3);
        else if (st === 'locked') drawLock(ctx, rect.x + rect.w * 0.75, rect.y + rect.h * 0.26, rect.w * 0.3);

        ctx.restore();
      }

      // 翻页（首页禁用态用文字，避免误触）
      if (page > 0) {
        decor.drawPillButton(ctx, L.prev, {
          label: '上一页',
          font: `bold ${L.navFont}px sans-serif`,
          border: HOME.mint,
          glow: HOME.mintGlow,
          fill: HOME.mintFill,
          pressed: pressed === 'prev',
        });
      } else {
        decor.drawOutlinedText(ctx, '上一页', L.prev.x + L.prev.w / 2, L.prev.y + L.prev.h / 2, {
          font: `bold ${L.navFont}px sans-serif`,
          fill: MACARON.inkDim,
          glow: 'rgba(255,255,255,0.7)',
          glowBlur: 4,
        });
      }
      if (page < 4) {
        decor.drawPillButton(ctx, L.next, {
          label: '下一页',
          font: `bold ${L.navFont}px sans-serif`,
          border: HOME.mint,
          glow: HOME.mintGlow,
          fill: HOME.mintFill,
          pressed: pressed === 'next',
        });
      } else {
        decor.drawOutlinedText(ctx, '下一页', L.next.x + L.next.w / 2, L.next.y + L.next.h / 2, {
          font: `bold ${L.navFont}px sans-serif`,
          fill: MACARON.inkDim,
          glow: 'rgba(255,255,255,0.7)',
          glowBlur: 4,
        });
      }

      // 页码圆点
      const dotsCx = L.cx;
      for (let i = 0; i < 5; i += 1) {
        const x = dotsCx + (i - 2) * L.dotGap;
        ctx.beginPath();
        if (i === page) {
          ctx.fillStyle = HOME.gold;
          ctx.arc(x, L.dotY, L.dotR, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(58,74,107,0.45)';
          ctx.lineWidth = 2;
          ctx.arc(x, L.dotY, L.dotR - 1, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 返回首页
      decor.drawPillButton(ctx, L.back, {
        label: '返回',
        font: `bold ${L.backFont}px sans-serif`,
        border: HOME.mint,
        glow: HOME.mintGlow,
        fill: HOME.mintFill,
        pressed: pressed === 'back',
      });
    },

    onTouchStart(x, y) {
      pressed = targetAt(x, y);
    },

    onTouchEnd(x, y) {
      const target = targetAt(x, y);
      pressed = null;
      if (!target) return;
      if (target === 'prev') {
        audio.play('tap');
        flip(-1);
        return;
      }
      if (target === 'next') {
        audio.play('tap');
        flip(1);
        return;
      }
      if (target === 'back') {
        audio.play('tap');
        if (typeof opts.onBack === 'function') opts.onBack();
        return;
      }
      // 瓦片：先刷新进度（服务端回执可能刚覆盖），再上报给 boot 判定是否需看广告
      audio.play('tap');
      refresh();
      const index = Number(target.slice('tile:'.length));
      if (typeof opts.onPick === 'function') opts.onPick(levelAt(index));
    },
  };
}

module.exports = { createLevelsScene, computeLevelsLayout };
