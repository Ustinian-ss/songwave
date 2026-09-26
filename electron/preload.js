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
  getLxStatus: () => ipcRenderer.invoke('songwave-lx-status'),
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
});