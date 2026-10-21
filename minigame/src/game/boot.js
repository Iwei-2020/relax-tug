'use strict';

/**
 * 启动装配（《项目说明书》§4.1 启动页 → 首页 → 对局 → 结算）
 *
 * 唯一职责：把平台层（canvas / 输入）、渲染层（场景）、逻辑层（core）串起来，
 * 并持有**局外成长 / 闯关进度**的唯一可写状态（§4.6 / §4.8）。
 * 所有跨场景跳转都在这里集中装配，**场景之间互不 import**，避免循环依赖。
 *
 * 成长与闯关进度的权威性（§4.6 / §4.8）：
 *   - 本地优先：结算时先用同一套纯函数更新本地存档并落盘（离线也看得到成长）；
 *   - 服务端权威：上报 `reportResult`，成功回执携带 `progress / levels`，
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
const { createLevelsScene } = require('../scenes/levels.js');
const { shareBattle } = require('../platform/share.js');
const { showRewardedVideo, AD_UNITS } = require('../platform/ad.js');
const { setSinkPath, track, EVENTS } = require('../utils/tracker.js');
const cloud = require('../net/cloud.js');
const { DEFAULT_DIFFICULTY } = require('../config/config.js');
const progression = require('../core/progression.js');
const levelsCore = require('../core/levels.js');
const livesCore = require('../core/lives.js');
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

  // 本地存档（§4.6）：局外成长的**唯一可写副本**，云端回执对其覆盖
  let player = saveStore.load(Date.now());

  let lastOptions = {}; // 最近一次开局的模式参数（模式 / 关卡 / 种子），供「再来一局」沿用
  let lifeActionPending = false;

  /**
   * 用服务端回执覆盖本地副本（§4.6 服务端权威）。
   * @param {{progress?:object, levels?:object}} data reportResult 的 data
   */
  function reconcile(data) {
    if (!data) return;
    if (data.progress) player.progress = progression.normalizeProgress(data.progress);
    if (data.levels) player.levels = levelsCore.normalizeLevels(data.levels); // §4.8 闯关进度以服务端为准
    if (data.lives) {
      const localLives = livesCore.normalizeLives(player.lives, Date.now());
      const remoteLives = livesCore.normalizeLives(data.lives, Date.now());
      player.lives = {
        day: remoteLives.day,
        count: localLives.day === remoteLives.day ? Math.min(localLives.count, remoteLives.count) : remoteLives.count,
      };
    }
    saveStore.persist(player);
  }

  /** 首页资料卡数据（§4.6）。 */
  function homeProfile() {
    const rank = progression.rankFor(player.progress.rankId);
    return {
      nickname: '',
      wins: player.progress.wins,
      rankName: rank.name,
      rankPoints: player.progress.rankPoints,
      lives: player.lives.count,
    };
  }

  function notify(message) {
    const tt = ttApi.getTt();
    if (tt && typeof tt.showToast === 'function') {
      try {
        tt.showToast({ title: message, icon: 'none', duration: 2000 });
      } catch (err) {
        /* Toast support is optional and must not block play. */
      }
    }
  }

  function saveLives(lives) {
    player.lives = livesCore.normalizeLives(lives, Date.now());
    saveStore.persist(player);
  }

  async function consumeLife() {
    if (cloud.transportReady()) {
      const res = await cloud.consumeLife();
      if (res && res.ok && res.data) {
        if (res.data.lives) player.lives = livesCore.normalizeLives(res.data.lives, Date.now());
        saveStore.persist(player);
        return res.data.consumed === true;
      }
      if (!res || !res.fallback) return false;
    }

    const result = livesCore.consumeLife(player.lives, Date.now());
    saveLives(result.state);
    return result.ok;
  }

  async function rewardLife() {
    if (cloud.transportReady()) {
      const res = await cloud.rewardLife();
      if (res && res.ok && res.data) {
        if (res.data.lives) player.lives = livesCore.normalizeLives(res.data.lives, Date.now());
        saveStore.persist(player);
        return res.data.granted === true;
      }
    }

    // Preserve a successfully watched reward locally if cloud sync is temporarily unavailable.
    const result = livesCore.grantLife(player.lives, Date.now());
    saveLives(result.state);
    return result.ok;
  }

  function withLife(onSuccess, onEmpty) {
    if (lifeActionPending) return;
    lifeActionPending = true;
    consumeLife()
      .then((consumed) => {
        lifeActionPending = false;
        if (consumed) {
          if (typeof onSuccess === 'function') onSuccess();
        } else if (player.lives.count === 0 && typeof onEmpty === 'function') {
          onEmpty();
        } else {
          notify('体力状态暂不可用，请稍后重试');
        }
      })
      .catch(() => {
        lifeActionPending = false;
        notify('体力状态暂不可用，请稍后重试');
      });
  }

  function startBattleWithLife(options, onEmpty) {
    withLife(
      () => startBattle(options),
      onEmpty ||
        (() => {
          goHome();
          notify('今日体力已用完');
        })
    );
  }

  function startFriendChallenge() {
    withLife(
      () => {
        shareBattle({ query: 'challenge=1' });
        goHome();
      },
      () => {
        goHome();
        notify('今日体力已用完');
      }
    );
  }

  function requestLifeAd(setHint) {
    if (lifeActionPending) return;
    lifeActionPending = true;
    track(EVENTS.LIFE_AD_CLICK, {});
    showRewardedVideo({
      unitId: AD_UNITS.life,
      scene: 'life_reward',
      onSuccess(detail) {
        if (detail && detail.fallback) {
          track(EVENTS.AD_FALLBACK, { scene: 'life_reward' });
          lifeActionPending = false;
          if (typeof setHint === 'function') setHint('体力补充广告暂不可用，无法领取');
          else notify('体力补充广告暂不可用，无法领取');
          return;
        }
        rewardLife()
          .then((granted) => {
            lifeActionPending = false;
            if (!granted) {
              if (typeof setHint === 'function') setHint('体力补充失败，请稍后重试');
              return;
            }
            startBattleWithLife(lastOptions, () => {
              if (typeof setHint === 'function') setHint('体力状态暂不可用，请稍后重试');
            });
          })
          .catch(() => {
            lifeActionPending = false;
            if (typeof setHint === 'function') setHint('体力补充失败，请稍后重试');
          });
      },
      onFail() {
        lifeActionPending = false;
        if (typeof setHint === 'function') setHint('未看完广告，未获得体力');
      },
    });
  }

  function replayFromResult(setHint) {
    startBattleWithLife(lastOptions, () => {
      if (player.lives.count === 0) requestLifeAd(setHint);
      else if (typeof setHint === 'function') setHint('体力状态暂不可用，请稍后重试');
    });
  }

  const goHome = () => {
    game.setScene(
      createHomeScene({
        layout,
        profile: homeProfile(),
        onStart: () => startBattleWithLife({}),
        onChallenge: startFriendChallenge,
        // 闯关挑战（§4.8）：进入闯关模式（C6 起为关卡选择页；当前直进「免费可挑战关」）
        onLevels: openLevels,
      })
    );
  };

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
   * 进入闯关模式（§4.8）：关卡选择页。
   * 默认停在「当前可挑战关」所在页；点选关卡交由 pickLevel 判定是否需看广告。
   */
  function openLevels() {
    game.setScene(
      createLevelsScene({
        layout,
        getState: () => levelsCore.normalizeLevels(player.levels),
        onPick: pickLevel,
        onBack: goHome,
      })
    );
  }

  /**
   * 选关（§4.8）：唯一免费关是「已通关的最大关 + 1」；其它关每次都要看一次激励视频
   * （**不永久解锁**）。广告位未配置 / 宿主不支持时由 platform/ad 兜底放行，不阻塞。
   * @param {number} level 关卡号
   */
  function pickLevel(level) {
    const L = levelsCore.clampLevel(level);
    if (!levelsCore.needsAd(L, player.levels)) {
      startLevel(L);
      return;
    }
    track(EVENTS.LEVEL_PICK, { level: L, via: 'ad' });
    showRewardedVideo({
      unitId: AD_UNITS.levelSkip,
      scene: 'level_skip',
      onSuccess: () => {
        track(EVENTS.LEVEL_SKIP_AD, { level: L });
        startLevel(L);
      },
      onFail: () => {
        // 广告未看完：停留在选关页，不进入（玩家可重试）
      },
    });
  }

  /**
   * 一局结束（结算前）：本地结算成长，并上报服务端校验记账（§4.6）。
   * 网络失败不回滚、不阻塞——本地已即时到账，留待下次成功再对齐。
   */
  function settleMatch(sum) {
    const award = progression.awardFor(sum);
    player.progress = progression.applyAward(player.progress, award, sum && sum.result);
    // §4.8 闯关进度：本地乐观推进（过关才推进），服务端权威值随后由回执覆盖
    if (sum && sum.mode === 'level' && sum.result === 'win') {
      player.levels = levelsCore.withClearedLevel(player.levels, sum.level);
    }
    saveStore.persist(player);
    track(EVENTS.MATCH_SETTLED, { result: sum && sum.result, rankPoints: award.rankPoints });
    if (sum && sum.mode === 'level') {
      track(sum.result === 'win' ? EVENTS.LEVEL_CLEARED : EVENTS.LEVEL_FAILED, { level: sum.level, livesLeft: sum.livesLeft });
    }
    cloud.reportResult(sum).then((res) => {
      if (res && res.ok && res.data) reconcile(res.data);
    });
  }

  /**
   * 开局。
   * @param {{seed?:number, challenge?:boolean, mode?:'classic'|'level', level?:number}} [options]
   *   seed：伪随机种子（闯关每关固定种子）；
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
        onFinish: showResult,
      })
    );
  }

  function showResult(sum) {
    settleMatch(sum); // §4.6：局外成长在结算前即时落账
    const isLevel = sum && sum.mode === 'level';
    const lvl = sum ? sum.level : null;
    game.setScene(
      createResultScene({
        layout,
        summary: sum,
        onReplay: replayFromResult,
        // §4.8 闯关模式：过关 → 下一关；失败 → 重试本关，不消耗每日体力
        onLevelNext: isLevel && lvl !== null ? () => startLevel(lvl + 1) : null,
        onLevelRetry: isLevel && lvl !== null ? () => startLevel(lvl) : null,
        onLevels: isLevel ? openLevels : null,
        onHome: goHome,
      })
    );
  }

  goHome();
  game.bindInput();
  game.start();

  // 启动时恢复服务端权威成长与闯关进度；离线时继续使用本地存档。
  cloud.fetchPlayerState().then((res) => {
    if (res && res.ok && res.data) {
      reconcile(res.data);
      const scene = game.currentScene();
      if (scene && scene.name === 'home') goHome();
    }
  });

  if (!canvas) {
    // 无宿主能力（例如误在 Node 环境执行）：给出明确提示而不是静默失败
    console.warn('[boot] 未检测到 tt 宿主能力，画布不可用；请确认运行在抖音小游戏环境中。');
  }

  return game;
}

module.exports = { boot };
