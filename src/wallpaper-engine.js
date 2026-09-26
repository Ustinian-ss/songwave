// 声浪 SongWave · Wallpaper Engine 壁纸库接入（纯 Node，可离线测试）
// 目标：做出与 DSH 插件 dsh-plugin-wallpaper-engine 等价的背景效果
//   - 发现 Steam 库里的 Wallpaper Engine 壁纸（创意工坊 431960 + 默认工程）
//   - 视频型：直接交给 <video> 播放（mp4/webm，Chromium 原生支持）
//   - 场景/网页型：用 preview.gif（动图）或 preview.jpg 作背景
//   - 提供 scrim / blur / 亮度对比度饱和 / objectFit / 翻转 / 透明度的渲染参数
'use strict';

const fs = require('fs');
const path = require('path');

const WE_APPID = '431960';
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

/** 解析 libraryfolders.vdf 里的所有库路径 */
function parseLibraryFolders(vdfText) {
  const out = [];
  const re = /"path"\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(String(vdfText || '')))) {
    out.push(m[1].replace(/\\\\/g, '\\'));
  }
  return out;
}

/** 候选 Steam 根目录（本机常见位置 + 各盘符） */
function candidateSteamRoots() {
  const out = [];
  const pf86 = process.env['ProgramFiles(x86)'];
  const pf = process.env['ProgramFiles'];
  if (pf86) out.push(path.join(pf86, 'Steam'));
  if (pf) out.push(path.join(pf, 'Steam'));
  const drives = [];
  for (let c = 65; c <= 90; c++) {
    const d = String.fromCharCode(c) + ':\\';
    try { if (fs.existsSync(d)) drives.push(d); } catch (e) { /* ignore */ }
  }
  for (const d of drives) {
    out.push(path.join(d, 'steam'));
    out.push(path.join(d, 'Steam'));
    out.push(path.join(d, 'SteamLibrary'));
    out.push(path.join(d, 'games', 'steam'));
    out.push(path.join(d, 'Program Files (x86)', 'Steam'));
    out.push(path.join(d, 'Program Files', 'Steam'));
  }
  // 去重
  const seen = new Set();
  return out.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 找出所有 Steam 库根目录（含 libraryfolders.vdf 里登记的其它盘） */
function findSteamLibraries(opts = {}) {
  const roots = opts.roots || candidateSteamRoots();
  const libs = [];
  const seen = new Set();
  const add = (p) => {
    if (!p) return;
    const k = path.resolve(p).toLowerCase();
    if (seen.has(k)) return;
    if (!fs.existsSync(p)) return;
    seen.add(k);
    libs.push(path.resolve(p));
  };
  for (const root of roots) {
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(vdf)) {
      add(root);
      try {
        parseLibraryFolders(fs.readFileSync(vdf, 'utf8')).forEach(add);
      } catch (e) { /* ignore */ }
    }
  }
  return libs;
}

function readProjectJson(dir) {
  try {
    const p = path.join(dir, 'project.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

function listFiles(dir) {
  try { return fs.readdirSync(dir); } catch (e) { return []; }
}

/** 找预览图（preview.gif/jpg/png...），gif 视为动图 */
function previewOf(dir, pj, files) {
  const cands = [];
  if (pj && pj.preview) cands.push(pj.preview);
  cands.push('preview.gif', 'preview.jpg', 'preview.jpeg', 'preview.png', 'preview.webp');
  for (const c of cands) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) {
      return { file: p, animated: /\.gif$/i.test(c) };
    }
  }
  const found = files.find((f) => /^preview\./i.test(f));
  if (found) {
    const p = path.join(dir, found);
    return { file: p, animated: /\.gif$/i.test(found) };
  }
  return null;
}

/** 找视频文件（project.json 的 file 字段优先，其次目录扫描） */
function videoOf(dir, pj, files) {
  if (pj && pj.file && VIDEO_EXT.has(path.extname(pj.file).toLowerCase())) {
    const p = path.join(dir, pj.file);
    if (fs.existsSync(p)) return p;
  }
  for (const f of files) {
    if (VIDEO_EXT.has(path.extname(f).toLowerCase())) return path.join(dir, f);
  }
  return null;
}

function detectType(pj, files, video, preview) {
  const raw = String((pj && pj.type) || '').toLowerCase();
  if (raw === 'video') return 'video';
  if (raw === 'scene') return 'scene';
  if (raw === 'web') return 'web';
  if (raw === 'application') return 'application';
  if (video) return 'video';
  if (files.includes('scene.pkg') || (pj && /scene\.json$/i.test(String(pj.file || '')))) return 'scene';
  if (pj && /index\.html$/i.test(String(pj.file || ''))) return 'web';
  if (preview) return 'scene';
  return 'unknown';
}

function buildItem(dir, id, source, extra = {}) {
  const pj = readProjectJson(dir);
  const files = listFiles(dir);
  const preview = previewOf(dir, pj, files);
  const video = videoOf(dir, pj, files);
  const type = detectType(pj, files, video, preview);
  const pkg = files.includes('scene.pkg') ? path.join(dir, 'scene.pkg') : null;
  return {
    id: String(id),
    title: (pj && pj.title) || extra.title || path.basename(dir),
    type,
    source,
    dir,
    file: (pj && pj.file) || '',
    video,
    preview: preview ? preview.file : null,
    previewAnimated: !!(preview && preview.animated),
    pkg,
    contentRating: (pj && pj.contentrating) || 'Everyone',
    // 能不能真的渲染出来：video（直接播）/ image（动图或静图）/ pkg-only（只有场景包，拿不到画面）
    renderable: video ? 'video' : (preview ? 'image' : (pkg ? 'pkg' : 'none')),
  };
}

/**
 * 扫描本机 Wallpaper Engine 壁纸
 * @param {object} [opts] { roots: string[] } 便于测试注入
 * @returns {{libraries: string[], items: Array}}
 */
function discoverWallpapers(opts = {}) {
  const libraries = findSteamLibraries(opts);
  const items = [];
  const seen = new Set();
  for (const lib of libraries) {
    // 1) 创意工坊
    const workshop = path.join(lib, 'steamapps', 'workshop', 'content', WE_APPID);
    if (fs.existsSync(workshop)) {
      for (const id of listFiles(workshop)) {
        const dir = path.join(workshop, id);
        try { if (!fs.statSync(dir).isDirectory()) continue; } catch (e) { continue; }
        const key = 'w:' + id;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(buildItem(dir, id, 'workshop'));
      }
    }
    // 2) WE 自带默认工程
    const defs = path.join(lib, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'defaultprojects');
    if (fs.existsSync(defs)) {
      for (const name of listFiles(defs)) {
        const dir = path.join(defs, name);
        try { if (!fs.statSync(dir).isDirectory()) continue; } catch (e) { continue; }
        if (!fs.existsSync(path.join(dir, 'project.json'))) continue;
        const key = 'd:' + name;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(buildItem(dir, name, 'default'));
      }
    }
  }
  return { libraries, items };
}

/** 渲染参数默认值（对齐 dsh-plugin-wallpaper-engine 的 config.json 字段） */
function defaultBackgroundSettings() {
  return {
    scrim: 0.10,            // 黑色遮罩浓度
    blur: 0,                // 背景模糊 px（插件里是 UI 玻璃模糊，这里给背景用）
    brightness: 100,        // %
    contrast: 100,          // %
    saturate: 100,          // %
    objectFit: 'cover',     // cover | contain | fill
    flip: false,            // 水平翻转
    opacity: 1,             // 背景不透明度
    playbackRate: 1,        // 视频播放速度
    videoMuted: true,       // 视频壁纸静音（音乐播放器必须静音）
    rotationEnabled: false, // 轮播
    rotationInterval: 30,   // 轮播间隔（秒）
    rotationIds: [],        // 轮播列表（空 = 全部可渲染项）
  };
}

module.exports = {
  WE_APPID,
  parseLibraryFolders,
  candidateSteamRoots,
  findSteamLibraries,
  discoverWallpapers,
  defaultBackgroundSettings,
  // 便于单测
  _internal: { previewOf, videoOf, detectType, buildItem },
};