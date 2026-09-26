// 声浪 SongWave · 已解析播放地址缓存（纯 Node，无依赖）
//
// 为什么需要：在线取链有两条铁律 ——
//   ① 平台接口会变、音源脚本的后端会挂（实测 flower 后端 97.64.37.235 已返回 404）；
//   ② 但**已经解析出来的地址往往是 CDN 直链，还能长期播放**（实测 LX 两个月前的缓存地址现在仍 200）。
// 其它播放器（LX）正是靠一张「歌曲 → 已解析地址」的表，在源失效后仍能继续播。
// 这里实现同样的机制：命中缓存先验证再播放，播放成功后写回。
'use strict';

const fs = require('fs');
const path = require('path');

// 音源代码别名：本应用用 netease/qq/kugou/kuwo/migu，其它播放器（LX）用 wy/tx/kg/kw/mg。
// canonSource 必须幂等（canon(canon(x)) === canon(x)），否则 kuwo→kw→netease 会串味。
const SRC_CANON = { netease: 'wy', qq: 'tx', kugou: 'kg', kuwo: 'kw', migu: 'mg' };
function canonSource(s) {
  const k = String(s || '');
  return SRC_CANON[k] || k;   // wy/tx/kg/kw/mg 原样保留
}

function createUrlCache(file) {
  let data = null;
  const MAX = 5000;   // 上限，超出后丢最旧的

  function load() {
    if (data) return data;
    data = {};
    try {
      if (fs.existsSync(file)) {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (j && typeof j === 'object') data = j;
      }
    } catch (e) { data = {}; }
    return data;
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const keys = Object.keys(data);
      if (keys.length > MAX) {
        keys.sort((a, b) => (data[a].at || 0) - (data[b].at || 0));
        keys.slice(0, keys.length - MAX).forEach((k) => { delete data[k]; });
      }
      fs.writeFileSync(file, JSON.stringify(data));
    } catch (e) { /* 缓存写失败不影响播放 */ }
  }

  const keyOf = (source, id, quality) => canonSource(source) + ':' + String(id || '') + (quality ? (':' + quality) : '');

  return {
    keyOf: keyOf,
    canonSource: canonSource,
    /** 取缓存地址（不做网络验证，由调用方 probe） */
    get(source, id, quality) {
      const d = load();
      const hit = d[keyOf(source, id, quality)];
      if (hit) return hit;
      // 音质不同的同一首歌也可以先用（能播总比没声好）
      const prefix = canonSource(source) + ':' + String(id) + ':';
      const loose = Object.keys(d).find((x) => x.indexOf(prefix) === 0);
      return loose ? d[loose] : null;
    },
    set(source, id, url, meta) {
      if (!url) return false;
      const d = load();
      d[keyOf(source, id, meta && meta.quality)] = {
        url: String(url),
        at: Date.now(),
        from: (meta && meta.from) || '',
        name: (meta && meta.name) || '',
      };
      save();
      return true;
    },
    remove(source, id, quality) {
      const d = load();
      delete d[keyOf(source, id, quality)];
      save();
    },
    stats() {
      const d = load();
      const bySource = {};
      Object.keys(d).forEach((k) => {
        const s = k.split(':')[0];
        bySource[s] = (bySource[s] || 0) + 1;
      });
      return { total: Object.keys(d).length, bySource: bySource, file: file };
    },
    /** 批量导入（key 形如 kw:239211505[:128k]，与其它播放器的缓存对应） */
    importPairs(pairs) {
      const d = load();
      let added = 0;
      (pairs || []).forEach((p) => {
        if (!p || !p.key || !p.url) return;
        if (d[p.key] && d[p.key].url === p.url) return;
        d[p.key] = { url: String(p.url), at: Date.now(), from: (p.from || 'import'), name: p.name || '' };
        added++;
      });
      save();
      return added;
    },
  };
}

/**
 * 从其它播放器（LX Music）的 SQLite 数据库里提取「歌曲 → 已解析地址」记录。
 * 不引入 SQLite 依赖：music_url 表的记录里 id 与 url 相邻存放，用正则扫描即可稳定还原
 * （形如 kw_239211505_128khttp://.../M5000044Fd2s1LB6MJ.mp3）。
 * @param {Buffer|string} raw 数据库文件（含 -wal 更好）内容
 * @returns {Array<{key:string,url:string,name:string,from:string}>}
 */
function parsePlayUrlTable(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw || '');
  const out = [];
  const seen = new Set();
  // id 形如 kw_239211505 或 kw_239211505_128k，紧跟一个 http(s) 地址
  const re = /\b((?:kw|wy|tx|kg|mg)_\d{1,12}(?:_[0-9a-z]{2,6})?)(https?:\/\/[!-~]{10,400}?\.(?:mp3|flac|m4a|aac|ogg|wav))/g;
  let m;
  while ((m = re.exec(text))) {
    const idPart = m[1];
    const url = m[2];
    const seg = idPart.split('_');
    const source = seg[0];
    const id = seg[1];
    const quality = seg.length > 2 ? seg[2] : '';
    const key = source + ':' + id + (quality ? (':' + quality) : '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key: key, url: url, name: '', from: 'lx' });
  }
  return out;
}

module.exports = { createUrlCache, parsePlayUrlTable };
