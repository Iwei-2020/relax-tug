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
const { createShareCardScene } = require('../scenes/share-card.js');
const { shareBattle } = require('../platform/share.js');
const { setSinkPath, track } = require('../utils/tracker.js');
const cloud = require('../net/cloud.js');
const { DEFAULT_DIFFICULTY } = require('../config/config.js');
const { dailyChallengeSeed } = require('../core/rng.js');

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
  let lastOptions = {}; // 最近一次开局的模式参数（难度 / 种子 / 每日挑战标记），供「再来一局」沿用

  const goHome = () => {
    game.setScene(
      createHomeScene({
        layout,
        onStart: () => startBattle({}),
        onShare: () => shareBattle({}),
        onChallenge: () => shareBattle({ query: 'challenge=1' }),
        // 每日挑战（§4.4）：种子由「日期 + 难度」在客户端派生，同日同难度全球同题
        onDaily: () => startBattle({ challenge: true, seed: dailyChallengeSeed(Date.now(), DEFAULT_DIFFICULTY) }),
      })
    );
  };

  /**
   * 开局。
   * @param {{resume?:object, seed?:number, challenge?:boolean}} [options]
   *   resume：续战快照（复活用）；seed：伪随机种子（每日挑战同题局）；challenge：每日挑战标记
   */
  function startBattle(options) {
    const opts = options || {};
    // 记住模式参数，使「再来一局」在每日挑战局后仍回到同一模式（同题重刷）
    lastOptions = { seed: opts.seed, challenge: opts.challenge === true };
    game.setScene(
      createBattleScene({
        layout,
        difficulty: DEFAULT_DIFFICULTY, // TODO(接入云函数后)：改由 matchGhost 服务端下发
        seed: opts.seed,
        challenge: opts.challenge === true,
        resume: opts.resume || null,
        onFinish: showResult,
      })
    );
  }

  /**
   * 分享卡预览页（§4.5）：结算页「分享战绩/挑战好友」进入。
   * 卡面由 scenes/share-card 渲染；离屏能力缺失时 imagePath 为空，分享自动降级为纯文案。
   */
  function openShareCard(sum) {
    game.setScene(
      createShareCardScene({
        layout,
        summary: sum,
        onBack: () => showResult(sum, lastMatch),
        onShare: (imagePath) => shareBattle({ summary: sum, imageUrl: imagePath }),
      })
    );
  }

  function showResult(sum, match) {
    lastMatch = match;
    game.setScene(
      createResultScene({
        layout,
        summary: sum,
        onReplay: () => startBattle(lastOptions),
        onRevive: () => startBattle(Object.assign({}, lastOptions, { resume: lastMatch })),
        onHome: goHome,
        onShare: () => openShareCard(sum),
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
