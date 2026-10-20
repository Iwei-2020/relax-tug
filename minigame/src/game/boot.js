'use strict';

/**
 * 启动装配（《项目说明书》§4.1 启动页 → 首页 → 对局 → 结算）
 *
 * 唯一职责：把平台层（canvas / 输入）、渲染层（场景）、逻辑层（core）串起来，
 * 并持有**局外成长 / 每日任务 / 闯关进度**的唯一可写状态（§4.6 / §4.7 / §4.8）。
 * 所有跨场景跳转都在这里集中装配，**场景之间互不 import**，避免循环依赖。
 *
 * 成长、任务与闯关进度的权威性（§4.6 / §4.7 / §4.8）：
 *   - 本地优先：结算 / 领奖时先用同一套纯函数更新本地存档并落盘（离线也看得到成长）；
 *   - 服务端权威：同时上报 `reportResult / dailyTasks`，成功回执携带 `progress / tasks / levels`，
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
const { DEFAULT_DIFFICULTY, LEVEL_MAX } = require('../config/config.js');
const progression = require('../core/progression.js');
const tasksCore = require('../core/tasks.js');
const levelsCore = require('../core/levels.js');
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
  let lastOptions = {}; // 最近一次开局的模式参数（模式 / 关卡 / 种子），供「再来一局」沿用

  /** 当前场景若支持 refresh（任务面板），数据变更后即时重绘。 */
  function refreshCurrentScene() {
    const scene = game.currentScene();
    if (scene && typeof scene.refresh === 'function') scene.refresh();
  }

  /**
   * 用服务端回执覆盖本地副本（§4.6 服务端权威）。
   * @param {{progress?:object, tasks?:object, levels?:object}} data reportResult / dailyTasks 的 data
   */
  function reconcile(data) {
    if (!data) return;
    if (data.progress) player.progress = progression.normalizeProgress(data.progress);
    if (data.tasks) player.tasks = tasksCore.fromServer(data.tasks, player.tasks.day);
    if (data.levels) player.levels = levelsCore.normalizeLevels(data.levels); // §4.8 闯关进度以服务端为准
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
        // 闯关挑战（§4.8）：进入闯关模式（C6 起为关卡选择页；当前直进「免费可挑战关」）
        onLevels: openLevels,
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
   * 进入某一关（§4.8）：种子按关卡固定派生（每关同题），模式透传为 'level'。
   * @param {number} level 关卡号（1–100，越界自动夹取）
   */
  function startLevel(level) {
    const L = levelsCore.clampLevel(level);
    track(EVENTS.LEVEL_START, { level: L });
    startBattle({ mode: 'level', level: L, seed: levelsCore.levelSeed(L) });
  }

  /**
   * 进入闯关模式（§4.8）。
   * 当前实现（C5）：直进「免费可挑战关」（已通关的最大关 + 1；全部通关则进末关）。
   * C6 将替换为关卡选择页，由用户点选关卡（跳关需看激励视频）。
   */
  function openLevels() {
    const free = levelsCore.freeLevel(player.levels);
    startLevel(free === null ? LEVEL_MAX : free);
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
    // §4.8 闯关进度：本地乐观推进（过关才推进），服务端权威值随后由回执覆盖
    if (sum && sum.mode === 'level' && sum.result === 'win') {
      player.levels = levelsCore.withClearedLevel(player.levels, sum.level);
    }
    saveStore.persist(player);
    track(EVENTS.MATCH_SETTLED, { result: sum && sum.result, exp: award.exp, coins: award.coins });
    if (sum && sum.mode === 'level') {
      track(sum.result === 'win' ? EVENTS.LEVEL_CLEARED : EVENTS.LEVEL_FAILED, { level: sum.level, livesLeft: sum.livesLeft });
    }
    cloud.reportResult(sum).then((res) => {
      if (res && res.ok && res.data) reconcile(res.data);
    });
  }

  /**
   * 开局。
   * @param {{resume?:object, seed?:number, challenge?:boolean, mode?:'classic'|'level', level?:number}} [options]
   *   resume：续战快照（复活用）；seed：伪随机种子（闯关每关固定种子）；
   *   challenge：每日挑战标记（§4.4 已下线，仅历史兼容）；
   *   mode / level：对局模式与闯关关卡号（§4.8）
   */
  function startBattle(options) {
    const opts = options || {};
    const mode = opts.mode === 'level' ? 'level' : 'classic';
    const level = mode === 'level' ? opts.level : null;
    // 记住模式参数，使「再来一局」仍回到同一模式 / 同一关（闯关同关重刷）
    lastOptions = { mode, level, seed: opts.seed, challenge: opts.challenge === true };
    game.setScene(
      createBattleScene({
        layout,
        difficulty: DEFAULT_DIFFICULTY, // TODO(接入云函数后)：改由 matchGhost 服务端下发
        mode,
        level,
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
    const isLevel = sum && sum.mode === 'level';
    const lvl = sum ? sum.level : null;
    game.setScene(
      createResultScene({
        layout,
        summary: sum,
        onReplay: () => startBattle(lastOptions),
        onRevive: () => startBattle(Object.assign({}, lastOptions, { resume: lastMatch })),
        // §4.8 闯关模式：过关 → 下一关；失败 → 重试本关；两者均无复活（口径：3 条生命）
        onLevelNext: isLevel && lvl !== null ? () => startLevel(lvl + 1) : null,
        onLevelRetry: isLevel && lvl !== null ? () => startLevel(lvl) : null,
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
