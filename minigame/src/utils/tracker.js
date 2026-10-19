'use strict';

/**
 * 统一埋点入口（《项目说明书》§8.1 F14 核心埋点）
 *
 * ⚠️ 硬约束：本模块**必须导出统一的 `track(event, props)` 入口函数**。
 *   历史教训：曾因页面按 `{ track }` 解构导入而模块未导出同名函数，导致
 *   `track is not a function`、按钮点击无响应。任何新增埋点都必须经由 `track`。
 *
 * 需要回收的指标（§9.3 DoD）：平均对局时长 / 平均命中率 / 胜负比 / 广告观看率。
 *
 * 实现：事件先入内存队列，由 game/loop 在每帧末按批 flush（异步、失败即丢弃，
 * **绝不允许埋点失败影响对局**）。无宿主能力时退化为控制台输出，便于本地联调。
 */

const ttApi = require('../platform/tt.js');

const MAX_QUEUE = 50;
const FLUSH_BATCH = 20;

let queue = [];
let flushing = false;
let sinkPath = ''; // 服务端埋点上报路径（接入时配置，空则仅本地输出）

/** 事件名常量：避免散落字符串导致口径不一致。 */
const EVENTS = {
  APP_LAUNCH: 'app_launch',
  MATCH_START: 'match_start', // 进入对局（含倒计时）
  ROUND_HIT: 'round_hit',
  ROUND_MISS: 'round_miss',
  ROUND_TIMEOUT: 'round_timeout',
  MATCH_END: 'match_end', // 含 result / durationMs / accuracy
  REVIVE_CLICK: 'revive_click',
  AD_WATCH: 'ad_watch',
  AD_FAIL: 'ad_fail',
  AD_FALLBACK: 'ad_fallback',
  SHARE_CLICK: 'share_click',
  SHARE_SUCCESS: 'share_success',
  SHARE_FAIL: 'share_fail',
};

/**
 * 记录一个埋点事件（唯一入口）。
 * @param {string} event 事件名（建议取自 EVENTS）
 * @param {object} [props] 附加属性（扁平、可 JSON 序列化）
 */
function track(event, props) {
  if (!event) return;
  const payload = {
    event,
    props: props || {},
    ts: Date.now(),
  };
  if (queue.length >= MAX_QUEUE) queue.shift(); // 溢出丢最旧，避免内存膨胀
  queue.push(payload);
  if (!ttApi.isAvailable()) {
    // 本地联调：直接打印，便于在 Node 环境观察事件流
    console.log('[track]', event, JSON.stringify(payload.props));
  }
}

/** 设置服务端上报路径（由 net 层在启动时注入）。 */
function setSinkPath(path) {
  sinkPath = path || '';
}

/** 取出待上报事件并清空队列。 */
function drain() {
  const batch = queue.slice(0, FLUSH_BATCH);
  queue = queue.slice(batch.length);
  return batch;
}

/**
 * 批量上报（尽力而为）。无宿主能力或无上报路径时直接清空队列。
 * @param {(batch:object[]) => void} [sender] 实际发送实现（由 net/cloud.js 注入）
 */
function flush(sender) {
  if (flushing || queue.length === 0) return;
  const batch = drain();
  if (batch.length === 0) return;
  if (typeof sender !== 'function' || !sinkPath) return; // 未接入上报：静默丢弃
  flushing = true;
  try {
    sender(batch);
  } catch (err) {
    /* 埋点失败不影响对局 */
  } finally {
    flushing = false;
  }
}

/** 当前队列长度（调试用）。 */
function pendingCount() {
  return queue.length;
}

module.exports = { EVENTS, track, setSinkPath, drain, flush, pendingCount };
