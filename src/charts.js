// 声浪 SongWave · 排行榜与歌单推荐
// 榜单：网易云 / QQ音乐 / 酷狗；推荐：网易云个性化推荐歌单
// 纯 Node（fetch 可注入），便于离线测试
'use strict';

const { mapNeteasePlaylist, mapQqPlaylist } = require('./playlist-import');

// 榜单定义（id 为各平台公开榜单 id）
const CHARTS = {
  netease: [
    { id: '3778678', name: '热歌榜' },
    { id: '3779629', name: '新歌榜' },
    { id: '19723756', name: '飙升榜' },
    { id: '2884035', name: '原创榜' },
    { id: '3778678', name: '云音乐热歌榜' },
  ],
  qq: [
    { id: '26', name: '热歌榜' },
    { id: '4', name: '新歌榜' },
    { id: '27', name: '欧美榜' },
    { id: '58', name: '日本榜' },
    { id: '62', name: '韩流榜' },
  ],
  kugou: [
    { id: '8888', name: 'TOP500' },
    { id: '6666', name: '飙升榜' },
    { id: '23784', name: '网络红歌榜' },
  ],
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function msOf(sec) {
  const n = Number(sec) || 0;
  return n > 0 ? Math.round(n * 1000) : 0;
}

/** QQ 榜单响应 -> 统一条目 */
function mapQqTopList(j) {
  const list = (j && j.songlist) || [];
  return list.map((row) => {
    const s = row && row.data ? row.data : row;
    if (!s) return null;
    return {
      id: String(s.songmid || s.mid || ''),
      songmid: s.songmid || s.mid || '',
      name: s.songname || s.name || '',
      artist: Array.isArray(s.singer) ? s.singer.map((x) => x.name).filter(Boolean).join(' / ') : (s.singer || ''),
      album: s.albumname || (s.album && s.album.name) || '',
      cover: s.albummid ? ('https://y.gtimg.cn/music/photo_new/T002R300x300M000' + s.albummid + '.jpg') : '',
      durationMs: msOf(s.interval),
      source: 'qq',
      extKey: 'tx',
    };
  }).filter((x) => x && x.id);
}

/** 酷狗榜单响应 -> 统一条目 */
function mapKugouRank(j) {
  const list = (j && j.data && j.data.info) || [];
  return list.map((s) => ({
    id: String(s.hash || s.audio_id || ''),
    hash: s.hash || '',
    albumId: s.album_id || '',
    name: s.songname || '',
    artist: s.singername || '',
    album: s.albumname || '',
    cover: '',
    durationMs: msOf(s.duration),
    source: 'kugou',
    extKey: 'kg',
  })).filter((x) => x.id);
}

/** 网易云个性化推荐响应 -> 歌单列表 */
function mapNeteaseRecommend(j) {
  const list = (j && (j.result || j.data)) || [];
  return list.map((p) => ({
    id: String(p.id),
    name: p.name || '',
    cover: p.picUrl || p.coverImgUrl || '',
    playCount: Number(p.playCount) || 0,
    trackCount: Number(p.trackCount) || 0,
    platform: 'netease',
  })).filter((x) => x.id);
}

function createCharts(opts = {}) {
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));

  async function getJson(url, headers) {
    const res = await fetchImpl(url, { headers: Object.assign({ 'User-Agent': UA }, headers || {}), redirect: 'follow' });
    if (!res || !res.ok) throw new Error('HTTP ' + ((res && res.status) || '?'));
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new Error('返回不是 JSON'); }
  }

  /** 列出某平台的榜单 */
  function list(platform) {
    const key = platform || 'netease';
    const arr = CHARTS[key] || [];
    // 去重同名
    const seen = new Set();
    return arr.filter((c) => {
      if (seen.has(c.id + c.name)) return false;
      seen.add(c.id + c.name);
      return true;
    }).map((c) => Object.assign({ platform: key }, c));
  }

  /** 拉取榜单歌曲 */
  async function fetchChart(platform, id, limit = 50) {
    const key = platform || 'netease';
    if (key === 'netease') {
      const j = await getJson('https://music.163.com/api/v6/playlist/detail?id=' + encodeURIComponent(id) + '&n=' + limit,
        { Referer: 'https://music.163.com/', Cookie: 'appver=2.0.2' });
      const r = mapNeteasePlaylist(j);
      return { name: r.name, cover: r.cover, items: r.items.slice(0, limit), platform: 'netease' };
    }
    if (key === 'qq') {
      const url = 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=' + encodeURIComponent(id) +
        '&format=json&page=detail&type=top&tpl=3&song_begin=0&song_num=' + limit;
      const j = await getJson(url, { Referer: 'https://y.qq.com/' });
      return { name: 'QQ榜单 ' + id, cover: '', items: mapQqTopList(j).slice(0, limit), platform: 'qq' };
    }
    if (key === 'kugou') {
      const url = 'https://mobilecdn.kugou.com/api/v3/rank/song?rankid=' + encodeURIComponent(id) +
        '&page=1&pagesize=' + limit + '&format=json';
      const j = await getJson(url);
      return { name: '酷狗榜单 ' + id, cover: '', items: mapKugouRank(j).slice(0, limit), platform: 'kugou' };
    }
    throw new Error('不支持的平台：' + key);
  }

  /** 网易云个性化推荐歌单 */
  async function recommend(limit = 12) {
    const j = await getJson('https://music.163.com/api/personalized/playlist?limit=' + Math.max(1, Math.min(50, limit)),
      { Referer: 'https://music.163.com/' });
    return mapNeteaseRecommend(j);
  }

  /** 载入某个推荐歌单的歌曲（复用歌单详情） */
  async function fetchPlaylist(platform, id, limit = 200) {
    return fetchChart(platform || 'netease', id, limit);
  }

  return { list, fetchChart, recommend, fetchPlaylist, platforms: Object.keys(CHARTS) };
}

module.exports = { createCharts, CHARTS, mapQqTopList, mapKugouRank, mapNeteaseRecommend };