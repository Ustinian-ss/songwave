// 声浪 SongWave · 从 LX Music 一键导入音源脚本
// LX v2 把用户音源存在 %APPDATA%\lx-music-desktop\LxDatas\user_api.json
// 结构：{ userApis: [ { id, name, version, author, homepage, description, script } ] }
// 纯 Node（路径可注入），便于离线测试
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

/**
 * LX 把音源脚本压缩存储：'gz_' + base64(zlib.deflate(脚本正文))
 * 这里负责解开；未压缩的（普通文本）原样返回
 */
function decodeLxScript(text) {
  const s = String(text || '');
  if (!s.startsWith('gz_')) return s;
  const buf = Buffer.from(s.slice(3), 'base64');
  for (const fn of [zlib.inflateSync, zlib.gunzipSync, zlib.inflateRawSync]) {
    try { return fn(buf).toString('utf8'); } catch (e) { /* 试下一种 */ }
  }
  return s; // 解不开就原样返回，交给上层报错
}

/** 从脚本头部的 JSDoc 注释里读 @name / @version */
function headerMeta(script) {
  const out = {};
  const m = String(script || '').slice(0, 600);
  const name = m.match(/@name\s+(.+)/);
  const ver = m.match(/@version\s+(\S+)/);
  if (name) out.name = name[1].trim();
  if (ver) out.version = ver[1].trim().replace(/^v/i, '');  // 统一去掉前缀 v，展示时不再重复
  return out;
}

/** 候选的 LX 数据目录 */
function candidateLxDataDirs() {
  const out = [];
  const appdata = process.env.APPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming') : '');
  if (appdata) {
    out.push(path.join(appdata, 'lx-music-desktop', 'LxDatas'));
    out.push(path.join(appdata, 'lx-music-desktop'));
    out.push(path.join(appdata, 'LX Music', 'LxDatas'));
  }
  if (process.env.HOME) {
    out.push(path.join(process.env.HOME, '.config', 'lx-music-desktop', 'LxDatas'));
  }
  return out;
}

/** 找到存在的 user_api.json 路径 */
function findLxUserApiFile(extraDirs = []) {
  const dirs = extraDirs.concat(candidateLxDataDirs());
  for (const d of dirs) {
    const p = path.join(d, 'user_api.json');
    if (fs.existsSync(p)) return p;
    const p2 = path.join(d, 'LxDatas', 'user_api.json');
    if (fs.existsSync(p2)) return p2;
  }
  return null;
}

/**
 * 读取 LX 的音源列表
 * @param {string} file user_api.json 路径
 * @returns {Array<{id,name,version,author,homepage,description,script}>}
 */
function readLxUserApis(file) {
  const raw = fs.readFileSync(file, 'utf8');
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw new Error('user_api.json 解析失败：' + e.message); }
  let list = j && j.userApis;
  if (!list) throw new Error('user_api.json 里没有 userApis 字段');
  if (!Array.isArray(list)) list = Object.values(list);
  return list
    .filter((it) => it && typeof it.script === 'string' && it.script.length > 40)
    .map((it) => {
      const decoded = decodeLxScript(it.script);
      const head = headerMeta(decoded);
      return {
        id: String(it.id || ''),
        // 元数据优先用脚本头部注释里的 @name/@version（LX 列表里的可能不准）
        name: head.name || String(it.name || 'lx 音源'),
        version: head.version || String(it.version || ''),
        author: String(it.author || ''),
        homepage: String(it.homepage || ''),
        description: String(it.description || ''),
        script: decoded,
        compressed: decoded !== it.script,
      };
    });
}

/**
 * 把 LX 里的音源导入到 SongWave
 * @param {object} mgr createSourceManager 实例
 * @param {object} [opts] { file, only: string[] (id 或 name), extraDirs }
 * @returns {Promise<{file:string, imported:Array, skipped:Array}>}
 */
async function importFromLxMusic(mgr, opts = {}) {
  const file = opts.file || findLxUserApiFile(opts.extraDirs || []);
  if (!file) throw new Error('没有找到 LX Music 的音源数据（user_api.json）');
  const all = readLxUserApis(file);
  const only = opts.only && opts.only.length ? opts.only : null;
  const picked = only ? all.filter((a) => only.includes(a.id) || only.includes(a.name)) : all;
  const imported = [];
  const skipped = [];
  for (const api of picked) {
    try {
      const entry = await mgr.addFromScriptText(api.script, {
        name: api.name,
        version: api.version,
        author: api.author,
        homepage: api.homepage,
        description: api.description,
        from: 'lx-music',
        lxId: api.id,
      });
      imported.push(entry);
    } catch (e) {
      skipped.push({ name: api.name, error: String(e && e.message || e) });
    }
  }
  return { file, imported, skipped };
}

module.exports = { candidateLxDataDirs, findLxUserApiFile, readLxUserApis, importFromLxMusic, decodeLxScript, headerMeta };