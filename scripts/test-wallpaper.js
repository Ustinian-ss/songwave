// 声浪 SongWave · 壁纸模式专项测试（离线，验证「黑屏」bug 不再出现）
// 用法：node scripts/test-wallpaper.js
// 核心断言：壁纸窗口在音频回环失败时，绝不能再调 initFile(空 audio) 把振幅压成 0
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

function makeEl(tag = 'div') {
  return {
    tagName: String(tag).toUpperCase(),
    style: {}, dataset: {}, value: '', textContent: '', _children: [], _listeners: {},
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); },
      toggle(c, f) { const on = f === undefined ? !this.set.has(c) : !!f; if (on) this.set.add(c); else this.set.delete(c); return on; },
      contains(c) { return this.set.has(c); },
    },
    addEventListener(t, fn) { this._listeners[t] = fn; },
    appendChild(c) { this._children.push(c); return c; },
    get children() { return this._children; },
    removeAttribute() {},
    querySelector(sel) { this._q = this._q || {}; return this._q[sel] || (this._q[sel] = makeEl()); },
    querySelectorAll() { return this._children.slice(); },
    set innerHTML(v) { this._html = String(v); this._children = []; this._q = {}; },
    get innerHTML() { return this._html || ''; },
  };
}

const ids = {};
const body = makeEl('body');
const doc = {
  readyState: 'complete', _listeners: {}, body,
  getElementById(id) { return ids[id] || (ids[id] = makeEl()); },
  createElement(t) { return makeEl(t); },
  querySelectorAll(sel) { return sel === '.tab' ? [] : []; },
  addEventListener(t, fn) { this._listeners[t] = fn; },
};

const audioEl = makeEl('audio');
audioEl.paused = true; audioEl.currentTime = 0; audioEl.duration = 0; audioEl.volume = 0.8;
audioEl.play = async () => { audioEl.paused = false; };
audioEl.pause = () => { audioEl.paused = true; };
ids['audio'] = audioEl;

// 引擎桩：getState 返回「活对象」，模拟 engine.js 的真实行为
const engineState = { audioOn: false, audioLevel: 0, bass: 0, mid: 0, high: 0 };
const calls = { initSystemAudio: 0, initFile: 0, setTheme: [], setParam: [] };
const engine = {
  initSystemAudio: async () => { calls.initSystemAudio++; throw new Error('回环被占用'); }, // 模拟抢占失败
  initFile: (el) => { calls.initFile++; engineState.audioOn = true; return Promise.resolve('file'); },
  setTheme(n) { calls.setTheme.push(n); },
  setParam(k, v) { calls.setParam.push([k, v]); },
  getParam: (k) => (k === 'theme' ? 'deepsea' : 1),
  getThemes: () => [{ key: 'deepsea', name: '深海' }, { key: 'neon', name: '霓虹' }],
  getState: () => engineState,
  _onSourceEnd: null,
};

let paramsCb = null;
const wallpaperCalls = [];
const sandbox = {
  window: {
    SongLife: engine,
    winCtl: { minimize() {}, toggleMaximize() {}, close() {}, isMaximized: async () => false, onMaximizeChange() {}, setFullScreen: async () => ({ ok: true }) },
    songwave: {
      search: async () => ({ ok: true, data: [] }),
      getPlayUrl: async () => ({ ok: true, url: 'http://x/a.mp3' }),
      getLyric: async () => ({ ok: true, data: { lrc: '', tlyric: '' } }),
      openLocalFiles: async () => [],
      getExtStatus: async () => ({ ok: true, loaded: false, error: 'x' }),
      getDefaultSaveDir: async () => 'D:/musicdownload',
      download: async () => ({ ok: true }),
      cancelDownload: async () => ({ ok: true }),
      chooseSaveDir: async () => ({ ok: false }),
      onDownloadProgress: () => {},
      setWallpaper: (on) => { wallpaperCalls.push(on); return Promise.resolve({ ok: true, on, alwaysOnBottom: true }); },
      pushWallpaperParams: () => Promise.resolve({ ok: true }),
      onWallpaperParams: (cb) => { paramsCb = cb; },
      onWallpaperState: () => {},
    },
    addEventListener() {}, innerWidth: 1920, innerHeight: 1080,
  },
  document: doc,
  location: { search: '?mode=wallpaper' },   // ← 关键：进入壁纸模式
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); } },
  setTimeout, clearTimeout, setInterval, clearInterval, console,
};

const code = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8');
vm.runInNewContext(code, sandbox, { filename: 'renderer.js' });

const flush = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  try {
    await flush(); await flush();

    check('壁纸窗口加上了 wallpaper 类', body.classList.contains('wallpaper'));
    check('尝试过系统音频回环', calls.initSystemAudio === 1);
    // ↓↓ 就是「黑屏」这个 bug 的回归断言 ↓↓
    check('回环失败时不再 initFile(空 audio)（黑屏根因）', calls.initFile === 0, 'initFile 被调用 ' + calls.initFile + ' 次');
    check('回环失败后保持演示动画（audioOn=false）', engineState.audioOn === false);

    // 主窗口推来的主题/参数应生效
    const applied = paramsCb && (paramsCb({ theme: 'neon', params: { height: 1.7 }, hint: '测试' }), true);
    check('收到主窗口参数回调', !!paramsCb);
    check('主题已应用（neon）', calls.setTheme.includes('neon'), JSON.stringify(calls.setTheme));
    check('参数已应用（height=1.7）', calls.setParam.some(([k, v]) => k === 'height' && v === 1.7));
    check('提示文字未抛异常', applied === true);

    // Esc 退出
    doc._listeners['keydown'] && doc._listeners['keydown']({ key: 'Escape', preventDefault() {} });
    await flush();
    check('Esc 能请求关闭壁纸模式', wallpaperCalls.includes(false), JSON.stringify(wallpaperCalls));

    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('测试运行异常:', e);
    process.exit(1);
  }
})();