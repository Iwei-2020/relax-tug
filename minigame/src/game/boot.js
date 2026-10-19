'use strict';

/**
 * 启动装配（《项目说明书》§4.1 启动页 → 首页 → 对局 → 结算）
 *
 * 唯一职责：把平台层（canvas / 输入）、渲染层（场景）、逻辑层（core）串起来。
 * 所有跨场景跳转都在这里集中装配，**场景之间互不 import**，避免循环依赖。
 *
 * 启动时序：创建画布 → 计算布局 → 建 game → 首屏挂首页场景 → 启动主循环 → 绑定输入。
 */

const ttApi = require('../platform/tt.js');
const { computeLayout } = require('../components/theme.js');
const { createGame } = require('./loop.js');
const { createHomeScene } = require('../scenes/home.js');
const { createBattleScene } = require('../scenes/battle.js');
const { createResultScene } = require('../scenes/result.js');
const { shareBattle } = require('../platform/share.js');
const { setSinkPath, track } = require('../utils/tracker.js');
const cloud = require('../net/cloud.js');
const { DEFAULT_DIFFICULTY } = require('../config/config.js');

/** 启动（由 minigame/game.js 调用）。 */
function boot() {
  const sysInfo = ttApi.getSystemInfo();
  const canvas = ttApi.createCanvas();
  const ctx = ttApi.createContext(canvas);
  const layout = computeLayout(sysInfo);

  const game = createGame({ canvas, ctx, layout, sysInfo });

  // 埋点上报路径：未接入云端时为空字符串，埋点仅在本地输出，不影响对局
  setSinkPath(cloud.CLOUD.baseUrl || '');
  track('app_launch', { width: layout.width, height: layout.height, dpr: sysInfo.pixelRatio });

  let lastMatch = null; // 最近一局快照，用于「看广告复活」续战

  const goHome = () => {
    game.setScene(
      createHomeScene({
        layout,
        onStart: startBattle,
        onShare: () => shareBattle({}),
        onChallenge: () => shareBattle({ query: 'challenge=1' }),
      })
    );
  };

  function startBattle(resume) {
    game.setScene(
      createBattleScene({
        layout,
        difficulty: DEFAULT_DIFFICULTY, // TODO(接入云函数后)：改由 matchGhost 服务端下发
        resume,
        onFinish: showResult,
      })
    );
  }

  function showResult(sum, match) {
    lastMatch = match;
    game.setScene(
      createResultScene({
        layout,
        summary: sum,
        onReplay: () => startBattle(null),
        onRevive: () => startBattle(lastMatch),
        onHome: goHome,
        onShare: () => shareBattle({ summary: sum }),
      })
    );
  }

  goHome();
  game.bindInput();
  game.start();

  if (!canvas) {
    // 无宿主能力（例如误在 Node 环境执行）：给出明确提示而不是静默失败
    console.warn('[boot] 未检测到 tt 宿主能力，画布不可用；请确认运行在抖音小游戏环境中。');
  }

  return game;
}

module.exports = { boot };
