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

const { SEQUENCE_LENGTH } = require('../config/config.js');

/**
 * 首页配色（对齐视觉稿：亮蓝天空 + 暖色高光 CTA + 彩色糖果点缀）。
 *
 * 与下方 MACARON 的分工：HOME 是「引流封面」，天空更深更艳，负责第一眼点击欲；
 * MACARON 是「对局 / 结算」的浅色版本，天空更淡、面板更透，承托玩法内容。
 * 两者同属一套糖果语言（同一批点缀色、同款绳圈与按钮原语），不要引入第三套色板。
 */
const HOME = {
  skyTop: '#5468F0',
  skyMid: '#4E96EE',
  skyLow: '#8CCBF7',
  skyBottom: '#D6EEFC',
  cloud: '#FFFFFF',

  // 标题：暖色渐变 + 白色粗描边 + 橙色外发光
  titleTop: '#FFE066',
  titleBottom: '#FF6E3C',
  titleOutline: '#FFFFFF',
  titleGlow: 'rgba(255,110,60,0.55)',
  subtitle: '#FFFFFF',

  // 磨砂玻璃卡片
  card: 'rgba(255,255,255,0.22)',
  cardBorder: 'rgba(255,255,255,0.62)',
  cardGlow: 'rgba(31,90,180,0.28)',

  // 主 CTA：粉 → 橙 → 琥珀，外套金色绳圈（呼应拔河绳）
  ctaFrom: '#FF6FB5',
  ctaMid: '#FF9E4A',
  ctaTo: '#FFD44F',
  ctaBrink: '#FFFFFF',
  ctaText: '#FFFFFF',
  ctaTextGlow: 'rgba(196,74,16,0.45)',
  ropeGold: '#F5B526',
  ropeGoldLight: '#FFE066',
  ropeWeave: 'rgba(206,132,18,0.55)',

  // 次级按钮：薄荷 / 紫罗兰描边玻璃
  mint: '#5CE1B0',
  mintGlow: 'rgba(92,225,176,0.55)',
  mintFill: 'rgba(255,255,255,0.38)',
  violet: '#B98CFF',
  violetGlow: 'rgba(185,140,255,0.55)',
  violetFill: 'rgba(150,110,255,0.42)',
  subText: '#FFFFFF',
  subTextGlow: 'rgba(24,58,122,0.55)',

  // 氛围点缀
  star: '#FFD84D',
  starGlow: 'rgba(255,216,77,0.85)',
  confetti: ['#FF7BD5', '#FFD84D', '#63D6FF', '#7CE7B0', '#B98CFF', '#FF9E4A'],
};

/**
 * 对局 / 结算页马卡龙配色（与首页 HOME 同一套糖果语言，统一观感）
 *
 * 与 HOME 的分工：HOME 是「引流封面」，用高饱和亮蓝天空营造点击欲；
 * 对局 / 结算用**同色相的浅色版本**承托玩法内容 —— 天空更淡、面板更透，
 * 保证 §3.2「目标色必须一眼可辨」不被背景干扰。
 *
 * 硬约束（§3.2 / §3.3）：玩法色块本身仍取 config.palette 的高饱和色，
 * **不参与马卡龙化**，仅靠白色厚描边 + 柔和投影与浅底拉开层次。
 */
const MACARON = {
  // 天空（对局页全屏底）
  skyTop: '#6FB4F2',
  skyMid: '#A6DCF7',
  skyLow: '#D8F0FD',
  skyBottom: '#F4FBFF',

  // 磨砂玻璃面板（三分区共用）
  panel: 'rgba(255,255,255,0.34)',
  panelStrong: 'rgba(255,255,255,0.5)',
  panelBorder: 'rgba(255,255,255,0.8)',
  panelGlow: 'rgba(46,102,180,0.22)',

  // 阵营：我方暖（草莓）／对方冷（蓝莓）
  our: '#FF7BA9',
  ourDeep: '#F2517F',
  opp: '#61C2F2',
  oppDeep: '#2F9FDC',

  // 文字（浅底用深墨色，替代对局旧版的近白文字）
  ink: '#3A4A6B',
  inkDim: '#6E82A6',

  // 语义色
  win: '#3FD0A0',
  lose: '#FF7A8A',
  warn: '#FFB43D',

  // 判定线
  judge: 'rgba(255,255,255,0.9)',
  judgeHot: '#FFB43D',

  // 结果色（结算页标题渐变两端，§4.3「配阵营色高亮」）
  resultWin: ['#FF9DBE', '#F2517F'], // 胜利 → 我方阵营色（草莓粉）
  resultLose: ['#8FD6F8', '#2F9FDC'], // 失败 → 对方阵营色（蓝莓蓝）
  resultDraw: ['#FFD84D', '#F5921F'], // 平局 → 中性金（不代表任何一方）

  /* ── 拔河区（§3.1）：天空 → 阵营地面 → 中央光圈 → 卡通小人 ──────── */
  horizon: 'rgba(255,255,255,0.62)', // 地平线（天空与地面分界）
  groundLeft: 'rgba(255,138,150,0.30)', // 我方侧暖色地贴
  groundRight: 'rgba(97,194,242,0.30)', // 对方侧冷色地贴
  groundCenter: 'rgba(255,255,255,0.62)', // 中央中性带
  groundLine: 'rgba(255,255,255,0.28)', // 地面透视横纹
  groundFar: 'rgba(255,255,255,0.5)', // 地面远边
  // 阵营胶囊徽章（对齐示例图的「红方 / 蓝方」）
  badgeOur: '#F2517F',
  badgeOpp: '#2F9FDC',
  // 中央发光光圈（绳结位置标记）
  ring: '#FFB43D',
  ringCore: '#FFFDEF',
  ringGlow: 'rgba(255,180,61,0.55)',
  // 卡通小人
  skin: '#FFD9B8',
  skinShade: '#F2C39C',
  hair: '#3B2B24',
  shoe: '#FFFFFF',
  eye: '#3A4A6B',
  blush: 'rgba(255,123,169,0.45)',
};

/** 拔河小人上衣配色（每侧 3 人，与阵营色同系）。 */
const OUR_OUTFITS = ['#FF8A4C', '#F2517F', '#FFC24D'];
const OPP_OUTFITS = ['#61C2F2', '#3FD0A0', '#8C9BFF'];
/** 发色（错开，避免三胞胎观感）。 */
const HAIRS = ['#3B2B24', '#241C16', '#6B4A2F'];

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
  // 地平线在上方约 30% 处，其下为透视地面（阵营染色 + 角色站位）
  const horizonY = Math.round(top.y + top.h * 0.3);
  // 绳子高度：与角色肩部齐平（角色握绳的手落在肩高）
  const ropeY = Math.round(top.y + top.h * 0.56);
  // 能量条移到底部两侧（对齐示例图），给天空/地面/角色腾出空间
  const barH = 20;
  const barW = Math.round((width - 40) * 0.42);
  const barY = Math.round(top.y + top.h - barH - 16);
  // 阵营徽章（贴安全区上沿）
  const badgeH = 30;
  const badgeW = Math.round(Math.min(96, width * 0.26));
  const badgeY = Math.round(top.y + safeTop + badgeH / 2 + 6);

  return {
    width,
    height,
    safeTop,
    safeBottom,
    top,
    mid,
    bottom,
    // 顶部拔河视图（§3.1）
    rope: {
      y: ropeY,
      cx: Math.round(width / 2),
      maxPx,
      leftAnchor: ropeMargin,
      rightAnchor: width - ropeMargin,
      barY,
      barW,
      barH,
      horizonY,
      groundBottom: top.y + top.h,
      badge: { w: badgeW, h: badgeH, y: badgeY },
    },
    // 中部目标区：一条横向彩色条带（§2.2 / §3.2：目标是一段一段的颜色序列）
    // 宽度受三处约束：屏宽 84%、中部高度的 92%、以及「每段不超过 132 px」。
    target: {
      cx: Math.round(width / 2),
      cy: Math.round(mid.y + mid.h * 0.5),
      bandW: Math.min(Math.round(width * 0.84), Math.round(mid.h * 0.92), SEQUENCE_LENGTH * 132),
      bandH: Math.round(Math.min(width * 0.84 * 0.32, mid.h * 0.4)),
      radius: 22,
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

module.exports = {
  HOME,
  MACARON,
  SPLIT,
  MIN_TOUCH,
  GAP,
  OUR_OUTFITS,
  OPP_OUTFITS,
  HAIRS,
  paletteGrid,
  computeLayout,
};
