// 声浪 SongWave · 音源层：网易云音乐（免签名公开接口）
// 说明：搜索用官方 web 搜索接口；播放用 outer/url 直链（无需登录）。
// 部分 VIP / 版权受限歌曲会返回 404/空流，属预期行为。
'use strict';

const { probeAudio } = require('../audio-probe');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function httpJson(url, options = {}) {
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'User-Agent': UA,
      Referer: 'https://music.163.com/',
      ...(options.headers || {}),
    },
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * 搜索歌曲
 * @param {string} keywords
 * @param {number} limit
 * @returns {Promise<Array>} [{ id, name, artist, album, cover, durationMs, source:'netease' }]
 */
async function search(keywords, limit = 20) {
  const url =
    'https://music.163.com/api/search/get/web' +
    '?s=' + encodeURIComponent(keywords) +
    '&type=1&offset=0&total=true&limit=' + limit;
  const data = await httpJson(url);
  const songs = data && data.result && data.result.songs;
  if (!Array.isArray(songs)) return [];
  return songs.map((s) => ({
    id: s.id,
    name: s.name || '',
    artist: (s.artists || []).map((a) => a.name).join(' / '),
    album: (s.album && s.album.name) || '',
    cover: (s.album && s.album.picUrl) || '',
    durationMs: s.duration || 0,
    source: 'netease',
  }));
}

/**
 * 获取可播放直链（外链接口，返回 302 到真实 mp3）
 *
 * 注意：网易云**歌词接口有授权、播放接口不一定有**。无版权/VIP 歌曲这里会 302 到
 * https://music.163.com/404（text/html），音频元素只会静默失败 —— 所以默认探测一次响应头，
 * 拿不到音频就直接抛错，让上层走「自动换源」，而不是让用户对着歌词听空气。
 * @param {number|string} id
 * @param {{validate?: boolean, timeout?: number}} [opts] validate=false 可跳过探测（离线测试用）
 * @returns {Promise<string>}
 */
const probeCache = new Map();   // id → { at, res }，10 分钟内复用，避免每次播放都多一次请求

async function getPlayUrl(id, opts = {}) {
  const nid = Number(id);
  if (!Number.isFinite(nid) || nid <= 0) throw new Error('无效歌曲 id');
  const url = 'https://music.163.com/song/media/outer/url?id=' + nid + '.mp3';
  if (opts.validate === false) return url;

  const cached = probeCache.get(nid);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
    if (!cached.res.ok && !cached.res.unknown) throw new Error(playUrlError(cached.res));
    return url;
  }
  const res = await probeAudio(url, {
    timeout: opts.timeout || 4000,
    headers: { Referer: 'https://music.163.com/' },
  });
  probeCache.set(nid, { at: Date.now(), res });
  if (!res.ok && !res.unknown) throw new Error(playUrlError(res));
  return url;
}

function playUrlError(res) {
  return '网易云没有该歌曲的播放版权（' + (res.reason || '未知原因') + '）';
}

/**
 * 获取歌词（免登录公开接口；返回原始 LRC 文本）
 * @param {number|string} id
 * @returns {Promise<{lrc: string, tlyric: string}>}
 */
async function getLyric(id) {
  const nid = Number(id);
  if (!Number.isFinite(nid) || nid <= 0) throw new Error('无效歌曲 id');
  // rv=1 取罗马音（日文歌），tv=-1 取翻译
  const url = 'https://music.163.com/api/song/lyric?id=' + nid + '&lv=1&kv=1&tv=-1&rv=1';
  const data = await httpJson(url);
  return {
    lrc: (data && data.lrc && data.lrc.lyric) || '',
    tlyric: (data && data.tlyric && data.tlyric.lyric) || '',
    romalrc: (data && data.romalrc && data.romalrc.lyric) || '',
  };
}

module.exports = { search, getPlayUrl, getLyric };