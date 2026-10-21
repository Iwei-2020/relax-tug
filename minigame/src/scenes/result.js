'use strict';

/**
 * 结算场景（《项目说明书》§4.3 结算页 + §5.1 激励广告）
 *
 * 元素：结果大字（渐变 + 白描边）、数据面板（命中/最高连击/命中率/时长/净能量差）、
 * 主按钮、次按钮、返回首页。
 *
 * 风格：马卡龙（与首页、对局页统一）—— 天空 + 同款氛围装饰打底，磨砂玻璃数据面板，
 * 主 CTA 与次按钮直接复用 components/decor.js 的 `drawCtaButton / drawPillButton`。
 *
 * 普通对战结算：提供「再来一局」与「返回首页」；
 * 体力耗尽时，重开回调负责请求体力补充广告。
 *
 * 闯关模式分支（§4.8）：不消耗每日体力，关内仍按 3 次机会判定失败——
 * 过关主 CTA 为「下一关」（末关为「已通关全部」，点击回首页），失败主 CTA 为「重试本关」，
 * 次 CTA 恒为「返回选关」，数据面板额外呈现「关卡 / 剩余机会」。
 *
 * 结算情绪设计（§4.3）：失败页给"差一点"的措辞，最大化重开率。
 */

const { HOME, MACARON } = require('../components/theme.js');
const decor = require('../components/decor.js');
const { roundRect } = require('../components/shape.js');
const { HIT_ENERGY, COMBO_BONUS_MAX, LEVEL_LIVES, LEVEL_MAX } = require('../config/config.js');
const { createRng } = require('../core/rng.js');
const { findEvent } = require('../core/events.js');
const { track } = require('../utils/tracker.js');
const audio = require('../platform/audio.js');

/** 结果动画时长（§4.3「撒花 / 破碎」）：到期后粒子自然隐去，不再绘制。 */
const BURST_MS = 1600;
/** 破碎时内容层抖动时长（仅失败页，天空与装饰不抖，避免露出边缘）。 */
const SHAKE_MS = 260;
/** 粒子渐隐时长（乘 BURST_MS 之后）。 */
const BURST_FADE_MS = 420;
/** Each result row uses a vivid macaron label and a darker matching value color. */
const RESULT_ROW_COLORS = [
  { label: '#E95E9D', value: '#B52F70' },
  { label: '#E9893E', value: '#A95719' },
  { label: '#438FDC', value: '#285F9B' },
  { label: '#31AA8B', value: '#176F5E' },
  { label: '#9167D4', value: '#5F3D9A' },
  { label: '#E25B73', value: '#A9364E' },
  { label: '#249DB6', value: '#176A7C' },
  { label: '#C18428', value: '#81530F' },
];

/** "差一点"文案：按净能量差给不同措辞（§4.3）。阈值按能量尺度派生，避免阈值重标定后永远落到最后一档。 */
function almostText(summary) {
  const gap = Math.abs(summary.netEnergy || 0);
  const unit = HIT_ENERGY + COMBO_BONUS_MAX; // 18 = 单段命中的最高能量（基础 + 满连击）
  if (gap <= unit) return '就差 1 次命中！';
  if (gap <= unit * 3) return '再快一点就翻盘了';
  return '差得不多，再来一局找回场子';
}

/**
 * 结算页几何。`rowCount` 控制数据行数（普通对战 6 行、闯关模式 8 行）——
 * 行数变化时同步收紧行高与上移面板，避免压到主 CTA。
 */
function computeResultLayout(layout, rowCount) {
  const W = layout.width;
  const H = layout.height;
  const cx = Math.round(W / 2);

  const rows = rowCount || 6;
  const panelW = Math.round(Math.min(W * 0.836, 340));
  const rowH = Math.round(H * (rows > 6 ? 0.035 : 0.043));
  const padH = Math.round(H * 0.024);
  const panel = {
    x: Math.round(cx - panelW / 2),
    y: Math.round(H * (rows > 6 ? 0.31 : 0.32)),
    w: panelW,
    h: rows * rowH + padH * 2,
    r: Math.round(W * 0.051),
  };

  const mainH = Math.round(H * 0.09);
  const mainW = Math.round(W * 0.72);
  const main = { x: Math.round(cx - mainW / 2), y: Math.round(H * 0.66), w: mainW, h: mainH };

  const secH = Math.round(H * 0.07);
  const secW = Math.round(W * 0.62);
  const secondary = { x: Math.round(cx - secW / 2), y: main.y + mainH + Math.round(H * 0.025), w: secW, h: secH };

  const homeW = Math.round(W * 0.62);
  const homeH = Math.round(H * 0.068);
  const homeY = rows > 6 ? Math.round(H * 0.89) : Math.round(H * 0.82);
  const home = { x: Math.round(cx - homeW / 2), y: homeY, w: homeW, h: homeH };

  return {
    W,
    H,
    cx,
    rowH,
    panel,
    main,
    secondary,
    home,
    titleY: Math.round(H * 0.148),
    titleFont: Math.round(Math.min(W * 0.14, 56)),
    subY: Math.round(H * 0.232),
    subFont: Math.round(Math.min(W * 0.048, 20)),
    rowFont: Math.round(Math.min(W * 0.046, 19)),
    ctaFont: Math.round(Math.min(W * 0.098, 38)),
    pillFont: Math.round(Math.min(W * 0.052, 22)),
  };
}

/** 结果标题渐变（按结果档缓存，避免每帧新建）。 */
function titleGradient(ctx, cache, colors, centerY, fontPx) {
  const key = `title_${colors[0]}`;
  if (!cache[key]) {
    const g = ctx.createLinearGradient(0, centerY - fontPx * 0.62, 0, centerY + fontPx * 0.62);
    g.addColorStop(0, colors[0]);
    g.addColorStop(1, colors[1]);
    cache[key] = g;
  }
  return cache[key];
}

function hit(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** 命中扩展：把视觉矩形扩到最小 88×88（仅用于触摸判定，§2.1）。 */
function touchRect(rect) {
  const w = Math.max(rect.w, 88);
  const h = Math.max(rect.h, 88);
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

function targetAt(x, y, layout, hitMain, hitSecondary, hitHome) {
  const targets = [
    { id: 'main', hitRect: hitMain, rect: layout.main },
    { id: 'home', hitRect: hitHome, rect: layout.home },
  ];
  if (hitSecondary) targets.splice(1, 0, { id: 'secondary', hitRect: hitSecondary, rect: layout.secondary });
  let picked = null;
  let closestDistance = Infinity;
  for (const target of targets) {
    if (!hit(target.hitRect, x, y)) continue;
    const dx = x - (target.rect.x + target.rect.w / 2);
    const dy = y - (target.rect.y + target.rect.h / 2);
    const distance = dx * dx + dy * dy;
    if (distance < closestDistance) {
      picked = target.id;
      closestDistance = distance;
    }
  }
  return picked;
}

/**
 * 胜利「撒花」粒子（§4.3）：糖果彩纸自屏幕上方飘落，边落边旋转。
 * 粒子在场景创建时一次性生成（固定种子，确定性），运行期只做原地积分，符合 §5.4「帧内不新建对象」。
 */
function makeConfettiBurst(rng, L) {
  const out = [];
  const colors = HOME.confetti;
  const n = 28 + Math.floor(rng() * 3); // 28 ~ 30 片
  for (let i = 0; i < n; i += 1) {
    const w = L.W * (0.016 + rng() * 0.016);
    out.push({
      x: rng() * L.W,
      y: -L.H * (0.02 + rng() * 0.22), // 从屏幕上方入场
      vx: (rng() - 0.5) * 130, // px/s
      vy: 110 + rng() * 160,
      g: 240 + rng() * 140, // px/s²
      rot: rng() * Math.PI * 2,
      vr: (rng() - 0.5) * 12, // rad/s
      w,
      h: w * (0.55 + rng() * 0.5),
      color: colors[i % colors.length],
    });
  }
  return out;
}

/**
 * 失败「破碎」粒子（§4.3）：冷灰蓝细长碎片自标题中心向外飞散，受重力下坠。
 */
function makeShardBurst(rng, L) {
  const out = [];
  const colors = ['#8FD6F8', '#B9C8DC', '#5E7AA8', '#2F9FDC', '#A8B4C8'];
  const cx = L.cx;
  const cy = L.titleY;
  const n = 16 + Math.floor(rng() * 3); // 16 ~ 18 片
  for (let i = 0; i < n; i += 1) {
    const ang = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const sp = 240 + rng() * 320; // px/s
    const w = L.W * (0.007 + rng() * 0.011);
    out.push({
      x: cx + Math.cos(ang) * L.W * 0.04,
      y: cy + Math.sin(ang) * L.W * 0.04,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 60,
      g: 900 + rng() * 320,
      rot: ang,
      vr: (rng() - 0.5) * 16,
      w,
      h: w * (2.6 + rng() * 2),
      color: colors[i % colors.length],
    });
  }
  return out;
}

/**
 * @param {object} options
 * @param {object} options.layout 见 theme.computeLayout
 * @param {object} options.summary 见 core/battle.summary
 * @param {(setHint:(message:string)=>void) => void} options.onReplay 再来一局（普通对战）
 * @param {() => void} [options.onLevelNext] 闯关过关 → 下一关（§4.8）
 * @param {() => void} [options.onLevelRetry] 闯关失败 → 重试本关（§4.8）
 * @param {() => void} [options.onLevels] 闯关 → 返回选关页（§4.8）
 * @param {() => void} options.onHome 返回首页
 */
function createResultScene(options) {
  const opts = options || {};
  const layout = opts.layout;
  const summary = opts.summary || {};
  const isLevel = summary.mode === 'level'; // §4.8 闯关模式：主 CTA 为「下一关 / 重试本关」
  const L = computeResultLayout(layout, isLevel ? 8 : 6);
  const cache = {};
  const hitMain = touchRect(L.main);
  const hitSecondary = isLevel ? touchRect(L.secondary) : null;
  const hitHome = touchRect(L.home);

  const isLose = summary.result === 'lose';
  const isWin = summary.result === 'win';
  audio.play(isWin ? 'win' : summary.result === 'draw' ? 'draw' : 'lose');
  const isFinalLevel = isLevel && (summary.level || 0) >= LEVEL_MAX; // 末关（第 100 关）过关 → 全部通关
  const title = isWin
    ? isLevel
      ? isFinalLevel
        ? '全部通关'
        : '过关'
      : '胜利'
    : summary.result === 'draw'
      ? '平局'
      : isLevel
        ? '闯关失败'
        : '失败';
  const titleColors = isWin ? MACARON.resultWin : summary.result === 'draw' ? MACARON.resultDraw : MACARON.resultLose;
  const subText = isLose
    ? isLevel
      ? '能量未达到 100%，再试一次'
      : almostText(summary)
    : summary.result === 'draw'
      ? '势均力敌，再来一局决胜'
      : '漂亮，保持这个手感';

  // 随机事件标记（§6.5）：本局触发过则展示金色胶囊（次数 + 事件名序列）。
  // 文本在场景创建时算一次，避免帧内新建字符串/数组（§5.4）。
  const eventIds = Array.isArray(summary.eventIds) ? summary.eventIds : [];
  const eventNames = eventIds
    .map((id) => {
      const ev = findEvent(id);
      return ev ? ev.name : '';
    })
    .filter(Boolean);
  const eventLabel =
    (summary.eventsFired || 0) > 0 && eventNames.length > 0
      ? `随机事件 ×${summary.eventsFired} · ${eventNames.join(' / ')}`
      : '';

  // 数据面板行（§4.3；闯关模式额外呈现「关卡 / 剩余机会」）。
  // 在场景创建时算一次，避免帧内新建数组 / 字符串（§5.4）。
  const dataRows = isLevel
    ? [
        ['关卡', `第 ${summary.level || 1} 关`],
        ['剩余机会', `${summary.livesLeft || 0} / ${LEVEL_LIVES}`],
        ['命中次数', String(summary.hits || 0)],
        ['完美判定', String(summary.perfectHits || 0)],
        ['最高连击', String(summary.bestCombo || 0)],
        ['命中率', `${Math.round((summary.accuracy || 0) * 100)}%`],
        ['对局时长', `${((summary.durationMs || 0) / 1000).toFixed(1)}s`],
        ['能量进度', `${summary.energyPct || 0}%`],
      ]
    : [
        ['命中次数', String(summary.hits || 0)],
        ['完美判定', String(summary.perfectHits || 0)],
        ['最高连击', String(summary.bestCombo || 0)],
        ['命中率', `${Math.round((summary.accuracy || 0) * 100)}%`],
        ['对局时长', `${((summary.durationMs || 0) / 1000).toFixed(1)}s`],
        ['净能量差', String(summary.netEnergy || 0)],
      ];

  let pressed = null;
  let hintText = '';
  let tMs = 0;

  // 结果动画（§4.3）：胜利撒花、失败破碎。粒子只生成一次（固定种子，确定性），
  // 运行期只做原地积分，不在帧内新建对象（§5.4）。平局不加爆点。
  const burst = isWin
    ? makeConfettiBurst(createRng(0x9e3779b1), L)
    : isLose
      ? makeShardBurst(createRng(0x85ebca6b), L)
      : [];
  let burstLeftMs = burst.length > 0 ? BURST_MS : 0;
  let shakeLeftMs = isLose ? SHAKE_MS : 0;

  function replay() {
    audio.play('tap');
    track('replay_click', { result: summary.result });
    if (typeof opts.onReplay === 'function') opts.onReplay((message) => { hintText = message || ''; });
  }

  return {
    name: 'result',

    update(dt) {
      const step = Math.max(0, Math.min(64, dt || 0)); // 夹住长帧，避免切后台回来粒子一次跳过整段动画
      tMs += step; // 氛围装饰的待机动画时间轴

      if (shakeLeftMs > 0) shakeLeftMs -= step;

      if (burstLeftMs > 0) {
        const s = step / 1000;
        for (let i = 0; i < burst.length; i += 1) {
          const p = burst[i];
          p.vy += p.g * s;
          p.x += p.vx * s;
          p.y += p.vy * s;
          p.rot += p.vr * s;
        }
        burstLeftMs -= step;
      }
    },

    draw(ctx) {
      decor.drawSky(ctx, layout, cache);
      decor.drawDecor(ctx, layout, tMs);

      // 失败页「破碎」：内容层（标题/面板/按钮）轻微抖动；天空与装饰不抖，避免边缘露底
      const shaking = shakeLeftMs > 0;
      if (shaking) {
        const k = shakeLeftMs / SHAKE_MS; // 1 → 0，抖动幅度衰减
        ctx.save();
        ctx.translate(Math.sin(shakeLeftMs * 0.062) * 6 * k, Math.cos(shakeLeftMs * 0.078) * 4.5 * k);
      }

      decor.drawOutlinedText(ctx, title, L.cx, L.titleY, {
        font: `bold ${L.titleFont}px sans-serif`,
        fill: titleGradient(ctx, cache, titleColors, L.titleY, L.titleFont),
        outline: HOME.titleOutline,
        outlineWidth: Math.max(6, Math.round(L.titleFont * 0.16)),
        glow: 'rgba(46,102,180,0.32)',
        glowBlur: 16,
        glowOffsetY: 4,
      });
      decor.drawOutlinedText(ctx, subText, L.cx, L.subY, {
        font: `bold ${L.subFont}px sans-serif`,
        fill: MACARON.ink,
        glow: 'rgba(255,255,255,0.85)',
        glowBlur: 8,
        glowOffsetY: 1,
      });

      // 随机事件标记（§6.5）：本局触发过则以金色胶囊展示在数据面板上方
      if (eventLabel) {
        const bh = 26;
        const bw = Math.min(Math.round(L.W * 0.82), 300);
        const bx = L.cx - bw / 2;
        const by = Math.round(L.subY + L.subFont * 0.9);
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        roundRect(ctx, bx, by, bw, bh, bh / 2);
        ctx.fill();
        ctx.strokeStyle = HOME.gold;
        ctx.lineWidth = 3;
        roundRect(ctx, bx + 2, by + 2, bw - 4, bh - 4, bh / 2 - 2);
        ctx.stroke();
        decor.drawOutlinedText(ctx, eventLabel, L.cx, by + bh / 2, {
          font: 'bold 13px sans-serif',
          fill: MACARON.ink,
        });
      }

      // 数据面板（§4.3）
      const rows = dataRows;
      decor.drawGlassPanel(ctx, L.panel);
      const rowX = L.panel.x + Math.round(L.panel.w * 0.06);
      const rowRight = L.panel.x + L.panel.w - Math.round(L.panel.w * 0.06);
      for (let i = 0; i < rows.length; i += 1) {
        const y = L.panel.y + L.panel.h * 0.1 + i * L.rowH + L.rowH / 2;
        ctx.font = `${L.rowFont}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = RESULT_ROW_COLORS[i % RESULT_ROW_COLORS.length].label;
        ctx.fillText(rows[i][0], rowX, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = RESULT_ROW_COLORS[i % RESULT_ROW_COLORS.length].value;
        ctx.font = `bold ${L.rowFont}px sans-serif`;
        ctx.fillText(rows[i][1], rowRight, y);
        if (i < rows.length - 1) {
          ctx.strokeStyle = 'rgba(255,255,255,0.65)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(rowX, y + L.rowH / 2);
          ctx.lineTo(rowRight, y + L.rowH / 2);
          ctx.stroke();
        }
      }

      // 普通对战统一重开；闯关模式按关卡结果继续或重试。
      const mainLabel = isLevel
        ? isWin
          ? isFinalLevel
            ? '已通关全部'
            : '下一关'
          : '重试本关'
        : '再来一局';
      decor.drawCtaButton(ctx, L.main, {
        label: mainLabel,
        font: `bold ${L.ctaFont}px sans-serif`,
        pressed: pressed === 'main',
        cache,
      });

      if (isLevel) {
        decor.drawPillButton(ctx, L.secondary, {
          label: '返回选关',
          font: `bold ${L.pillFont}px sans-serif`,
          border: HOME.mint,
          glow: HOME.mintGlow,
          fill: HOME.mintFill,
          pressed: pressed === 'secondary',
        });
      }

      // 返回首页：复用首页 CTA 视觉语言。
      decor.drawCtaButton(ctx, L.home, {
        label: '返回首页',
        font: `bold ${L.pillFont}px sans-serif`,
        ring: false,
        gradient: HOME.challengeCta,
        pressed: pressed === 'home',
        cache,
      });

      if (hintText) {
        const hintY = isLevel
          ? L.secondary.y + L.secondary.h + Math.round(L.H * 0.028)
          : L.main.y + L.main.h + Math.round(L.H * 0.024);
        decor.drawOutlinedText(ctx, hintText, L.cx, hintY, {
          font: 'bold 15px sans-serif',
          fill: MACARON.warn,
          outline: '#FFFFFF',
          outlineWidth: 4,
        });
      }

      // 结果动画粒子（§4.3）：压在内容之上，末段渐隐；与内容层一起参与抖动，观感一致
      if (burstLeftMs > 0) {
        const alpha = burstLeftMs < BURST_FADE_MS ? burstLeftMs / BURST_FADE_MS : 1;
        for (let i = 0; i < burst.length; i += 1) {
          const p = burst[i];
          decor.drawConfetti(ctx, p.x, p.y, p.w, p.h, p.rot, p.color, alpha);
        }
      }

      if (shaking) ctx.restore();
    },

    onTouchStart(x, y) {
      const target = targetAt(x, y, L, hitMain, hitSecondary, hitHome);
      pressed = target === 'main' || target === 'secondary' || target === 'home' ? target : null;
    },

    onTouchEnd(x, y) {
      const target = targetAt(x, y, L, hitMain, hitSecondary, hitHome);
      pressed = null;

      if (target === 'main') {
        if (isLevel) {
          audio.play('tap');
          // §4.8 闯关模式：过关进下一关（末关回首页），失败重试本关
          if (isWin) {
            if (isFinalLevel) {
              if (typeof opts.onHome === 'function') opts.onHome();
            } else if (typeof opts.onLevelNext === 'function') opts.onLevelNext();
          } else if (typeof opts.onLevelRetry === 'function') opts.onLevelRetry();
        } else replay();
        return;
      }
      if (target === 'secondary') {
        audio.play('tap');
        if (typeof opts.onLevels === 'function') opts.onLevels();
        return;
      }
      if (target === 'home') {
        audio.play('tap');
        if (typeof opts.onHome === 'function') opts.onHome();
      }
    },
  };
}

module.exports = { createResultScene, computeResultLayout };
