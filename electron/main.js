// 声浪 SongWave · Electron 主进程
const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer } = require('electron');
const path = require('path');

const netease = require('../src/sources/netease');
const lxSource = require('../src/sources/lx-source');

let win = null;

// —— LX 用户音源（懒加载，可插拔；默认 flower.js，可用 SONGWAVE_LX_SCRIPT 指定） ——
const LX_SCRIPT = process.env.SONGWAVE_LX_SCRIPT || 'D:\\小程序\\lxmusic\\flower-v1.0.0.js';
const LX_INIT_TIMEOUT = Number(process.env.SONGWAVE_LX_INIT_TIMEOUT) || 30000;
let lxPromise = null;
function getLx() {
  if (!lxPromise) {
    lxPromise = lxSource.createLxSource(LX_SCRIPT, {
      name: path.basename(LX_SCRIPT),
      initTimeoutMs: LX_INIT_TIMEOUT,
    })
      .then((src) => {
        console.log('[songwave] lx 音源已加载:', src.name, '| 音源:', src.sourceKeys.join(','));
        return src;
      })
      .catch((err) => {
        console.log('[songwave] lx 音源不可用:', err && err.message || err);
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

function setupMaximizeEvents() {
  win.on('maximize', () => win.webContents.send('win-maximized-changed', true));
  win.on('unmaximize', () => win.webContents.send('win-maximized-changed', false));
}

// —— 音源 IPC ——
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