'use strict';

/**
 * AI 对手（Ghost）（《项目说明书》§2.2「异步实时说明」+ §6.4「对手能量产出模型」）
 *
 * 定位：对手侧默认由**服务端模拟 AI**，玩家体感上仍是 1v1 实时拔河，不区分对手身份。
 * 这也是弱网兜底方案：关键逻辑本地化 + AI 兜底，服务端只做校验与排名（§5.4）。
 *
 * 命中率模型：
 *   **逐段**（不是每轮一次）先按难度档 `oppHit` 掷骰是否命中（命中则按 §6.2 同口径吃连击加成，
 *   并加 ±10% 浮动）；未命中时，再按 `oppMiss` 掷骰决定是「点错扣分」还是「空轮不计」。
 *   —— 与玩家侧**逐段对称**：玩家每点一段、AI 就在同一段掷一次骰（见核心循环 core/battle.js#submit）。
 *   最后叠加**平衡兜底**（对玩家不可见）：玩家落后超过 0.5×越线阈值时对手命中率 -8%（连败保护），
 *   玩家领先超过 0.5×越线阈值时 +5%（防碾压）。阈值以比例表达，随越线阈值自动跟随（§6.4）。
 */

const { DIFFICULTY, DEFAULT_DIFFICULTY, BALANCE, WIN_NET_ENERGY } = require('../config/config.js');
const { createEnergyState, applyHit, applyMiss, applyTimeout } = require('./energy.js');

/**
 * 创建对手状态；非法难度 key 回落默认档。
 * @param {string} difficultyKey easy | normal | hard | hell
 * @param {{oppHit?:number, oppMiss?:number, winNetEnergy?:number}} [overrides]
 *   闯关模式覆盖项（§4.8 / §6.7）：命中率 / 失误率取自 core/levels.js#levelConfig（已含陪练弱化），
 *   越线阈值用于**平衡兜底的比例换算**。缺省时与普通对战完全一致。
 */
function createGhost(difficultyKey, overrides) {
  const key = DIFFICULTY[difficultyKey] ? difficultyKey : DEFAULT_DIFFICULTY;
  const diff = DIFFICULTY[key];
  const o = overrides || {};
  return {
    difficulty: key,
    oppHit: o.oppHit === undefined ? diff.oppHit : o.oppHit,
    oppMiss: o.oppMiss === undefined ? diff.oppMiss : o.oppMiss,
    winNetEnergy: o.winNetEnergy === undefined ? WIN_NET_ENERGY : o.winNetEnergy,
    state: createEnergyState(),
  };
}

/**
 * 计入平衡兜底后的实际命中率。阈值以**比例**表达（`BALANCE.*Ratio × 本局越线阈值`，
 * 普通对战 = 160，闯关模式 = `winNetEnergyOf(level)`，§6.7），保持「改一个数，处处跟随」。
 * @param {object} ghost 对手状态
 * @param {number} playerEnergy 我方当前能量
 */
function effectiveHitRate(ghost, playerEnergy) {
  const winNetEnergy = ghost.winNetEnergy === undefined ? WIN_NET_ENERGY : ghost.winNetEnergy;
  const lead = playerEnergy - ghost.state.energy; // 正 = 我方领先
  let rate = ghost.oppHit;
  if (lead > BALANCE.winThresholdRatio * winNetEnergy) rate += BALANCE.winAid;
  else if (lead < -BALANCE.loseThresholdRatio * winNetEnergy) rate -= BALANCE.loseAid;
  return Math.max(0, Math.min(1, rate));
}

/**
 * 推进对手**一段**（一名玩家点一段 = AI 掷一次骰，逐段对称）。
 * @param {object} ghost 对手状态
 * @param {number} playerEnergy 我方当前能量（用于平衡兜底）
 * @param {() => number} rand 伪随机源
 * @returns {{state:object, gained:number, hit:boolean, hitRate:number}} 新对手状态 + 本段净变化
 */
function stepGhost(ghost, playerEnergy, rand) {
  const hitRate = effectiveHitRate(ghost, playerEnergy);
  let state;
  let hit;
  if (rand() < hitRate) {
    hit = true;
    // §6.4：加入 ±10% 随机浮动，制造「势均力敌」的紧张感
    state = applyHit(ghost.state, 0.9 + 0.2 * rand());
  } else {
    hit = false;
    state = rand() < ghost.oppMiss ? applyMiss(ghost.state) : applyTimeout(ghost.state);
  }
  return { state, gained: state.lastGain, hit, hitRate };
}

module.exports = { createGhost, effectiveHitRate, stepGhost };
