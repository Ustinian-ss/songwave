// 声浪 SongWave · Electron 主进程
const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer, screen, globalShortcut } = require('electron');
const path = require('path');

const netease = require('../src/sources/netease');
const lxSource = require('../src/sources/lx-source');
const { downloadFile } = require('../src/download');

let win = null;
let wallpaperWin = null;
let wallpaperParams = null;

// —— LX 用户音源（懒加载，可插拔；默认 flower.js，可用 SONGWAVE_LX_SCRIPT 指定） ——
const LX_SCRIPT = process.env.SONGWAVE_LX_SCRIPT || 'D:\\小程序\\lxmusic\\flower-v1.0.0.js';
const LX_INIT_TIMEOUT = Number(process.env.SONGWAVE_LX_INIT_TIMEOUT) || 30000;
let lxPromise = null;
let lxState = { loading: false, loaded: false, name: '', sourceKeys: [], searchSources: [], error: '' };
function getLx() {
  if (!lxPromise) {
    lxState.loading = true;
    lxPromise = lxSource.createLxSource(LX_SCRIPT, {
      name: path.basename(LX_SCRIPT),
      initTimeoutMs: LX_INIT_TIMEOUT,
    })
      .then((src) => {
        lxState = {
          loading: false, loaded: true,
          name: src.name, sourceKeys: src.sourceKeys, searchSources: src.searchSources,
          error: '',
        };
        console.log('[songwave] lx 音源已加载:', src.name, '| 音源:', src.sourceKeys.join(','));
        return src;
      })
      .catch((err) => {
        lxState = {
          loading: false, loaded: false, name: '', sourceKeys: [], searchSources: [],
          error: err && err.message || String(err),
        };
        console.log('[songwave] lx 音源不可用:', lxState.error);
        return null;
      });
  }
  return lxPromise;
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
  setupDisplayMedia();
  createWindow();
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
ipcMain.handle('songwave-lx-status', () => lxState);

ipcMain.handle('songwave-search', async (_e, keywords) => {
  if (!keywords || !String(keywords).trim()) return { ok: false, error: '关键词为空' };
  const kw = String(keywords).trim();
  try {
    const [neteaseList, lxList] = await Promise.all([
      netease.search(kw),
      getLx().then((src) => (src ? src.search(kw, 15) : [])),
    ]);
    return { ok: true, data: neteaseList.concat(lxList) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('songwave-play-url', async (_e, payload) => {
  try {
    if (payload && payload.source === 'lx') {
      const src = await getLx();
      if (!src) return { ok: false, error: 'lx 音源未加载' };
      const url = await src.getPlayUrl(payload.lxSource, payload, payload.quality);
      return { ok: true, url };
    }
    const nid = Number(payload && payload.id !== undefined ? payload.id : payload);
    const url = await netease.getPlayUrl(nid);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('songwave-lyric', async (_e, payload) => {
  try {
    if (payload && payload.source === 'lx') {
      const src = await getLx();
      if (!src) return { ok: false, error: 'lx 音源未加载' };
      const lyric = await src.getLyric(payload.lxSource, payload.id);
      return { ok: true, data: lyric };
    }
    const nid = Number(payload && payload.id !== undefined ? payload.id : payload);
    const lyric = await netease.getLyric(nid);
    return { ok: true, data: lyric };
  } catch (err) {
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