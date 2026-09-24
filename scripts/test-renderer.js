// 声浪 SongWave · 渲染层离线端到端测试（最小 DOM/引擎桩，无需 Electron）
// 用法：node scripts/test-renderer.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------- 最小元素桩 ----------
function makeEl(tag = 'div') {
  return {
    tagName: String(tag).toUpperCase(),
    style: {},
    dataset: {},
    value: '',
    textContent: '',
    _children: [],
    _listeners: {},
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      toggle(c, force) {
        const on = force === undefined ? !this.set.has(c) : !!force;
        if (on) this.set.add(c); else this.set.delete(c);
        return on;
      },
      contains(c) { return this.set.has(c); },
    },
    addEventListener(type, fn) { this._listeners[type] = fn; },
    appendChild(child) { this._children.push(child); return child; },
    get children() { return this._children; },
    removeAttribute() {},
    querySelector() { return this._qs || (this._qs = makeEl('div')); },
    querySelectorAll() { return this._children.slice(); },
    set innerHTML(v) {
      this._html = String(v);
      this._children = [];
      this._qs = undefined;
    },
    get innerHTML() { return this._html || ''; },
  };
}

function makeAudioEl() {
  const el = makeEl('audio');
  el.paused = true;
  el.currentTime = 0;
  el.duration = 200;
  el.volume = 0.8;
  el.play = async () => {
    el.paused = false;
    const fn = el._listeners['play'];
    if (fn) fn();
    return undefined;
  };
  el.pause = () => {
    el.paused = true;
    const fn = el._listeners['pause'];
    if (fn) fn();
  };
  return el;
}

// ---------- 全局桩 ----------
const ids = {};
const tabEls = [
  { dataset: { tab: 'search' }, classList: { set: new Set(), add() {}, remove() {}, toggle() {}, contains() { return false; } }, onclick: null },
  { dataset: { tab: 'list' }, classList: { set: new Set(), add() {}, remove() {}, toggle() {}, contains() { return false; } }, onclick: null },
];
const doc = {
  readyState: 'complete',
  getElementById(id) { return ids[id] || (ids[id] = makeEl('div')); },
  createElement(tag) { return makeEl(tag); },
  querySelectorAll(sel) { return sel === '.tab' ? tabEls : []; },
  addEventListener() {},
};

const audioEl = makeAudioEl();
ids['audio'] = audioEl;

const engineStub = {
  _onSourceEnd: null,
  initSystemAudio: async () => { engineStub.calls = (engineStub.calls || []).concat('system'); return 'system'; },
  initFile: (el) => { engineStub.calls = (engineStub.calls || []).concat('file'); return Promise.resolve('file'); },
  setTheme() {},
  setParam() {},
  getParam(k) { return k === 'theme' ? 'deepsea' : 1; },
  getThemes() { return [{ key: 'deepsea', name: '深海' }]; },
  getState() { return { audioLevel: 0 }; },
};

const sandbox = {
  window: {
    SongLife: engineStub,
    winCtl: {
      minimize() {}, toggleMaximize() {}, close() {},
      isMaximized: async () => false,
      onMaximizeChange() {},
    },
    songwave: {
      search: async (kw) => {
        if (!kw) return { ok: false, error: '空' };
        return { ok: true, data: [{ id: 1, name: '晴天', artist: '周杰伦', album: '叶惠美', cover: 'http://c/p.jpg', durationMs: 269000, source: 'netease' }] };
      },
      getPlayUrl: async (obj) => ({ ok: true, url: 'https://music.163.com/song/media/outer/url?id=' + (obj && obj.id !== undefined ? obj.id : obj) + '.mp3' }),
      getLyric: async () => ({ ok: true, data: { lrc: '[00:01.00]第一句\n[00:10.00]第二句\n', tlyric: '[00:10.00]Second line' } }),
      openLocalFiles: async () => [],
    },
    addEventListener() {},
    innerWidth: 1280,
  },
  document: doc,
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] || null; },
    setItem(k, v) { this._d[k] = String(v); },
  },
  setTimeout,
  clearTimeout,
  console,
};

// ---------- 加载并执行 ----------
const code = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8');
vm.runInNewContext(code, sandbox, { filename: 'renderer.js' });

// ---------- 断言工具 ----------
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  try {
    // 1) boot 后的初始状态
    check('boot 后主题按钮已生成', ids['themes']._children.length === 1);
    check('boot 后状态条显示欢迎语', /欢迎使用/.test(ids['status'].textContent));
    check('Tab 回调已绑定', typeof tabEls[0].onclick === 'function' && typeof tabEls[1].onclick === 'function');

    // 2) 搜索流程
    ids['search-input'].value = '周杰伦';
    await ids['search-btn'].onclick();
    check('搜索结果 1 条', ids['results']._children.length === 1);
    check('搜索结果条目标题正确', /晴天/.test(ids['results']._children[0].innerHTML));

    // 3) 点击结果 → 加入列表并播放（playCurrent 是异步的，等待微任务落定）
    const row = ids['results']._children[0];
    row.onclick();
    await flush();
    await flush();
    check('播放列表出现 1 条', ids['playlist']._children.length === 1);
    check('now-title 显示歌名', ids['now-title'].textContent === '晴天');
    check('now-artist 显示歌手', ids['now-artist'].textContent.indexOf('周杰伦') >= 0);
    check('封面已设置', ids['cover'].src === 'http://c/p.jpg');
    check('音频 src 为直链', audioEl.src === 'https://music.163.com/song/media/outer/url?id=1.mp3');
    check('已调用系统音频可视化', (engineStub.calls || []).includes('system'));

    // 4) 播放/暂停切换
    check('播放后 paused=false', audioEl.paused === false);
    ids['btn-play'].onclick();
    check('点击后暂停', audioEl.paused === true && ids['btn-play'].textContent === '▶');
    ids['btn-play'].onclick();
    check('再点恢复播放', audioEl.paused === false && ids['btn-play'].textContent === '⏸');

    // 5) 歌词解析与同步高亮
    check('歌词 2 行已渲染', ids['lyric']._children.length === 2);
    audioEl.currentTime = 11;
    audioEl._listeners['timeupdate']();
    check('第二行高亮（含翻译拼接）', ids['lyric']._children[1].classList.contains('active'));
    audioEl.currentTime = 0.5;
    audioEl._listeners['timeupdate']();
    check('歌前无高亮行', ids['lyric']._children[0].classList.contains('active') === false);
    audioEl.currentTime = 1.5;
    audioEl._listeners['timeupdate']();
    check('回到第一行高亮', ids['lyric']._children[0].classList.contains('active'));

    // 6) 单曲列表 next 不越界
    ids['btn-next'].onclick();
    await flush();
    check('单曲列表 next 不越界', audioEl.src === 'https://music.163.com/song/media/outer/url?id=1.mp3');

    // 6) 清空列表
    ids['btn-clear-list'].onclick();
    check('清空后播放列表为空', ids['playlist']._children.length === 0);
    check('清空后回到未播放', ids['now-title'].textContent === '未在播放');

    // 7) 设置持久化
    ids['volume'].value = '55';
    ids['volume']._listeners['input']({ target: ids['volume'] });
    check('音量已应用', Math.abs(audioEl.volume - 0.55) < 1e-9);
    check('设置已写入 localStorage', /volume/.test(sandbox.localStorage._d['songwave.state'] || ''));

    // 8) Tab 切换
    tabEls[1].onclick();
    check('Tab 切换后 side-list 可见', ids['side-list'].classList.contains('hidden') === false);

    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
    process.exit(fail ? 1 : 0);
  } catch (err) {
    console.error('测试运行异常:', err);
    process.exit(1);
  }
})();