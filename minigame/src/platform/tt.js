'use strict';

/**
 * 抖音小游戏平台适配层（唯一接触 `tt` 全局的地方）
 *
 * 平台事实（《项目说明书》§5.4）：
 *   - 小游戏运行时**没有 DOM / window**，全局对象是 `GameGlobal`，宿主能力只有 `tt` 系列 API；
 *   - 绘图走 `tt.createCanvas()` + 2D context；帧驱动走全局 `requestAnimationFrame`；
 *   - 触摸事件为 `tt.onTouchStart / onTouchMove / onTouchEnd / onTouchCancel`；
 *   - 无 `tt` 环境（Node 单测）下，本模块全部返回安全降级值，保证 core 层逻辑可脱离平台单测。
 *
 * 约定：除本模块与 `platform/ad.js`、`platform/share.js` 外，任何代码**不得**直接引用 `tt`。
 */

/** 取全局对象：小游戏为 GameGlobal，Node 为 globalThis（`typeof` 判定保证不抛错）。 */
function globalScope() {
  if (typeof GameGlobal !== 'undefined' && GameGlobal) return GameGlobal;
  if (typeof globalThis !== 'undefined' && globalThis) return globalThis;
  return {};
}

/** 取 `tt` 命名空间；无则返回 null。 */
function getTt() {
  const g = globalScope();
  return g && g.tt ? g.tt : null;
}

/** 运行环境是否具备抖音小游戏宿主能力。 */
function isAvailable() {
  return getTt() !== null;
}

/**
 * 创建主画布并配置高分屏缩放。
 * 返回 null 表示无宿主能力（Node 单测）——调用方必须容忍。
 */
function createCanvas() {
  const tt = getTt();
  if (!tt || typeof tt.createCanvas !== 'function') return null;
  return tt.createCanvas();
}

/** 2D 上下文；拿到画布后一次性创建并复用（禁止每帧重建）。 */
function createContext(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  return canvas.getContext('2d');
}

/**
 * 屏幕信息。缺失时返回一个安全的默认值（375×667 / dpr 2），避免布局代码除零或 NaN。
 * 真机 defer 时字段：windowWidth / windowHeight / pixelRatio / safeArea（含 top/bottom）。
 */
function getSystemInfo() {
  const tt = getTt();
  let info = null;
  if (tt && typeof tt.getSystemInfoSync === 'function') {
    try {
      info = tt.getSystemInfoSync();
    } catch (err) {
      info = null;
    }
  }
  const width = (info && info.windowWidth) || 375;
  const height = (info && info.windowHeight) || 667;
  const dpr = (info && info.pixelRatio) || 2;
  const safeArea = (info && info.safeArea) || { top: 20, bottom: height, left: 0, right: width, height: height - 20, width };
  return {
    windowWidth: width,
    windowHeight: height,
    pixelRatio: dpr,
    safeArea,
    platform: (info && info.platform) || 'unknown',
  };
}

/** 触摸事件注册（统一绑到一次点击的归一化坐标）。 */
function onTouchStart(handler) {
  const tt = getTt();
  if (tt && typeof tt.onTouchStart === 'function') tt.onTouchStart(handler);
}
function onTouchMove(handler) {
  const tt = getTt();
  if (tt && typeof tt.onTouchMove === 'function') tt.onTouchMove(handler);
}
function onTouchEnd(handler) {
  const tt = getTt();
  if (tt && typeof tt.onTouchEnd === 'function') tt.onTouchEnd(handler);
}
function onTouchCancel(handler) {
  const tt = getTt();
  if (tt && typeof tt.onTouchCancel === 'function') tt.onTouchCancel(handler);
}

/** 帧驱动：优先宿主 rAF，回落 setTimeout（Node / 兜底），保证主循环永远能跑。 */
function requestFrame(callback) {
  const g = globalScope();
  if (typeof g.requestAnimationFrame === 'function') return g.requestAnimationFrame(callback);
  return setTimeout(() => callback(Date.now()), 16);
}

/** 高精度时间基准（毫秒）。 */
function now() {
  const g = globalScope();
  if (typeof g.performance !== 'undefined' && g.performance && typeof g.performance.now === 'function') {
    return g.performance.now();
  }
  return Date.now();
}

/** 本地存储（失败一律吞掉：存储不可用不应阻断对局）。 */
function setStorageSync(key, value) {
  const tt = getTt();
  if (!tt || typeof tt.setStorageSync !== 'function') return false;
  try {
    tt.setStorageSync(key, value);
    return true;
  } catch (err) {
    return false;
  }
}
function getStorageSync(key, fallback) {
  const tt = getTt();
  if (!tt || typeof tt.getStorageSync !== 'function') return fallback;
  try {
    const value = tt.getStorageSync(key);
    return value === '' || value === undefined || value === null ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

/** 轻震动反馈（§7.1；用户可在设置里关闭）。 */
function vibrateShort() {
  const tt = getTt();
  if (tt && typeof tt.vibrateShort === 'function') {
    try {
      tt.vibrateShort({});
    } catch (err) {
      /* 忽略：部分机型不支持 */
    }
  }
}

module.exports = {
  globalScope,
  getTt,
  isAvailable,
  createCanvas,
  createContext,
  getSystemInfo,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  requestFrame,
  now,
  setStorageSync,
  getStorageSync,
  vibrateShort,
};
