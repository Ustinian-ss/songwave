// 声浪 SongWave · preload：向渲染层安全暴露窗口控制 + 音源桥
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('winCtl', {
  minimize: () => ipcRenderer.send('win-minimize'),
  toggleMaximize: () => ipcRenderer.send('win-toggle-maximize'),
  close: () => ipcRenderer.send('win-close'),
  isMaximized: () => ipcRenderer.invoke('win-is-maximized'),
  onMaximizeChange: (cb) => {
    ipcRenderer.on('win-maximized-changed', (_e, val) => cb(val));
  },
});

contextBridge.exposeInMainWorld('songwave', {
  search: (keywords) => ipcRenderer.invoke('songwave-search', keywords),
  getPlayUrl: (id) => ipcRenderer.invoke('songwave-play-url', id),
  openLocalFiles: () => ipcRenderer.invoke('open-local-files'),
});