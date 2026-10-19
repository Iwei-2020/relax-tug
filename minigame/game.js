'use strict';

/**
 * 抖音小游戏包入口（《项目说明书》§4.1 启动页）
 *
 * 平台契约：小游戏包根必须存在 `game.js` + `game.json` + `project.config.json`，
 * 运行时无 DOM/window，只有 `tt` 系列 API；CommonJS `require` 由小游戏构建链支持。
 *
 * 本文件只做一件事：启动游戏主循环。所有逻辑位于 `src/`：
 *   src/game/boot.js      启动装配（画布、布局、场景、循环）
 *   src/game/loop.js      requestAnimationFrame 主循环 + 场景管理
 *   src/core/*            引擎无关核心逻辑（能量 / 判定 / 回合），可被 Node 直接单测
 */

require('./src/game/boot.js').boot();
