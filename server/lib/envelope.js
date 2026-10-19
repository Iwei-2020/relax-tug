'use strict';

/**
 * 统一响应信封（《项目说明书》§8.1 F14 数据 / 服务端契约）
 *
 * 形态：`{ code, msg, data }`，`code === 0` 为成功。
 *
 * 平台事实：抖音云函数服务把入口函数的返回值直接作为 Response Body，
 * 客户端（minigame/src/net/cloud.js）拿到后自行 JSON 解析并归一为 `{ ok, code, msg, data }`，
 * 因此服务端只需保证信封结构稳定，不要指望平台帮忙封装。
 */

/** 数值错误码（区间约定：4xxx 客户端可归因，5xxx 服务端内部）。 */
const CODES = {
  OK: 0,
  BAD_REQUEST: 4000,
  NOT_FOUND: 4004,
  CONFLICT: 4009,
  RATE_LIMIT: 4029,
  SERVER_ERROR: 5000,
};

/** 成功信封。 */
function ok(data) {
  return { code: CODES.OK, msg: 'ok', data: data === undefined ? {} : data };
}

/** 失败信封（detail 面向日志，不面向用户）。 */
function fail(code, detail, meta) {
  return {
    code,
    msg: detail ? `${code}: ${detail}` : String(code),
    data: meta === undefined ? null : meta,
  };
}

/** 把任意异常收敛为失败信封，避免把内部细节泄漏给客户端。 */
function fromError(err) {
  const message = err && err.message ? String(err.message) : 'unknown error';
  return fail(CODES.SERVER_ERROR, message);
}

/** 判断信封是否成功。 */
function isOk(envelope) {
  return !!envelope && envelope.code === CODES.OK;
}

module.exports = { CODES, ok, fail, fromError, isOk };
