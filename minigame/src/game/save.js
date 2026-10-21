'use strict';

/**
 * 本地进度存档（《项目说明书》§4.6 局外成长的「本地优先」半边）
 *
 * 抖音小游戏本地存储：`tt.setStorageSync / getStorageSync`（platform/tt.js 已封装，失败一律吞掉，
 * 存储不可用**绝不**阻断对局）。单一键存整个存档：
 * `{ v, progress, levels }`
 *
 * 成长数据（等级 / 经验 / 金币 / 场次）与 `levels`（§4.8 闯关进度）均保留。
 *
 * 权威性：本地只是「离线也能看到成长」的乐观副本；云端可用时 boot 用 `reportResult`
 * 回执里的 `progress / levels` 覆盖（§4.6 服务端权威）。
 */

const ttApi = require('../platform/tt.js');
const { emptyProgress, normalizeProgress } = require('../core/progression.js');
const { emptyLevels, normalizeLevels } = require('../core/levels.js');

const KEY = 'relax_tug_save_v1';

/** 默认存档（新玩家）。 */
function defaultSave() {
  return { v: 1, progress: emptyProgress(), levels: emptyLevels() };
}

/** 读档；存储缺失 / 损坏时回落默认值，不抛错。 */
function load() {
  const raw = ttApi.getStorageSync(KEY, null);
  const base = raw && typeof raw === 'object' ? raw : {};
  return {
    v: 1,
    progress: normalizeProgress(base.progress),
    levels: normalizeLevels(base.levels), // §4.8 闯关进度（跨日保留）
  };
}

/** 落盘（尽力而为）。 */
function persist(save) {
  const s = save || {};
  ttApi.setStorageSync(KEY, {
    v: 1,
    progress: s.progress || emptyProgress(),
    levels: normalizeLevels(s.levels),
  });
  return s;
}

module.exports = { KEY, defaultSave, load, persist };
