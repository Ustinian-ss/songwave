// 声浪 SongWave · 扩展音源脚本适配层
// 把 script-runtime 加载的脚本包装成 SongWave 音源接口：search() / getPlayUrl() / getLyric()
'use strict';

const { loadScript } = require('./script-runtime');

const DEFAULT_QUALITY = '128k';

/**
 * 归一化 LX 音乐条目 → SongWave 条目（保留 songmid/hash 等取链所需字段）
 */
function normalizeMusic(item, sourceKey) {
  if (!item || typeof item !== 'object') return null;
  const { id, name, singer, album, img, interval, quality, ...rest } = item;
  const artist = Array.isArray(singer) ? singer.filter(Boolean).join(' / ') : (singer || '');
  const durationMs = (Number(interval) || 0) * 1000;
  return Object.assign({}, rest, {
    id: String(id),
    name: name || '',
    artist,
    album: album || '',
    cover: img || item.pic || '',
    durationMs: durationMs > 0 ? durationMs : 0,
    quality: quality || DEFAULT_QUALITY,
    source: 'ext',
    extKey: sourceKey,
  });
}

/** 从 search 结果里安全取列表 */
function extractList(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.list)) return result.list;
  if (result && Array.isArray(result.data)) return result.data;
  return [];
}

/** 从 musicUrl 结果里取播放地址 */
function extractUrl(result) {
  if (typeof result === 'string' && result) return result;
  if (result && typeof result === 'object') {
    if (typeof result.url === 'string' && result.url) return result.url;
    if (Array.isArray(result.urls) && result.urls.length) return result.urls[0];
  }
  return null;
}

/** 从 lyric 结果里取歌词文本 */
function extractLyric(result) {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    if (typeof result.lyric === 'string') return result.lyric;
    if (typeof result.lrc === 'string') return result.lrc;
  }
  return '';
}

/**
 * 加载一个 扩展音源脚本（异步：等待脚本 inited 声明）
 * @param {string} scriptPath
 * @param {object} [options] { requestImpl, name, version, author, homepage, initTimeoutMs }
 * @returns {Promise<object>}
 */
async function createLxSource(scriptPath, options = {}) {
  const { runtime, sources, updateAlert } = await loadScript(scriptPath, options);

  const sourceKeys = Object.keys(sources || {}).filter((k) => sources[k] && sources[k].actions);
  const searchSources = sourceKeys.filter((k) => sources[k].actions.includes('search'));

  function supports(key, action) {
    return !!(sources[key] && sources[key].actions && sources[key].actions.includes(action));
  }

  async function dispatchFor(key, action, info) {
    if (!supports(key, action)) {
      throw new Error(`音源 ${key} 不支持 ${action}`);
    }
    return runtime.dispatch({ source: key, action, info });
  }

  /** @returns {Promise<Array>} */
  async function search(keywords, limit = 20) {
    const out = [];
    if (!searchSources.length) return out;
    const perSource = Math.max(1, Math.ceil(limit / searchSources.length));
    for (const key of searchSources) {
      try {
        const result = await dispatchFor(key, 'search', {
          keywords,
          page: 1,
          pageSize: perSource,
          type: 'music',
        });
        const items = extractList(result)
          .map((it) => normalizeMusic(it, key))
          .filter(Boolean);
        out.push(...items);
      } catch (err) {
        console.warn(`[ext-source] ${key} search 失败:`, err && err.message);
      }
    }
    return out.slice(0, limit);
  }

  async function getPlayUrl(sourceKey, info, quality) {
    // info 可能是 {id, songmid, hash, ...} 或字符串 id
    const base = typeof info === 'string' ? { id: info } : Object.assign({}, info);
    const result = await dispatchFor(sourceKey, 'musicUrl', {
      musicInfo: base,
      quality: quality || base.quality || DEFAULT_QUALITY,
      type: base.type || 'music',
    });
    const url = extractUrl(result);
    if (!url) throw new Error(`音源 ${sourceKey} 未返回播放地址`);
    return url;
  }

  async function getLyric(sourceKey, idOrInfo) {
    const base = typeof idOrInfo === 'string' ? { id: idOrInfo } : Object.assign({}, idOrInfo);
    const result = await dispatchFor(sourceKey, 'lyric', { musicInfo: base });
    const lrc = extractLyric(result);
    return { lrc, tlyric: '', extKey: sourceKey };
  }

  return {
    name: options.name || require('path').basename(scriptPath),
    scriptPath,
    sources,
    sourceKeys,
    searchSources,
    supports,
    search,
    getPlayUrl,
    getLyric,
    updateAlert,
  };
}

module.exports = { createLxSource, normalizeMusic };