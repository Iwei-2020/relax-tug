'use strict';

/**
 * 服务端常量镜像生成
 *
 * 问题：客户端数值在 minigame/src/config/config.js（唯一事实来源），
 * 服务端（抖音云函数）需要**同一套数字**做校验与记账，但两端在不同的包/进程里，
 * 无法直接共享同一份文件（小游戏包不能引用服务端文件，反之亦然）。
 *
 * 做法：本脚本从客户端 config 读取数值，生成服务端镜像 server/lib/constants.js。
 * 与手工复制两份常量相比，这里用 **--check 漂移门禁**（纳入 npm run verify）保证两端永远一致：
 * 忘记重新生成时 verify 直接失败，而不是让线上出现"客户端算 2.75、服务端算 2.2"这类静默错账。
 *
 * 用法：
 *   node tools/gen-constants.js          生成 / 覆盖 server/lib/constants.js
 *   node tools/gen-constants.js --check  仅校验镜像与源一致
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'server/lib/constants.js');
const SOURCE = 'minigame/src/config/config.js';
const CHECK_ONLY = process.argv.includes('--check');

/**
 * 镜像字段（= 服务端真正会用到的数值）。
 * PALETTE（配色）属渲染专用，不进镜像 —— 少一份无用数据就少一处漂移面。
 */
function mirrorOf(config) {
  const {
    WIN_NET_ENERGY,
    DISPLACEMENT_MAX_PX,
    DISPLACEMENT_FACTOR,
    DRAW_BAND_PX,
    HIT_ENERGY,
    MISS_PENALTY,
    MIN_ENERGY,
    COMBO_BONUS,
    COMBO_HIGH_FROM,
    COMBO_BONUS_MAX,
    PERFECT_WINDOW_RATIO,
    PERFECT_MULTIPLIER,
    SEQUENCE_LENGTH,
    COUNTDOWN_MS,
    ROUND_GAP_MS,
    MATCH_TIMEOUT_MS,
    GAME_HARD_LIMIT_MS,
    BALANCE,
    DIFFICULTY,
    DEFAULT_DIFFICULTY,
    MONETIZATION,
  } = config;

  return {
    WIN_NET_ENERGY,
    DISPLACEMENT_MAX_PX,
    DISPLACEMENT_FACTOR,
    DRAW_BAND_PX,
    HIT_ENERGY,
    MISS_PENALTY,
    MIN_ENERGY,
    COMBO_BONUS,
    COMBO_HIGH_FROM,
    COMBO_BONUS_MAX,
    PERFECT_WINDOW_RATIO,
    PERFECT_MULTIPLIER,
    SEQUENCE_LENGTH,
    COUNTDOWN_MS,
    ROUND_GAP_MS,
    MATCH_TIMEOUT_MS,
    GAME_HARD_LIMIT_MS,
    BALANCE,
    DIFFICULTY,
    DEFAULT_DIFFICULTY,
    MONETIZATION,
  };
}

function render(mirror) {
  const header = [
    "'use strict';",
    '',
    '/**',
    ' * 服务端常量镜像 —— **构建期生成，禁止手改**',
    ' *',
    ` * 源：${SOURCE}（客户端 / 服务端唯一事实来源）`,
    ' * 生成：node tools/gen-constants.js（校验：node tools/gen-constants.js --check）',
    ' *',
    ' * 变更流程：改客户端 config → 重跑本脚本 → 提交。忘记重跑会被 npm run verify 的 --check 拦截。',
    ' * 字段对应《解压拔河大作战 · 项目说明书》§6（数值规划）与 §5.1（广告频次上限）。',
    ' * PALETTE（配色）属渲染专用，不进本镜像。',
    ' */',
    '',
  ];
  return `${header.join('\n')}module.exports = ${JSON.stringify(mirror, null, 2)};\n`;
}

function main() {
  const config = require(path.join(ROOT, SOURCE));
  const content = render(mirrorOf(config));

  if (CHECK_ONLY) {
    if (!fs.existsSync(OUT_FILE)) {
      console.error(`[gen-constants] --check 失败：镜像缺失 ${path.relative(ROOT, OUT_FILE)}，请先运行 node tools/gen-constants.js`);
      process.exit(1);
    }
    if (fs.readFileSync(OUT_FILE, 'utf8') !== content) {
      console.error('[gen-constants] --check 失败：服务端常量镜像与客户端 config 不一致（发生漂移）');
      console.error('  处置：重新运行 node tools/gen-constants.js 覆盖镜像，并确认客户端数值改动是预期的。');
      process.exit(1);
    }
    console.log('[gen-constants] --check 通过：服务端常量镜像与客户端 config 一致');
    return;
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, content);
  console.log(`[gen-constants] 已生成 ${path.relative(ROOT, OUT_FILE)}（源：${SOURCE}）`);
}

main();
