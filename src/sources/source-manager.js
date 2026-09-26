// 声浪 SongWave · 音源脚本管理（对齐 外部播放器 的“自定义源”逻辑）
// 支持：粘贴音源链接导入 / 本地 .js 导入 / 启用停用 / 删除 / 能力探测 / 持久化
// 纯 Node 实现（fetch 与目录均可注入），便于离线测试
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadScript } = require('./script-runtime');

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

/** 粗校验：是不是 扩展音源脚本
 *  注意：混淆脚本会把 lx 写成 '\x6c\x78'，所以这里只做「明显不是脚本」的排除，
 *  真正的能力判断交给 vm 沙箱加载（inspect） */
function looksLikeLxScript(text) {
  const s = String(text || '');
  if (s.length < 40) return false;
  if (/^\s*<(!doctype|html|\?xml)/i.test(s)) return false;         // HTML 页面
  if (/^\s*[\{\[]/.test(s) && !/function|=>/.test(s)) return false; // 纯 JSON
  return /(EVENT_NAMES|musicUrl|musicDetail|globalThis|inited|function|=>|\\x6c\\x78)/i.test(s);
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

  /** 探测脚本能力（加载到 vm 沙箱里读 inited 声明）；meta 会作为脚本的 currentScriptInfo（部分脚本用它做版本校验） */
  async function inspect(scriptPath, meta = {}) {
    try {
      const r = await loadScript(scriptPath, {
        initTimeoutMs,
        name: meta.name,
        version: meta.version,
        author: meta.author,
        homepage: meta.homepage,
        description: meta.description,
      });
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
    const name = options.name || safeName(path.basename(u.pathname) || u.hostname);
    return addFromScriptText(text, Object.assign({}, options, { name, url: String(url), from: options.from || 'url' }));
  }

  /**
   * 从脚本正文导入（链接下载 / LX 导入 / 分享文本 / 直接粘贴代码 都走这里）
   * @param {string} text 脚本内容
   * @param {object} [meta] { name, version, author, homepage, description, url, from, lxId }
   */
  async function addFromScriptText(text, meta = {}) {
    if (Buffer.byteLength(text, 'utf8') > MAX_SCRIPT_BYTES) throw new Error('脚本过大（>8MB）');
    if (!looksLikeLxScript(text)) throw new Error('这不是有效的 扩展音源脚本（未发现 扩展音源接口特征）');
    const name = safeName(meta.name || 'source');
    const id = meta.lxId ? hashId(String(meta.lxId) + text.length) : hashId(name + text.length + (meta.url || ''));
    const file = path.join(dir, `ext-${name}-${id}.js`);
    fs.writeFileSync(file, text);
    const info = await inspect(file, meta);
    return upsert({
      id,
      name: meta.name || name,
      version: meta.version || '',
      author: meta.author || '',
      homepage: meta.homepage || '',
      description: meta.description || '',
      from: meta.from || 'text',
      lxId: meta.lxId || '',
      url: meta.url || '',
      file,
      enabled: true,
      addedAt: Date.now(),
      bytes: Buffer.byteLength(text, 'utf8'),
      sourceKeys: info.sourceKeys, actions: info.actions, ok: info.ok, error: info.error,
    });
  }

  /** 解析 LX 分享文本：支持多行、含密码、含说明文字 */
  function parseShareText(text) {
    const urls = (String(text || '').match(/https?:\/\/[^\s'"<>）)】]+/g) || [])
      .map((s) => s.replace(/[.,;，。；]+$/, ''));
    const pwd = (String(text || '').match(/(?:密码|提取码|password|pwd)\s*[:：]?\s*([A-Za-z0-9]{3,12})/i) || [])[1] || '';
    return { urls, password: pwd };
  }

  /** 智能导入：链接（可多个）→ 下载导入；没有任何链接时按脚本正文导入 */
  async function addFromText(text, options = {}) {
    const share = parseShareText(text);
    if (share.urls.length) {
      const out = [];
      const errors = [];
      for (const u of share.urls) {
        try { out.push(await addFromUrl(u, options)); }
        catch (e) { errors.push(u + ' → ' + String(e && e.message || e)); }
      }
      if (!out.length) throw new Error('链接导入全部失败：' + errors.join('；'));
      return { entries: out, errors };
    }
    const entry = await addFromScriptText(String(text || ''), options);
    return { entries: [entry], errors: [] };
  }

  /** 批量导入一个目录下的所有 .js 音源 */
  async function importFromDirectory(dirPath, options = {}) {
    const abs = path.resolve(dirPath);
    if (!fs.existsSync(abs)) throw new Error('目录不存在：' + abs);
    const files = fs.readdirSync(abs).filter((f) => /\.js$/i.test(f));
    const imported = [];
    const skipped = [];
    for (const f of files) {
      const p = path.join(abs, f);
      try {
        const text = fs.readFileSync(p, 'utf8');
        if (!looksLikeLxScript(text)) { skipped.push({ name: f, error: '不是 扩展音源脚本' }); continue; }
        imported.push(await addFromScriptText(text, Object.assign({ name: path.basename(f, '.js'), from: 'dir' }, options)));
      } catch (e) {
        skipped.push({ name: f, error: String(e && e.message || e) });
      }
    }
    return { dir: abs, scanned: files.length, imported, skipped };
  }

  /** 重新下载（按记录的链接更新脚本） */
  async function update(id) {
    const list = readRegistry();
    const e = list.find((x) => x.id === id);
    if (!e) throw new Error('音源不存在：' + id);
    if (!e.url) throw new Error('该音源是本地导入的，没有链接可更新');
    const res = await fetchImpl(e.url, { redirect: 'follow' });
    if (!res || !res.ok) throw new Error('下载失败：HTTP ' + ((res && res.status) || '?'));
    const text = await res.text();
    if (!looksLikeLxScript(text)) throw new Error('下载到的内容不是 扩展音源脚本');
    fs.writeFileSync(e.file, text);
    const info = await inspect(e.file, e);
    Object.assign(e, {
      bytes: Buffer.byteLength(text, 'utf8'),
      sourceKeys: info.sourceKeys, actions: info.actions, ok: info.ok, error: info.error,
      updatedAt: Date.now(),
    });
    writeRegistry(list);
    return e;
  }

  async function addFromFile(srcPath, options = {}) {
    const abs = path.resolve(srcPath);
    if (!fs.existsSync(abs)) throw new Error('文件不存在：' + abs);
    const text = fs.readFileSync(abs, 'utf8');
    const name = options.name || safeName(path.basename(abs));
    return addFromScriptText(text, Object.assign({}, options, { name, from: 'file' }));
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

  /** 加载所有已启用的音源，返回 [{entry, source}]，source 为 script-source 适配对象 */
  async function loadEnabled() {
    const out = [];
    for (const entry of readRegistry()) {
      if (!entry.enabled) continue;
      try {
        // 这里复用 script-source 适配层，避免重复实现
        const { createLxSource } = require('./script-source');
        const source = await createLxSource(entry.file, {
          name: entry.name,
          version: entry.version || '',
          author: entry.author || '',
          homepage: entry.homepage || '',
          description: entry.description || '',
          initTimeoutMs,
        });
        out.push({ entry, source });
      } catch (e) {
        // 加载失败不阻塞其它音源
        out.push({ entry, source: null, error: String(e && e.message || e) });
      }
    }
    return out;
  }

  return {
    dir, list, readRegistry,
    addFromUrl, addFromFile, addFromScriptText, addFromText, importFromDirectory,
    toggle, remove, recheck, update, inspect, loadEnabled, parseShareText,
  };
}

module.exports = { createSourceManager, looksLikeLxScript, safeName };