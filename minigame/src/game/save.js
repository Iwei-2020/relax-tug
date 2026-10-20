'use strict';

/**
 * 本地进度存档（《项目说明书》§4.6 局外成长 / §4.7 每日任务 的「本地优先」半边）
 *
 * 抖音小游戏本地存储：`tt.setStorageSync / getStorageSync`（platform/tt.js 已封装，失败一律吞掉，
 * 存储不可用**绝不**阻断对局）。单一键存整个存档：
 *   `{ v, day, progress, tasks, levels }`
 *
 * 跨日：`load` 时按 UTC+8 自然日（`core/rng.utc8DayKey`）对 `tasks` 做 `rollover`（§4.7 不结转）；
 *   `progress`（等级 / 经验 / 金币 / 场次）与 `levels`（§4.8 闯关进度）**跨日保留**。
 *
 * 权威性：本地只是「离线也能看到成长」的乐观副本；云端可用时 boot 用 `reportResult /
 * dailyTasks` 回执里的 `progress / tasks / levels` 覆盖（§4.6 服务端权威）。
 */

const ttApi = require('../platform/tt.js');
const { utc8DayKey } = require('../core/rng.js');
const { emptyProgress, normalizeProgress } = require('../core/progression.js');
const { emptyTasks, normalizeTasks } = require('../core/tasks.js');
const { emptyLevels, normalizeLevels } = require('../core/levels.js');

const KEY = 'relax_tug_save_v1';

/** 默认存档（新玩家）。 */
function defaultSave(day) {
  return { v: 1, day: day || '', progress: emptyProgress(), tasks: emptyTasks(day || ''), levels: emptyLevels() };
}

/** 读档（含跨日重置）；存储缺失 / 损坏时回落默认值，不抛错。 */
function load(nowMs) {
  const day = utc8DayKey(nowMs === undefined ? Date.now() : nowMs);
  const raw = ttApi.getStorageSync(KEY, null);
  const base = raw && typeof raw === 'object' ? raw : {};
  return {
    v: 1,
    day,
    progress: normalizeProgress(base.progress),
    tasks: normalizeTasks(base.tasks, day),
    levels: normalizeLevels(base.levels), // §4.8 闯关进度（跨日保留）
  };
}

/** 落盘（尽力而为）。 */
function persist(save) {
  const s = save || {};
  const day = s.day || utc8DayKey(Date.now());
  ttApi.setStorageSync(KEY, {
    v: 1,
    day,
    progress: s.progress || emptyProgress(),
    tasks: s.tasks || emptyTasks(day),
    levels: normalizeLevels(s.levels),
  });
  return s;
}

module.exports = { KEY, defaultSave, load, persist };
