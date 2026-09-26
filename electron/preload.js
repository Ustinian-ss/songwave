// 声浪 SongWave · preload：向渲染层安全暴露窗口控制 + 音源桥
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('winCtl', {
  minimize: () => ipcRenderer.send('win-minimize'),
  toggleMaximize: () => ipcRenderer.send('win-toggle-maximize'),
  close: () => ipcRenderer.send('win-close'),
  isMaximized: () => ipcRenderer.invoke('win-is-maximized'),
  setFullScreen: (on) => ipcRenderer.invoke('win-set-fullscreen', on),
  onMaximizeChange: (cb) => {
    ipcRenderer.on('win-maximized-changed', (_e, val) => cb(val));
  },
});

contextBridge.exposeInMainWorld('songwave', {
  search: (keywords, source) => ipcRenderer.invoke('songwave-search', keywords, source),
  getPlayUrl: (id) => ipcRenderer.invoke('songwave-play-url', id),
  getLyric: (id) => ipcRenderer.invoke('songwave-lyric', id),
  openLocalFiles: () => ipcRenderer.invoke('open-local-files'),
  getExtStatus: () => ipcRenderer.invoke('songwave-ext-status'),
  download: (payload) => ipcRenderer.invoke('songwave-download', payload),
  cancelDownload: (id) => ipcRenderer.invoke('songwave-download-cancel', id),
  chooseSaveDir: () => ipcRenderer.invoke('songwave-choose-save-dir'),
  getDefaultSaveDir: () => ipcRenderer.invoke('songwave-default-save-dir'),
  onDownloadProgress: (cb) => {
    ipcRenderer.on('songwave-download-progress', (_e, p) => cb(p));
  },
  setWallpaper: (on) => ipcRenderer.invoke('songwave-wallpaper', on),
  pushWallpaperParams: (params) => ipcRenderer.invoke('songwave-wallpaper-params', params),
  onWallpaperParams: (cb) => {
    ipcRenderer.on('wallpaper-params', (_e, params) => cb(params));
  },
  onWallpaperState: (cb) => {
    ipcRenderer.on('wallpaper-state', (_e, on) => cb(on));
  },
  weList: (force) => ipcRenderer.invoke('songwave-we-list', force),
  srcList: () => ipcRenderer.invoke('songwave-src-list'),
  srcAdd: (payload) => ipcRenderer.invoke('songwave-src-add', payload),
  srcToggle: (payload) => ipcRenderer.invoke('songwave-src-toggle', payload),
  srcRemove: (id) => ipcRenderer.invoke('songwave-src-remove', id),
  srcPick: () => ipcRenderer.invoke('songwave-src-pick'),
  srcExternalPreview: () => ipcRenderer.invoke('songwave-src-external-preview'),
  srcImportExternal: (only) => ipcRenderer.invoke('songwave-src-import-external', only),
  srcImportDir: () => ipcRenderer.invoke('songwave-src-import-dir'),
  srcUpdate: (id) => ipcRenderer.invoke('songwave-src-update', id),
  srcProbe: (payload) => ipcRenderer.invoke('songwave-src-probe', payload),
  cacheImportOthers: () => ipcRenderer.invoke('songwave-cache-import-others'),
  cacheStats: () => ipcRenderer.invoke('songwave-cache-stats'),
  srcImportRecommended: () => ipcRenderer.invoke('songwave-src-import-recommended'),
  altSources: (payload) => ipcRenderer.invoke('songwave-alt-sources', payload),
  audioPresets: () => ipcRenderer.invoke('songwave-audio-presets'),
  // —— v2.0.0：桌面歌词浮窗 / 托盘 / 榜单 / 简繁 / 批量下载 ——
  lyricWindow: (payload) => ipcRenderer.invoke('songwave-lyric-window', payload),
  lyricPush: (payload) => ipcRenderer.invoke('songwave-lyric-push', payload),
  lyricWindowStatus: () => ipcRenderer.invoke('songwave-lyric-window-status'),
  onLyricWindowData: (cb) => { ipcRenderer.on('lyric-window-data', (_e, d) => cb(d)); },
  onLyricWindowState: (cb) => { ipcRenderer.on('lyric-window-state', (_e, on) => cb(on)); },
  tray: (payload) => ipcRenderer.invoke('songwave-tray', payload),
  onTrayCommand: (cb) => { ipcRenderer.on('tray-command', (_e, cmd) => cb(cmd)); },
  charts: (payload) => ipcRenderer.invoke('songwave-charts', payload),
  downloadBatch: (payload) => ipcRenderer.invoke('songwave-download-batch', payload),
  cancelDownloadBatch: () => ipcRenderer.invoke('songwave-download-batch-cancel'),
  zhTables: () => ipcRenderer.invoke('songwave-zh-tables'),
  playlistImport: (payload) => ipcRenderer.invoke('songwave-playlist-import', payload),
  playlistImportFile: () => ipcRenderer.invoke('songwave-playlist-import-file'),
});