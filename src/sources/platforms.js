// 声浪 SongWave · 多平台音源（QQ / 酷狗 / 酷我 / 咪咕）
// 搜索走各平台公开 JSON 接口；**播放取链交给 扩展音源脚本**（flower 已支持 kw/tx/wy/kg/mg）
// 每个平台保留“原生 ID 字段”（songmid/hash/copyrightId），这是 扩展音源脚本取链所必需的
'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function getJson(url, headers) {
  const res = await fetch(url, {
    headers: Object.assign({ 'User-Agent': UA }, headers || {}),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error('返回不是 JSON'); }
}

function msFromSeconds(s) {
  const n = Number(s) || 0;
  return n > 0 ? Math.round(n * 1000) : 0;
}

// —— QQ 音乐（扩展源: tx） ——
const qq = {
  key: 'qq',
  label: 'QQ音乐',
  extKey: 'tx',
  platform: 'qq',
  async search(keywords, limit = 20) {
    const url = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?new_json=1&format=json&p=1&n=' +
      encodeURIComponent(limit) + '&w=' + encodeURIComponent(keywords);
    const j = await getJson(url, { Referer: 'https://y.qq.com/' });
    const list = (((j || {}).data || {}).song || {}).list || [];
    return list.map((it) => ({
      id: String(it.songmid || it.mid || ''),
      songmid: it.songmid || it.mid || '',
      name: it.songname || it.name || it.title || '',
      artist: (it.singer || []).map((s) => s.name).filter(Boolean).join(' / '),
      album: it.albumname || (it.album && it.album.name) || '',
      cover: it.albummid ? ('https://y.gtimg.cn/music/photo_new/T002R300x300M000' + it.albummid + '.jpg') : '',
      durationMs: msFromSeconds(it.interval),
      source: 'qq',
      extKey: 'tx',
    })).filter((x) => x.id);
  },
};

// —— 酷狗（扩展源: kg） ——
const kugou = {
  key: 'kugou',
  label: '酷狗',
  extKey: 'kg',
  platform: 'kugou',
  async search(keywords, limit = 20) {
    const url = 'https://mobilecdn.kugou.com/api/v3/search/song?format=json&showtype=1&page=1&pagesize=' +
      encodeURIComponent(limit) + '&keyword=' + encodeURIComponent(keywords);
    const j = await getJson(url);
    const list = (((j || {}).data || {}).info) || [];
    return list.map((it) => ({
      id: String(it.hash || it.audio_id || ''),
      hash: it.hash || '',
      albumId: it.album_id || '',
      name: it.songname || '',
      artist: it.singername || '',
      album: it.albumname || '',
      cover: '',
      durationMs: msFromSeconds(it.duration),
      source: 'kugou',
      extKey: 'kg',
    })).filter((x) => x.id);
  },
};

// —— 酷我（扩展源: kw） ——
const kuwo = {
  key: 'kuwo',
  label: '酷我',
  extKey: 'kw',
  platform: 'kuwo',
  async search(keywords, limit = 20) {
    const url = 'http://www.kuwo.cn/api/www/search/searchMusicBykeyWord?httpsStatus=1&pn=1&rn=' +
      encodeURIComponent(limit) + '&key=' + encodeURIComponent(keywords);
    const j = await getJson(url, { Referer: 'http://www.kuwo.cn/', csrf: '' });
    const list = (((j || {}).data || {}).list) || [];
    return list.map((it) => ({
      id: String(it.rid || ''),
      songmid: String(it.rid || ''),   // 酷我取链需要 rid，flower 读的是 songmid
      name: it.name || '',
      artist: it.artist || '',
      album: it.album || '',
      cover: it.pic || '',
      durationMs: msFromSeconds(it.duration),
      source: 'kuwo',
      extKey: 'kw',
    })).filter((x) => x.id);
  },
};

// —— 咪咕（扩展源: mg） ——
const migu = {
  key: 'migu',
  label: '咪咕',
  extKey: 'mg',
  platform: 'migu',
  async search(keywords, limit = 20) {
    const url = 'https://m.music.migu.cn/migu/remoting/scr_search_tag?type=2&pgc=1&rows=' +
      encodeURIComponent(limit) + '&keyword=' + encodeURIComponent(keywords);
    const j = await getJson(url, { Referer: 'https://m.music.migu.cn/' });
    const list = (j || {}).musics || ((j || {}).data || {}).musics || [];
    return list.map((it) => ({
      id: String(it.id || it.copyrightId || ''),
      copyrightId: it.copyrightId || it.id || '',
      hash: it.hash || '',
      name: it.songName || it.title || '',
      artist: it.singerName || '',
      album: it.albumName || '',
      cover: it.cover || it.albumPic || '',
      durationMs: 0,
      source: 'migu',
      extKey: 'mg',
    })).filter((x) => x.id);
  },
};

const PLATFORMS = [qq, kugou, kuwo, migu];

module.exports = { qq, kugou, kuwo, migu, PLATFORMS, getJson };