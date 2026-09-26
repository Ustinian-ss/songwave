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
    querySelector(sel) {
      this._qsMap = this._qsMap || {};
      return this._qsMap[sel] || (this._qsMap[sel] = makeEl('div'));
    },
    querySelectorAll() { return this._children.slice(); },
    set innerHTML(v) {
      this._html = String(v);
      this._children = [];
      this._qsMap = {};
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
let lastDownload = null;
let lastWallpaper = null;
let lastWallpaperParams = null;
let lastSearchSource = null;
let lastSrcAdd = null;
let lastLxImport = false;
let lastPlImport = null;
const tabEls = [
  { dataset: { tab: 'search' }, classList: { set: new Set(), add() {}, remove() {}, toggle() {}, contains() { return false; } }, onclick: null },
  { dataset: { tab: 'list' }, classList: { set: new Set(), add() {}, remove() {}, toggle() {}, contains() { return false; } }, onclick: null },
];
const chipEls = ['netease', 'qq', 'kugou', 'kuwo', 'migu'].map((s) => ({
  dataset: { src: s },
  classList: { set: new Set(s === 'netease' ? ['active'] : []), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, f) { const on = f === undefined ? !this.set.has(c) : !!f; if (on) this.set.add(c); else this.set.delete(c); return on; }, contains(c) { return this.set.has(c); } },
  onclick: null,
}));
const railEls = ['search', 'list', 'lyric', 'panel'].map((v) => ({
  id: 'rail-' + v,
  dataset: { view: v },
  classList: { set: new Set(v === 'search' ? ['active'] : []), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, f) { const on = f === undefined ? !this.set.has(c) : !!f; if (on) this.set.add(c); else this.set.delete(c); return on; }, contains(c) { return this.set.has(c); } },
  onclick: null,
}));
const doc = {
  readyState: 'complete',
  _listeners: {},
  body: makeEl('body'),
  documentElement: makeEl('html'),
  getElementById(id) { return ids[id] || (ids[id] = makeEl('div')); },
  createElement(tag) { return makeEl(tag); },
  querySelectorAll(sel) {
    if (sel === '.tab') return tabEls;
    if (sel === '#src-chips .chip') return chipEls;
    if (sel === '#rail .rail-btn') return railEls;
    return [];
  },
  addEventListener(type, fn) { this._listeners[type] = fn; },
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
      search: async (kw, src) => {
        lastSearchSource = src || 'netease';
        if (!kw) return { ok: false, error: '空' };
        return { ok: true, data: [{ id: 1, name: '晴天', artist: '周杰伦', album: '叶惠美', cover: 'http://c/p.jpg', durationMs: 269000, source: 'netease' }] };
      },
      getPlayUrl: async (obj) => ({ ok: true, url: 'https://music.163.com/song/media/outer/url?id=' + (obj && obj.id !== undefined ? obj.id : obj) + '.mp3' }),
      getLyric: async () => ({ ok: true, data: { lrc: '[00:01.00]第一句\n[00:10.00]第二句\n', tlyric: '[00:10.00]Second line' } }),
      openLocalFiles: async () => [],
      getLxStatus: async () => ({ ok: true, loaded: true, name: 'flower', sourceKeys: ['kw', 'mg'], searchSources: [] }),
      getDefaultSaveDir: async () => 'D:/musicdownload',
      download: async (o) => { lastDownload = o; return { ok: true, filePath: 'D:/musicdownload/' + o.filename }; },
      cancelDownload: async () => ({ ok: true }),
      chooseSaveDir: async () => ({ ok: false }),
      onDownloadProgress: () => {},
      setWallpaper: async (on) => { lastWallpaper = on; return { ok: true, on }; },
      pushWallpaperParams: (p) => { lastWallpaperParams = p; return { ok: true }; },
      onWallpaperParams: () => {},
      onWallpaperState: () => {},
      srcList: async () => ({
        ok: true,
        items: [{ id: 'a1', name: 'flower-v1.0.0', url: 'https://src.example/flower.js', enabled: true, sourceKeys: ['kw', 'tx'], ok: true }],
        state: {
          loading: false, loaded: true, name: 'flower-v1.0.0', sourceKeys: ['kw', 'tx'], searchSources: [], error: '',
          items: [{ id: 'a1', name: 'flower-v1.0.0', ok: true, sourceKeys: ['kw', 'tx'], searchSources: [], canSearch: false }],
        },
      }),
      srcAdd: async (p) => { lastSrcAdd = p; return { ok: true, entry: { id: 'a2', name: 'new-source', ok: true } }; },
      srcToggle: async () => ({ ok: true, items: [], state: { loaded: true, sourceKeys: [] } }),
      srcRemove: async () => ({ ok: true, items: [], state: { loaded: false, sourceKeys: [] } }),
      srcPick: async () => ({ ok: false }),
      srcImportLx: async () => { lastLxImport = true; return { ok: true, imported: [{ name: '野花🌷', sourceKeys: ['kw', 'tx'] }], skipped: [], items: [], state: { loaded: true, sourceKeys: ['kw', 'tx'], items: [] } }; },
      srcImportDir: async () => ({ ok: true, scanned: 3, imported: [{ name: 'a' }], items: [], state: { loaded: true, sourceKeys: ['kw'], items: [] } }),
      srcUpdate: async () => ({ ok: true, entry: { name: 'x' } }),
      playlistImport: async (p) => {
        lastPlImport = p;
        return { ok: true, name: '测试歌单', count: 2, items: [{ id: 'x1', name: 'A', artist: 'B', source: 'netease' }, { id: 'x2', name: 'C', artist: 'D', source: 'netease' }] };
      },
      playlistImportFile: async () => ({ ok: false }),
      weList: async () => ({
        ok: true,
        libraries: ['D:\\steam'],
        defaults: { scrim: 0.1, blur: 0, brightness: 100, contrast: 100, saturate: 100, objectFit: 'cover', flip: false, opacity: 1, playbackRate: 1, rotationEnabled: false, rotationInterval: 30 },
        items: [
          { id: '1111', title: '视频壁纸', type: 'video', source: 'workshop', renderable: 'video', video: 'D:\\steam\\w\\clip.mp4', preview: 'D:\\steam\\w\\preview.jpg', previewAnimated: false },
          { id: '2222', title: '场景壁纸', type: 'scene', source: 'workshop', renderable: 'image', video: null, preview: 'D:\\steam\\w\\preview.gif', previewAnimated: true },
        ],
      }),
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

    // 9) 键盘快捷键
    audioEl.pause();
    doc._listeners['keydown']({ key: ' ', preventDefault() {} });
    check('Space 播放', audioEl.paused === false);
    doc._listeners['keydown']({ key: ' ', preventDefault() {} });
    check('Space 暂停', audioEl.paused === true);
    audioEl.currentTime = 50;
    doc._listeners['keydown']({ key: 'ArrowRight', preventDefault() {} });
    check('→ 快进 5 秒', audioEl.currentTime === 55);
    doc._listeners['keydown']({ key: 'ArrowLeft', preventDefault() {} });
    check('← 快退 5 秒', audioEl.currentTime === 50);
    doc._listeners['keydown']({ key: 'ArrowUp', preventDefault() {} });
    check('↑ 音量 +5', Number(ids['volume'].value) === 60 && Math.abs(audioEl.volume - 0.6) < 1e-9);

    // 10) 播放条滚轮调音量
    ids['player']._listeners['wheel']({ deltaY: -100, preventDefault() {} });
    check('滚轮上调音量', Number(ids['volume'].value) === 65 && Math.abs(audioEl.volume - 0.65) < 1e-9);

    // 11) lx 音源状态提示
    await flush();
    check('lx 状态提示已更新', /flower/.test(ids['lx-status'].textContent));

    // 12) 下载：搜索结果行的 ⤓ 按钮 → 解析直链 → 调下载 → 状态提示
    const dlRow = ids['results']._children[0];
    await dlRow.querySelector('.t-dl').onclick({ stopPropagation() {} });
    await flush();
    await flush();
    check('下载参数含文件名', /晴天/.test((lastDownload || {}).filename || ''), JSON.stringify(lastDownload));
    check('下载参数用默认目录', (lastDownload || {}).saveDir === 'D:/musicdownload');
    check('下载完成状态提示', /已下载/.test(ids['status'].textContent), ids['status'].textContent);

    // 13) 壁纸模式
    await ids['btn-wallpaper'].onclick();
    await flush();
    await flush();
    check('壁纸模式已开启', lastWallpaper === true);
    check('壁纸参数已推送（含主题）', !!(lastWallpaperParams && lastWallpaperParams.theme), JSON.stringify(lastWallpaperParams));
    check('壁纸开启状态提示', /壁纸模式已开启/.test(ids['status'].textContent), ids['status'].textContent);

    // 14) Wallpaper Engine 背景（模仿 dsh-plugin-wallpaper-engine）
    await flush();
    check('壁纸列表已渲染 2 项', ids['we-list']._children.length === 2, String(ids['we-list']._children.length));
    check('默认背景模式不是壁纸', doc.body.classList.contains('bg-we') === false);
    ids['we-list']._children[0].onclick();
    await flush();
    check('选中视频壁纸后进入叠加模式', doc.body.classList.contains('bg-blend'));
    check('背景层已显示', ids['we-bg'].classList.contains('hidden') === false);
    check('视频背景已设置 src', /clip\.mp4$/.test(String(ids['we-video'].src || '')), String(ids['we-video'].src));
    check('遮罩透明度已应用', Number(ids['we-scrim'].style.opacity) === 0.1, String(ids['we-scrim'].style.opacity));
    ids['we-list']._children[1].onclick();
    await flush();
    check('动图预览壁纸切到 img 层', /preview\.gif$/.test(String(ids['we-img'].src || '')), String(ids['we-img'].src));
    check('img 层已取消隐藏', ids['we-img'].classList.contains('hidden') === false);

    // 15) 音源切换（网易 / QQ / 酷狗 / 酷我 / 咪咕）
    check('音源 chips 已绑定点击', typeof chipEls[1].onclick === 'function');
    check('默认搜索音源为网易', lastSearchSource === 'netease', String(lastSearchSource));
    chipEls[1].onclick();          // 切到 QQ
    await flush();
    check('切到 QQ 后高亮', chipEls[1].classList.contains('active'));
    check('切换后写入 localStorage', sandbox.localStorage._d['songwave.source'] === 'qq');
    ids['search-input'].value = '周杰伦';
    await ids['search-btn'].onclick();
    check('搜索请求带上了所选音源', lastSearchSource === 'qq', String(lastSearchSource));

    // 16) 左侧功能栏（LX 风格）
    check('功能栏按钮已绑定', typeof railEls[1].onclick === 'function');
    railEls[1].onclick();                    // 点「播放列表」
    check('点功能栏切到播放列表视图', ids['side-list'].classList.contains('hidden') === false);
    check('功能栏高亮跟随', railEls[1].classList.contains('active') && !railEls[0].classList.contains('active'));

    // 17) 音源管理（粘贴链接导入）
    await flush();
    check('音源列表已渲染', ids['src-list']._children.length === 1, String(ids['src-list']._children.length));
    check('音源条目显示能力与“仅取链”', /kw, tx/.test(ids['src-list']._children[0].innerHTML) && /仅取链/.test(ids['src-list']._children[0].innerHTML));
    const srcUrlInput = doc.getElementById('src-url');
    srcUrlInput.value = 'https://src.example/new.js';
    await ids['src-add-btn'].onclick();
    await flush();
    check('导入时带上了链接', (lastSrcAdd || {}).url === 'https://src.example/new.js', JSON.stringify(lastSrcAdd));
    check('导入成功提示', /音源导入成功/.test(ids['status'].textContent), ids['status'].textContent);
    check('导入后清空输入框', srcUrlInput.value === '');

    // 18) 歌词：点击跳转 + 偏移调节
    check('歌词行可点击（有 onclick）', typeof ids['lyric']._children[0].onclick === 'function');
    audioEl.currentTime = 99;
    ids['lyric']._children[0].onclick();
    check('点击歌词跳转到该行时间', audioEl.currentTime === 1, String(audioEl.currentTime));
    doc.getElementById('lyr-plus').onclick();
    check('歌词偏移 +0.5s 生效', /\+0\.5s/.test(ids['lyric-offset-val'].textContent), ids['lyric-offset-val'].textContent);
    check('歌词偏移已持久化', sandbox.localStorage._d['songwave.lyricOffset'] === '0.5', sandbox.localStorage._d['songwave.lyricOffset']);
    doc.getElementById('lyr-reset').onclick();
    check('偏移可重置', /^0\.0s/.test(ids['lyric-offset-val'].textContent), ids['lyric-offset-val'].textContent);

    // 19) 导入外部歌单
    doc.getElementById('btn-pl-import').onclick();
    const beforeCount = ids['playlist']._children.length;
    doc.getElementById('pl-import-text').value = 'https://music.163.com/#/playlist?id=1';
    await doc.getElementById('pl-import-btn').onclick();
    await flush();
    check('歌单导入调用了主进程', !!lastPlImport && /playlist/.test(lastPlImport.text || ''));
    check('歌单歌曲已加入播放列表', ids['playlist']._children.length === beforeCount + 2, String(ids['playlist']._children.length));
    check('歌单导入提示', /已导入歌单/.test(ids['status'].textContent), ids['status'].textContent);

    // 20) 从 LX Music 导入音源
    doc.getElementById('src-import-lx').onclick();
    await flush();
    await flush();
    check('触发了从 LX 导入', lastLxImport === true);
    check('LX 导入结果提示', /已从 LX 导入/.test(ids['status'].textContent), ids['status'].textContent);

    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
    process.exit(fail ? 1 : 0);
  } catch (err) {
    console.error('测试运行异常:', err);
    process.exit(1);
  }
})();