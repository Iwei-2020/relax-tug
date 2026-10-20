'use strict';

/**
 * 启动装配（《项目说明书》§4.1 启动页 → 首页 → 对局 → 结算）
 *
 * 唯一职责：把平台层（canvas / 输入）、渲染层（场景）、逻辑层（core）串起来，
 * 并持有**局外成长 / 每日任务**的唯一可写状态（§4.6 / §4.7）。
 * 所有跨场景跳转都在这里集中装配，**场景之间互不 import**，避免循环依赖。
 *
 * 成长与任务的权威性（§4.6 / §4.7）：
 *   - 本地优先：结算 / 领奖时先用同一套纯函数更新本地存档并落盘（离线也看得到成长）；
 *   - 服务端权威：同时上报 `reportResult / dailyTasks`，成功回执携带 `progress / tasks`，
 *     用它覆盖本地副本（`reconcile`），因此线上状态最终以服务端为准。
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
const { createTasksScene } = require('../scenes/tasks.js');
const { shareBattle } = require('../platform/share.js');
const { setSinkPath, track, EVENTS } = require('../utils/tracker.js');
const cloud = require('../net/cloud.js');
const { DEFAULT_DIFFICULTY } = require('../config/config.js');
const { dailyChallengeSeed } = require('../core/rng.js');
const progression = require('../core/progression.js');
const tasksCore = require('../core/tasks.js');
const saveStore = require('./save.js');

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

  // 本地存档（§4.6 / §4.7）：局外成长的**唯一可写副本**，云端回执对其覆盖
  let player = saveStore.load(Date.now());

  let lastMatch = null; // 最近一局快照，用于「看广告复活」续战
  let lastOptions = {}; // 最近一次开局的模式参数（难度 / 种子 / 每日挑战标记），供「再来一局」沿用

  /** 当前场景若支持 refresh（任务面板），数据变更后即时重绘。 */
  function refreshCurrentScene() {
    const scene = game.currentScene();
    if (scene && typeof scene.refresh === 'function') scene.refresh();
  }

  /**
   * 用服务端回执覆盖本地副本（§4.6 服务端权威）。
   * @param {{progress?:object, tasks?:object}} data reportResult / dailyTasks 的 data
   */
  function reconcile(data) {
    if (!data) return;
    if (data.progress) player.progress = progression.normalizeProgress(data.progress);
    if (data.tasks) player.tasks = tasksCore.fromServer(data.tasks, player.tasks.day);
    saveStore.persist(player);
    refreshCurrentScene();
  }

  /** 首页资料卡数据 + 可领红点（§4.6 / §4.7）。 */
  function homeProfile() {
    const rank = progression.rankFor(player.progress.level);
    const claimable = tasksCore.claimableIds(player.tasks).length;
    const chest = tasksCore.chestState(player.tasks);
    return {
      nickname: '',
      wins: player.progress.wins,
      level: player.progress.level,
      rankName: rank.name,
      coins: player.progress.coins,
      tasksClaimable: claimable + (chest.claimable ? 1 : 0),
    };
  }

  /** 任务面板状态（读取本地副本，云端会在回执里覆盖）。 */
  function taskViewState() {
    return {
      tasks: tasksCore.taskStates(player.tasks),
      chest: tasksCore.chestState(player.tasks),
      coins: player.progress.coins,
    };
  }

  const goHome = () => {
    game.setScene(
      createHomeScene({
        layout,
        profile: homeProfile(),
        onStart: () => startBattle({}),
        onShare: () => shareBattle({}),
        onChallenge: () => shareBattle({ query: 'challenge=1' }),
        // 每日挑战（§4.4）：种子由「日期 + 难度」在客户端派生，同日同难度全球同题
        onDaily: () => startBattle({ challenge: true, seed: dailyChallengeSeed(Date.now(), DEFAULT_DIFFICULTY) }),
        // 每日任务（§4.7）：进入任务面板（领奖见 claimTask / claimChestReward）
        onTasks: openTasks,
      })
    );
  };

  /** 每日任务面板（§4.7）。 */
  function openTasks() {
    game.setScene(
      createTasksScene({
        layout,
        getState: taskViewState,
        onClaim: claimTask,
        onChest: claimChestReward,
        onBack: goHome,
      })
    );
  }

  /**
   * 领取单条任务（§4.7）：本地即时到账（离线也能领），同时请求服务端权威记账（幂等）。
   */
  function claimTask(taskId) {
    const r = tasksCore.claim(player.tasks, taskId);
    if (r.ok) {
      player.tasks = r.state;
      player.progress = { ...player.progress, coins: player.progress.coins + r.coins };
      saveStore.persist(player);
      track(EVENTS.TASK_CLAIM, { id: taskId, coins: r.coins });
    }
    cloud.claimDailyTask(taskId).then((res) => {
      if (res && res.ok && res.data) reconcile(res.data);
    });
  }

  /** 领取每日宝箱（§4.7）：同样本地即时到账 + 服务端幂等记账。 */
  function claimChestReward() {
    const r = tasksCore.claimChest(player.tasks);
    if (r.ok) {
      player.tasks = r.state;
      player.progress = { ...player.progress, coins: player.progress.coins + r.coins };
      saveStore.persist(player);
      track(EVENTS.TASK_CHEST_CLAIM, { coins: r.coins });
    }
    cloud.claimChest().then((res) => {
      if (res && res.ok && res.data) reconcile(res.data);
    });
  }

  /**
   * 一局结束（结算前）：本地结算成长与任务进度，并上报服务端校验记账（§4.6 / §4.7）。
   * 网络失败不回滚、不阻塞——本地已即时到账，留待下次成功再对齐。
   */
  function settleMatch(sum) {
    const award = progression.awardFor(sum);
    player.progress = progression.applyAward(player.progress, award, sum && sum.result);
    player.tasks = tasksCore.applyMatch(player.tasks, sum);
    saveStore.persist(player);
    track(EVENTS.MATCH_SETTLED, { result: sum && sum.result, exp: award.exp, coins: award.coins });
    cloud.reportResult(sum).then((res) => {
      if (res && res.ok && res.data) reconcile(res.data);
    });
  }

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
    settleMatch(sum); // §4.6 / §4.7：局外成长与每日任务在结算前即时落账
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

  // 启动即与服务端对齐一次当日任务 / 成长（跨设备一致；失败静默，本地副本仍可用）
  cloud.fetchDailyTasks().then((res) => {
    if (res && res.ok && res.data) reconcile(res.data);
  });

  if (!canvas) {
    // 无宿主能力（例如误在 Node 环境执行）：给出明确提示而不是静默失败
    console.warn('[boot] 未检测到 tt 宿主能力，画布不可用；请确认运行在抖音小游戏环境中。');
  }

  return game;
}

module.exports = { boot };
