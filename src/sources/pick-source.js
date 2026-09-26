// 声浪 SongWave · 取链音源候选排序（纯函数，便于离线测试）
//
// 为什么需要它：用户可能同时装了同一平台的多个音源脚本（实测就出现过
// 两条都叫「野花🌷」：旧版域名已废弃、新版可用）。以前只取"第一个支持该平台的脚本"，
// 于是永远撞在坏的那条上；这里按健康度排序，好坏一目了然，且**不会剔除**
// （只有一个候选时仍然要试，否则会误判成"没有可用音源"）。
'use strict';

const DEFAULT_COOLDOWN = 5 * 60 * 1000;   // 失败后的冷却期：这段时间内把它排到最后

/**
 * @param {Array<{id:string}>} candidates 支持该动作的音源候选（保持原始顺序）
 * @param {Map<string,{okAt?:number,failAt?:number,reason?:string}>} health 健康度表
 * @param {{now?:number,cooldown?:number}} [opts]
 * @returns {Array} 排序后的候选（新数组，不修改入参）
 */
function orderCandidates(candidates, health, opts = {}) {
  const now = Number(opts.now) || Date.now();
  const cooldown = Number(opts.cooldown) || DEFAULT_COOLDOWN;
  const rank = (c) => {
    const h = (health && typeof health.get === 'function' && health.get(c.id)) || {};
    // 冷却期内失败过、且之后没成功过 → 排最后
    const failedRecently = !!(h.failAt && (now - h.failAt) < cooldown && !(h.okAt && h.okAt > h.failAt));
    if (failedRecently) return 2;
    if (h.okAt) return 0;   // 最近成功过 → 最优先
    return 1;               // 没试过 → 居中
  };
  return candidates
    .map((c, i) => ({ c: c, i: i, r: rank(c) }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))   // 同档保持原顺序（稳定）
    .map((o) => o.c);
}

/** 记录一次取链结果（成功清空失败标记，失败记录原因与时间） */
function markHealth(health, id, ok, detail, now) {
  const t = Number(now) || Date.now();
  const h = health.get(id) || {};
  if (ok) {
    h.okAt = t;
    h.fails = 0;
    h.reason = '';
  } else {
    h.failAt = t;
    h.fails = (h.fails || 0) + 1;
    h.reason = String(detail || '').slice(0, 160);
  }
  health.set(id, h);
  return h;
}

module.exports = { orderCandidates, markHealth, DEFAULT_COOLDOWN };
