// 声浪 SongWave · Electron 主进程
const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer, screen, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const netease = require('../src/sources/netease');
const extKey = require('../src/sources/script-source');
const { createSourceManager } = require('../src/sources/source-manager');
const { downloadFile } = require('../src/download');

let win = null;
let wallpaperWin = null;

// —— 兜底：音源脚本内部可能异步抛错，绝不能让主进程崩掉 ——
process.on('uncaughtException', (e) => {
  logLine('[songwave] 未捕获异常（已忽略，应用继续运行）:', (e && e.stack) || e);
});
process.on('unhandledRejection', (r) => {
  logLine('[songwave] 未处理的 Promise 拒绝（已忽略）:', (r && (r.stack || r.message)) || r);
});
let wallpaperParams = null;

// —— 扩展音源（链接导入 / 本地导入 / 多音源并存 / 启用停用） ——
// 不写死任何本机路径：脚本请通过「音源管理」导入，或用 SONGWAVE_SOURCE_SCRIPT 指定
const SOURCE_SCRIPT = process.env.SONGWAVE_SOURCE_SCRIPT || '';
const SOURCE_INIT_TIMEOUT = Number(process.env.SONGWAVE_SOURCE_INIT_TIMEOUT) || 8000;   // 失败要快（慢脚本可用环境变量调大）
let srcMgr = null;
let lxLoadPromise = null;
let extState = { loading: false, loaded: false, name: '', sourceKeys: [], searchSources: [], error: '', items: [] };

// —— 运行日志（打包版看不到控制台，写文件便于排查） ——
let logFilePath = null;
function logLine() {
  const parts = Array.prototype.slice.call(arguments).map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch (e) { return String(x); } })()));
  const line = new Date().toISOString() + ' ' + parts.join(' ');
  try { console.log(line); } catch (e) { /* ignore */ }
  try {
    if (!logFilePath) logFilePath = path.join(app.getPath('userData'), 'songwave.log');
    if (fs.existsSync(logFilePath) && fs.statSync(logFilePath).size > 512 * 1024) fs.writeFileSync(logFilePath, '');
    fs.appendFileSync(logFilePath, line + '\n');
  } catch (e) { /* ignore */ }
}

function getSrcMgr() {
  if (!srcMgr) {
    let base;
    try {
      base = app.getPath('userData');
    } catch (e) {
      console.log('[songwave] userData 不可用，回退临时目录:', e && e.message);
      base = path.join(require('os').tmpdir(), 'songwave');
    }
    const dir = path.join(base, 'script-sources');
    logLine('[songwave] 音源目录:', dir);
    try {
      srcMgr = createSourceManager({ dir, initTimeoutMs: SOURCE_INIT_TIMEOUT });
    } catch (e) {
      console.log('[songwave] 音源目录不可用，改用临时目录:', e && e.message);
      srcMgr = createSourceManager({ dir: path.join(require('os').tmpdir(), 'songwave-sources'), initTimeoutMs: SOURCE_INIT_TIMEOUT });
    }
  }
  return srcMgr;
}

/** 首次运行且没有任何音源时，把默认脚本（如果存在）自动导入一份 */
async function ensureDefaultSource() {
  const mgr = getSrcMgr();
  if (mgr.list().length) return;
  const fs = require('fs');
  if (!fs.existsSync(SOURCE_SCRIPT)) return;
  try {
    const e = await mgr.addFromFile(SOURCE_SCRIPT);
    console.log('[songwave] 已自动导入默认音源脚本:', e.name, e.ok ? '' : ('（探测失败：' + e.error + '）'));
  } catch (e) {
    console.log('[songwave] 默认音源导入失败:', e && e.message);
  }
}

/** 加载所有启用音源（带缓存） */
function getExtSources(force) {
  if (!lxLoadPromise) {
    extState.loading = true;
    lxLoadPromise = (async () => {
      const __t0 = Date.now();
      logLine('[songwave] 音源加载开始 | 注册', getSrcMgr().list().length, '个 | force=', !!force);
      await ensureDefaultSource();
      const loaded = await getSrcMgr().loadEnabled({ retryFailed: !!force });
      logLine('[songwave] 音源加载结束 | 用时', (Date.now() - __t0) + 'ms | 结果:', loaded.map((x) => (x.entry.name + '=' + (x.source ? 'ok' : 'fail'))).join(', '));
      const okList = loaded.filter((x) => x.source);
      const sourceKeys = [];
      const searchSources = [];
      okList.forEach((x) => {
        x.source.sourceKeys.forEach((k) => { if (!sourceKeys.includes(k)) sourceKeys.push(k); });
        x.source.searchSources.forEach((k) => { if (!searchSources.includes(k)) searchSources.push(k); });
      });
      extState = {
        loading: false,
        loaded: okList.length > 0,
        name: okList.map((x) => x.entry.name).join(' + '),
        sourceKeys,
        searchSources,
        error: loaded.filter((x) => !x.source).map((x) => x.entry.name + '：' + (x.error || '加载失败')).join('；'),
        items: loaded.map((x) => ({
          id: x.entry.id, name: x.entry.name, ok: !!x.source,
          error: x.source ? '' : (x.error || '加载失败'),
          sourceKeys: x.source ? x.source.sourceKeys : (x.entry.sourceKeys || []),
          searchSources: x.source ? x.source.searchSources : [],
          canSearch: !!(x.source && x.source.searchSources.length),
        })),
      };
      console.log('[songwave] 扩展音源就绪:', extState.name || '(无)', '| 平台:', sourceKeys.join(',') || '(无)');
      return okList;
    })();
  }
  return lxLoadPromise;
}

/** 重新加载（导入/启停后调用） */
function reloadExt() {
  lxLoadPromise = null;
  extState = { loading: true, loaded: false, name: '', sourceKeys: [], searchSources: [], error: '', items: [] };
  return getExtSources();
}

/** 找到支持某平台取链的音源 */
function findSourceFor(lxPlatform, action) {
  return getExtSources().then((list) => {
    for (const x of list) {
      if (x.source.supports(lxPlatform, action)) return x.source;
    }
    return null;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 480,
    minHeight: 300,
    frame: false,
    backgroundColor: '#060810',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '..', 'app', 'icon.png'),
  });

  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));

  // 便于本地调试：把 renderer 控制台错误打出来（SONGWAVE_DEBUG=1 electron .）
  if (process.env.SONGWAVE_DEBUG) {
    win.webContents.on('console-message', (_e, _level, message) => {
      console.log('[renderer]', message);
    });
  }

  setupMaximizeEvents();
  setupWindowShortcuts(win);
  // 关闭到托盘（可选）：拦截 close，隐藏窗口；真正退出走托盘菜单
  win.on('close', (e) => {
    if (trayOptions.closeToTray && !app.isQuiting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

// F11 只在应用窗口内生效
function setupWindowShortcuts(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  logLine('[songwave] 启动 version=' + app.getVersion() + ' electron=' + process.versions.electron + ' packaged=' + app.isPackaged);
  setupDisplayMedia();
  createWindow();
  createTray();          // 系统托盘（可在面板里关闭）
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 关键：处理 getDisplayMedia 请求，支持“系统音频回环”（可视化监听正在播放的声音）。
// 播放走普通 <audio> 输出（不受 CORS 限制），可视化用 loopback 抓系统输出，可靠性最高。
function setupDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      });
      if (!sources.length) { callback(null); return; }
      callback({
        video: sources[0],
        audio: 'loopback',
      });
    } catch (err) {
      console.error('系统音频捕获失败:', err);
      callback(null);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// —— 窗口控制 ——
ipcMain.on('win-minimize', () => { if (win) win.minimize(); });
ipcMain.on('win-toggle-maximize', () => { if (win) (win.isMaximized() ? win.unmaximize() : win.maximize()); });
ipcMain.on('win-close', () => { if (win) win.close(); });
ipcMain.handle('win-is-maximized', () => (win ? win.isMaximized() : false));
ipcMain.handle('win-set-fullscreen', (_e, on) => {
  if (!win) return { ok: false };
  win.setFullScreen(!!on);
  return { ok: true, on: win.isFullScreen() };
});

function setupMaximizeEvents() {
  win.on('maximize', () => win.webContents.send('win-maximized-changed', true));
  win.on('unmaximize', () => win.webContents.send('win-maximized-changed', false));
}

// —— 音源 IPC ——
ipcMain.handle('songwave-ext-status', () => extState);

// 音源管理（自定义音源：粘贴链接导入）
ipcMain.handle('songwave-src-list', async (_e, force) => {
  try {
    const mgr = getSrcMgr();
    await getExtSources(!!force);        // force=true 时重试上次失败的音源
    return { ok: true, items: mgr.list(), state: extState };
  } catch (err) {
    logLine('[songwave] src-list 失败:', (err && err.stack) || err);
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('songwave-src-add', async (_e, payload) => {
  try {
    const mgr = getSrcMgr();
    const text = payload && (payload.text || payload.url) ? String(payload.text || payload.url).trim() : '';
    if (!text) return { ok: false, error: '请填写音源链接或粘贴脚本 / 分享文本' };
    const r = await mgr.addFromText(text, { name: payload && payload.name });
    reloadExt();   // 后台刷新，不阻塞返回
    return { ok: true, entries: r.entries, errors: r.errors, state: extState };
  } catch (err) {
    logLine('[songwave] src-add 失败:', (err && err.stack) || err);
    return { ok: false, error: String(err && err.message || err) };
  }
});

// 从其它播放器一键导入（自动探测其音源数据文件，含压缩脚本解压）
ipcMain.handle('songwave-src-external-preview', async () => {
  try {
    const lxImport = require('../src/sources/import-sources');
    const file = lxImport.findLxUserApiFile();
    if (!file) return { ok: false, error: '没有找到外部播放器的音源数据（user_api.json）' };
    const list = lxImport.readLxUserApis(file).map((a) => ({
      id: a.id, name: a.name, version: a.version, author: a.author, homepage: a.homepage, bytes: a.script.length,
    }));
    return { ok: true, file, list };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('songwave-src-import-external', async (_e, only) => {
  try {
    const lxImport = require('../src/sources/import-sources');
    const mgr = getSrcMgr();
    const r = await lxImport.importFromLxMusic(mgr, { only: Array.isArray(only) ? only : undefined });
    reloadExt();   // 后台刷新，不阻塞返回
    return { ok: true, file: r.file, imported: r.imported, skipped: r.skipped, items: mgr.list(), state: extState };
  } catch (err) {
    logLine('[songwave] src-import 失败:', (err && err.stack) || err);
    return { ok: false, error: String(err && err.message || err) };
  }
});

// 从文件夹批量导入 .js 音源
ipcMain.handle('songwave-src-import-dir', async () => {
  const r = await dialog.showOpenDialog(win, { title: '选择存放 扩展音源脚本的文件夹', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  try {
    const mgr = getSrcMgr();
    const res = await mgr.importFromDirectory(r.filePaths[0]);
    reloadExt();   // 后台刷新，不阻塞返回
    return { ok: true, dir: res.dir, scanned: res.scanned, imported: res.imported, skipped: res.skipped, items: mgr.list(), state: extState };
  } catch (err) {
    logLine('[songwave] src-import-dir 失败:', (err && err.stack) || err);
    return { ok: false, error: String(err && err.message || err) };
  }
});

// 重新下载更新
ipcMain.handle('songwave-src-update', async (_e, id) => {
  try {
    const mgr = getSrcMgr();
    const entry = await mgr.update(id);
    reloadExt();   // 后台刷新，不阻塞返回
    return { ok: true, entry, items: mgr.list(), state: extState };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('songwave-src-toggle', async (_e, payload) => {
  try {
    const mgr = getSrcMgr();
    mgr.toggle(payload && payload.id, !!(payload && payload.enabled));
    reloadExt();   // 后台刷新，不阻塞返回
    return { ok: true, items: mgr.list(), state: extState };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('songwave-src-remove', async (_e, id) => {
  try {
    const mgr = getSrcMgr();
    mgr.remove(id);
    reloadExt();   // 后台刷新，不阻塞返回
    return { ok: true, items: mgr.list(), state: extState };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('songwave-src-pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择 扩展音源脚本（.js）',
    properties: ['openFile'],
    filters: [{ name: '音源脚本', extensions: ['js'] }, { name: '所有文件', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  try {
    const mgr = getSrcMgr();
    const entry = await mgr.addFromFile(r.filePaths[0]);
    reloadExt();   // 后台刷新，不阻塞返回
    return { ok: true, entry, items: mgr.list(), state: extState };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// 平台音源（QQ/酷狗/酷我/咪咕）：搜索走平台接口，取链交给 扩展音源脚本
const platforms = require('../src/sources/platforms');
const PLATFORM_MAP = {};
platforms.PLATFORMS.forEach((p) => { PLATFORM_MAP[p.key] = p; });

ipcMain.handle('songwave-sources', () => ({
  ok: true,
  sources: [
    { key: 'netease', label: '网易云', extKey: 'wy' },
    ...platforms.PLATFORMS.map((p) => ({ key: p.key, label: p.label, extKey: p.extKey })),
  ],
}));

// 音效预设（EQ 10 段）
const audioFx = require('../src/audio-effects');
// 简繁转换表（一次下发，渲染层本地转换，避免逐行 IPC）
const zhConv = require('../src/zh-convert');
ipcMain.handle('songwave-zh-tables', () => ({
  ok: true,
  s: zhConv.S2T_SIMPLE,
  t: zhConv.S2T_TRAD,
  phrases: zhConv.PHRASES,
}));

ipcMain.handle('songwave-audio-presets', () => ({
  ok: true,
  freqs: audioFx.EQ_FREQS,
  presets: audioFx.listPresets(),
  defaults: audioFx.defaults(),
}));

// 换源：某首歌取链失败时，用「歌名+歌手」到其它平台找同一首歌
const { pickAlternatives } = require('../src/match');
ipcMain.handle('songwave-alt-sources', async (_e, payload) => {
  try {
    const q = {
      name: payload && payload.name,
      artist: payload && payload.artist,
      durationMs: payload && payload.durationMs,
    };
    const kw = [q.name, q.artist].filter(Boolean).join(' ').trim();
    if (!kw) return { ok: false, error: '缺少歌名，无法换源' };
    const exclude = (payload && payload.excludeSources) || [];
    const tasks = [];
    if (!exclude.includes('netease')) tasks.push(netease.search(kw, 8).catch(() => []));
    platforms.PLATFORMS.forEach((p2) => {
      if (!exclude.includes(p2.key)) tasks.push(p2.search(kw, 8).catch(() => []));
    });
    const groups = await Promise.all(tasks);
    const alternatives = pickAlternatives(q, groups, { excludeSources: exclude, limit: 6 });
    return { ok: true, alternatives };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('songwave-search', async (_e, keywords, sourceKey) => {
  if (!keywords || !String(keywords).trim()) return { ok: false, error: '关键词为空' };
  const kw = String(keywords).trim();
  const key = sourceKey || 'netease';
  try {
    const lxTask = getExtSources().then(async (list) => {
      // 只有声明了 search 动作的 扩展音源脚本才参与搜索（取链型脚本会返回空数组）
      const searchers = list.filter((x) => x.source.searchSources.length);
      if (!searchers.length) return [];
      const groups = await Promise.all(searchers.map((x) => x.source.search(kw, 10).catch(() => [])));
      return [].concat(...groups);
    });
    if (key === 'netease' || key === 'auto') {
      const [neteaseList, extList] = await Promise.all([netease.search(kw), lxTask]);
      return { ok: true, data: neteaseList.concat(extList), source: 'netease' };
    }
    const mod = PLATFORM_MAP[key];
    if (!mod) return { ok: false, error: '未知音源：' + key };
    // 平台接口经常变动/被限流：失败或 0 结果时自动回退内置网易云，并说明原因
    let list = [];
    let failReason = '';
    try {
      list = await mod.search(kw);
    } catch (e) {
      failReason = String(e && e.message || e);
      logLine('[songwave] 平台搜索失败(' + key + '):', failReason);
    }
    if (!list.length) {
      const [neteaseList, extList2] = await Promise.all([netease.search(kw), lxTask]);
      if (neteaseList.length) {
        return {
          ok: true,
          data: neteaseList.concat(extList2),
          source: 'netease',
          fallbackFrom: key,
          note: (failReason ? ('该音源接口不可用（' + failReason.slice(0, 40) + '）') : '该音源没有结果') + '，已自动改用网易云',
        };
      }
      if (failReason) return { ok: false, error: mod.label + ' 搜索失败：' + failReason };
    }
    const extList = await lxTask;
    return { ok: true, data: list.concat(extList), source: key };
  } catch (err) {
    logLine('[songwave] search 失败:', (err && err.stack) || err);
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('songwave-play-url', async (_e, payload) => {
  try {
    // 文本歌单导入的条目：先按「歌名 歌手」搜索，再取链
    if (payload && payload.source === 'search') {
      const kw = [payload.name, payload.artist].filter(Boolean).join(' ').trim();
      const list = await netease.search(kw, 5);
      if (!list.length) return { ok: false, error: '没有搜到：' + kw };
      const first = list[0];
      const url = await netease.getPlayUrl(Number(first.id));
      return { ok: true, url, via: 'search→netease', resolved: first };
    }
    // 带 extKey 的条目（QQ/酷狗/酷我/咪咕）统一走 扩展音源脚本取链
    if (payload && payload.extKey) {
      const src = await findSourceFor(payload.extKey, 'musicUrl');
      if (!src) {
        const have = extState.sourceKeys.length ? ('已装入的音源支持：' + extState.sourceKeys.join(', ')) : '尚未导入可用音源';
        return { ok: false, error: '没有能取链 ' + payload.extKey + ' 的音源脚本（请在「音源管理」里粘贴音源链接）。' + have };
      }
      const url = await src.getPlayUrl(payload.extKey, payload, payload.quality);
      return { ok: true, url, via: 'ext:' + payload.extKey };
    }
    const nid = Number(payload && payload.id !== undefined ? payload.id : payload);
    const url = await netease.getPlayUrl(nid);
    return { ok: true, url, via: 'netease' };
  } catch (err) {
    logLine('[songwave] play-url 失败:', (err && err.stack) || err);
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('songwave-lyric', async (_e, payload) => {
  try {
    if (payload && payload.extKey) {
      const src = await findSourceFor(payload.extKey, 'lyric');
      if (!src) return { ok: false, error: '没有支持歌词的 扩展音源' };
      const lyric = await src.getLyric(payload.extKey, payload.id);
      return { ok: true, data: lyric };
    }
    const nid = Number(payload && payload.id !== undefined ? payload.id : payload);
    const lyric = await netease.getLyric(nid);
    return { ok: true, data: lyric };
  } catch (err) {
    logLine('[songwave] lyric 失败:', (err && err.stack) || err);
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('open-local-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择本地音乐',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '音频', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (r.canceled) return [];
  return r.filePaths;
});

// —— 外部歌单导入（粘贴分享链接 / 文本歌单 / 本地文件） ——
const { createPlaylistImporter } = require('../src/playlist-import');
const playlistImporter = createPlaylistImporter();

ipcMain.handle('songwave-playlist-import', async (_e, payload) => {
  try {
    const text = payload && (payload.text != null ? payload.text : payload);
    if (!text || !String(text).trim()) return { ok: false, error: '请粘贴歌单链接或文本' };
    const r = await playlistImporter.importFromText(String(text));
    return { ok: true, name: r.name, cover: r.cover, platform: r.platform, items: r.items, count: r.items.length };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('songwave-playlist-import-file', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择歌单文件（.txt / .json）',
    properties: ['openFile'],
    filters: [{ name: '歌单', extensions: ['txt', 'json', 'm3u'] }, { name: '所有文件', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  try {
    const fs = require('fs');
    const raw = fs.readFileSync(r.filePaths[0], 'utf8');
    let text = raw;
    if (/\.json$/i.test(r.filePaths[0])) {
      try {
        const j = JSON.parse(raw);
        const arr = Array.isArray(j) ? j : (j.items || j.songs || j.tracks || []);
        text = arr.map((x) => (typeof x === 'string' ? x : [x.name || x.title, x.artist || x.singer].filter(Boolean).join(' - '))).join('\n');
      } catch (e) { /* 当作纯文本 */ }
    }
    const res = await playlistImporter.importFromText(text);
    return { ok: true, name: res.name || path.basename(r.filePaths[0]), cover: res.cover, platform: res.platform, items: res.items, count: res.items.length };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});
// —— 下载 ——
const DEFAULT_SAVE_DIR = process.env.SONGWAVE_SAVE_DIR || 'D:\\musicdownload';
const activeDownloads = new Map();
let dlSeq = 0;

ipcMain.handle('songwave-download', async (e, payload) => {
  const id = ++dlSeq;
  const url = payload && payload.url;
  const dir = (payload && payload.saveDir) || DEFAULT_SAVE_DIR;
  try {
    if (!url) return { ok: false, id, error: '缺少下载地址' };
    const job = downloadFile(url, dir, {
      filename: (payload && payload.filename) || 'download.mp3',
      onProgress: (p) => {
        try { e.sender.send('songwave-download-progress', { id, name: payload && payload.name, ...p }); } catch (err) { /* 窗口已关闭 */ }
      },
    });
    activeDownloads.set(id, job);
    const r = await job.promise;
    return { ok: true, id, filePath: r.filePath, bytes: r.bytes, saveDir: dir };
  } catch (err) {
    if (err && err.code === 'ECANCELED') return { ok: false, id, canceled: true };
    return { ok: false, id, error: String(err && err.message || err) };
  } finally {
    activeDownloads.delete(id);
  }
});

ipcMain.handle('songwave-download-cancel', (_e, id) => {
  const job = activeDownloads.get(Number(id));
  if (job) { job.cancel(); return { ok: true }; }
  return { ok: false, error: '任务不存在或已结束' };
});

ipcMain.handle('songwave-choose-save-dir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择下载目录',
    defaultPath: DEFAULT_SAVE_DIR,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  return { ok: true, dir: r.filePaths[0] };
});

ipcMain.handle('songwave-default-save-dir', () => DEFAULT_SAVE_DIR);

// —— Wallpaper Engine 壁纸库（背景） ——
const weEngine = require('../src/wallpaper-engine');
let weCache = null;
ipcMain.handle('songwave-we-list', (_e, force) => {
  try {
    if (!weCache || force) weCache = weEngine.discoverWallpapers();
    return {
      ok: true,
      libraries: weCache.libraries,
      items: weCache.items,
      defaults: weEngine.defaultBackgroundSettings(),
    };
  } catch (err) {
    logLine('[songwave] we-list 失败:', (err && err.stack) || err);
    return { ok: false, error: String(err && err.message || err) };
  }
});

// —— 壁纸模式（模仿 Wallpaper Engine：独立桌面层窗口，无边框、不抢焦点、尽量置底） ——
function createWallpaperWindow() {
  // 铺满主窗口所在的那块屏幕（多屏时跟随用户当前屏幕）
  let bounds;
  try {
    bounds = screen.getDisplayMatching(win ? win.getBounds() : {}).bounds;
  } catch (e) {
    bounds = screen.getPrimaryDisplay().bounds;
  }
  wallpaperWin = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    frame: false,
    backgroundColor: '#000000',
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  wallpaperWin.loadFile(path.join(__dirname, '..', 'app', 'index.html'), { query: { mode: 'wallpaper' } });

  const pushParams = () => {
    if (!wallpaperWin) return;
    if (wallpaperParams) {
      try { wallpaperWin.webContents.send('wallpaper-params', wallpaperParams); } catch (e) { /* ignore */ }
    }
  };
  wallpaperWin.webContents.on('did-finish-load', () => { pushParams(); });
  wallpaperWin.once('ready-to-show', () => {
    if (!wallpaperWin) return;
    wallpaperWin.showInactive();   // 不抢焦点地显示
    pushParams();
  });

  // 置底（Windows 支持）；不支持的平台/环境则退化为普通窗口，并在返回值里告知渲染层
  let alwaysOnBottom = false;
  try {
    wallpaperWin.setAlwaysOnBottom(true);
    alwaysOnBottom = true;
  } catch (e) {
    alwaysOnBottom = false;
  }
  try { wallpaperWin.setIgnoreMouseEvents(true); } catch (e) { /* ignore */ }

  wallpaperWin.on('closed', () => {
    wallpaperWin = null;
    notifyWallpaperState(false);
  });
  return { win: wallpaperWin, alwaysOnBottom };
}

function notifyWallpaperState(on) {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('wallpaper-state', !!on); } catch (e) { /* ignore */ }
  }
}

function toggleWallpaper(on) {
  if (on && !wallpaperWin) {
    const r = createWallpaperWindow();
    notifyWallpaperState(true);
    return { ok: true, on: true, alwaysOnBottom: r.alwaysOnBottom, platform: process.platform };
  }
  if (!on && wallpaperWin) {
    try { wallpaperWin.close(); } catch (e) { /* ignore */ }
    wallpaperWin = null;
    notifyWallpaperState(false);
    return { ok: true, on: false, platform: process.platform };
  }
  return { ok: true, on: !!wallpaperWin, alwaysOnBottom: process.platform === 'win32', platform: process.platform };
}

ipcMain.handle('songwave-wallpaper', (_e, on) => toggleWallpaper(on));

ipcMain.handle('songwave-wallpaper-params', (_e, params) => {
  wallpaperParams = params || null;
  if (wallpaperWin) {
    try { wallpaperWin.webContents.send('wallpaper-params', wallpaperParams); } catch (e) { /* ignore */ }
  }
  return { ok: true };
});

// 兜底逃生通道：即使壁纸层点击穿透/无法聚焦，也能用 Ctrl+Alt+W 关闭
app.whenReady().then(() => {
  try {
    globalShortcut.register('CommandOrControl+Alt+W', () => {
      toggleWallpaper(!wallpaperWin);
    });
  } catch (e) {
    console.log('[songwave] 全局快捷键注册失败:', e && e.message);
  }
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (e) { /* ignore */ }
});

// 主窗口关闭时同步关掉壁纸层
app.on('before-quit', () => {
  if (wallpaperWin) { try { wallpaperWin.destroy(); } catch (e) { /* ignore */ } wallpaperWin = null; }
});
// ============================================================
// v2.0.0 新增：桌面歌词独立浮窗 / 系统托盘 / 榜单 / 批量下载
// ============================================================

// —— 桌面歌词浮窗（独立窗口，可自由拖动） ——
let lyricWin = null;
const lyricState = { locked: false, style: null, text: '', next: '' };

function createLyricWindow() {
  if (lyricWin) return lyricWin;
  const b = lyricState.bounds || { width: 960, height: 140, x: 240, y: 80 };
  lyricWin = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    frame: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: true, skipTaskbar: true, resizable: true, hasShadow: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    title: '声浪桌面歌词',
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  lyricWin.loadFile(path.join(__dirname, '..', 'app', 'desktop-lyric.html'));
  try { lyricWin.setAlwaysOnTop(true, 'screen-saver'); } catch (e) { /* ignore */ }
  if (lyricState.locked) { try { lyricWin.setIgnoreMouseEvents(true, { forward: true }); } catch (e) { /* ignore */ } }
  lyricWin.on('moved', () => {
    try {
      const [x, y] = lyricWin.getPosition();
      const [width, height] = lyricWin.getSize();
      lyricState.bounds = { x, y, width, height };
    } catch (e) { /* ignore */ }
  });
  lyricWin.on('closed', () => { lyricWin = null; notifyLyricState(false); });
  lyricWin.webContents.on('did-finish-load', () => pushLyricPayload());
  return lyricWin;
}

function pushLyricPayload() {
  if (!lyricWin) return;
  try {
    lyricWin.webContents.send('lyric-window-data', {
      text: lyricState.text, next: lyricState.next,
      style: lyricState.style || {}, locked: lyricState.locked,
    });
  } catch (e) { /* ignore */ }
}

function notifyLyricState(on) {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('lyric-window-state', !!on); } catch (e) { /* ignore */ }
  }
  refreshTrayMenu();
}

function toggleLyricWindow(on) {
  if (on && !lyricWin) { createLyricWindow(); notifyLyricState(true); return { ok: true, on: true }; }
  if (!on && lyricWin) { try { lyricWin.close(); } catch (e) { /* ignore */ } lyricWin = null; notifyLyricState(false); return { ok: true, on: false }; }
  return { ok: true, on: !!lyricWin };
}

ipcMain.handle('songwave-lyric-window', (_e, payload) => {
  const p = payload || {};
  if (p.style) lyricState.style = p.style;
  if (typeof p.locked === 'boolean') lyricState.locked = p.locked;
  if (p.action === 'close') return toggleLyricWindow(false);
  const r = toggleLyricWindow(p.action === 'open' ? true : (p.on !== undefined ? p.on : true));
  if (lyricWin) {
    try { lyricWin.setIgnoreMouseEvents(!!lyricState.locked, { forward: true }); } catch (e) { /* ignore */ }
    pushLyricPayload();
  }
  return r;
});

ipcMain.handle('songwave-lyric-push', (_e, payload) => {
  const p = payload || {};
  lyricState.text = p.text || '';
  lyricState.next = p.next || '';
  if (p.style) lyricState.style = p.style;
  pushLyricPayload();
  return { ok: true };
});

ipcMain.handle('songwave-lyric-window-status', () => ({ ok: true, on: !!lyricWin, locked: lyricState.locked, bounds: lyricState.bounds || null }));

// —— 系统托盘 ——
let tray = null;
let trayOptions = { minimizeToTray: false, closeToTray: false };

function sendToMain(channel, payload) {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send(channel, payload); return true; } catch (e) { /* ignore */ }
  }
  return false;
}

function toggleMainWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) win.hide();
  else { win.show(); win.focus(); }
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏主窗口', click: toggleMainWindow },
    { type: 'separator' },
    { label: '播放 / 暂停', click: () => sendToMain('tray-command', 'toggle') },
    { label: '上一首', click: () => sendToMain('tray-command', 'prev') },
    { label: '下一首', click: () => sendToMain('tray-command', 'next') },
    { type: 'separator' },
    {
      label: '桌面歌词',
      type: 'checkbox',
      checked: !!lyricWin,
      click: () => toggleLyricWindow(!lyricWin),
    },
    { type: 'separator' },
    { label: '退出 声浪', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  if (tray) return tray;
  try {
    const iconPath = path.join(__dirname, '..', 'app', 'icon.png');
    const img = nativeImage.createFromPath(iconPath);
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
  } catch (e) {
    logLine('[songwave] 托盘创建失败:', e && e.message);
    return null;
  }
  tray.setToolTip('声浪 SongWave');
  refreshTrayMenu();
  tray.on('click', toggleMainWindow);
  tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
  return tray;
}

ipcMain.handle('songwave-tray', (_e, payload) => {
  const p = payload || {};
  if (p.action === 'on') { createTray(); refreshTrayMenu(); return { ok: true, on: !!tray }; }
  if (p.action === 'off' && tray) { try { tray.destroy(); } catch (e) { /* ignore */ } tray = null; return { ok: true, on: false }; }
  if (p.action === 'tooltip') { if (tray) tray.setToolTip(String(p.text || '声浪 SongWave').slice(0, 120)); return { ok: true }; }
  if (p.options) { Object.assign(trayOptions, p.options); }
  return { ok: true, on: !!tray, options: trayOptions };
});

// —— 排行榜 / 推荐歌单 ——
// 注意：src/charts.js 导出的是工厂函数，必须调用 createCharts() 得到实例
const charts = require('../src/charts').createCharts();
ipcMain.handle('songwave-charts', async (_e, payload) => {
  const p = payload || {};
  try {
    if (p.action === 'platforms') {
      const info = require('../src/charts').platformInfo();
      return { ok: true, platforms: info.supported, unsupported: info.unsupported };
    }
    if (p.action === 'list') {
      const info = require('../src/charts').platformInfo();
      const lists = {};
      info.supported.forEach((pl) => { lists[pl.key] = charts.list(pl.key); });
      return { ok: true, lists, unsupported: info.unsupported };
    }
    if (p.action === 'recommend') return { ok: true, items: await charts.recommend(p.limit || 12) };
    if (p.action === 'chart' || p.action === 'playlist') {
      const r = await charts.fetchChart(p.platform || 'netease', p.id, p.limit || 50);
      return { ok: true, data: r };
    }
    return { ok: false, error: '未知操作：' + p.action };
  } catch (err) {
    logLine('[songwave] charts 失败:', (err && err.stack) || err);
    return { ok: false, error: String(err && err.message || err) };
  }
});

// —— 批量下载（并发 / 命名模板 / 分组 / 歌词与封面嵌入） ——
const { createDownloadQueue } = require('../src/download-queue');
const { writeTagsToFile } = require('../src/id3');
let activeBatch = null;

ipcMain.handle('songwave-download-batch', async (e, payload) => {
  const p = payload || {};
  const items = Array.isArray(p.items) ? p.items : [];
  if (!items.length) return { ok: false, error: '没有可下载的歌曲' };
  const dir = p.saveDir || DEFAULT_SAVE_DIR;
  const q = createDownloadQueue({
    concurrency: p.options && p.options.concurrency,
    downloadFile,
    fetchBuffer: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return Buffer.from(await res.arrayBuffer());
    },
  });
  activeBatch = q;
  q.on('progress', (prog) => {
    try { e.sender.send('songwave-download-progress', Object.assign({ batch: true }, prog)); } catch (err) { /* ignore */ }
  });
  items.forEach((it, i) => {
    q.add({
      url: it.url, saveDir: dir, playlistName: p.playlistName, index: it.index != null ? it.index : (i + 1),
      lyrics: it.lyrics, coverUrl: it.cover,
      meta: { name: it.name, artist: it.artist, album: it.album, source: it.source },
      options: Object.assign({}, p.options, { template: (p.options && p.options.template) || '{artist} - {name}' }),
    });
  });
  const r = await q.start();
  activeBatch = null;
  return { ok: true, results: r.results, errors: r.errors, summary: q.summary() };
});

ipcMain.handle('songwave-download-batch-cancel', () => {
  if (activeBatch) { activeBatch.cancelAll(); return { ok: true }; }
  return { ok: false, error: '没有进行中的批量下载' };
});

// 主窗口关闭行为（托盘最小化）
app.on('browser-window-created', () => { /* no-op: 保持 window-all-closed 逻辑 */ });
