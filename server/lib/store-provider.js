'use strict';

/**
 * 存储选择（《项目说明书》§5.4）
 *
 * 优先级：能加载官方 `@open-dy/node-server-sdk` → 云数据库实现；否则退化为内存实现。
 *
 * 注意：该依赖**只声明在部署产物 build/cloud-functions/relax-tug-api/package.json 中**，
 * 由抖音云平台在部署时安装（既不进小游戏包，也不在仓库根安装），
 * 因此本地/单测环境通常加载不到，走内存分支属预期行为，这里只打印一次告警。
 */

const { createMemoryStore } = require('./store.js');
const { createCloudStore } = require('./store-cloud.js');

let cached = null;
let warned = false;

/** 创建（或复用）存储实例。 */
function getStore() {
  if (cached) return cached;
  try {
    const dySDK = require('@open-dy/node-server-sdk');
    cached = createCloudStore(dySDK);
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(
        '[store-provider] 未加载到 @open-dy/node-server-sdk，降级为内存存储：' +
          '仅适用于本地调试；多实例下跨函数状态不可见，禁止用于生产。' +
          '（部署产物中已声明该依赖，由平台在部署时安装。）'
      );
    }
    cached = createMemoryStore();
  }
  return cached;
}

/** 重置缓存（仅单测使用）。 */
function resetStore(store) {
  cached = store || null;
  warned = false;
}

module.exports = { getStore, resetStore };
