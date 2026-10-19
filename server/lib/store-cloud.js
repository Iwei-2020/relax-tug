'use strict';

/**
 * 云数据库存储实现（《项目说明书》§5.4 服务端只做校验与排名）
 *
 * 依据：抖音云云数据库（文档型）的服务端**唯一通道**是官方 Node SDK
 * `@open-dy/node-server-sdk` → `dySDK.database()`。
 * ⚠️ 部署前置条件：部署前**必须在抖音云控制台对应环境开启云数据库组件**，
 * 否则 SDK 调用会失败 / 服务退化为内存存储（见 store-provider.js），
 * 且多实例下跨函数状态互不可见。**不要臆造注入式 db 适配器。**
 *
 * 与内存实现（store.js）签名一一对应，差异只在载体语义：
 *   1) 全部方法返回 Promise（云库 IO 异步）；
 *   2) 文档 `_id` 承担唯一键：profiles 用 openid、counters 用 `openid:day`；
 *   3) `set` 为**替换式写入**且不接受 `_id`，故写入前统一 stripId；
 *   4) **没有「原地改字段即落库」语义**：读出的计数 / 档案改动后必须显式回写，
 *      否则只改内存副本。
 *
 * 集合（首次写入即创建；需先在控制台开启「云数据库」组件）：
 *   - rt_profiles  _id = openid
 *   - rt_counters  _id = openid:day
 *   - rt_results   _id = SDK 自动生成
 */

const C_PROFILES = 'rt_profiles';
const C_RESULTS = 'rt_results';
const C_COUNTERS = 'rt_counters';

/** 去掉库侧 `_id`，使读出口径与内存实现一致。 */
function stripId(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

/** `collection.doc(id).get()` → 单条记录（已剔除 `_id`）或 null。 */
async function readDoc(collection, id) {
  const res = await collection.doc(id).get();
  const rows = (res && res.data) || [];
  return rows.length > 0 ? stripId(rows[0]) : null;
}

/** `collection.get()` / `where(...).get()` → 记录数组（已剔除 `_id`）。 */
function readRows(res) {
  const rows = (res && res.data) || [];
  return rows.map(stripId);
}

const keyOfCounter = (openid, day) => `${openid}:${day}`;

/**
 * @param {{database:()=>object}} dySDK 官方 SDK 的 `dySDK`（其 `database()` 返回数据库实例）
 */
function createCloudStore(dySDK) {
  const database = dySDK.database();
  const profiles = () => database.collection(C_PROFILES);
  const counters = () => database.collection(C_COUNTERS);
  const results = () => database.collection(C_RESULTS);

  return {
    kind: 'cloud',
    available: true,
    COLLECTIONS: { C_PROFILES, C_RESULTS, C_COUNTERS },

    async getProfile(openid) {
      return readDoc(profiles(), openid);
    },
    async saveProfile(profile) {
      await profiles().doc(profile.openid).set(stripId(profile));
      return { ...profile };
    },

    async countersOf(openid, day) {
      const doc = await readDoc(counters(), keyOfCounter(openid, day));
      return doc || null; // null 由上层补空默认值（server/lib/result.js）
    },
    async saveCounters(openid, day, counter) {
      await counters().doc(keyOfCounter(openid, day)).set(stripId(counter));
      return { ...counter };
    },

    async addResult(record) {
      await results().add({ ...record });
      return { ...record };
    },
    async listResults(openid, limit) {
      const res = await results().where({ openid }).limit(limit || 20).get();
      return readRows(res);
    },
  };
}

module.exports = { createCloudStore, C_PROFILES, C_RESULTS, C_COUNTERS };
