'use strict';

/**
 * 端云通信薄封装（《项目说明书》§5.4 弱网适配）
 *
 * 定位：服务端只承担三类职责 —— **下发 AI 对手参数、校验并记录对局结果、接收埋点**；
 * 对局关键逻辑全部在本地（core/*），因此网络失败**绝不能阻塞玩法**：本模块的所有方法
 * 一律 **resolve**（从不 reject），失败时返回 `{ ok:false, fallback:true }`，由调用方走本地兜底。
 *
 * 传输：优先 `tt.callContainer`（云托管容器）；否则用 `tt.request` 直连函数服务 HTTP 路径
 * （与 tools/gen-cloud-functions.js 生成的产物布局对称：调用路径 = 函数名）。
 * 平台差异：抖音云返回体的信封 `data` 可能是 **JSON 字符串**，这里统一解析后归一为
 * `{ ok, code, msg, data }`。
 *
 * ⚠️ 待接入：`baseUrl` / `envId` 需按抖音云控制台的实际环境填写（TODOLIST: 与云端联调时补全）。
 */

const ttApi = require('../platform/tt.js');
const { track } = require('../utils/tracker.js');

const CLOUD = {
  /** 抖音云函数服务名，必须与 tools/gen-cloud-functions.js 的 SERVICE_NAME 一致。 */
  serviceName: 'relax-tug-api',
  /** 函数直连基址（形如 https://xxx.dycloud.run），留空则视为未接入。 */
  baseUrl: '',
  /** 云托管环境 id（使用 tt.callContainer 时必填）。 */
  envId: '',
};

/** 归一化信封：`{ code, msg, data }`（code === 0 为成功）→ `{ ok, code, msg, data }`。 */
function normalize(body) {
  let parsed = body;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (err) {
      return { ok: false, code: -1, msg: 'bad-json', data: null };
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, code: -1, msg: 'empty-body', data: null };
  return {
    ok: parsed.code === 0,
    code: typeof parsed.code === 'number' ? parsed.code : -1,
    msg: parsed.msg || '',
    data: parsed.data === undefined ? null : parsed.data,
  };
}

/** 未接入 / 不可用时的统一兜底返回（调用方据此走本地 AI 与本地记账）。 */
function unavailable(reason) {
  return { ok: false, code: -1, msg: reason, data: null, fallback: true };
}

/** 当前是否具备可用传输通道。 */
function transportReady() {
  if (!ttApi.isAvailable()) return false;
  return Boolean(ttApi.getTt().callContainer) || Boolean(CLOUD.baseUrl);
}

/**
 * 调用云函数（永不 reject）。
 * @param {string} name 函数名（= 调用路径，如 'matchGhost'）
 * @param {object} params 请求体（直接作为函数入参 / HTTP body）
 * @returns {Promise<{ok:boolean, code:number, msg:string, data:any, fallback?:boolean}>}
 */
function callFunction(name, params) {
  if (!transportReady()) return Promise.resolve(unavailable('cloud-not-configured'));
  const tt = ttApi.getTt();
  const payload = params || {};

  // 通道 A：云托管容器调用
  if (typeof tt.callContainer === 'function' && CLOUD.envId) {
    return new Promise((resolve) => {
      tt.callContainer({
        envID: CLOUD.envId,
        service: CLOUD.serviceName,
        path: `/${name}`,
        method: 'POST',
        header: { 'content-type': 'application/json' },
        data: JSON.stringify(payload),
        success: (res) => resolve(normalize(res && res.data)),
        fail: (err) => {
          track('cloud_fail', { name, channel: 'container', msg: err && err.errMsg });
          resolve(unavailable('container-fail'));
        },
      });
    });
  }

  // 通道 B：函数服务 HTTP 直连
  if (typeof tt.request === 'function') {
    return new Promise((resolve) => {
      tt.request({
        url: `${CLOUD.baseUrl}/${name}`,
        method: 'POST',
        header: { 'content-type': 'application/json' },
        data: payload,
        success: (res) => resolve(normalize(res && res.data)),
        fail: (err) => {
          track('cloud_fail', { name, channel: 'http', msg: err && err.errMsg });
          resolve(unavailable('http-fail'));
        },
      });
    });
  }

  return Promise.resolve(unavailable('no-transport'));
}

/* ── 业务薄封装 ──────────────────────────────────────────────────── */

/**
 * 取 AI 对手参数（服务端权威下发，客户端不自行决定难度）。
 * 失败时由调用方回落本地默认档（core/ghost.createGhost）。
 */
function fetchGhostParams(params) {
  return callFunction('matchGhost', params);
}

/** 上报对局结果（服务端做校验与记账，见 server/lib/result.js）。 */
function reportResult(summary) {
  return callFunction('reportResult', summary || {});
}

/** 埋点批量上报（作为 tracker.flush 的 sender）。 */
function reportEvents(batch) {
  return callFunction('reportEvents', { events: batch });
}

module.exports = {
  CLOUD,
  normalize,
  transportReady,
  callFunction,
  fetchGhostParams,
  reportResult,
  reportEvents,
};
