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

/** 老接口返回的文本里带 HTML 实体（&nbsp; / &amp; 等），要还原 */
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 纯文本响应（如酷我 anti.s 直接返回一个播放地址） */
async function getText(url, headers) {
  const res = await fetch(url, {
    headers: Object.assign({ 'User-Agent': UA }, headers || {}),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
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
    // 酷狗有多个 CDN 域名，逐个尝试（mobilecdn 在部分网络已不可达）
    const qs = 'api/v3/search/song?format=json&showtype=1&page=1&pagesize=' + encodeURIComponent(limit) + '&keyword=' + encodeURIComponent(keywords);
    const hosts = ['https://mobiles.kugou.com/', 'https://msearchcdn.kugou.com/', 'https://mobilecdn.kugou.com/'];
    let j = null;
    let lastErr = null;
    for (const h of hosts) {
      try { j = await getJson(h + qs); break; } catch (e) { lastErr = e; }
    }
    if (!j) throw lastErr || new Error('酷狗接口不可用');
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
// 搜索：www.kuwo.cn/api/www/* 现在要求 csrf token，无 token 一律回 "The request is illegal!"，
//       所以走仍然可用的 www 老接口 search.kuwo.cn/r.s（rformat=json 返回标准 JSON 的 abslist）。
// 取链：anti.s convert_url 直接返回一个 mp3 地址（无需 token）。
//       注意会员/版权歌曲它只给**试听片段**（实测约 11 秒），由上层用 audio-probe 判定并提示。
const KUWO_UA_QS = '&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1' +
  '&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&mobi=1&issubtitle=1';

const kuwo = {
  key: 'kuwo',
  label: '酷我',
  extKey: 'kw',
  platform: 'kuwo',
  async search(keywords, limit = 20) {
    const url = 'http://search.kuwo.cn/r.s?client=kt&all=' + encodeURIComponent(keywords) +
      '&pn=0&rn=' + encodeURIComponent(limit) + KUWO_UA_QS;
    const j = await getJson(url, { Referer: 'http://www.kuwo.cn/' });
    const list = (j && j.abslist) || [];
    return list.map((it) => {
      const rid = String(it.MUSICRID || it.DC_TARGETID || '').replace(/^MUSIC_/, '');
      const short = String(it.web_albumpic_short || '');
      return {
        id: rid,
        songmid: rid,                       // 扩展音源脚本（flower/kw）读的是 songmid
        rid: rid,
        musicrid: 'MUSIC_' + rid,
        name: decodeEntities(it.NAME || it.SONGNAME),
        artist: decodeEntities(it.ARTIST || it.AARTIST),
        album: decodeEntities(it.ALBUM),
        cover: short ? ('https://img1.kuwo.cn/star/albumcover/' + short.replace(/^\//, '')) : '',
        durationMs: msFromSeconds(it.DURATION),
        source: 'kuwo',
        extKey: 'kw',
      };
    }).filter((x) => x.id);
  },
  /**
   * 内置原生取链（无需任何扩展音源脚本）
   * @param {{songmid?:string,id?:string,rid?:string,musicrid?:string}} song
   * @returns {Promise<string>} 播放地址
   */
  async getPlayUrl(song) {
    const raw = String((song && (song.musicrid || song.songmid || song.rid || song.id)) || '');
    const rid = raw.replace(/^MUSIC_/, '').trim();
    if (!/^\d+$/.test(rid)) throw new Error('无效的酷我 rid：' + raw);
    const api = 'http://antiserver.kuwo.cn/anti.s?type=convert_url&rid=MUSIC_' + rid + '&format=mp3&response=url';
    const text = String(await getText(api, { Referer: 'http://www.kuwo.cn/' })).trim();
    if (!/^https?:\/\//i.test(text)) {
      throw new Error('酷我未返回播放地址：' + text.slice(0, 60));
    }
    return text;
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