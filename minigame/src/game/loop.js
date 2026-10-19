'use strict';

/**
 * 主循环与场景管理（《项目说明书》§5.4「稳定 60 FPS / 低端机 ≥30 FPS」）
 *
 * 职责：
 *   1) 设备像素比换算（高清屏下 canvas 尺寸 ×dpr，绘图仍用逻辑像素，避免模糊）；
 *   2) requestAnimationFrame 帧驱动 + dt 计算（长帧由各场景自行夹取，避免切后台回来一次结算多轮）；
 *   3) 场景切换（setScene）与触摸分发（onTouchStart / onTouchEnd 归一化为逻辑坐标）；
 *   4) 埋点批量上报（尽力而为，失败不影响对局）。
 *
 * 性能约定：帧内**不得新建对象/数组**，不得每帧重建 canvas 或 context（§5.4）。
 */

const ttApi = require('../platform/tt.js');
const { flush } = require('../utils/tracker.js');
const cloud = require('../net/cloud.js');
const { MACARON } = require('../components/theme.js');

const TRACKER_FLUSH_EVERY = 120; // 约 2 秒（60FPS）上报一次

/**
 * @param {object} options
 * @param {object} options.canvas 由 platform/tt.createCanvas 创建
 * @param {object} options.ctx 2D context
 * @param {object} options.layout 见 components/theme.computeLayout
 * @param {{pixelRatio?:number}} [options.sysInfo]
 */
function createGame(options) {
  const opts = options || {};
  const layout = opts.layout;
  const canvas = opts.canvas;
  const ctx = opts.ctx;
  const dpr = (opts.sysInfo && opts.sysInfo.pixelRatio) || 1;

  let scene = null;
  let lastTs = 0;
  let frameCount = 0;
  let running = false;

  // 高清屏缩放：画布物理尺寸放大，绘图坐标仍为逻辑像素
  if (canvas && ctx) {
    canvas.width = Math.round(layout.width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    else if (typeof ctx.scale === 'function') ctx.scale(dpr, dpr);
  }

  /** 埋点批量上报：尽力而为，失败不影响对局 */
  function flushTracker() {
    flush((batch) => cloud.reportEvents(batch));
  }

  function frame(ts) {
    if (!running) return;
    const dt = lastTs === 0 ? 16 : ts - lastTs;
    lastTs = ts;

    if (scene && typeof scene.update === 'function') scene.update(dt);

    if (ctx) {
      ctx.fillStyle = MACARON.skyBottom; // 浅色兜底底，避免任何漏画区域闪深色
      ctx.fillRect(0, 0, layout.width, layout.height);
      if (scene && typeof scene.draw === 'function') scene.draw(ctx);
    }

    frameCount += 1;
    if (frameCount % TRACKER_FLUSH_EVERY === 0) flushTracker();

    ttApi.requestFrame(frame);
  }

  /** 首屏触摸坐标取自 tt 事件的 clientX/clientY（已是逻辑像素，画布铺满屏幕） */
  function touchPoint(event) {
    const t = event && event.touches && event.touches[0];
    if (!t) return null;
    const x = typeof t.clientX === 'number' ? t.clientX : t.x;
    const y = typeof t.clientY === 'number' ? t.clientY : t.y;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    return { x, y };
  }

  return {
    layout,
    ctx,
    canvas,

    setScene(next) {
      scene = next;
    },
    currentScene() {
      return scene;
    },

    start() {
      if (running) return;
      running = true;
      lastTs = 0;
      ttApi.requestFrame(frame);
    },

    stop() {
      running = false;
    },

    /** 注册触摸（在 boot 中调用一次；坐标系统一为逻辑像素）。 */
    bindInput() {
      ttApi.onTouchStart((event) => {
        const p = touchPoint(event);
        if (p && scene && typeof scene.onTouchStart === 'function') scene.onTouchStart(p.x, p.y);
      });
      ttApi.onTouchEnd((event) => {
        const p = touchPoint(event);
        if (p && scene && typeof scene.onTouchEnd === 'function') scene.onTouchEnd(p.x, p.y);
      });
    },
  };
}

module.exports = { createGame, TRACKER_FLUSH_EVERY };
