'use strict';

/**
 * 内存存储实现（**仅本地调试 / 单测**）
 *
 * ⚠️ 云函数为多实例运行，内存实现**不保证跨实例状态可见，禁止用于生产**。
 * 生产必须走官方 SDK（见 store-cloud.js），由 store-provider.js 自动选择。
 *
 * 与云端实现的关系：**方法签名一一对应**，且全部返回 Promise；
 * 读出的对象一律返回**浅拷贝**（模拟云端「读到的不是同一引用」的语义，
 * 逼迫上层显式回写，避免「原地改字段就以为落库了」的经典陷阱）。
 */

const C_PROFILES = 'rt_profiles';
const C_RESULTS = 'rt_results';
const C_COUNTERS = 'rt_counters';

/** 空计数器（与 store-cloud.js 口径一致）。 */
function emptyCounter() {
  return {
    match: 0, // 当日对局数
    win: 0, // 当日胜场
    skinUnlock: 0, // 当日皮肤解锁已用次数
    lastMatchAt: 0,
  };
}

/** @param {object} [seed] 预置数据，便于单测直接构造状态 */
function createMemoryStore(seed) {
  const data = seed || {};
  const profiles = new Map(Object.entries(data.profiles || {}));
  const counters = new Map(Object.entries(data.counters || {}));
  const results = [];

  const keyOfCounter = (openid, day) => `${openid}:${day}`;

  return {
    kind: 'memory',
    available: false,
    COLLECTIONS: { C_PROFILES, C_RESULTS, C_COUNTERS },

    async getProfile(openid) {
      const p = profiles.get(openid);
      return p ? { ...p } : null;
    },
    async saveProfile(profile) {
      profiles.set(profile.openid, { ...profile });
      return { ...profile };
    },

    async countersOf(openid, day) {
      const c = counters.get(keyOfCounter(openid, day));
      return { ...(c || emptyCounter()) };
    },
    async saveCounters(openid, day, counter) {
      counters.set(keyOfCounter(openid, day), { ...counter });
      return { ...counter };
    },

    async addResult(record) {
      const stored = { ...record, id: `rt_${results.length + 1}` };
      results.push(stored);
      return { ...stored };
    },
    async listResults(openid, limit) {
      const rows = results.filter((r) => r.openid === openid);
      const size = limit === undefined ? rows.length : limit;
      return rows.slice(Math.max(0, rows.length - size)).map((r) => ({ ...r }));
    },
  };
}

module.exports = { createMemoryStore, emptyCounter, C_PROFILES, C_RESULTS, C_COUNTERS };
