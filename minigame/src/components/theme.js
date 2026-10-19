'use strict';

/**
 * 布局与主题（《项目说明书》§2.1 界面分区 + §3.4 全局视觉规范）
 *
 * 三分区固定比例 **4 : 4 : 2**（顶部拔河视图 : 中部目标区 : 底部选色面板）。
 * 所有尺寸均以**逻辑像素**计算（画布按 devicePixelRatio 另行缩放），
 * 并显式扣除安全区（刘海屏顶部 / 全面屏底部 Home 条），保证 16:9 ~ 21:9 宽高比不错位。
 *
 * 目标分辨率基准：750×1334（§3.4），运行期按真机尺寸自适应。
 */

/** 主题色（§3.4：我方暖色 / 对方冷色，中性背景深灰蓝）。 */
const COLORS = {
  bg: '#0F1724',
  bgTop: '#13203A',
  ground: '#1B2A44',
  line: '#2B3D5C',
  text: '#EDF2FA',
  textDim: '#8FA3C0',
  our: '#FF6B35',
  opp: '#2FA8E1',
  win: '#4CD964',
  lose: '#FF4D4F',
  warn: '#FFC53D',
  knot: '#FFE8A3',
  white: '#FFFFFF',
};

/** 分区比例（§2.1）。 */
const SPLIT = { top: 0.4, mid: 0.4, bottom: 0.2 };

/** 最小可点击热区（§2.1：逻辑像素 ≥ 88×88，间距 ≥ 12）。 */
const MIN_TOUCH = 88;
const GAP = 12;

/**
 * 计算底部候选色网格（支持 4 / 6 / 9 个候选，§6.4）。
 * @param {{x:number,y:number,w:number,h:number}} area 底部面板区域
 * @param {number} count 候选色数量
 */
function paletteGrid(area, count) {
  const cols = count <= 4 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(count / cols));
  const padX = 16;
  const cellW = Math.floor((area.w - padX * 2 - GAP * (cols - 1)) / cols);
  const cellH = Math.floor((area.h - GAP * (rows - 1)) / rows);
  const cell = Math.max(MIN_TOUCH, Math.min(cellW, cellH));
  const gridW = cell * cols + GAP * (cols - 1);
  const gridH = cell * rows + GAP * (rows - 1);
  const x0 = Math.round(area.x + (area.w - gridW) / 2);
  const y0 = Math.round(area.y + (area.h - gridH) / 2);
  return {
    cols,
    rows,
    cell,
    gap: GAP,
    rect(index) {
      const r = Math.floor(index / cols);
      const c = index % cols;
      return { x: x0 + c * (cell + GAP), y: y0 + r * (cell + GAP), w: cell, h: cell };
    },
    contains(index, x, y) {
      const rc = this.rect(index);
      return x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h;
    },
  };
}

/**
 * 计算整屏布局。
 * @param {{windowWidth:number, windowHeight:number, safeArea?:object}} sysInfo 见 platform/tt.getSystemInfo
 */
function computeLayout(sysInfo) {
  const width = sysInfo.windowWidth;
  const height = sysInfo.windowHeight;
  const safeArea = sysInfo.safeArea || null;
  const safeTop = safeArea && typeof safeArea.top === 'number' ? safeArea.top : 20;
  const safeBottom = safeArea && typeof safeArea.bottom === 'number' ? Math.max(0, height - safeArea.bottom) : 0;

  const topH = Math.round(height * SPLIT.top);
  const midH = Math.round(height * SPLIT.mid);
  const botH = height - topH - midH;

  const top = { x: 0, y: 0, w: width, h: topH };
  const mid = { x: 0, y: topH, w: width, h: midH };
  const bottom = { x: 0, y: topH + midH, w: width, h: botH };

  // 绳子可用跨度：留出两侧小人站位，避免越线时绳子跑出屏幕
  const ropeMargin = 34;
  const maxPx = Math.min(220, Math.round((width - ropeMargin * 2) / 2) - 40);
  const ropeY = Math.round(top.y + top.h * 0.62);

  return {
    width,
    height,
    safeTop,
    safeBottom,
    top,
    mid,
    bottom,
    // 顶部拔河视图
    rope: {
      y: ropeY,
      cx: Math.round(width / 2),
      maxPx,
      leftAnchor: ropeMargin,
      rightAnchor: width - ropeMargin,
      barY: top.y + safeTop + 16,
      barW: Math.round((width - 48 - GAP) / 2),
      barH: 14,
    },
    // 中部目标区
    target: {
      size: Math.min(Math.round(width * 0.46), Math.round(mid.h * 0.5)),
      cx: Math.round(width / 2),
      cy: Math.round(mid.y + mid.h * 0.52),
      radius: 20,
    },
    // 底部候选面板
    bottomArea: {
      x: bottom.x + 8,
      y: bottom.y + 8,
      w: bottom.w - 16,
      h: bottom.h - 8 - safeBottom,
    },
  };
}

module.exports = { COLORS, SPLIT, MIN_TOUCH, GAP, paletteGrid, computeLayout };
