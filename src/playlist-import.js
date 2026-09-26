// 声浪 SongWave · 外部歌单导入（对齐 外部播放器 的“导入外部歌单”）
// 支持：
//   1) 粘贴分享文本 / 链接（自动提取 URL 与平台，网易云 / QQ 音乐）
//   2) 纯文本歌单（每行「歌名 - 歌手」）→ 生成待解析条目，播放时用当前音源搜索后播放
//   3) 本地歌单文件（.txt / .json）
// 纯 Node（fetch 可注入），便于离线测试
'use strict';

const URL_RE = /https?:\/\/[^\s'"<>）)】]+/g;

/** 从任意分享文本里提取链接（LX 的分享文本常带密码、说明文字） */
function extractUrls(text) {
  const m = String(text || '').match(URL_RE);
  return m ? m.map((u) => u.replace(/[.,;，。；]+$/, '')) : [];
}

/** 识别链接属于哪个平台与歌单 id */
function parsePlaylistUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return null; }
  const host = u.hostname.toLowerCase();
  const q = u.searchParams;
  if (host.includes('music.163.com') || host.includes('163cn.tv') || host.includes('y.music.163.com')) {
    // https://music.163.com/#/playlist?id=123  /  .../playlist/123
    let id = q.get('id');
    if (!id) {
      const m = u.pathname.match(/playlist\/(\d+)/) || String(u.hash || '').match(/id=(\d+)/);
      if (m) id = m[1];
    }
    if (id) return { platform: 'netease', id, source: 'netease' };
  }
  if (host.includes('y.qq.com') || host.includes('i.y.qq.com') || host.includes('c6.y.qq.com') || host.includes('qq.com')) {
    let id = q.get('id') || q.get('disstid');
    if (!id) {
      const m = u.pathname.match(/playlist\/(\d+)/);
      if (m) id = m[1];
    }
    if (id) return { platform: 'qq', id, source: 'qq', extKey: 'tx' };
  }
  return null;
}

/** 纯文本歌单：每行「歌名 - 歌手」/「歌名」 */
function parseTextPlaylist(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s || /^https?:/i.test(s)) return;
    const parts = s.split(/\s+[-–—]\s+/);
    const name = (parts[0] || '').trim();
    const artist = (parts[1] || '').trim();
    if (!name) return;
    out.push({ name, artist, source: 'search', type: 'pending' });
  });
  return out;
}

function msOf(sec) {
  const n = Number(sec) || 0;
  return n > 0 ? Math.round(n * 1000) : 0;
}

/** 网易云歌单详情 → 统一条目 */
function mapNeteasePlaylist(j) {
  const pl = (j && (j.playlist || (j.result && j.result.playlist))) || {};
  const tracks = (pl.tracks || (j && j.result && j.result.tracks) || []);
  return {
    name: pl.name || '网易云歌单',
    cover: pl.coverImgUrl || '',
    items: tracks.map((t) => ({
      id: String(t.id),
      name: t.name || '',
      artist: (t.ar || t.artists || []).map((a) => a.name).filter(Boolean).join(' / '),
      album: (t.al && t.al.name) || (t.album && t.album.name) || '',
      cover: (t.al && t.al.picUrl) || (t.album && t.album.picUrl) || '',
      durationMs: msOf((t.dt || t.duration || 0) / 1000),
      source: 'netease',
    })).filter((x) => x.id),
  };
}

/** QQ 歌单详情 → 统一条目 */
function mapQqPlaylist(j) {
  const cd = (j && j.cdlist && j.cdlist[0]) || {};
  const songs = cd.songlist || [];
  return {
    name: cd.dissname || 'QQ歌单',
    cover: cd.logo || '',
    items: songs.map((s) => ({
      id: String(s.songmid || s.mid || ''),
      songmid: s.songmid || s.mid || '',
      name: s.songname || s.name || '',
      artist: Array.isArray(s.singer) ? s.singer.map((x) => x.name).filter(Boolean).join(' / ') : (s.singer || ''),
      album: s.albumname || '',
      cover: s.albummid ? ('https://y.gtimg.cn/music/photo_new/T002R300x300M000' + s.albummid + '.jpg') : '',
      durationMs: msOf(s.interval),
      source: 'qq',
      extKey: 'tx',
    })).filter((x) => x.id),
  };
}

/**
 * 创建歌单导入器
 * @param {object} opts { fetchImpl }
 */
function createPlaylistImporter(opts = {}) {
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

  async function getJson(url, headers) {
    const res = await fetchImpl(url, { headers: Object.assign({ 'User-Agent': UA }, headers || {}), redirect: 'follow' });
    if (!res || !res.ok) throw new Error('HTTP ' + ((res && res.status) || '?'));
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new Error('返回不是 JSON'); }
  }

  async function fetchNetease(id) {
    // 官方 web 接口；不同版本字段位置略有差异，两种都兼容
    const j = await getJson('https://music.163.com/api/v6/playlist/detail?id=' + encodeURIComponent(id) + '&n=1000', {
      Referer: 'https://music.163.com/',
      Cookie: 'appver=2.0.2',
    });
    return mapNeteasePlaylist(j);
  }

  async function fetchQq(id) {
    const url = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&format=json&disstid=' +
      encodeURIComponent(id);
    const j = await getJson(url, { Referer: 'https://y.qq.com/' });
    return mapQqPlaylist(j);
  }

  /**
   * 主入口：粘贴分享文本 / 链接 / 纯文本
   * @returns {Promise<{name:string, cover:string, platform:string, items:Array, urls:string[], text:Array}>}
   */
  async function importFromText(text) {
    const urls = extractUrls(text);
    if (urls.length) {
      const parsed = parsePlaylistUrl(urls[0]);
      if (!parsed) throw new Error('无法识别这个链接（目前支持网易云 / QQ 音乐歌单链接）');
      if (parsed.platform === 'netease') {
        const r = await fetchNetease(parsed.id);
        return Object.assign({ platform: 'netease', urls, text: [] }, r);
      }
      const r = await fetchQq(parsed.id);
      return Object.assign({ platform: 'qq', urls, text: [] }, r);
    }
    const items = parseTextPlaylist(text);
    if (!items.length) throw new Error('没有识别到歌单内容：请粘贴歌单链接，或每行一首「歌名 - 歌手」');
    return { name: '文本歌单', cover: '', platform: 'text', items, urls: [], text: items };
  }

  return { importFromText, extractUrls, parsePlaylistUrl, parseTextPlaylist, mapNeteasePlaylist, mapQqPlaylist };
}

module.exports = { createPlaylistImporter, extractUrls, parsePlaylistUrl, parseTextPlaylist, mapNeteasePlaylist, mapQqPlaylist };