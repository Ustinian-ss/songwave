// 声浪 SongWave · 音源层：网易云音乐（免签名公开接口）
// 说明：搜索用官方 web 搜索接口；播放用 outer/url 直链（无需登录）。
// 部分 VIP / 版权受限歌曲会返回 404/空流，属预期行为。
'use strict';

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
 * @param {number|string} id
 * @returns {Promise<string>}
 */
async function getPlayUrl(id) {
  const nid = Number(id);
  if (!Number.isFinite(nid) || nid <= 0) throw new Error('无效歌曲 id');
  return 'https://music.163.com/song/media/outer/url?id=' + nid + '.mp3';
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