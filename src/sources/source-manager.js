// 声浪 SongWave · 音源脚本管理（对齐 LX Music 的“自定义源”逻辑）
// 支持：粘贴音源链接导入 / 本地 .js 导入 / 启用停用 / 删除 / 能力探测 / 持久化
// 纯 Node 实现（fetch 与目录均可注入），便于离线测试
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadScript } = require('./lx-runtime');

const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;

function hashId(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 10);
}

function safeName(s) {
  return String(s || 'source')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .slice(0, 60) || 'source';
}

/** 粗校验：是不是 lx 用户音源脚本 */
function looksLikeLxScript(text) {
  const s = String(text || '');
  if (s.length < 40) return false;
  const hasApi = /lx/i.test(s);
  const hasProto = /(EVENT_NAMES|inited|musicUrl|musicDetail|lyric|globalThis\s*\[\s*['"]lx['"]\s*\])/.test(s);
  return hasApi && hasProto;
}

/**
 * @param {object} opts
 * @param {string} opts.dir 音源脚本存放目录
 * @param {Function} [opts.fetchImpl] 便于测试注入
 * @param {number} [opts.initTimeoutMs]
 */
function createSourceManager(opts) {
  const dir = opts.dir;
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const initTimeoutMs = opts.initTimeoutMs || 20000;
  const regPath = path.join(dir, 'sources.json');

  fs.mkdirSync(dir, { recursive: true });

  function readRegistry() {
    try {
      const raw = fs.readFileSync(regPath, 'utf8');
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }
  function writeRegistry(list) {
    fs.writeFileSync(regPath, JSON.stringify(list, null, 2));
  }

  /** 探测脚本能力（加载到 vm 沙箱里读 inited 声明） */
  async function inspect(scriptPath) {
    try {
      const r = await loadScript(scriptPath, { initTimeoutMs });
      const keys = Object.keys(r.sources || {});
      const actions = {};
      keys.forEach((k) => { actions[k] = (r.sources[k] && r.sources[k].actions) || []; });
      if (!keys.length) {
        return { ok: false, sourceKeys: [], actions: {}, error: '脚本未声明任何音源（可能不是取链型脚本或已失效）' };
      }
      return { ok: true, sourceKeys: keys, actions, error: '' };
    } catch (e) {
      return { ok: false, sourceKeys: [], actions: {}, error: String(e && e.message || e) };
    }
  }

  function upsert(entry) {
    const list = readRegistry().filter((e) => e.id !== entry.id);
    list.push(entry);
    writeRegistry(list);
    return entry;
  }

  async function addFromUrl(url, options = {}) {
    let u;
    try { u = new URL(String(url)); } catch (e) { throw new Error('链接格式不正确'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只支持 http/https 链接');
    const res = await fetchImpl(String(url), { redirect: 'follow' });
    if (!res || !res.ok) throw new Error('下载失败：HTTP ' + ((res && res.status) || '?'));
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_SCRIPT_BYTES) throw new Error('脚本过大（>8MB）');
    if (!looksLikeLxScript(text)) throw new Error('这不是有效的 lx 音源脚本（未发现 lx 音源接口特征）');
    const id = hashId(String(url) + text.length);
    const name = options.name || safeName(path.basename(u.pathname) || u.hostname);
    const file = path.join(dir, `lx-${name}-${id}.js`);
    fs.writeFileSync(file, text);
    const info = await inspect(file);
    return upsert({
      id, name, url: String(url), file, enabled: true, addedAt: Date.now(),
      bytes: Buffer.byteLength(text, 'utf8'),
      sourceKeys: info.sourceKeys, actions: info.actions, ok: info.ok, error: info.error,
    });
  }

  async function addFromFile(srcPath, options = {}) {
    const abs = path.resolve(srcPath);
    if (!fs.existsSync(abs)) throw new Error('文件不存在：' + abs);
    const text = fs.readFileSync(abs, 'utf8');
    if (!looksLikeLxScript(text)) throw new Error('这不是有效的 lx 音源脚本');
    const id = hashId(abs + text.length);
    const name = options.name || safeName(path.basename(abs));
    const file = path.join(dir, `lx-${name}-${id}.js`);
    if (path.resolve(file) !== abs) fs.writeFileSync(file, text);
    const info = await inspect(file);
    return upsert({
      id, name, url: '', file, enabled: true, addedAt: Date.now(),
      bytes: Buffer.byteLength(text, 'utf8'),
      sourceKeys: info.sourceKeys, actions: info.actions, ok: info.ok, error: info.error,
    });
  }

  function list() {
    return readRegistry();
  }

  function toggle(id, enabled) {
    const list = readRegistry();
    const e = list.find((x) => x.id === id);
    if (!e) throw new Error('音源不存在：' + id);
    e.enabled = !!enabled;
    writeRegistry(list);
    return e;
  }

  function remove(id) {
    const list = readRegistry();
    const e = list.find((x) => x.id === id);
    if (!e) return false;
    try { if (e.file && fs.existsSync(e.file)) fs.unlinkSync(e.file); } catch (err) { /* ignore */ }
    writeRegistry(list.filter((x) => x.id !== id));
    return true;
  }

  async function recheck(id) {
    const list = readRegistry();
    const e = list.find((x) => x.id === id);
    if (!e) throw new Error('音源不存在：' + id);
    const info = await inspect(e.file);
    e.ok = info.ok; e.error = info.error; e.sourceKeys = info.sourceKeys; e.actions = info.actions;
    writeRegistry(list);
    return e;
  }

  /** 加载所有已启用的音源，返回 [{entry, source}]，source 为 lx-source 适配对象 */
  async function loadEnabled() {
    const out = [];
    for (const entry of readRegistry()) {
      if (!entry.enabled) continue;
      try {
        // 这里复用 lx-source 适配层，避免重复实现
        const { createLxSource } = require('./lx-source');
        const source = await createLxSource(entry.file, { name: entry.name, initTimeoutMs });
        out.push({ entry, source });
      } catch (e) {
        // 加载失败不阻塞其它音源
        out.push({ entry, source: null, error: String(e && e.message || e) });
      }
    }
    return out;
  }

  return { dir, list, addFromUrl, addFromFile, toggle, remove, recheck, inspect, loadEnabled, readRegistry };
}

module.exports = { createSourceManager, looksLikeLxScript, safeName };