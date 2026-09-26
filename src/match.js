// 声浪 SongWave · 换源匹配打分（纯函数，便于离线测试）
// 用途：某首歌在原平台取链失败时，用「歌名 + 歌手」到其它平台找同一首歌
'use strict';

/** 归一化歌名：去括号内容、标点、空格、大小写、常见后缀 */
function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, ' ')          // 去掉 (Live) 【HQ】 等
    .replace(/\b(feat|ft)\b\.?.*$/i, ' ')                    // feat. 之后通常是合作歌手，整段去掉
    .replace(/\b(remix|version|ver|live|cover|inst|instrumental|demo)\b\.?/g, ' ')
    .replace(/[\s\-_·.,!?'"“”‘’~!@#$%^&*+=|\\/<>:;：；、，。！？…]/g, '')
    .trim();
}

/** 归一化歌手串 -> 名字数组 */
function artistList(s) {
  return String(s || '')
    .split(/[\/,、;&]|feat\.?|ft\.?/i)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function similar(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length > 1 && b.length > 1 && (a.includes(b) || b.includes(a))) return 0.75;
  // 字符级 Jaccard，兼容「晴天」vs「晴天(钢琴版)」这类
  const A = new Set(a.split(''));
  const B = new Set(b.split(''));
  let inter = 0;
  A.forEach((c) => { if (B.has(c)) inter++; });
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/**
 * 给候选歌曲打分
 * @param {{name:string, artist?:string, durationMs?:number}} query 原曲
 * @param {{name:string, artist?:string, durationMs?:number}} cand 候选
 * @returns {number} 0~140，<40 视为不匹配
 */
function scoreMatch(query, cand) {
  const qn = normalizeTitle(query && query.name);
  const cn = normalizeTitle(cand && cand.name);
  if (!qn || !cn) return 0;
  const ts = similar(qn, cn);
  let score = ts * 90;

  const qa = artistList(query && query.artist);
  const ca = artistList(cand && cand.artist);
  if (qa.length && ca.length) {
    const hit = qa.some((a) => ca.some((b) => b === a || (a.length > 1 && b.length > 1 && (a.includes(b) || b.includes(a)))));
    score += hit ? 30 : -12;
  }

  const qd = Number(query && query.durationMs) || 0;
  const cd = Number(cand && cand.durationMs) || 0;
  if (qd > 0 && cd > 0) {
    const diff = Math.abs(qd - cd) / 1000;
    if (diff <= 3) score += 18;
    else if (diff <= 8) score += 9;
    else if (diff > 25) score -= 12;
  }
  return Math.round(score);
}

/**
 * 从各平台搜索结果里挑出可用的替代源
 * @param {{name:string, artist?:string, durationMs?:number}} query
 * @param {Array<Array>} groups 每个平台一个数组
 * @param {object} [opts] { excludeSources: string[], limit: number, minScore: number }
 */
function pickAlternatives(query, groups, opts = {}) {
  const exclude = new Set(opts.excludeSources || []);
  const limit = opts.limit || 6;
  const minScore = opts.minScore == null ? 45 : opts.minScore;
  const out = [];
  const seen = new Set();
  (groups || []).forEach((list) => {
    (list || []).forEach((cand) => {
      if (!cand) return;
      const key = (cand.source || '') + ':' + (cand.id || '');
      if (seen.has(key)) return;
      if (exclude.has(cand.source)) return;
      const score = scoreMatch(query, cand);
      if (score < minScore) return;
      seen.add(key);
      out.push(Object.assign({}, cand, { _score: score }));
    });
  });
  out.sort((a, b) => b._score - a._score);
  return out.slice(0, limit);
}

module.exports = { normalizeTitle, artistList, similar, scoreMatch, pickAlternatives };