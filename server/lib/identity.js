'use strict';

/**
 * 调用方身份（《项目说明书》§5.3 实名/防沉迷 + §5.4 服务端只做校验与排名）
 *
 * 平台事实：抖音云函数服务会在请求头注入 `X-TT-OPENID`（以及 unionid / appid 等），
 * 服务端**直接读取即可**，无需再调 code2Session 换登录态 —— 这是已在同仓「月老办事处」
 * 项目中实测确认的结论，不要再自造登录置换流程。
 *
 * 容错：平台在不同入口（函数服务 / 云托管）下 header 的承载位置不完全一致，
 * 这里做一次宽容查找，命中第一个可用形态即可；查找失败返回 null，由调用方按未登录处理。
 */

const OPENID_HEADERS = ['x-tt-openid', 'x-tt-open-id', 'openid'];

/** 大小写不敏感地取 header。 */
function headerOf(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      return value === undefined || value === null ? null : String(value);
    }
  }
  return null;
}

/** 从请求上下文里宽容取 openid（依次尝试 event.headers / context.headers / context）。 */
function openidFromContext(context) {
  if (!context) return null;
  const candidates = [
    context.headers,
    context.event && context.event.headers,
    context.request && context.request.headers,
    context,
  ];
  for (const headers of candidates) {
    for (const name of OPENID_HEADERS) {
      const value = headerOf(headers, name);
      if (value) return value;
    }
  }
  return null;
}

module.exports = { OPENID_HEADERS, headerOf, openidFromContext };
