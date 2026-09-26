// 声浪 SongWave · 渲染层逻辑
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const statusEl = $('status');
  const resultsEl = $('results');
  const playlistEl = $('playlist');
  const hintEl = $('hint');
  const nowTitle = $('now-title');
  const nowArtist = $('now-artist');
  const coverEl = $('cover');
  const btnPlay = $('btn-play');

  const engine = window.SongLife;

  // 壁纸模式：同一套代码，用 ?mode=wallpaper 在桌面层窗口里只渲染可视化
  const IS_WALLPAPER = (typeof location !== 'undefined' && location.search)
    ? /mode=wallpaper/.test(location.search)
    : false;

  let playlist = [];
  let current = -1;
  let engineStarted = false;
  let vizMode = 'none';   // none | system | direct
  let statusTimer = null;
  // 当前音源（网易/QQ/酷狗/酷我/咪咕）
  let curSource = 'netease';
  const SOURCE_LABELS = { netease: '网易云', qq: 'QQ音乐', kugou: '酷狗', kuwo: '酷我', migu: '咪咕' };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function setStatus(msg, ms = 2600) {
    statusEl.textContent = msg;
    statusEl.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove('show'), ms);
  }

  // —— 窗口控制 ——
  $('wb-min').onclick = () => window.winCtl.minimize();
  $('wb-max').onclick = () => window.winCtl.toggleMaximize();
  $('wb-close').onclick = () => window.winCtl.close();
  window.winCtl.onMaximizeChange((v) => { $('wb-max').textContent = v ? '❐' : '□'; });

  // —— 侧栏 Tab ——
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const key = tab.dataset.tab;
      $('side-search').classList.toggle('hidden', key !== 'search');
      $('side-list').classList.toggle('hidden', key !== 'list');
      $('side-lyric').classList.toggle('hidden', key !== 'lyric');
    };
  });

  // —— 搜索 ——
  async function doSearch() {
    const kw = $('search-input').value.trim();
    if (!kw) return;
    setStatus('搜索中（' + (SOURCE_LABELS[curSource] || curSource) + '）…', 4000);
    const r = await window.songwave.search(kw, curSource);
    if (!r.ok) { setStatus('搜索失败：' + r.error, 7000); return; }
    pushSearchHistory(kw);
    // 平台接口不可用时后端会回退网易云：只提示原因，**不改**你选的音源（下次仍按你的选择重试）
    if (r.fallbackFrom) {
      const want = SOURCE_LABELS[r.fallbackFrom] || r.fallbackFrom;
      setStatus((r.note || (want + ' 暂无结果')) + '（下面显示的是' + (SOURCE_LABELS[r.source] || r.source) + '的结果，音源选择未改动）', 9000);
    }
    renderResults(r.data || []);
    if (!r.fallbackFrom) setStatus(r.data && r.data.length ? `找到 ${r.data.length} 首` : '没有结果');
  }
  $('search-btn').onclick = doSearch;
  $('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  // 音源切换（网易 / QQ / 酷狗 / 酷我 / 咪咕）
  document.querySelectorAll('#src-chips .chip').forEach((b) => {
    b.onclick = () => {
      curSource = b.dataset.src || 'netease';
      document.querySelectorAll('#src-chips .chip').forEach((x) => x.classList.toggle('active', x.dataset.src === curSource));
      try { localStorage.setItem('songwave.source', curSource); } catch (e) { /* ignore */ }
      setStatus('音源切换为：' + (SOURCE_LABELS[curSource] || curSource), 2500);
      if ($('search-input').value.trim()) doSearch();
    };
  });

  function renderResults(list) {
    resultsEl.innerHTML = '';
    if (!list.length) { resultsEl.innerHTML = '<div class="t-artist" style="padding:10px">没有结果</div>'; return; }
    list.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'track';
      const badge = item.source === 'ext'
        ? '<span class="t-src">' + esc(item.extKey || 'ext') + '</span>'
        : '<span class="t-src">' + esc(SOURCE_LABELS[item.source] || item.source || '') + '</span>';
      row.innerHTML =
        '<span class="t-name">' + esc(item.name) + '</span>' +
        '<span class="t-artist">' + esc(item.artist) + '</span>' +
        badge +
        '<button class="t-dl" title="下载">⤓</button>' +
        '<button class="t-remove" title="加入播放列表">＋</button>';
      const dlBtn = row.querySelector('.t-dl');
      if (dlBtn) dlBtn.onclick = (e) => { e.stopPropagation(); downloadItem(item); };
      row.querySelector('.t-remove').onclick = (e) => { e.stopPropagation(); addAndPlay(item); };
      row.onclick = () => addAndPlay(item);
      resultsEl.appendChild(row);
    });
  }

  // —— 播放列表 ——
  function addAndPlay(item) {
    playlist.push(item);
    current = playlist.length - 1;
    renderPlaylist();
    playCurrent();
    switchTab('list');
  }
  function switchTab(key) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === key));
    $('side-search').classList.toggle('hidden', key !== 'search');
    $('side-list').classList.toggle('hidden', key !== 'list');
    $('side-lyric').classList.toggle('hidden', key !== 'lyric');
    const fav = $('side-favorites'); if (fav) fav.classList.toggle('hidden', key !== 'favorites');
    const dis = $('side-discover'); if (dis) dis.classList.toggle('hidden', key !== 'discover');
    const pls = $('side-playlists'); if (pls) pls.classList.toggle('hidden', key !== 'playlists');
    const his = $('side-history'); if (his) his.classList.toggle('hidden', key !== 'history');
    if (key === 'favorites') renderFavorites();
    if (key === 'discover') loadCharts();
    if (key === 'playlists') { renderMyPlaylists(); renderMyPlaylistSongs(); }
    if (key === 'history') renderHistory();
    // 功能栏高亮同步
    document.querySelectorAll('#rail .rail-btn').forEach((b) => {
      if (b.id === 'btn-wallpaper') return;
      b.classList.toggle('active', b.dataset.view === key);
    });
  }

  // ================= 曲库：收藏 / 历史 / 搜索历史 / 播放进度记忆 =================
  let favorites = [];
  let history = [];
  let searchHistory = [];
  let progressMap = {};
  const HOT_SEARCHES = ['周杰伦', '林俊杰', '薛之谦', '夜曲', '起风了', '孤勇者'];

  const trackKey = (it) => (it && (it.source || it.type || 'local')) + ':' + (it && (it.id || it.url || it.name) || '');
  function loadLibrary() {
    const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
    favorites = read('songwave.favorites', []) || [];
    history = read('songwave.history', []) || [];
    searchHistory = read('songwave.searchHistory', []) || [];
    progressMap = read('songwave.progress', {}) || {};
    if (!Array.isArray(favorites)) favorites = [];
    if (!Array.isArray(history)) history = [];
    if (!Array.isArray(searchHistory)) searchHistory = [];
    if (typeof progressMap !== 'object' || !progressMap) progressMap = {};
  }
  function saveLibrary() {
    try {
      localStorage.setItem('songwave.favorites', JSON.stringify(favorites.slice(0, 500)));
      localStorage.setItem('songwave.history', JSON.stringify(history.slice(0, 300)));
      localStorage.setItem('songwave.searchHistory', JSON.stringify(searchHistory.slice(0, 30)));
      localStorage.setItem('songwave.progress', JSON.stringify(progressMap));
    } catch (e) { /* ignore */ }
  }
  function isFavorite(it) {
    const k = trackKey(it);
    return favorites.some((x) => trackKey(x) === k);
  }
  function toggleFavorite(it) {
    if (!it) return;
    const k = trackKey(it);
    const idx = favorites.findIndex((x) => trackKey(x) === k);
    if (idx >= 0) { favorites.splice(idx, 1); setStatus('已取消收藏', 1800); }
    else { favorites.unshift(it); setStatus('已收藏到「我喜欢」', 1800); }
    saveLibrary(); renderFavorites(); updateFavButton();
  }
  function updateFavButton() {
    const btn = $('btn-fav');
    if (!btn) return;
    const on = current >= 0 && playlist[current] && isFavorite(playlist[current]);
    btn.textContent = on ? '♥' : '♡';
    btn.classList.toggle('active', !!on);
    const npFav = $('np-fav'); if (npFav) npFav.textContent = on ? '♥' : '♡';
  }
  function pushHistory(it) {
    if (!it) return;
    const k = trackKey(it);
    const i = history.findIndex((x) => trackKey(x) === k);
    if (i >= 0) history.splice(i, 1);
    history.unshift(Object.assign({}, it, { playedAt: Date.now() }));
    saveLibrary();
    if (currentSideView() === 'history') renderHistory();
  }
  function currentSideView() {
    const el = $('side-search');
    if (el && !el.classList.contains('hidden')) return 'search';
    const l = $('side-list'); if (l && !l.classList.contains('hidden')) return 'list';
    const ly = $('side-lyric'); if (ly && !ly.classList.contains('hidden')) return 'lyric';
    const f = $('side-favorites'); if (f && !f.classList.contains('hidden')) return 'favorites';
    return 'history';
  }
  function pushSearchHistory(kw) {
    const k = String(kw || '').trim();
    if (!k) return;
    const i = searchHistory.indexOf(k);
    if (i >= 0) searchHistory.splice(i, 1);
    searchHistory.unshift(k);
    saveLibrary(); renderSearchHistory();
  }
  function renderSearchHistory() {
    const el = $('search-history');
    if (!el) return;
    el.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'sh-head';
    head.textContent = '热门搜索';
    el.appendChild(head);
    const row1 = document.createElement('div');
    row1.className = 'sh-row';
    HOT_SEARCHES.slice(0, 6).forEach((k) => {
      const b = document.createElement('button');
      b.className = 'btn chip';
      b.textContent = k;
      b.onclick = () => { $('search-input').value = k; doSearch(); };
      row1.appendChild(b);
    });
    el.appendChild(row1);
    if (searchHistory.length) {
      const head2 = document.createElement('div');
      head2.className = 'sh-head';
      const label = document.createElement('span');
      label.textContent = '搜索历史';
      const clr = document.createElement('button');
      clr.className = 'sh-clear';
      clr.textContent = '清空';
      clr.onclick = () => { searchHistory = []; saveLibrary(); renderSearchHistory(); };
      head2.appendChild(label);
      head2.appendChild(clr);
      el.appendChild(head2);
      const row2 = document.createElement('div');
      row2.className = 'sh-row';
      searchHistory.slice(0, 12).forEach((k) => {
        const b = document.createElement('button');
        b.className = 'btn chip';
        b.textContent = k;
        b.onclick = () => { $('search-input').value = k; doSearch(); };
        row2.appendChild(b);
      });
      el.appendChild(row2);
    }
  }
  function renderFavorites() {
    const el = $('favorites');
    if (!el) return;
    el.innerHTML = '';
    if (!favorites.length) { el.innerHTML = '<div class="we-empty">还没有收藏，点播放条上的 ♡ 收藏当前歌曲</div>'; return; }
    favorites.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'track';
      row.innerHTML =
        '<span class="t-idx">' + (i + 1) + '</span>' +
        '<span class="t-name">' + esc(it.name || it.label) + '</span>' +
        '<span class="t-artist">' + esc(it.artist || '') + '</span>' +
        '<span class="t-src">' + esc(sourceLabelOf(it)) + '</span>' +
        '<button class="t-remove" title="取消收藏">♥</button>';
      row.onclick = () => { playlist = playlist.concat([it]); current = playlist.length - 1; renderPlaylist(); playCurrent(); switchTab('list'); };
      const rm = row.querySelector('.t-remove');
      if (rm) rm.onclick = (e) => { e.stopPropagation(); toggleFavorite(it); };
      el.appendChild(row);
    });
  }
  function renderHistory() {
    const el = $('history');
    if (!el) return;
    el.innerHTML = '';
    if (!history.length) { el.innerHTML = '<div class="we-empty">还没有播放记录</div>'; return; }
    history.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'track';
      row.innerHTML =
        '<span class="t-idx">' + (i + 1) + '</span>' +
        '<span class="t-name">' + esc(it.name || it.label) + '</span>' +
        '<span class="t-artist">' + esc(it.artist || '') + '</span>' +
        '<span class="t-src">' + esc(sourceLabelOf(it)) + '</span>' +
        '<button class="t-dl" title="加入列表">＋</button>';
      row.onclick = () => { playlist = playlist.concat([it]); current = playlist.length - 1; renderPlaylist(); playCurrent(); switchTab('list'); };
      const add = row.querySelector('.t-dl');
      if (add) add.onclick = (e) => { e.stopPropagation(); playlist.push(it); renderPlaylist(); setStatus('已加入播放列表', 1800); };
      el.appendChild(row);
    });
  }
  function sourceLabelOf(it) {
    if (!it) return '';
    if (it.type === 'local') return '本地';
    if (it.source === 'ext') return it.extKey || 'ext';
    const map = { netease: '网易', qq: 'QQ', kugou: '酷狗', kuwo: '酷我', migu: '咪咕', search: '搜索' };
    return map[it.source] || it.source || '';
  }

  // ================= 播放失败自动换源（换平台） =================
  let autoSwitch = true;
  try { autoSwitch = localStorage.getItem('songwave.autoswitch') !== '0'; } catch (e) { /* ignore */ }
  const altTried = new Map();   // trackKey -> 已尝试过的平台集合
  // 已经用「试听片段」播过的曲目（keyed by trackKey，跨对象替换也能记住）：
  // 这类曲目播到十几秒被截断是正常的，不该再报"换源失败"。
  const previewTracks = new Set();

  const switching = new Map();   // trackKey -> 进行中的换源 Promise（同一首并发只跑一次）

  async function tryAutoSwitch(item) {
    if (!autoSwitch || !window.songwave.altSources || !item) return false;
    const key = trackKey(item);
    // 已经给这首歌找到过「能出声的版本」（哪怕只是试听片段），不要再换一轮吓人
    if (previewTracks.has(key)) return true;
    // 并发去重：点播放和 audio 的 error 事件几乎同时触发，不合并就会跑两轮
    // （第二轮在第一轮成功之前发起，12 秒后才回来报"换源失败"，把已成功的提示覆盖掉）
    if (switching.has(key)) return switching.get(key);
    const task = doAutoSwitch(item, key).catch(() => false).then((ok) => {
      switching.delete(key);
      return ok;
    });
    switching.set(key, task);
    return task;
  }

  async function doAutoSwitch(item, key) {
    const tried = altTried.get(key) || new Set([item.source || 'local', 'local']);
    if (tried.size > 6) return false;
    setStatus('取链失败，正在换源…', 0);
    let r = null;
    try {
      r = await window.songwave.altSources({
        name: item.name || item.label,
        artist: item.artist,
        durationMs: item.durationMs,
        excludeSources: Array.from(tried),
      });
    } catch (e) { r = null; }
    if (!r || !r.ok || !r.alternatives || !r.alternatives.length) {
      const why = (r && r.error) ? ('（' + r.error + '）') : '';
      setStatus('换源失败：其它平台没找到匹配版本' + why + '，已试 ' + tried.size + ' 个平台', 8000);
      console.warn('[songwave] 换源失败：未找到替代版本', { query: item.name, artist: item.artist, tried: Array.from(tried) });
      return false;
    }
    const failures = [];
    let previewOnly = null;   // 只有试听片段的候选，留作最后的兜底
    for (const alt of r.alternatives) {
      tried.add(alt.source);
      altTried.set(key, tried);
      setStatus('尝试换源：' + sourceLabelOf(alt) + ' · ' + (alt.name || ''), 0);
      let pr = null;
      try {
        pr = await window.songwave.getPlayUrl({
          source: alt.source,
          id: alt.id,
          extKey: alt.extKey,
          songmid: alt.songmid,
          hash: alt.hash,
          copyrightId: alt.copyrightId,
          quality: alt.quality,
        });
      } catch (e) { pr = null; }
      if (!pr || !pr.ok) {
        const reason = (pr && pr.error) ? pr.error : '取链异常';
        failures.push(sourceLabelOf(alt) + '（' + String(reason).slice(0, 24) + '）');
        console.warn('[songwave] 换源尝试失败', sourceLabelOf(alt), reason);
        continue;
      }
      // 只有试听片段（版权/会员限制）：先记下来，继续找完整版；实在没有再用它
      if (pr.warn && !previewOnly) {
        previewOnly = { alt: alt, pr: pr };
        console.warn('[songwave] 该平台只有试听片段，继续找完整版：', sourceLabelOf(alt), pr.warn);
        continue;
      }
      return await playAlt(alt, pr);
    }
    if (previewOnly) {
      setStatus('其它平台只有试听片段，先用它播放…', 4000);
      return await playAlt(previewOnly.alt, previewOnly.pr);
    }
    setStatus('换源失败：' + (failures.length ? failures.join('、') : '替代音源都不可用'), 9000);
    console.warn('[songwave] 换源失败明细', failures);
    return false;

    /** 真正切到替代音源播放 */
    async function playAlt(alt, pr) {
      // 记住换源结果：后续重播直接用新平台
      const merged = Object.assign({}, item, {
        source: alt.source,
        id: alt.id,
        extKey: alt.extKey,
        songmid: alt.songmid,
        hash: alt.hash,
        copyrightId: alt.copyrightId,
        name: item.name || alt.name,
        artist: item.artist || alt.artist,
        cover: item.cover || alt.cover || '',
        viaAlt: true,
      });
      if (current >= 0 && playlist[current] && trackKey(playlist[current]) === key) {
        playlist[current] = merged;
        renderPlaylist();
        syncNowPlaying();
      }
      audio.src = pr.url;
      try { await audio.play(); } catch (e) { /* ignore */ }
      // 标记：只有试听片段的曲目，播完/截断报错时别再说"换源失败"吓人
      if (pr.warn) {
        merged.previewClip = true;
        previewTracks.add(trackKey(merged));
        previewTracks.add(key);   // 原平台 key 也要记住（同一首可能被再次取链）
      }
      const extra = pr.warn ? ('　⚠ ' + pr.warn) : '';
      setStatus('已换源播放（' + sourceLabelOf(alt) + '）：' + (alt.name || '') + extra, pr.warn ? 9000 : 5000);
      return true;
    }
  }

  // ================= 播放模式 / 倍速 / 定时停止 =================
  const PLAY_MODES = [
    { key: 'order', icon: '➡', label: '顺序播放' },
    { key: 'list', icon: '🔁', label: '列表循环' },
    { key: 'single', icon: '🔂', label: '单曲循环' },
    { key: 'shuffle', icon: '🔀', label: '随机播放' },
  ];
  let playMode = 'order';
  const RATES = [1, 1.25, 1.5, 2, 0.75, 0.5];
  let rateIdx = 0;
  let sleepTimer = null;

  function applyPlayMode(key) {
    playMode = key;
    const m = PLAY_MODES.find((x) => x.key === key) || PLAY_MODES[0];
    const btn = $('btn-mode');
    if (btn) { btn.textContent = m.icon; btn.title = '播放模式：' + m.label + '（点击切换）'; }
  }
  function cyclePlayMode() {
    const i = PLAY_MODES.findIndex((x) => x.key === playMode);
    applyPlayMode(PLAY_MODES[(i + 1) % PLAY_MODES.length].key);
    saveState();
    setStatus('播放模式：' + (PLAY_MODES.find((x) => x.key === playMode) || {}).label, 2000);
  }
  function applyRate(r) {
    audio.playbackRate = r;
    try { audio.preservesPitch = true; } catch (e) { /* ignore */ }
    const btn = $('btn-rate');
    if (btn) btn.textContent = Number(r).toFixed(2).replace(/0$/, '') + 'x';
  }
  function cycleRate() {
    rateIdx = (rateIdx + 1) % RATES.length;
    applyRate(RATES[rateIdx]);
    saveState();
    setStatus('播放速度 ' + RATES[rateIdx] + 'x', 1800);
  }
  const SLEEP_STEPS = [0, 15, 30, 60, 90];
  let sleepStep = 0;
  function cycleSleep() {
    sleepStep = (sleepStep + 1) % SLEEP_STEPS.length;
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
    const min = SLEEP_STEPS[sleepStep];
    const btn = $('btn-sleep');
    if (!min) { if (btn) { btn.textContent = '⏱'; btn.classList.remove('active'); } setStatus('已取消定时停止', 2000); return; }
    if (btn) { btn.textContent = min + '′'; btn.classList.add('active'); }
    sleepTimer = setTimeout(() => {
      audio.pause();
      setStatus('定时停止：已暂停播放', 6000);
      sleepStep = 0;
      if (btn) { btn.textContent = '⏱'; btn.classList.remove('active'); }
    }, min * 60 * 1000);
    setStatus('将在 ' + min + ' 分钟后停止播放', 2500);
  }

  /** 播完一首后按播放模式决定下一首 */
  function advanceOnEnded() {
    if (!playlist.length) return;
    const finished = playlist[current];
    const wasPreview = !!(finished && (finished.previewClip || previewTracks.has(trackKey(finished))));
    if (finished) finished.previewClip = false;
    if (finished) previewTracks.delete(trackKey(finished));
    if (playMode === 'single') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    if (playMode === 'shuffle') {
      if (playlist.length === 1) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
      let n = current;
      while (n === current) n = Math.floor(Math.random() * playlist.length);
      current = n; renderPlaylist(); playCurrent(); return;
    }
    if (current < playlist.length - 1) { current++; renderPlaylist(); playCurrent(); return; }
    if (playMode === 'list') { current = 0; renderPlaylist(); playCurrent(); return; }
    setStatus(wasPreview ? '试听片段播放结束（该平台受版权/会员限制），列表已播完' : '播放列表已播完');
  }

  function saveProgress() {
    const it = current >= 0 ? playlist[current] : null;
    if (!it || !audio.currentTime || audio.currentTime < 3) return;
    progressMap[trackKey(it)] = Math.round(audio.currentTime);
    saveLibrary();
  }
  function renderPlaylist() {
    playlistEl.innerHTML = '';
    playlist.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'track' + (i === current ? ' active' : '');
      row.draggable = true;
      row.dataset.idx = String(i);
      row.innerHTML =
        '<span class="t-idx">' + (i + 1) + '</span>' +
        '<span class="t-name">' + esc(it.name || it.label) + '</span>' +
        '<span class="t-artist">' + esc(it.artist || '') + '</span>' +
        '<span class="t-src">' + esc(sourceLabelOf(it)) + '</span>' +
        (it.type === 'local' ? '' : '<button class="t-dl" title="下载">⤓</button>') +
        '<button class="t-remove" title="移出列表">✕</button>';
      // 拖拽排序
      row.addEventListener('dragstart', (e) => {
        try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) { /* ignore */ }
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        let from = i;
        try { from = Number(e.dataTransfer.getData('text/plain')); } catch (err) { /* ignore */ }
        if (!Number.isFinite(from) || from === i || from < 0 || from >= playlist.length) return;
        const playing = playlist[current];
        const [moved] = playlist.splice(from, 1);
        playlist.splice(i, 0, moved);
        current = playing ? playlist.indexOf(playing) : -1;
        renderPlaylist();
        setStatus('已调整播放顺序', 1500);
      });
      const dlBtn = row.querySelector('.t-dl');
      if (dlBtn) dlBtn.onclick = (e) => { e.stopPropagation(); downloadItem(it); };
      row.querySelector('.t-remove').onclick = (e) => {
        e.stopPropagation();
        playlist.splice(i, 1);
        if (current > i) current--;
        else if (current === i) { current = -1; audio.pause(); resetNowPlaying(); }
        renderPlaylist();
      };
      row.onclick = () => { current = i; renderPlaylist(); playCurrent(); };
      playlistEl.appendChild(row);
    });
    saveState();
  }
  function resetNowPlaying() {
    nowTitle.textContent = '未在播放';
    nowArtist.textContent = '—';
    coverEl.removeAttribute('src');
    $('time-cur').textContent = '0:00';
    $('time-total').textContent = '0:00';
    $('progress').value = 0;
    btnPlay.textContent = '▶';
  }

  // —— 歌词 ——
  const lyricEl = $('lyric');
  let lyricLines = [];
  let activeLyricIndex = -1;
  let lyricOffset = 0;     // 歌词偏移（秒），正值=歌词提前显示
  let pendingSeek = null;  // 元数据未就绪时的待跳转位置
  try {
    const savedOffset = Number(localStorage.getItem('songwave.lyricOffset'));
    if (Number.isFinite(savedOffset)) lyricOffset = savedOffset;
  } catch (e) { /* ignore */ }

  function setLyricOffset(v) {
    lyricOffset = Math.max(-30, Math.min(30, Math.round(v * 10) / 10));
    try { localStorage.setItem('songwave.lyricOffset', String(lyricOffset)); } catch (e) { /* ignore */ }
    updateLyricToolbar();
    activeLyricIndex = -1;
    updateLyricActive(audio.currentTime || 0);
    setStatus('歌词偏移：' + (lyricOffset > 0 ? '+' : '') + lyricOffset.toFixed(1) + 's', 2000);
  }

  function parseLrc(text) {
    const out = [];
    if (!text) return out;
    const re = /\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g;
    String(text).split('\n').forEach((line) => {
      let m;
      let last = 0;
      const times = [];
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        times.push(Number(m[1]) * 60 + Number(m[2]));
        last = re.lastIndex;
      }
      const content = line.slice(last).trim();
      if (!times.length || !content) return;
      times.forEach((t) => out.push({ t, text: content }));
    });
    return out.sort((a, b) => a.t - b.t);
  }
  function renderLyric(main, trans, roma) {
    lyricEl.innerHTML = '';
    lyricLines = parseLrc(main);
    activeLyricIndex = -1;
    lyricRaw = { main: main || '', trans: trans || '', roma: roma || '' };
    if (!lyricLines.length) {
      lyricEl.innerHTML = '<div class="lyric-empty">暂无歌词</div>';
      return;
    }
    const transByTime = new Map();
    parseLrc(trans).forEach((l) => { if (!transByTime.has(l.t)) transByTime.set(l.t, l.text); });
    transMap.clear();
    transByTime.forEach((v, k) => transMap.set(k, v));
    const romaByTime = new Map();
    parseLrc(roma).forEach((l) => { if (!romaByTime.has(l.t)) romaByTime.set(l.t, l.text); });
    romaMap.clear();
    romaByTime.forEach((v, k) => romaMap.set(k, v));
    if (isNowPlayingOpen()) renderOverlayLyric();
    lyricLines.forEach((line, i) => {
      const div = document.createElement('div');
      div.className = 'lyric-line';
      div.textContent = composeLyricLine(line, transByTime, romaByTime);
      // 翻译 / 罗马音 / 简繁 由 composeLyricLine 统一组合
      // 点击歌词跳转到对应时间（点击歌词跳转）
      div.dataset.t = String(line.t);
      div.title = '点击跳转到 ' + fmtTime(line.t);
      div.onclick = () => seekTo(line.t + lyricOffset);
      lyricEl.appendChild(div);
    });
    updateLyricToolbar();
  }
  /** 歌词选项变化时用缓存重绘（不重新请求） */
  function renderLyricFromCache() {
    if (!lyricRaw || !lyricRaw.main) return;
    renderLyric(lyricRaw.main, lyricRaw.trans, lyricRaw.roma);
  }

  function updateLyricToolbar() {
    const el = $('lyric-offset-val');
    if (el) el.textContent = (lyricOffset > 0 ? '+' : '') + lyricOffset.toFixed(1) + 's';
  }
  /** 跳转到指定秒数（音频元数据未就绪时先记住） */
  function seekTo(t) {
    const target = Math.max(0, Number(t) || 0);
    if (audio.duration && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(target, audio.duration);
      updateLyricActive(audio.currentTime);
    } else {
      pendingSeek = target;
    }
  }
  function updateLyricActive(t) {
    if (!lyricLines.length) return;
    const tt = t - lyricOffset;   // 歌词偏移：正值表示歌词提前
    let idx = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].t <= tt) idx = i;
      else break;
    }
    if (idx === activeLyricIndex) return;
    activeLyricIndex = idx;
    lyricEl.querySelectorAll('.lyric-line').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });
    if (idx >= 0) {
      const el = lyricEl.children[idx];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }
    if (npLyricEl) {
      const lines = npLyricEl.querySelectorAll('.np-line');
      if (lines && lines.forEach) lines.forEach((el, i) => el.classList.toggle('active', i === idx));
      const cur = lines && lines[idx];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  async function loadLyric(item) {
    try {
      const r = await window.songwave.getLyric({
        source: item.source,
        id: item.id,
        extKey: item.extKey,
      });
      if (!r.ok) { renderLyric('', ''); return; }
      renderLyric(r.data.lrc || '', r.data.tlyric || '', r.data.romalrc || '');
    } catch (e) {
      renderLyric('', '');
    }
  }

  // —— 播放 ——
  // 播放本身走普通 <audio> 输出（不受 CORS 限制）；
  // 可视化优先用“系统音频回环”抓取正在播放的声音（Song-Life 已验证的方案），
  // 回环不可用时退回 initFile（本地文件仍可正常可视化）。
  let vizWatchdog = null;
  let silentTicks = 0;
  // 回环“连上了但没声音”时（振幅恒 0 → 画面像死了一样）自动切到直连模式
  function startVizWatchdog() {
    if (vizWatchdog) return;
    vizWatchdog = setInterval(() => {
      const st = engine.getState ? engine.getState() : null;
      if (!st || !st.audioOn) return;
      const playing = !audio.paused && audio.currentTime > 0;
      if (playing && !(st.audioLevel > 0.005)) {
        silentTicks++;
        if (silentTicks >= 4) {
          clearInterval(vizWatchdog);
          vizWatchdog = null;
          if (typeof engine.initFile === 'function') {
            try { engine.initFile(audio); vizMode = 'direct'; setStatus('系统音频无信号，已切换直连可视化', 4000); } catch (e) { /* ignore */ }
          }
        }
      } else {
        silentTicks = 0;
      }
    }, 1000);
  }
  async function ensureEngine() {
    if (engineStarted) return;
    try {
      await engine.initSystemAudio();
      vizMode = 'system';
      setStatus('可视化已连接系统音频');
      if (!fx.enabled) startVizWatchdog();
    } catch (e) {
      if (typeof engine.initFile === 'function') engine.initFile(audio);
      vizMode = 'direct';
      setStatus('系统音频不可用，使用直连模式');
    }
    engineStarted = true;
    if (fx.enabled) applyEffects();
  }
  async function playCurrent() {
    if (current < 0 || current >= playlist.length) return;
    const item = playlist[current];
    nowTitle.textContent = item.name || item.label || '未知歌曲';
    nowArtist.textContent = [item.artist, item.album].filter(Boolean).join(' · ') || '—';
    setCover(item.cover);
    syncNowPlaying();
    if (item.type !== 'local' && window.songwave.getLyric) {
      loadLyric(item);
    } else {
      lyricLines = [];
      lyricEl.innerHTML = '<div class="lyric-empty">本地文件暂无歌词</div>';
    }
    setStatus('播放：' + (item.name || item.label), 2000);

    ensureEngine();
    let src;
    if (item.type === 'local') {
      src = toFileUrl(item.url);
    } else {
      const r = await window.songwave.getPlayUrl({
        source: item.source,
        id: item.id,
        extKey: item.extKey,
        songmid: item.songmid,
        hash: item.hash,
        copyrightId: item.copyrightId,
        name: item.name,
        artist: item.artist,
        album: item.album,
        durationMs: item.durationMs,
        quality: item.quality,
      });
      if (!r.ok) {
        const ok = await tryAutoSwitch(item);
        // 换源失败的原因已经在 tryAutoSwitch 里显示得更详细，这里不要覆盖它
        if (!ok && !autoSwitch) setStatus('获取播放地址失败：' + r.error, 6000);
        return;
      }
      src = r.url;
      // 例如「酷我仅提供试听片段（约 11 秒）」：如实告知，别让人以为播放器坏了
      if (r.warn) setStatus(r.warn, 9000);
    }
    audio.src = src;
    // 进度记忆：上次听到哪就从哪继续（开头/结尾附近不恢复）
    const saved = progressMap[trackKey(item)];
    if (saved && saved > 10) pendingSeek = saved;
    pushHistory(item);
    updateTrayTooltip();
    updateFavButton();
    try { audio.preservesPitch = true; } catch (e) { /* ignore */ }
    applyRate(RATES[rateIdx]);
    try { await audio.play(); } catch (err) {
      setStatus('播放失败：' + (err && err.message || err));
    }
  }
  function toFileUrl(p) {
    const parts = String(p).split(/[\\/]+/).map(encodeURIComponent);
    return 'file:///' + parts.join('/');
  }

  $('btn-play').onclick = () => {
    if (current < 0) return;
    if (audio.paused) { audio.play().catch(() => {}); } else { audio.pause(); }
  };
  $('btn-prev').onclick = () => { if (playlist.length && current > 0) { current--; renderPlaylist(); playCurrent(); } };
  $('btn-next').onclick = () => { if (playlist.length && current < playlist.length - 1) { current++; renderPlaylist(); playCurrent(); } };
  audio.addEventListener('play', () => {
    errorStreak = 0; btnPlay.textContent = '⏸';
    const np = $('np-play'); if (np) np.textContent = '⏸';
    if (npDiscEl) npDiscEl.classList.add('spin');
  });
  audio.addEventListener('pause', () => {
    btnPlay.textContent = '▶';
    const np = $('np-play'); if (np) np.textContent = '▶';
    if (npDiscEl) npDiscEl.classList.remove('spin');
  });
  audio.addEventListener('ended', () => { advanceOnEnded(); });
  // 在线直链对 VIP/版权受限歌曲会失败：自动跳到下一首（连续失败 3 次停止，防死循环）
  let errorStreak = 0;
  audio.addEventListener('error', () => {
    if (!audio.src) return;
    const cur = current >= 0 ? playlist[current] : null;
    // 试听片段本来就只有十几秒，播到截断处报错属正常：如实说明，不要报"换源失败"
    if (cur && (cur.previewClip || previewTracks.has(trackKey(cur)))) {
      cur.previewClip = false;
      previewTracks.delete(trackKey(cur));
      setStatus('试听片段播放结束（该平台受版权/会员限制）', 7000);
      if (current < playlist.length - 1) { current++; renderPlaylist(); playCurrent(); }
      return;
    }
    if (cur && !cur._altTried) {
      cur._altTried = true;   // 每首只自动换源一次，避免死循环
      setStatus('播放失败，尝试自动换源…', 0);
      tryAutoSwitch(cur).then((ok) => {
        if (ok) return;
        cur._altTried = true;
        errorStreak++;
        if (errorStreak > 3) { errorStreak = 0; setStatus('连续播放失败，已停止自动跳过'); return; }
        if (current < playlist.length - 1) { setStatus('播放失败（版权/VIP 限制），自动下一首'); current++; renderPlaylist(); playCurrent(); }
        else setStatus('播放失败，且已是最后一首');
      });
      return;
    }
    errorStreak++;
    if (errorStreak > 3) { errorStreak = 0; setStatus('连续播放失败，已停止自动跳过'); return; }
    if (current < playlist.length - 1) {
      setStatus('播放失败（版权/VIP 限制），自动下一首');
      current++; renderPlaylist(); playCurrent();
    } else {
      setStatus('播放失败，且已是最后一首');
    }
  });

  // 进度与音量
  let lastProgressSave = 0;
  let dlLastIdx = -99;
  audio.addEventListener('timeupdate', () => {
    $('time-cur').textContent = fmtTime(audio.currentTime);
    if (audio.duration && Number.isFinite(audio.duration)) {
      $('time-total').textContent = fmtTime(audio.duration);
      $('progress').value = Math.round((audio.currentTime / audio.duration) * 1000);
    }
    updateLyricActive(audio.currentTime);
    if (dlCfg.enabled && dlLastIdx !== activeLyricIndex) { dlLastIdx = activeLyricIndex; renderDesktopLyric(); pushWallpaperSync(); pushLyricWindowData(); }
    if (dlCfg.enabled && dlCfg.anim === 'karaoke') updateKaraoke();
    const npc = $('np-cur'); if (npc) npc.textContent = fmtTime(audio.currentTime);
    const npt = $('np-total'); if (npt && audio.duration && Number.isFinite(audio.duration)) npt.textContent = fmtTime(audio.duration);
    const npp = $('np-progress');
    if (npp && audio.duration && Number.isFinite(audio.duration)) npp.value = Math.round((audio.currentTime / audio.duration) * 1000);
    // 每 5 秒记一次播放进度
    const now = Date.now();
    if (now - lastProgressSave > 5000) { lastProgressSave = now; saveProgress(); }
  });
  audio.addEventListener('pause', () => { saveProgress(); });
  $('progress').addEventListener('input', (e) => {
    if (audio.duration && Number.isFinite(audio.duration)) {
      audio.currentTime = (Number(e.target.value) / 1000) * audio.duration;
    }
  });
  // 元数据就绪后应用「点击歌词时记下的待跳转位置」
  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeek == null) return;
    const t = pendingSeek;
    pendingSeek = null;
    if (audio.duration && Number.isFinite(audio.duration)) {
      // 别续播到"快到结尾"的位置：试听片段只有十几秒，续到 11s 会一开就结束（看着像坏了）
      if (audio.duration - t < 3) { updateLyricActive(0); return; }
      audio.currentTime = Math.min(t, audio.duration);
      updateLyricActive(audio.currentTime);
    }
  });
  // 歌词偏移按钮
  {
    const minus = $('lyr-minus'); const plus = $('lyr-plus'); const reset = $('lyr-reset');
    if (minus) minus.onclick = () => setLyricOffset(lyricOffset - 0.5);
    if (plus) plus.onclick = () => setLyricOffset(lyricOffset + 0.5);
    if (reset) reset.onclick = () => setLyricOffset(0);
    updateLyricToolbar();
  }
  $('volume').addEventListener('input', (e) => {
    audio.volume = Number(e.target.value) / 100;
  });

  // —— 键盘快捷键（输入框聚焦时不响应） ——
  function isTyping() {
    const t = document.activeElement && document.activeElement.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
  }
  function seekBy(delta) {
    if (!audio.duration || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + delta));
  }
  function changeVolume(delta) {
    const v = Math.min(100, Math.max(0, Math.round(Number($('volume').value)) + delta));
    $('volume').value = v;
    audio.volume = v / 100;
    setStatus('音量 ' + v + '%', 1200);
  }
  document.addEventListener('keydown', (e) => {
    if (isTyping()) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
    else if (k === 'ArrowRight') seekBy(5);
    else if (k === 'ArrowLeft') seekBy(-5);
    else if (k === 'ArrowUp') { e.preventDefault(); changeVolume(5); }
    else if (k === 'ArrowDown') { e.preventDefault(); changeVolume(-5); }
    else if (k === 'm' || k === 'M') { audio.muted = !audio.muted; setStatus(audio.muted ? '已静音（M 取消）' : '已恢复声音', 1200); }
    else if (k === 'n' || k === 'N') { if (playlist.length && current < playlist.length - 1) { current++; renderPlaylist(); playCurrent(); } }
    else if (k === 'p' || k === 'P') { if (playlist.length && current > 0) { current--; renderPlaylist(); playCurrent(); } }
    else if (k === 'Escape' && isNowPlayingOpen()) { e.preventDefault(); closeNowPlaying(); }
    else if ((k === 'Escape' || k === 'w' || k === 'W') && immersive) { e.preventDefault(); exitImmersive(); }
  });
  // 播放条上滚动滚轮调音量
  $('player').addEventListener('wheel', (e) => {
    e.preventDefault();
    changeVolume(e.deltaY < 0 ? 5 : -5);
  }, { passive: false });

  // —— 扩展音源状态提示 ——
  function updateLxStatus() {
    const el = $('ext-status');
    if (!el) return;
    if (!window.songwave.getExtStatus) return;
    window.songwave.getExtStatus().then((s) => {
      el.classList.remove('warn');
      if (s && s.loaded) {
        el.textContent = '音源：网易云 + ' + s.name + '（' + s.sourceKeys.join(', ') + '）';
      } else if (s && s.loading) {
        el.textContent = '音源：网易云 · 扩展音源加载中…';
      } else {
        el.textContent = '音源：网易云（扩展音源未加载' + (s && s.error ? '：' + s.error : '') + '）';
        el.classList.add('warn');
      }
    }).catch(() => {});
  }

  // —— 本地音乐 ——
  $('btn-local').onclick = async () => {
    const paths = await window.songwave.openLocalFiles();
    if (!paths || !paths.length) return;
    paths.forEach((p) => {
      const label = String(p).split(/[\\/]/).pop();
      playlist.push({ type: 'local', url: p, name: label.replace(/\.[^.]+$/, ''), artist: '本地文件', album: '' });
    });
    if (current < 0) { current = 0; playCurrent(); }
    renderPlaylist();
    setStatus('已加入 ' + paths.length + ' 首本地音乐');
  };
  $('btn-clear-list').onclick = () => {
    playlist = []; current = -1;
    audio.pause();
    audio.removeAttribute('src');
    resetNowPlaying();
    renderPlaylist();
  };

  // —— 导入外部歌单（粘贴链接/文本，或从文件） ——
  const plImportBox = $('pl-import');
  function togglePlImport(show) {
    if (!plImportBox) return;
    const willShow = show === undefined ? plImportBox.classList.contains('hidden') : !!show;
    plImportBox.classList.toggle('hidden', !willShow);
  }
  {
    const b = $('btn-pl-import'); if (b) b.onclick = () => togglePlImport();
    const c = $('pl-import-close'); if (c) c.onclick = () => togglePlImport(false);
  }
  function addImportedItems(items, label) {
    (items || []).forEach((it) => playlist.push(it));
    if (current < 0 && playlist.length) current = 0;
    renderPlaylist();
    switchTab('list');
    togglePlImport(false);
    setStatus(label, 6000);
  }
  {
    const btn = $('pl-import-btn');
    if (btn) {
      btn.onclick = async () => {
        if (!window.songwave.playlistImport) return;
        const t = $('pl-import-text');
        const text = t ? String(t.value || '') : '';
        if (!text.trim()) { setStatus('请粘贴歌单链接或歌名列表', 3000); return; }
        setStatus('正在导入歌单…', 0);
        const r = await window.songwave.playlistImport({ text });
        if (!r || !r.ok) { setStatus('歌单导入失败：' + ((r && r.error) || ''), 7000); return; }
        if (t) t.value = '';
        addImportedItems(r.items, '已导入歌单「' + (r.name || '') + '」共 ' + (r.count || 0) + ' 首');
      };
    }
    const fbtn = $('pl-import-file');
    if (fbtn) {
      fbtn.onclick = async () => {
        if (!window.songwave.playlistImportFile) return;
        const r = await window.songwave.playlistImportFile();
        if (!r || !r.ok) { if (r && r.error) setStatus('导入失败：' + r.error, 6000); return; }
        addImportedItems(r.items, '已从文件导入「' + (r.name || '') + '」共 ' + (r.count || 0) + ' 首');
      };
    }
  }

  // —— 下载 ——
  let saveDir = '';
  const dlState = { name: '' };
  function fmtBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  async function ensureSaveDir() {
    if (saveDir) return saveDir;
    try { saveDir = localStorage.getItem('songwave.saveDir') || ''; } catch (e) { saveDir = ''; }
    if (!saveDir && window.songwave.getDefaultSaveDir) {
      try { saveDir = await window.songwave.getDefaultSaveDir() || ''; } catch (e) { saveDir = ''; }
    }
    return saveDir;
  }
  if (window.songwave.onDownloadProgress) {
    window.songwave.onDownloadProgress((p) => {
      if (!p || p.name !== dlState.name) return;
      const pct = p.total > 0 ? p.percent + '%' : fmtBytes(p.loaded);
      setStatus('下载中 ' + p.name + ' ' + pct, 0);
    });
  }
  async function downloadItem(item) {
    if (!item || item.type === 'local' || !window.songwave.download) return;
    setStatus('正在获取下载地址…', 0);
    try {
      const r = await window.songwave.getPlayUrl({
        source: item.source, id: item.id, extKey: item.extKey, quality: item.quality,
      });
      if (!r.ok) { setStatus('下载失败：' + r.error, 5000); return; }
      const dir = await ensureSaveDir();
      dlState.name = (item.artist ? item.artist + ' - ' : '') + (item.name || 'song');
      const res = await window.songwave.download({
        url: r.url, filename: dlState.name + '.mp3', name: dlState.name, saveDir: dir,
      });
      if (res.ok) setStatus('已下载：' + res.filePath, 6000);
      else if (res.canceled) setStatus('下载已取消', 3000);
      else setStatus('下载失败：' + res.error, 6000);
    } catch (e) {
      setStatus('下载异常：' + (e && e.message || e), 6000);
    }
  }
  $('btn-save-dir').onclick = async () => {
    if (!window.songwave.chooseSaveDir) return;
    const r = await window.songwave.chooseSaveDir();
    if (r && r.ok) {
      saveDir = r.dir;
      try { localStorage.setItem('songwave.saveDir', saveDir); } catch (e) { /* ignore */ }
      setStatus('下载目录：' + saveDir, 4000);
    }
  };

  // —— 可视化：主题 / 参数（复用 Song-Life 引擎） ——
  const themesEl = $('themes');
  const pKeys = [
    ['p-height', 'height', 'v-height'], ['p-response', 'response', 'v-response'],
    ['p-flash', 'flash', 'v-flash'], ['p-bright', 'brightness', 'v-bright'],
    ['p-tilt', 'tilt', 'v-tilt'], ['p-hueshift', 'hueShift', 'v-hueshift'],
    ['p-mousewave', 'mouseWave', 'v-mousewave'], ['p-barstyle', 'barStyle', null],
    ['p-barblur', 'barBlur', 'v-barblur'], ['p-baralpha', 'barAlpha', 'v-baralpha'],
    ['p-barglow', 'barGlow', 'v-barglow'], ['p-barround', 'barRound', 'v-barround'],
    ['p-colormix', 'colorMix', 'v-colormix'], ['p-bottompad', 'bottomPad', 'v-bottompad'],
    ['p-flipy', 'flipY', 'v-flipy'],
  ];
  /** 地形朝向的标签要显示文字而不是数字（0/1） */
  function bindFlipYLabel() {
    const el = $('p-flipy'), label = $('v-flipy');
    if (!el || !label) return;
    const paint = () => { label.textContent = Number(el.value) >= 0.5 ? '正立' : '倒挂'; };
    el.addEventListener('input', paint);   // 在 pKeys 的监听之后注册，最终以文字覆盖
    paint();
  }
  function renderThemes() {
    themesEl.innerHTML = '';
    (engine.getThemes() || []).forEach((t) => {
      const b = document.createElement('button');
      b.className = 'theme';
      b.dataset.key = t.key;
      b.textContent = t.name;
      b.onclick = () => {
        themesEl.querySelectorAll('.theme').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        engine.setTheme(t.key);
        // 选内置主题时关闭混搭（混搭是独立的一档主题）
        engine.setParam('colorMix', 0);
        bgApplyMixControls();
        saveState();
      };
      themesEl.appendChild(b);
    });
    // 新增：把「色彩混搭」作为一档主题（与音柱材质互不影响）
    const mixBtn = document.createElement('button');
    mixBtn.className = 'theme theme-mix';
    mixBtn.dataset.key = '__mix';
    mixBtn.textContent = '混搭（自选两色）';
    mixBtn.onclick = () => {
      themesEl.querySelectorAll('.theme').forEach((x) => x.classList.remove('active'));
      mixBtn.classList.add('active');
      const strength = Number(($('p-colormix') || {}).value) || 0.75;
      if (!strength) engine.setParam('colorMix', 0.75);
      else engine.setParam('colorMix', strength);
      bgApplyMixControls();
      const mixEl = $('p-colormix');
      if (mixEl && !Number(mixEl.value)) { mixEl.value = '0.75'; }
      const mv = $('v-colormix'); if (mv) mv.textContent = Math.round((Number(($('p-colormix') || {}).value) || 0.75) * 100) + '%';
      saveState();
    };
    themesEl.appendChild(mixBtn);
  }
  /** 混搭控件与主题按钮的高亮同步（不影响音柱材质设置） */
  function bgApplyMixControls() {
    const on = Number(engine.getParam('colorMix')) > 0;
    const mixEl = $('p-colormix');
    if (mixEl) mixEl.value = String(on ? engine.getParam('colorMix') : 0);
    const mv = $('v-colormix');
    if (mv) mv.textContent = Math.round((on ? Number(engine.getParam('colorMix')) : 0) * 100) + '%';
    themesEl.querySelectorAll('.theme').forEach((x) => {
      if (x.dataset.key === '__mix') x.classList.toggle('active', on);
    });
  }
  function bindParams() {
    pKeys.forEach(([elId, key, valId]) => {
      const el = $(elId);
      if (!el) return;
      const update = () => {
        const v = el.type === 'checkbox' ? el.checked : (el.tagName === 'SELECT' ? el.value : Number(el.value));
        engine.setParam(key, v);
        const valSpan = valId && $(valId);
        if (valSpan) valSpan.textContent = v;
        saveState();
      };
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });
    const hintInput = $('hint-input');
    hintInput.addEventListener('input', () => {
      hintEl.textContent = hintInput.value || '点击画面有光环 · 左侧搜索歌曲';
      saveState();
    });
    // 色彩混搭：两个色板（自选颜色）
    [['p-colora', 'colorA'], ['p-colorb', 'colorB']].forEach(([id, key]) => {
      const el = $(id);
      if (!el) return;
      const upd = () => {
        engine.setParam(key, el.value);
        const vv = $(key === 'colorA' ? 'v-colora' : 'v-colorb');
        if (vv) vv.textContent = el.value;
        saveState();
      };
      el.addEventListener('input', upd);
      el.addEventListener('change', upd);
    });
    $('btn-panel').onclick = () => $('panel').classList.toggle('open');
    $('panel-close').onclick = () => $('panel').classList.remove('open');
  }
  function saveState() {
    try {
      localStorage.setItem('songwave.state', JSON.stringify({
        playlist: playlist.map((it) => ({ ...it, cover: it.cover || '' })),
        settings: {
          theme: engine.getParam('theme'),
          height: engine.getParam('height'), response: engine.getParam('response'),
          flash: engine.getParam('flash'), brightness: engine.getParam('brightness'),
          tilt: engine.getParam('tilt'), hueShift: engine.getParam('hueShift'),
          mouseWave: engine.getParam('mouseWave'), barStyle: engine.getParam('barStyle'),
          barBlur: engine.getParam('barBlur'), barAlpha: engine.getParam('barAlpha'),
          barGlow: engine.getParam('barGlow'), barRound: engine.getParam('barRound'),
          colorA: engine.getParam('colorA'), colorB: engine.getParam('colorB'), colorMix: engine.getParam('colorMix'),
          hint: $('hint-input').value, volume: $('volume').value,
          playMode: playMode, rate: RATES[rateIdx],
        },
      }));
    } catch (e) { /* ignore */ }
    // 同步给壁纸窗口
    if (!IS_WALLPAPER && wallpaperOn && window.songwave.pushWallpaperParams) {
      try { window.songwave.pushWallpaperParams(currentWallpaperParams()); } catch (e) { /* ignore */ }
    }
  }
  function loadState() {
    let s;
    try { s = JSON.parse(localStorage.getItem('songwave.state') || 'null'); } catch (e) { s = null; }
    if (!s) return;
    if (Array.isArray(s.playlist)) { playlist = s.playlist; }
    const st = s.settings || {};
    if (st.theme && engine.getThemes().some((t) => t.key === st.theme)) engine.setTheme(st.theme);
    pKeys.forEach(([elId, key]) => {
      const el = $(elId);
      if (!el || st[key] === undefined) return;
      el.value = st[key];
      engine.setParam(key, el.type === 'checkbox' ? !!st[key] : (el.tagName === 'SELECT' ? st[key] : Number(st[key])));
    });
    if (st.hint) { $('hint-input').value = st.hint; hintEl.textContent = st.hint; }
    if (st.volume !== undefined) { $('volume').value = st.volume; audio.volume = Number(st.volume) / 100; }
    if (st.playMode && PLAY_MODES.some((m) => m.key === st.playMode)) applyPlayMode(st.playMode);
    if (st.rate) {
      const idx = RATES.indexOf(Number(st.rate));
      if (idx >= 0) { rateIdx = idx; applyRate(RATES[rateIdx]); }
    }
    // 回填主题高亮
    themesEl.querySelectorAll('.theme').forEach((b) => b.classList.toggle('active', b.dataset.key === st.theme));
  }

  // —— Wallpaper Engine 背景（模仿 dsh-plugin-wallpaper-engine） ——
  const bgEl = $('we-bg');
  const bgVideo = $('we-video');
  const bgImg = $('we-img');
  const bgScrim = $('we-scrim');
  const weListEl = $('we-list');
  const bg = { mode: 'viz', id: '', settings: {} };
  let weItems = [];
  let weDefaults = null;
  let rotTimer = null;

  function loadBgState() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem('songwave.bg') || 'null'); } catch (e) { s = null; }
    if (s) {
      bg.mode = s.mode || 'viz';
      bg.id = s.id || '';
      bg.settings = s.settings || {};
    }
  }
  function saveBgState() {
    try { localStorage.setItem('songwave.bg', JSON.stringify({ mode: bg.mode, id: bg.id, settings: bg.settings })); } catch (e) { /* ignore */ }
  }
  function currentWeItem() {
    return weItems.find((i) => i.id === bg.id) || null;
  }
  function applyBgSettings() {
    const st = bg.settings || {};
    const hasBg = !!bg.id && bg.mode !== 'viz';
    if (bgEl) bgEl.classList.toggle('hidden', !hasBg);
    document.body.classList.toggle('bg-we', bg.mode === 'we' && !!bg.id);
    document.body.classList.toggle('bg-blend', bg.mode === 'blend' && !!bg.id);
    const filt = 'brightness(' + (st.brightness || 100) + '%) contrast(' + (st.contrast || 100) + '%) saturate(' +
      (st.saturate == null ? 100 : st.saturate) + '%)' + (st.blur > 0 ? ' blur(' + st.blur + 'px)' : '');
    [bgVideo, bgImg].forEach((el) => {
      if (!el) return;
      el.style.filter = filt;
      el.style.objectFit = st.objectFit || 'cover';
    });
    if (bgEl) bgEl.classList.toggle('flip', !!st.flip);
    if (bgScrim) bgScrim.style.opacity = String(st.scrim == null ? 0.1 : st.scrim);
    const vizOp = st.vizOpacity == null ? 0.85 : st.vizOpacity;
    if (document.documentElement && document.documentElement.style && document.documentElement.style.setProperty) {
      document.documentElement.style.setProperty('--viz-opacity', String(vizOp));
    }
    try { if (bgVideo) bgVideo.playbackRate = Number(st.playbackRate) || 1; } catch (e) { /* ignore */ }
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    const txt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('bg-scrim', st.scrim == null ? 0.1 : st.scrim); txt('v-scrim', Math.round((st.scrim == null ? 0.1 : st.scrim) * 100) + '%');
    set('bg-blur', st.blur || 0); txt('v-blur', (st.blur || 0) + 'px');
    set('bg-bright', st.brightness || 100); txt('v-bright2', (st.brightness || 100) + '%');
    set('bg-contrast', st.contrast || 100); txt('v-contrast', (st.contrast || 100) + '%');
    set('bg-saturate', st.saturate == null ? 100 : st.saturate); txt('v-saturate', (st.saturate == null ? 100 : st.saturate) + '%');
    set('bg-vizop', vizOp); txt('v-vizop', Math.round(vizOp * 100) + '%');
    set('bg-rate', st.playbackRate || 1); txt('v-rate', Number(st.playbackRate || 1).toFixed(2) + 'x');
    set('bg-rot', st.rotationInterval || 30); txt('v-rot', (st.rotationInterval || 30) + 's');
    const flipEl = $('bg-flip'); if (flipEl) flipEl.checked = !!st.flip;
    const rotEl = $('bg-rotate'); if (rotEl) rotEl.checked = !!st.rotationEnabled;
    document.querySelectorAll('#bg-modes .mode').forEach((b) => b.classList.toggle('active', b.dataset.bgmode === bg.mode));
  }
  function applyBackgroundSource() {
    if (!bgVideo || !bgImg) return;
    const it = currentWeItem();
    if (!it || bg.mode === 'viz') {
      try { bgVideo.pause(); } catch (e) { /* ignore */ }
      return;
    }
    if (it.renderable === 'video' && it.video) {
      bgVideo.src = toFileUrl(it.video);
      bgVideo.classList.remove('hidden');
      bgImg.classList.add('hidden');
      bgVideo.muted = true;
      if (typeof bgVideo.play === 'function') {
        try {
          const p = bgVideo.play();
          if (p && p.catch) p.catch(() => { /* 自动播放被拒：忽略 */ });
        } catch (e) { /* ignore */ }
      }
    } else if (it.preview) {
      bgImg.src = toFileUrl(it.preview);
      bgImg.classList.remove('hidden');
      bgVideo.classList.add('hidden');
      try { bgVideo.pause(); } catch (e) { /* ignore */ }
    }
  }
  function renderWeList() {
    if (!weListEl) return;
    weListEl.innerHTML = '';
    if (!weItems.length) {
      weListEl.innerHTML = '<div class="we-empty">未发现 Wallpaper Engine 壁纸（需安装 Steam 版 WE）</div>';
      return;
    }
    weItems.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'we-item' + (it.id === bg.id ? ' active' : '');
      row.innerHTML =
        '<img src="' + esc(it.preview ? toFileUrl(it.preview) : '') + '" alt="">' +
        '<div class="we-meta"><div class="we-title">' + esc(it.title) + '</div>' +
        '<div class="we-sub">' + esc(it.renderable === 'video' ? '视频' : '场景/图片') +
        (it.previewAnimated ? ' · 动图' : '') + '</div></div>';
      row.onclick = () => {
        bg.id = it.id;
        if (bg.mode === 'viz') bg.mode = 'blend';
        saveBgState();
        renderWeList();
        applyBackgroundSource();
        applyBgSettings();
        setStatus('背景已切换：' + it.title, 2500);
      };
      weListEl.appendChild(row);
    });
  }
  function restartRotation() {
    if (rotTimer) { clearInterval(rotTimer); rotTimer = null; }
    const st = bg.settings || {};
    if (!st.rotationEnabled || weItems.length < 2) return;
    const secs = Math.max(5, Number(st.rotationInterval) || 30);
    rotTimer = setInterval(() => {
      const idx = weItems.findIndex((i) => i.id === bg.id);
      const next = weItems[(idx + 1 + weItems.length) % weItems.length];
      if (next) {
        bg.id = next.id;
        saveBgState();
        renderWeList();
        applyBackgroundSource();
      }
    }, secs * 1000);
  }
  async function loadWeList(force) {
    if (!window.songwave.weList || !weListEl) return;
    let r = null;
    try { r = await window.songwave.weList(force); } catch (e) { r = null; }
    if (!r || !r.ok) {
      weListEl.innerHTML = '<div class="we-empty">壁纸库扫描失败' + (r && r.error ? '：' + esc(r.error) : '') + '</div>';
      return;
    }
    weDefaults = r.defaults || {};
    weItems = (r.items || []).filter((i) => i.renderable === 'video' || i.renderable === 'image');
    bg.settings = Object.assign({}, weDefaults, bg.settings || {});
    if (!bg.id && weItems.length) bg.id = (weItems.find((i) => i.renderable === 'video') || weItems[0]).id;
    renderWeList();
    applyBackgroundSource();
    applyBgSettings();
    restartRotation();
  }
  function bindBackgroundControls() {
    document.querySelectorAll('#bg-modes .mode').forEach((b) => {
      b.onclick = () => {
        bg.mode = b.dataset.bgmode;
        saveBgState();
        applyBackgroundSource();
        applyBgSettings();
        setStatus(bg.mode === 'viz' ? '背景：仅可视化' : (bg.mode === 'we' ? '背景：仅壁纸' : '背景：壁纸 + 可视化叠加'), 2500);
      };
    });
    const bind = (id, key, fmt) => {
      const el = $(id);
      if (!el) return;
      const upd = () => {
        const v = el.type === 'checkbox' ? el.checked : Number(el.value);
        bg.settings[key] = v;
        if (fmt) fmt(v);
        saveBgState();
        applyBgSettings();
        if (key === 'rotationEnabled' || key === 'rotationInterval') restartRotation();
        if (key === 'playbackRate' && bgVideo) { try { bgVideo.playbackRate = Number(v) || 1; } catch (e) { /* ignore */ } }
      };
      el.addEventListener('input', upd);
      el.addEventListener('change', upd);
    };
    bind('bg-scrim', 'scrim', (v) => { const e = $('v-scrim'); if (e) e.textContent = Math.round(v * 100) + '%'; });
    bind('bg-blur', 'blur', (v) => { const e = $('v-blur'); if (e) e.textContent = v + 'px'; });
    bind('bg-bright', 'brightness', (v) => { const e = $('v-bright2'); if (e) e.textContent = v + '%'; });
    bind('bg-contrast', 'contrast', (v) => { const e = $('v-contrast'); if (e) e.textContent = v + '%'; });
    bind('bg-saturate', 'saturate', (v) => { const e = $('v-saturate'); if (e) e.textContent = v + '%'; });
    bind('bg-vizop', 'vizOpacity', (v) => { const e = $('v-vizop'); if (e) e.textContent = Math.round(v * 100) + '%'; });
    bind('bg-rate', 'playbackRate', (v) => { const e = $('v-rate'); if (e) e.textContent = Number(v).toFixed(2) + 'x'; });
    bind('bg-rot', 'rotationInterval', (v) => { const e = $('v-rot'); if (e) e.textContent = v + 's'; });
    bind('bg-flip', 'flip');
    bind('bg-rotate', 'rotationEnabled');
    const refresh = $('we-refresh');
    if (refresh) refresh.onclick = () => loadWeList(true);
    const fit = $('bg-fit');
    if (fit) {
      fit.onchange = () => { bg.settings.objectFit = fit.value; saveBgState(); applyBgSettings(); };
    }
    if (bgVideo) bgVideo.addEventListener('click', () => {
      if (typeof bgVideo.play !== 'function') return;
      try { bgVideo.play(); } catch (e) { /* ignore */ }
    });
  }

  // —— 壁纸模式（模仿 Wallpaper Engine） ——
  let wallpaperOn = false;
  let engineReady = false;          // 引擎初始化完成后才能吃主题/参数
  let pendingWallpaperParams = null; // 初始化前的参数先缓存
  
  function applyWallpaperParams(p) {
    if (!p) return;
    if (p.desktopLyric) {
      Object.assign(dlCfg, p.desktopLyric.cfg || {});
      renderDesktopLyric(p.desktopLyric.text, p.desktopLyric.next);
      applyDlStyle();
    }
    if (!engineReady) { pendingWallpaperParams = p; return; }
    if (p.theme && engine.getThemes().some((t) => t.key === p.theme)) {
      engine.setTheme(p.theme);
      themesEl.querySelectorAll('.theme').forEach((b) => b.classList.toggle('active', b.dataset.key === p.theme));
    }
    if (p.params) {
      Object.keys(p.params).forEach((k) => {
        if (p.params[k] !== undefined && p.params[k] !== null) engine.setParam(k, p.params[k]);
      });
    }
    if (p.hint && hintEl) hintEl.textContent = p.hint;
  }
  function currentWallpaperParams() {
    const params = {};
    pKeys.forEach(([, key]) => { params[key] = engine.getParam(key); });
    return { theme: engine.getParam('theme'), params, hint: $('hint-input').value || '' };
  }
  async function enterWallpaperLocal() {
    // 壁纸窗口：只留可视化、铺满整屏。
    // 关键：engine.js 加载后自己就调了 init()，state.audioOn=false 时走 demoEnergy 演示动画，
    // 所以这里绝不能无条件 ensureEngine()/initFile(空 audio) —— 那会让振幅恒为 0、画面全黑。
    document.body.classList.add('wallpaper');
    if (window.songwave.onWallpaperParams) {
      window.songwave.onWallpaperParams((p) => applyWallpaperParams(p));
    }
    // 引擎在脚本加载时已就绪，参数可以立刻应用（不再等音频初始化）
    engineReady = true;
    if (pendingWallpaperParams) {
      applyWallpaperParams(pendingWallpaperParams);
      pendingWallpaperParams = null;
    }
    // 桌面层也显示同一张 WE 壁纸（与主窗口共享 localStorage）
    loadBgState();
    loadWeList();
    // 可选增强：壁纸层自己抢一次系统音频回环，拿到真实频谱；
    // 4 秒内没有电平就退回演示动画（避免“连上了但没声音”导致画面像死了）
    try {
      await engine.initSystemAudio();
      const st = engine.getState ? engine.getState() : null;
      if (st && st.audioOn) {
        let ticks = 0;
        const wd = setInterval(() => {
          const s = engine.getState ? engine.getState() : null;
          if (!s || !s.audioOn) { clearInterval(wd); return; }
          if (s.audioLevel > 0.005) { clearInterval(wd); return; }
          if (++ticks >= 4) {
            clearInterval(wd);
            s.audioOn = false; // 回环无信号 → 回演示动画，绝不黑屏
          }
        }, 1000);
      }
    } catch (e) { /* 回环不可用：保持演示动画 */ }
    // Esc 退出壁纸模式（窗口可聚焦时；另有 Ctrl+Alt+W 全局兜底）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && window.songwave.setWallpaper) window.songwave.setWallpaper(false);
    });
  }
  const wallpaperBtn = $('btn-wallpaper');
  let immersive = false;
  function enterImmersive(msg) {
    immersive = true;
    document.body.classList.add('wallpaper');
    if (window.winCtl && window.winCtl.setFullScreen) window.winCtl.setFullScreen(true);
    setStatus(msg || '沉浸模式已开启（Esc 或 W 退出）', 4500);
  }
  function exitImmersive() {
    immersive = false;
    document.body.classList.remove('wallpaper');
    if (window.winCtl && window.winCtl.setFullScreen) window.winCtl.setFullScreen(false);
    setStatus('已退出沉浸模式', 2500);
  }
  function setWallpaperButtonState(on) {
    wallpaperOn = !!on;
    if (wallpaperBtn) wallpaperBtn.classList.toggle('active', wallpaperOn);
  }
  if (window.songwave.onWallpaperState) {
    // 主进程侧状态变化（全局快捷键 Ctrl+Alt+W / 壁纸窗口关闭）时保持按钮同步
    window.songwave.onWallpaperState((on) => setWallpaperButtonState(on));
  }
  if (wallpaperBtn) {
    wallpaperBtn.onclick = async () => {
      if (!window.songwave.setWallpaper) return;
      if (immersive) { exitImmersive(); return; }
      const want = !wallpaperOn;
      const r = await window.songwave.setWallpaper(want);
      const actual = !!(r && r.on);
      setWallpaperButtonState(actual);
      if (actual) {
        if (window.songwave.pushWallpaperParams) window.songwave.pushWallpaperParams(currentWallpaperParams());
        if (r && r.alwaysOnBottom === false) {
          // 系统不支持置底：桌面层会挡住其它窗口，改用窗口内沉浸模式
          await window.songwave.setWallpaper(false);
          setWallpaperButtonState(false);
          enterImmersive('系统不支持桌面置底，已改用沉浸模式（Esc 或 W 退出）');
        } else {
          setStatus('壁纸模式已开启（桌面底层；Ctrl+Alt+W 或再点此按钮退出）', 5000);
        }
      } else if (want) {
        enterImmersive('壁纸层不可用，已改用沉浸模式（Esc 或 W 退出）');
      } else {
        setStatus('壁纸模式已关闭', 2500);
      }
    };
  }

  // —— 播放条新控件：播放模式 / 收藏 / 倍速 / 定时停止 ——
  {
    const mode = $('btn-mode'); if (mode) mode.onclick = cyclePlayMode;
    const fav = $('btn-fav'); if (fav) fav.onclick = () => {
      if (current < 0 || !playlist[current]) { setStatus('先播放一首再收藏', 2000); return; }
      toggleFavorite(playlist[current]);
    };
    const rate = $('btn-rate'); if (rate) rate.onclick = cycleRate;
    const sleep = $('btn-sleep'); if (sleep) sleep.onclick = cycleSleep;
    const fp = $('btn-fav-play');
    if (fp) fp.onclick = () => {
      if (!favorites.length) { setStatus('还没有收藏', 2000); return; }
      playlist = playlist.concat(favorites);
      current = playlist.length - favorites.length;
      renderPlaylist(); playCurrent(); switchTab('list');
    };
    const fc = $('btn-fav-clear');
    if (fc) fc.onclick = () => { favorites = []; saveLibrary(); renderFavorites(); updateFavButton(); setStatus('收藏已清空', 2000); };
    const hc = $('btn-hist-clear');
    if (hc) hc.onclick = () => { history = []; saveLibrary(); renderHistory(); setStatus('播放历史已清空', 2000); };
  }

  // —— 左侧功能栏（竖向导航） ——
  document.querySelectorAll('#rail .rail-btn').forEach((b) => {
    if (b.id === 'btn-wallpaper') return;   // 壁纸按钮有独立逻辑
    b.onclick = () => {
      const view = b.dataset.view;
      document.querySelectorAll('#rail .rail-btn').forEach((x) => x.classList.toggle('active', x === b));
      if (view === 'search' || view === 'list' || view === 'lyric' || view === 'favorites' || view === 'history' || view === 'discover' || view === 'playlists') {
        switchTab(view);
      } else if (view === 'panel') {
        const p = $('panel');
        if (p) p.classList.toggle('open');
        b.classList.toggle('active', !!(p && p.classList.contains('open')));
      }
    };
  });

  // —— 音源管理（自定义音源：粘贴链接导入） ——
  const srcListEl = $('src-list');
  const srcHintEl = $('src-hint');

  function renderSrcItems(items, state) {
    if (!srcListEl) return;
    srcListEl.innerHTML = '';
    if (!items || !items.length) {
      srcListEl.innerHTML = '<div class="we-empty">还没有音源脚本，把 扩展音源链接粘到上面点「导入」</div>';
      if (srcHintEl) srcHintEl.textContent = '未装入音源时，QQ/酷狗/酷我/咪咕 无法播放';
      return;
    }
    items.forEach((it) => {
      const st = ((state && state.items) || []).find((x) => x.id === it.id) || {};
      const row = document.createElement('div');
      row.className = 'src-item ' + (st.ok ? 'ok' : 'bad');
      const caps = st.sourceKeys || it.sourceKeys || [];
      row.innerHTML =
        '<input type="checkbox" class="src-toggle"' + (it.enabled ? ' checked' : '') + '>' +
        '<div class="src-meta"><div class="src-name">' + esc(it.name) +
        (it.version ? ' <span class="src-ver">v' + esc(it.version) + '</span>' : '') + '</div>' +
        '<div class="src-sub">' + esc(st.ok
          ? ('支持：' + (caps.join(', ') || '—') + (st.canSearch ? ' · 可搜索' : ' · 仅取链'))
          : ('⚠ ' + (st.error || it.error || '不可用'))) + '</div></div>' +
        (it.url ? '<button class="src-upd" title="重新下载更新">↻</button>' : '') +
        '<button class="src-del" title="删除">✕</button>';
      const cb = row.querySelector('.src-toggle');
      if (cb) cb.onchange = () => toggleSrc(it.id, cb.checked);
      const upd = row.querySelector('.src-upd');
      if (upd) upd.onclick = () => updateSrc(it.id);
      const del = row.querySelector('.src-del');
      if (del) del.onclick = () => removeSrc(it.id);
      srcListEl.appendChild(row);
    });
    if (srcHintEl && state && state.loading) {
      srcHintEl.textContent = '音源正在后台加载…（慢脚本不影响其它功能）';
    } else if (srcHintEl && state && state.loaded) {
      srcHintEl.textContent = '已就绪平台：' + (state.sourceKeys.join(', ') || '—');
    }
  }
  async function loadSrcList(force) {
    if (!window.songwave.srcList || !srcListEl) return;
    let r = null;
    try { r = await window.songwave.srcList(!!force); } catch (e) { r = null; }
    if (!r || !r.ok) {
      srcListEl.innerHTML = '<div class="we-empty">读取音源列表失败' + (r && r.error ? '：' + esc(r.error) : '') + '</div>';
      return;
    }
    renderSrcItems(r.items, r.state);
  }
  async function addSrc() {
    const input = $('src-url');
    const url = input ? String(input.value || '').trim() : '';
    if (!url) { setStatus('请先粘贴音源链接', 2500); return; }
    if (!window.songwave.srcAdd) return;
    setStatus('正在导入音源…', 0);
    const r = await window.songwave.srcAdd({ url });
    if (!r || !r.ok) { setStatus('导入失败：' + ((r && r.error) || '未知错误'), 7000); return; }
    if (input) input.value = '';
    setStatus('音源导入成功：' + r.entry.name + (r.entry.ok ? '' : '（探测失败：' + r.entry.error + '）'), 7000);
    await loadSrcList();
    updateLxStatus();
  }
  async function toggleSrc(id, enabled) {
    if (!window.songwave.srcToggle) return;
    const r = await window.songwave.srcToggle({ id, enabled });
    if (!r || !r.ok) { setStatus('切换失败：' + ((r && r.error) || ''), 5000); return; }
    renderSrcItems(r.items, r.state);
    setTimeout(loadSrcList, 1200);
    updateLxStatus();
    setStatus(enabled ? '音源已启用' : '音源已停用', 2000);
  }
  async function removeSrc(id) {
    if (!window.songwave.srcRemove) return;
    const r = await window.songwave.srcRemove(id);
    if (!r || !r.ok) { setStatus('删除失败：' + ((r && r.error) || ''), 5000); return; }
    renderSrcItems(r.items, r.state);
    updateLxStatus();
    setStatus('音源已删除', 2000);
  }
  async function updateSrc(id) {
    if (!window.songwave.srcUpdate) return;
    setStatus('正在更新音源…', 0);
    const r = await window.songwave.srcUpdate(id);
    if (!r || !r.ok) { setStatus('更新失败：' + ((r && r.error) || ''), 6000); return; }
    await loadSrcList();
    updateLxStatus();
    setStatus('音源已更新：' + r.entry.name, 4000);
  }
  async function importFromLx() {
    if (!window.songwave.srcImportExternal) return;
    setStatus('正在读取外部播放器音源…', 0);
    const r = await window.songwave.srcImportExternal();
    if (!r || !r.ok) { setStatus('外部导入失败：' + ((r && r.error) || ''), 8000); return; }
    renderSrcItems(r.items, r.state);
    updateLxStatus();
    setStatus('已从外部播放器导入 ' + r.imported.length + ' 个音源' +
      (r.skipped && r.skipped.length ? ('（' + r.skipped.length + ' 个未成功）') : ''), 8000);
  }
  async function importFromDir() {
    if (!window.songwave.srcImportDir) return;
    const r = await window.songwave.srcImportDir();
    if (!r || !r.ok) { if (r && r.error) setStatus('文件夹导入失败：' + r.error, 7000); return; }
    renderSrcItems(r.items, r.state);
    updateLxStatus();
    setStatus('扫描 ' + r.scanned + ' 个文件，导入 ' + r.imported.length + ' 个音源', 7000);
  }
  {
    const addBtn = $('src-add-btn');
    if (addBtn) addBtn.onclick = addSrc;
    const pickBtn = $('src-pick');
    if (pickBtn) {
      pickBtn.onclick = async () => {
        if (!window.songwave.srcPick) return;
        const r = await window.songwave.srcPick();
        if (!r || !r.ok) { if (r && r.error) setStatus('导入失败：' + r.error, 6000); return; }
        setStatus('已导入：' + r.entry.name, 5000);
        await loadSrcList();
        updateLxStatus();
      };
    }
    const refreshBtn = $('src-refresh');
    if (refreshBtn) refreshBtn.onclick = () => loadSrcList(true);   // ↻ 强制重试失败的音源
    const autoChk = $('chk-autoswitch');
    if (autoChk) {
      autoChk.checked = autoSwitch;
      autoChk.onchange = () => {
        autoSwitch = !!autoChk.checked;
        try { localStorage.setItem('songwave.autoswitch', autoSwitch ? '1' : '0'); } catch (e) { /* ignore */ }
        setStatus(autoSwitch ? '已开启播放失败自动换源' : '已关闭自动换源', 2500);
      };
    }
    const lxBtn = $('src-import-external');
    if (lxBtn) lxBtn.onclick = importFromLx;
    const dirBtn = $('src-import-dir');
    if (dirBtn) dirBtn.onclick = importFromDir;
    const probeBtn = $('src-probe');
    if (probeBtn) probeBtn.onclick = probeSources;
    const impBtn = $('cache-import');
    if (impBtn) impBtn.onclick = importUrlCache;
    const recBtn = $('src-recommend');
    if (recBtn) recBtn.onclick = importRecommendedSources;
  }

  /** 一键导入推荐音源（社区脚本；实测全豆要音源能取到完整版酷我/网易云地址） */
  async function importRecommendedSources() {
    if (!window.songwave.srcImportRecommended) return;
    const hint = $('src-probe-hint');
    if (hint) hint.textContent = '正在下载推荐音源（首次会稍慢）…';
    setStatus('正在导入推荐音源…', 5000);
    let r = null;
    try { r = await window.songwave.srcImportRecommended(); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (!r || !r.ok) { if (hint) hint.textContent = '导入失败：' + ((r && r.error) || '未知错误'); return; }
    const lines = (r.results || []).map((x) => (x.ok ? ('✅ ' + x.name + '（' + x.from + '，' + Math.round((x.bytes || 0) / 1024) + 'KB）') : ('❌ ' + x.name + '：' + (x.error || ''))));
    if (hint) hint.innerHTML = lines.map((s) => '<div>' + esc(s) + '</div>').join('');
    setStatus('推荐音源导入完成：' + r.imported + '/' + (r.results || []).length + ' 个成功，正在后台加载…', 8000);
    setTimeout(() => { if (typeof renderSources === 'function') { try { renderSources(); } catch (e) { /* ignore */ } } }, 2500);
  }

  /**
   * 导入其它播放器已解析好的播放地址缓存。
   * 音源脚本的后端会挂（实测 flower 后端 404），但**已经解析出来的 CDN 直链往往还能长期播放** ——
   * 其它播放器正是靠这张表在源失效后继续播；这里把它们读过来，这首歌立刻就能完整播放。
   */
  async function importUrlCache() {
    if (!window.songwave.cacheImportOthers) return;
    const hint = $('src-probe-hint');
    if (hint) hint.textContent = '正在读取其它播放器的已解析地址…';
    setStatus('正在导入已解析播放地址…', 4000);
    let r = null;
    try { r = await window.songwave.cacheImportOthers(); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (!r || !r.ok) { if (hint) hint.textContent = '导入失败：' + ((r && r.error) || '未知错误'); return; }
    const st = r.stats || {};
    const bySrc = st.bySource || {};
    const txt = '新增 ' + r.added + ' 条（解析到 ' + r.parsed + ' 条）' +
      '　缓存共 ' + (st.total || 0) + ' 条：' +
      Object.keys(bySrc).map((k) => (SOURCE_LABELS[k] || k) + ' ' + bySrc[k]).join('、') +
      (r.detail && r.detail.length ? ('　[' + r.detail.join('；') + ']') : '');
    if (hint) hint.textContent = txt;
    setStatus('已导入 ' + r.added + ' 条播放地址，再播放同一首歌即可命中缓存', 9000);
  }

  /**
   * 音源体检：逐个脚本真取一次酷我播放地址，直接看出哪个装好的音源真的能用。
   * （同一平台可能装了新旧多个脚本，坏的那个会拖累播放 —— 这个按钮就是用来分辨的）
   */
  async function probeSources() {
    if (!window.songwave.srcProbe) return;
    const hint = $('src-probe-hint');
    if (hint) hint.textContent = '体检中…（每个脚本都要真取一次链，约 10~30 秒）';
    setStatus('音源体检中…', 4000);
    let r = null;
    try { r = await window.songwave.srcProbe({ platform: 'kw', song: { songmid: '239211505', id: '239211505', name: '野火', artist: '戾格', interval: 232 } }); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (!r || !r.ok) { if (hint) hint.textContent = '体检失败：' + ((r && r.error) || '未知错误'); return; }
    const label = (x) => (x && typeof x === 'object') ? (x.name + (x.artist ? (' - ' + x.artist) : '')) : String(x);
    const lines = (r.results || []).map((x) => (x.ok ? '✅ ' : (x.skipped ? '➖ ' : '❌ ')) + x.name + '：' + (x.detail || '') + (x.ms ? ('（' + x.ms + 'ms）') : ''));
    if (hint) {
      hint.innerHTML = lines.length
        ? lines.map((s) => '<div>' + esc(s) + '</div>').join('')
        : '没有已启用的音源脚本';
    }
    const okCount = (r.results || []).filter((x) => x.ok).length;
    setStatus('音源体检完成：' + okCount + '/' + (r.results || []).length + ' 个可用（详见音源管理面板）', 8000);
    void label;
  }

  // ================= 音效（10 段 EQ + 混响） =================
  const EQ_FALLBACK_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const EQ_FALLBACK_PRESETS = [
    { key: 'off', name: '关闭（原声）', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { key: 'pop', name: '流行', gains: [-1, 0, 2, 3, 2, 0, -1, -1, 0, 1] },
    { key: 'rock', name: '摇滚', gains: [4, 3, 1, -1, -2, -1, 1, 3, 4, 4] },
    { key: 'classical', name: '古典', gains: [3, 2, 1, 0, -1, -1, 0, 1, 2, 3] },
    { key: 'vocal', name: '人声增强', gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
    { key: 'bass', name: '低音增强', gains: [7, 6, 4, 2, 0, -1, -2, -2, -1, 0] },
    { key: 'electronic', name: '电子', gains: [5, 4, 1, 0, -1, 0, 1, 2, 5, 6] },
  ];
  let fxFreqs = EQ_FALLBACK_FREQS.slice();
  let fxPresets = EQ_FALLBACK_PRESETS.slice();
  const fx = { enabled: false, preset: 'off', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], reverb: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem('songwave.effects') || 'null');
    if (saved) Object.assign(fx, saved);
    if (!Array.isArray(fx.gains) || fx.gains.length !== 10) fx.gains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  } catch (e) { /* ignore */ }
  function saveFx() {
    try { localStorage.setItem('songwave.effects', JSON.stringify(fx)); } catch (e) { /* ignore */ }
  }
  let fxNodes = null;
  async function loadFxPresets() {
    if (!window.songwave || !window.songwave.audioPresets) return;
    try {
      const r = await window.songwave.audioPresets();
      if (r && r.ok) {
        if (Array.isArray(r.freqs) && r.freqs.length === 10) fxFreqs = r.freqs;
        if (Array.isArray(r.presets) && r.presets.length) fxPresets = r.presets;
        renderFxControls();
      }
    } catch (e) { /* ignore */ }
  }
  function renderFxControls() {
    const sel = $('fx-preset');
    if (sel) {
      sel.innerHTML = '';
      fxPresets.forEach((p) => {
        const o = document.createElement('option');
        o.value = p.key;
        o.textContent = p.name;
        sel.appendChild(o);
      });
      sel.value = fx.preset;
      sel.onchange = () => {
        fx.preset = sel.value;
        const p = fxPresets.find((x) => x.key === fx.preset);
        if (p) fx.gains = p.gains.slice();
        saveFx(); renderEqBands(); applyEffects();
      };
    }
    renderEqBands();
    const rev = $('fx-reverb');
    if (rev) {
      rev.value = String(fx.reverb || 0);
      const rv = $('v-fxreverb'); if (rv) rv.textContent = Math.round((fx.reverb || 0) * 100) + '%';
      rev.oninput = () => {
        fx.reverb = Number(rev.value) || 0;
        if (rv) rv.textContent = Math.round(fx.reverb * 100) + '%';
        saveFx(); applyEffects();
      };
    }
    const en = $('fx-enable');
    if (en) {
      en.checked = !!fx.enabled;
      en.onchange = () => {
        fx.enabled = !!en.checked;
        saveFx();
        if (fx.enabled) ensureDirectMode();
        applyEffects();
        setStatus(fx.enabled ? '音效已开启（EQ/混响生效）' : '音效已关闭', 2500);
      };
    }
    const reset = $('fx-reset');
    if (reset) reset.onclick = () => {
      fx.preset = 'off';
      fx.gains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      fx.reverb = 0;
      saveFx(); renderFxControls(); applyEffects();
      setStatus('已重置为原声', 2000);
    };
  }
  function renderEqBands() {
    const box = $('eq-bands');
    if (!box) return;
    box.innerHTML = '';
    fxFreqs.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'eq-band';
      const label = document.createElement('label');
      label.textContent = f >= 1000 ? (f / 1000) + 'k' : f + 'Hz';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '-12'; input.max = '12'; input.step = '0.5';
      input.value = String(fx.gains[i] == null ? 0 : fx.gains[i]);
      const val = document.createElement('span');
      val.className = 'eq-val';
      val.textContent = (Number(input.value) > 0 ? '+' : '') + Number(input.value) + 'dB';
      input.addEventListener('input', () => {
        fx.gains[i] = Number(input.value);
        val.textContent = (fx.gains[i] > 0 ? '+' : '') + fx.gains[i] + 'dB';
        if (!fx.enabled) { fx.enabled = true; const en = $('fx-enable'); if (en) en.checked = true; ensureDirectMode(); }
        saveFx(); applyEffects();
      });
      row.appendChild(label); row.appendChild(input); row.appendChild(val);
      box.appendChild(row);
    });
  }
  /** 音效需要走 Web Audio 直连；系统回环模式下无法处理，所以自动切直连 */
  function ensureDirectMode() {
    if (vizMode === 'direct') return;
    try {
      if (typeof engine.initFile === 'function') engine.initFile(audio);
      vizMode = 'direct';
      const wd = null;
      setStatus('已切换到直连模式（音效生效）', 2500);
    } catch (e) { /* ignore */ }
  }
  function applyEffects() {
    if (!engine || typeof engine.setEffects !== 'function') return;
    if (!fx.enabled) { try { engine.setEffects([]); } catch (e) { /* ignore */ } return; }
    const ctx = engine.getAudioContext ? engine.getAudioContext() : null;
    if (!ctx || typeof ctx.createBiquadFilter !== 'function') {
      setStatus('音效不可用（音频上下文未就绪，先播放一次再开）', 4000);
      return;
    }
    try {
      const nodes = [];
      const preamp = ctx.createGain();
      preamp.gain.value = 1;
      nodes.push(preamp);
      fxFreqs.forEach((f, i) => {
        const bq = ctx.createBiquadFilter();
        bq.type = 'peaking';
        bq.frequency.value = f;
        bq.Q.value = 1;
        bq.gain.value = Number(fx.gains[i]) || 0;
        nodes.push(bq);
      });
      const out = ctx.createGain();
      out.gain.value = 1;
      nodes.push(out);
      if (fx.reverb > 0 && typeof ctx.createConvolver === 'function') {
        const conv = ctx.createConvolver();
        const len = Math.floor((ctx.sampleRate || 44100) * 2.4);
        const ir = ctx.createBuffer(2, len, ctx.sampleRate || 44100);
        for (let ch = 0; ch < 2; ch++) {
          const data = ir.getChannelData(ch);
          for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
        }
        conv.buffer = ir;
        const wet = ctx.createGain();
        wet.gain.value = Math.max(0, Math.min(1, fx.reverb)) * 0.6;
        const last = nodes[nodes.length - 2];   // 最后一个 EQ
        try { last.connect(conv); } catch (e) { /* ignore */ }
        try { conv.connect(wet); } catch (e) { /* ignore */ }
        try { wet.connect(out); } catch (e) { /* ignore */ }
      }
      engine.setEffects(nodes);
      fxNodes = nodes;
      setStatus('音效已应用（10 段 EQ' + (fx.reverb > 0 ? ' + 混响' : '') + '）', 2500);
    } catch (e) {
      setStatus('音效应用失败：' + (e && e.message || e), 4000);
    }
  }

  // ================= 桌面歌词（沉浸 / 壁纸模式） =================
  const dlEl = $('desktop-lyric');
  const dlCfg = {
    enabled: false, pos: 'bottom', align: 'center', lines: 1, size: 30,
    weight: 600, color: '#ffffff', font: 'system', shadow: true, anim: 'none',
  };
  try {
    const saved = JSON.parse(localStorage.getItem('songwave.desktoplyric') || 'null');
    if (saved) Object.assign(dlCfg, saved);
  } catch (e) { /* ignore */ }
  function saveDlCfg() {
    try { localStorage.setItem('songwave.desktoplyric', JSON.stringify(dlCfg)); } catch (e) { /* ignore */ }
  }
  function applyDlStyle() {
    if (!dlEl) return;
    // 用 classList 精确增删（不依赖 className 字符串，兼容性更好）
    ['bottom', 'top', 'left', 'right'].forEach((p) => dlEl.classList.remove('pos-' + p));
    ['left', 'center', 'right'].forEach((a) => dlEl.classList.remove('al-' + a));
    dlEl.classList.add('pos-' + dlCfg.pos);
    dlEl.classList.add('al-' + dlCfg.align);
    ['none', 'breath', 'karaoke', 'pulse', 'neon'].forEach((a) => dlEl.classList.remove('anim-' + a));
    dlEl.classList.add('anim-' + (dlCfg.anim || 'none'));
    dlEl.classList.toggle('dl-shadow', !!dlCfg.shadow);
    dlEl.classList.remove('hidden');
    dlEl.classList.toggle('on', !!dlCfg.enabled);
    // 控件回填
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    const chk = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    set('dl-pos', dlCfg.pos); set('dl-align', dlCfg.align); set('dl-lines', String(dlCfg.lines));
    set('dl-size', dlCfg.size); set('dl-weight', dlCfg.weight); set('dl-color', dlCfg.color); set('dl-font', dlCfg.font);
    set('dl-anim', dlCfg.anim || 'none');
    chk('dl-enable', dlCfg.enabled); chk('dl-shadow', dlCfg.shadow);
    const sv = $('v-dlsize'); if (sv) sv.textContent = dlCfg.size + 'px';
    const wv = $('v-dlweight'); if (wv) wv.textContent = String(dlCfg.weight);
  }
  function dlLineText(line, withTrans) {
    if (!line) return '';
    const tr = withTrans ? transMap.get(line.t) : '';
    return tr ? (line.text + String.fromCharCode(10) + tr) : line.text;
  }
  function currentLyricPair() {
    if (!lyricLines.length) return { cur: null, next: null, idx: -1 };
    const tt = (audio.currentTime || 0) - lyricOffset;
    let idx = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].t <= tt) idx = i;
      else break;
    }
    return { cur: lyricLines[idx] || lyricLines[0], next: lyricLines[idx + 1] || null, idx };
  }
  function renderDesktopLyric(overrideCur, overrideNext) {
    if (!dlEl) return;
    if (!dlCfg.enabled) { dlEl.innerHTML = ''; return; }
    let cur = null;
    let next = null;
    if (overrideCur != null || overrideNext != null) {
      cur = overrideCur ? { text: overrideCur } : null;
      next = overrideNext ? { text: overrideNext } : null;
    } else {
      const pair = currentLyricPair();
      cur = pair.cur; next = pair.next;
    }
    const parts = [];
    if (dlCfg.lines >= 2) {
      parts.push({ cls: 'dl-cur', text: cur ? cur.text : '' });
      parts.push({ cls: 'dl-next', text: next ? next.text : '' });
    } else {
      parts.push({ cls: 'dl-cur', text: cur ? cur.text : '' });
    }
    dlEl.innerHTML = '';
    parts.forEach((p) => {
      if (!p.text) return;
      const d = document.createElement('div');
      d.className = 'dl-line ' + p.cls;
      if (dlCfg.anim === 'karaoke' && p.cls === 'dl-cur') {
        // 逐字扫过：按字拆 span，随进度点亮
        dlChars = [];
        String(p.text).split('').forEach((ch) => {
          const sp = document.createElement('span');
          sp.className = 'dl-char';
          sp.textContent = ch;
          d.appendChild(sp);
          dlChars.push(sp);
        });
      } else {
        d.textContent = p.text;
      }
      d.style.fontSize = dlCfg.size + 'px';
      d.style.fontWeight = String(dlCfg.weight);
      d.style.color = dlCfg.color;
      d.style.fontFamily = dlCfg.font === 'system' ? '' : ('"' + dlCfg.font + '", sans-serif');
      dlEl.appendChild(d);
    });
  }
  let dlChars = [];
  /** 逐字扫过：按当前句进度点亮字符 */
  function updateKaraoke() {
    if (!dlCfg.enabled || dlCfg.anim !== 'karaoke' || !dlChars.length) return;
    const pair = currentLyricPair();
    const cur = pair.cur;
    if (!cur) return;
    const start = cur.t;
    const end = pair.next ? pair.next.t : (start + 4);
    const dur = Math.max(0.6, end - start);
    const prog = Math.max(0, Math.min(1, ((audio.currentTime || 0) - lyricOffset - start) / dur));
    const hit = Math.floor(prog * dlChars.length);
    for (let i = 0; i < dlChars.length; i++) dlChars[i].classList.toggle('hit', i < hit);
  }

  /** 面板分组折叠：每组可展开/收起，状态持久化 */
  function bindPanelCollapse() {
    let collapsed = [];
    try { collapsed = JSON.parse(localStorage.getItem('songwave.panelCollapsed') || '[]') || []; } catch (e) { collapsed = []; }
    const groups = document.querySelectorAll('#panel .panel-group');
    if (!groups || !groups.forEach) return;
    groups.forEach((g, i) => {
      const title = g.querySelector ? g.querySelector('.panel-title') : null;
      if (!title) return;
      const key = String((title.textContent || '').trim()).slice(0, 14) || ('g' + i);
      g.dataset.groupKey = key;
      if (collapsed.indexOf(key) >= 0) g.classList.add('collapsed');
      title.classList.add('collapsible');
      title.onclick = (ev) => {
        if (ev && ev.target && ev.target.tagName === 'BUTTON') return;  // 不吞掉刷新按钮
        g.classList.toggle('collapsed');
        const now = [];
        document.querySelectorAll('#panel .panel-group').forEach((x) => {
          if (x.classList.contains('collapsed')) now.push(x.dataset.groupKey);
        });
        try { localStorage.setItem('songwave.panelCollapsed', JSON.stringify(now)); } catch (e) { /* ignore */ }
      };
    });
  }

  /** 把当前参数 + 桌面歌词推给壁纸层窗口 */  function pushWallpaperSync() {
    if (IS_WALLPAPER || !window.songwave || !window.songwave.pushWallpaperParams) return;
    if (!wallpaperOn) return;
    const pair = currentLyricPair();
    try {
      window.songwave.pushWallpaperParams(Object.assign(currentWallpaperParams(), {
        desktopLyric: {
          cfg: Object.assign({}, dlCfg),
          text: dlLineText(pair.cur, false),
          next: dlLineText(pair.next, false),
        },
      }));
    } catch (e) { /* ignore */ }
  }
  function bindDesktopLyric() {
    const bindSel = (id, key) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => {
        dlCfg[key] = el.value;
        saveDlCfg(); applyDlStyle(); renderDesktopLyric(); pushWallpaperSync();
      });
    };
    const bindRange = (id, key, valId, fmt) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => {
        dlCfg[key] = Number(el.value);
        const v = valId && $(valId);
        if (v) v.textContent = fmt ? fmt(Number(el.value)) : el.value;
        saveDlCfg(); applyDlStyle(); renderDesktopLyric(); pushWallpaperSync();
      });
    };
    const bindChk = (id, key) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => {
        dlCfg[key] = !!el.checked;
        saveDlCfg(); applyDlStyle(); renderDesktopLyric(); pushWallpaperSync();
      });
    };
    bindChk('dl-enable', 'enabled');
    bindChk('dl-shadow', 'shadow');
    bindSel('dl-pos', 'pos'); bindSel('dl-align', 'align'); bindSel('dl-font', 'font');
    bindSel('dl-anim', 'anim');
    const linesEl = $('dl-lines');
    if (linesEl) linesEl.addEventListener('change', () => {
      dlCfg.lines = Number(linesEl.value) === 2 ? 2 : 1;
      saveDlCfg(); renderDesktopLyric(); pushWallpaperSync();
    });
    bindRange('dl-size', 'size', 'v-dlsize', (v) => v + 'px');
    bindRange('dl-weight', 'weight', 'v-dlweight', (v) => String(v));
    const colorEl = $('dl-color');
    if (colorEl) colorEl.addEventListener('input', () => {
      dlCfg.color = colorEl.value;
      saveDlCfg(); applyDlStyle(); renderDesktopLyric(); pushWallpaperSync();
    });
  }

  // ================= 封面 + 播放详情页（点封面进入，歌词居中） =================
  const npEl = $('now-playing');
  const npCoverEl = $('np-cover');
  const npDiscEl = $('np-disc');
  const npLyricEl = $('np-lyric');
  const transMap = new Map();
  const romaMap = new Map();
  let lyricRaw = { main: '', trans: '', roma: '' };
  // 无封面时的占位图（避免左下角一直是一块黑）
  const COVER_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#243354"/><stop offset="1" stop-color="#0b1020"/></linearGradient></defs>' +
    '<rect width="300" height="300" fill="url(#g)"/>' +
    '<text x="150" y="176" font-size="104" text-anchor="middle" fill="rgba(255,255,255,0.32)">♪</text></svg>'
  );
  function setCover(url) {
    const u = url || COVER_PLACEHOLDER;
    coverEl.src = u;
    if (npCoverEl) npCoverEl.src = u;
    const wrap = $('cover-wrap');
    if (wrap) wrap.classList.toggle('no-cover', !url);
  }
  function isNowPlayingOpen() { return !!(npEl && !npEl.classList.contains('hidden')); }
  function openNowPlaying() {
    if (!npEl) return;
    npEl.classList.remove('hidden');
    if (lyricLines.length) renderOverlayLyric();
    syncNowPlaying();
    const playBtn = $('np-play');
    if (playBtn) playBtn.textContent = audio.paused ? '▶' : '⏸';
  }
  function closeNowPlaying() { if (npEl) npEl.classList.add('hidden'); }
  function renderOverlayLyric() {
    if (!npLyricEl) return;
    npLyricEl.innerHTML = '';
    if (!lyricLines.length) {
      npLyricEl.innerHTML = '<div class="lyric-empty">暂无歌词</div>';
      return;
    }
    lyricLines.forEach((line) => {
      const div = document.createElement('div');
      div.className = 'np-line';
      div.dataset.t = String(line.t);
      const main = document.createElement('span');
      main.textContent = line.text;
      div.appendChild(main);
      const tr = transMap.get(line.t);
      if (tr) {
        const trEl = document.createElement('span');
        trEl.className = 'np-tr';
        trEl.textContent = tr;
        div.appendChild(trEl);
      }
      div.onclick = () => seekTo(line.t + lyricOffset);
      npLyricEl.appendChild(div);
    });
    activeLyricIndex = -1;
    updateLyricActive(audio.currentTime || 0);
  }
  function syncNowPlaying() {
    if (!npEl) return;
    const it = current >= 0 ? playlist[current] : null;
    const t = $('np-title'); const a = $('np-artist');
    if (t) t.textContent = it ? (it.name || it.label || '未知歌曲') : '未在播放';
    if (a) a.textContent = it ? ([it.artist, it.album].filter(Boolean).join(' · ') || '—') : '—';
    if (npCoverEl) npCoverEl.src = (it && it.cover) ? it.cover : COVER_PLACEHOLDER;
    if (npDiscEl) npDiscEl.classList.toggle('spin', !audio.paused);
    const fav = $('np-fav');
    if (fav) fav.textContent = (it && isFavorite(it)) ? '♥' : '♡';
    const mode = $('np-mode');
    if (mode) mode.textContent = (PLAY_MODES.find((m) => m.key === playMode) || PLAY_MODES[0]).icon;
  }
  {
    const wrap = $('cover-wrap');
    if (wrap) wrap.onclick = openNowPlaying;
    const disc = npDiscEl;
    if (disc) disc.onclick = () => closeNowPlaying();
    const closeBtn = $('np-close'); if (closeBtn) closeBtn.onclick = () => closeNowPlaying();
    const p = $('np-play');
    if (p) p.onclick = () => { if (current < 0) return; if (audio.paused) audio.play().catch(() => {}); else audio.pause(); };
    const pv = $('np-prev'); if (pv) pv.onclick = () => { if (playlist.length && current > 0) { current--; renderPlaylist(); playCurrent(); } };
    const nx = $('np-next'); if (nx) nx.onclick = () => { if (playlist.length && current < playlist.length - 1) { current++; renderPlaylist(); playCurrent(); } };
    const fv = $('np-fav');
    if (fv) fv.onclick = () => { if (current >= 0 && playlist[current]) toggleFavorite(playlist[current]); };
    const md = $('np-mode'); if (md) md.onclick = () => { cyclePlayMode(); syncNowPlaying(); };
    const pr = $('np-progress');
    if (pr) pr.addEventListener('input', (e) => {
      if (audio.duration && Number.isFinite(audio.duration)) {
        audio.currentTime = (Number(e.target.value) / 1000) * audio.duration;
      }
    });
  }

  // ================= v2.0.0：发现页（排行榜 / 推荐歌单） =================
  let curChartPlatform = 'netease';

  /** 播放量格式化：12345 → 1.2万 */
  function fmtCount(n) {
    const v = Number(n) || 0;
    if (v >= 100000000) return (v / 100000000).toFixed(1) + '亿';
    if (v >= 10000) return (v / 10000).toFixed(1) + '万';
    return String(v);
  }

  /** 渲染推荐歌单：封面网格卡片（对齐 LX 的展示方式） */
  function renderRecommendGrid(items) {
    const box = $('chart-list');
    if (!box) return;
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'sh-head';
    head.textContent = '推荐歌单 · ' + (items || []).length + ' 个';
    box.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'pl-grid';
    (items || []).forEach((p) => {
      const card = document.createElement('div');
      card.className = 'pl-card';
      card.title = p.name + (p.trackCount ? ('（' + p.trackCount + ' 首）') : '');
      const cover = document.createElement('div');
      cover.className = 'pl-cover';
      if (p.cover) {
        const img = document.createElement('img');
        img.src = p.cover;
        img.loading = 'lazy';
        img.alt = p.name;
        cover.appendChild(img);
      }
      if (p.playCount) {
        const c = document.createElement('span');
        c.className = 'pl-count';
        c.textContent = '▶ ' + fmtCount(p.playCount);
        cover.appendChild(c);
      }
      const play = document.createElement('div');
      play.className = 'pl-play';
      play.textContent = '▶';
      cover.appendChild(play);
      const name = document.createElement('div');
      name.className = 'pl-name';
      name.textContent = p.name;
      card.appendChild(cover);
      card.appendChild(name);
      card.onclick = () => loadChartSongs(p.platform || 'netease', p.id, p.name);
      grid.appendChild(card);
    });
    box.appendChild(grid);
  }

  function renderChartList(lists) {
    const box = $('chart-list');
    if (!box) return;
    box.innerHTML = '';
    const arr = (lists && lists[curChartPlatform]) || [];
    if (!arr.length) { box.innerHTML = '<div class="we-empty">暂无榜单</div>'; return; }
    const head = document.createElement('div');
    head.className = 'sh-head';
    head.textContent = '排行榜';
    box.appendChild(head);
    arr.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'track';
      row.innerHTML = '<span class="t-name">' + esc(c.name) + '</span><span class="t-src">' + esc(sourceLabelOf({ source: c.platform })) + '</span><button class="t-remove" title="载入榜单">＋</button>';
      row.onclick = () => loadChartSongs(c.platform, c.id, c.name);
      box.appendChild(row);
    });
  }

  /** 平台可用性提示：哪些平台有榜单、哪些没有（含原因，避免"为什么只有三个"的疑问） */
  function renderPlatformHint(unsupported) {
    const el = $('chart-plat-hint');
    if (!el) return;
    const list = unsupported || [];
    if (!list.length) { el.textContent = ''; return; }
    const have = Array.from(document.querySelectorAll('#chart-platforms .chip')).map((b) => b.textContent).join(' / ');
    el.textContent = '榜单接口可用：' + have + '；' + list.map((p) => p.label + '（' + p.reason + '）').join('、') + ' 暂不可用';
  }

  async function loadCharts() {
    if (!window.songwave.charts) return;
    const box = $('chart-list');
    if (box) box.innerHTML = '<div class="we-empty">正在获取榜单…</div>';
    const r = await window.songwave.charts({ action: 'list' });
    if (!r || !r.ok) { if (box) box.innerHTML = '<div class="we-empty">榜单获取失败：' + esc((r && r.error) || '') + '</div>'; return; }
    renderChartList(r.lists);
    renderPlatformHint(r.unsupported);
  }

  function renderSongRows(containerId, items, label) {
    const box = $(containerId);
    if (!box) return;
    box.innerHTML = '';
    if (!items || !items.length) { box.innerHTML = '<div class="we-empty">没有内容</div>'; return; }
    const head = document.createElement('div');
    head.className = 'pl-head';
    const coverUrl = (items[0] && items[0].cover) || '';
    if (coverUrl) {
      const img = document.createElement('img');
      img.src = coverUrl;
      img.alt = label || '';
      head.appendChild(img);
    }
    const meta = document.createElement('div');
    meta.className = 'ph-meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'ph-name';
    nameEl.textContent = label || '歌单';
    const subEl = document.createElement('div');
    subEl.className = 'ph-sub';
    subEl.textContent = items.length + ' 首' + (items[0] && items[0].artist ? (' · ' + items[0].artist) : '');
    meta.appendChild(nameEl);
    meta.appendChild(subEl);
    head.appendChild(meta);
    const title = document.createElement('button');
    title.className = 'btn btn-primary';
    title.textContent = '▶ 播放全部';
    title.onclick = () => {
      playlist = playlist.concat(items);
      current = playlist.length - items.length;
      renderPlaylist(); playCurrent(); switchTab('list');
      setStatus('已加入 ' + items.length + ' 首并开始播放', 3000);
    };
    head.appendChild(title);
    box.appendChild(head);
    items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'track';
      row.innerHTML =
        '<span class="t-idx">' + (i + 1) + '</span>' +
        '<span class="t-name">' + esc(it.name) + '</span>' +
        '<span class="t-artist">' + esc(it.artist || '') + '</span>' +
        '<button class="t-dl" title="加入播放列表">＋</button>';
      row.onclick = () => { playlist.push(it); renderPlaylist(); setStatus('已加入：' + it.name, 2000); };
      const add = row.querySelector('.t-dl');
      if (add) add.onclick = (e) => { e.stopPropagation(); playlist.push(it); renderPlaylist(); switchTab('list'); };
      box.appendChild(row);
    });
  }

  async function loadChartSongs(platform, id, name) {
    if (!window.songwave.charts) return;
    setStatus('正在载入：' + name, 0);
    const r = await window.songwave.charts({ action: 'chart', platform, id, limit: 50 });
    if (!r || !r.ok) { setStatus('载入失败：' + ((r && r.error) || ''), 5000); return; }
    renderSongRows('chart-songs', (r.data && r.data.items) || [], (r.data && r.data.name) || name);
    setStatus('已载入 ' + ((r.data && r.data.items.length) || 0) + ' 首', 2500);
  }

  async function loadRecommend() {
    if (!window.songwave.charts) return;
    const box = $('chart-list');
    if (box) box.innerHTML = '<div class="we-empty">正在获取推荐歌单…</div>';
    const r = await window.songwave.charts({ action: 'recommend', limit: 24 });
    if (!r || !r.ok) { if (box) box.innerHTML = '<div class="we-empty">推荐获取失败</div>'; return; }
    renderRecommendGrid(r.items || []);
    setStatus('推荐歌单已更新（' + (r.items || []).length + ' 个）', 2000);
    return;
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'sh-head';
    head.textContent = '推荐歌单（点击载入）';
    box.appendChild(head);
    (r.items || []).forEach((p) => {
      const row = document.createElement('div');
      row.className = 'track';
      row.innerHTML = (p.cover ? '<img class="chart-cover" src="' + esc(p.cover) + '" alt="">' : '') +
        '<span class="t-name">' + esc(p.name) + '</span>' +
        '<span class="t-artist">' + (p.trackCount ? p.trackCount + ' 首' : '') + '</span>';
      row.onclick = () => loadChartSongs('netease', p.id, p.name);
      box.appendChild(row);
    });
    setStatus('推荐歌单已更新', 2000);
  }

  // ================= v2.0.0：我的歌单（多歌单管理） =================
  let myPlaylists = [];
  let curMyPlaylistId = '';

  function loadMyPlaylists() {
    try {
      const a = JSON.parse(localStorage.getItem('songwave.playlists') || 'null');
      myPlaylists = Array.isArray(a) ? a : [];
    } catch (e) { myPlaylists = []; }
    if (!myPlaylists.length) {
      myPlaylists = [{ id: 'pl-' + Date.now(), name: '我的收藏夹', songs: [] }];
      saveMyPlaylists();
    }
  }
  function saveMyPlaylists() {
    try { localStorage.setItem('songwave.playlists', JSON.stringify(myPlaylists)); } catch (e) { /* ignore */ }
  }
  function renderMyPlaylists() {
    const box = $('playlists');
    if (!box) return;
    box.innerHTML = '';
    myPlaylists.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'track' + (p.id === curMyPlaylistId ? ' active' : '');
      row.innerHTML = '<span class="t-name">' + esc(p.name) + '</span>' +
        '<span class="t-artist">' + (p.songs || []).length + ' 首</span>' +
        '<span class="pl-actions"><button class="t-dl" title="播放">▶</button>' +
        '<button class="t-dl" title="重命名">✎</button>' +
        '<button class="t-remove" title="删除">✕</button></span>';
      row.onclick = () => { curMyPlaylistId = p.id; renderMyPlaylists(); renderMyPlaylistSongs(); };
      const [playBtn, renameBtn, delBtn] = Array.prototype.slice.call(row.querySelectorAll('.t-dl, .t-remove'));
      if (playBtn) playBtn.onclick = (e) => {
        e.stopPropagation();
        if (!p.songs || !p.songs.length) { setStatus('歌单是空的', 2000); return; }
        playlist = playlist.concat(p.songs);
        current = playlist.length - p.songs.length;
        renderPlaylist(); playCurrent(); switchTab('list');
      };
      if (renameBtn) renameBtn.onclick = (e) => {
        e.stopPropagation();
        const name = prompt('重命名歌单', p.name);
        if (name && name.trim()) { p.name = name.trim(); saveMyPlaylists(); renderMyPlaylists(); setStatus('已重命名', 1800); }
      };
      if (delBtn) delBtn.onclick = (e) => {
        e.stopPropagation();
        myPlaylists = myPlaylists.filter((x) => x.id !== p.id);
        if (curMyPlaylistId === p.id) curMyPlaylistId = '';
        saveMyPlaylists(); renderMyPlaylists(); renderMyPlaylistSongs();
        setStatus('歌单已删除', 1800);
      };
      box.appendChild(row);
    });
  }
  function renderMyPlaylistSongs() {
    const box = $('playlist-songs');
    if (!box) return;
    const p = myPlaylists.find((x) => x.id === curMyPlaylistId);
    if (!p) { box.innerHTML = '<div class="we-empty">选择或新建一个歌单</div>'; return; }
    renderSongRows('playlist-songs', p.songs || [], p.name);
  }
  /** 把当前播放的歌加进歌单 */
  function addCurrentToPlaylist(playlistId) {
    const it = current >= 0 ? playlist[current] : null;
    if (!it) { setStatus('先播放一首歌', 2000); return; }
    const p = myPlaylists.find((x) => x.id === playlistId);
    if (!p) return;
    p.songs = p.songs || [];
    if (p.songs.some((x) => trackKey(x) === trackKey(it))) { setStatus('已在歌单中', 1800); return; }
    p.songs.push(it);
    saveMyPlaylists(); renderMyPlaylists(); renderMyPlaylistSongs();
    setStatus('已加入歌单《' + p.name + '》', 2500);
  }

  // ================= v2.0.0：独立桌面歌词浮窗 =================
  let lyricWinOn = false;
  function dlStylePayload() {
    return { size: dlCfg.size, color: dlCfg.color, font: dlCfg.font, weight: dlCfg.weight, lines: dlCfg.lines, anim: dlCfg.anim, shadow: dlCfg.shadow };
  }
  async function toggleLyricWindow(on) {
    if (!window.songwave.lyricWindow) return;
    const r = await window.songwave.lyricWindow({ on: !!on, style: dlStylePayload(), locked: !!($('dl-winlock') || {}).checked });
    lyricWinOn = !!(r && r.on);
    const cb = $('dl-window'); if (cb) cb.checked = lyricWinOn;
    setStatus(lyricWinOn ? '桌面歌词浮窗已开启（可拖动）' : '桌面歌词浮窗已关闭', 3000);
    pushLyricWindowData();
  }
  function pushLyricWindowData() {
    if (!lyricWinOn || !window.songwave.lyricPush) return;
    const pair = currentLyricPair();
    try {
      window.songwave.lyricPush({
        text: dlLineText(pair.cur, false),
        next: dlCfg.lines >= 2 ? dlLineText(pair.next, false) : '',
        style: dlStylePayload(),
      });
    } catch (e) { /* ignore */ }
  }

  // ================= v2.0.0：歌词 翻译 / 罗马音 / 简繁 =================
  const lyrOpts = { trans: true, roma: false, zh: 'off' };
  let zhTables = null;
  try {
    const saved = JSON.parse(localStorage.getItem('songwave.lyropts') || 'null');
    if (saved) Object.assign(lyrOpts, saved);
  } catch (e) { /* ignore */ }
  function saveLyrOpts() {
    try { localStorage.setItem('songwave.lyropts', JSON.stringify(lyrOpts)); } catch (e) { /* ignore */ }
  }
  async function loadZhTables() {
    if (zhTables || !window.songwave || !window.songwave.zhTables) return;
    try {
      const r = await window.songwave.zhTables();
      if (r && r.ok) {
        const map = new Map();
        const a = Array.from(r.s || '');
        const b = Array.from(r.t || '');
        for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) map.set(a[i], b[i]);
        const rev = new Map();
        map.forEach((t, s) => { if (!rev.has(t)) rev.set(t, s); });
        zhTables = { map, rev, phrases: r.phrases || [] };
      }
    } catch (e) { /* ignore */ }
  }
  function convertZh(text) {
    if (lyrOpts.zh === 'off' || !text) return text;
    if (!zhTables) return text;
    let s = String(text);
    const dir = lyrOpts.zh;
    (zhTables.phrases || []).forEach((pair) => {
      const from = dir === 's2t' ? pair[0] : pair[1];
      const to = dir === 's2t' ? pair[1] : pair[0];
      s = s.split(from).join(to);
    });
    const m = dir === 's2t' ? zhTables.map : zhTables.rev;
    let out = '';
    for (const ch of s) out += (m.get(ch) || ch);
    return out;
  }
  /** 按选项组合一行的显示文本（原词 / 罗马音 / 翻译） */
  function composeLyricLine(line, transMapRef, romaMapRef) {
    if (!line) return '';
    let main = convertZh(line.text);
    const parts = [main];
    if (lyrOpts.roma && romaMapRef && romaMapRef.get(line.t)) parts.push(convertZh(romaMapRef.get(line.t)));
    if (lyrOpts.trans && transMapRef && transMapRef.get(line.t)) parts.push(convertZh(transMapRef.get(line.t)));
    return parts.join('\n');
  }

  // ================= v2.0.0：系统托盘 =================
  function bindTrayControls() {
    const en = $('tray-enable');
    const cl = $('tray-close');
    try {
      const s = JSON.parse(localStorage.getItem('songwave.tray') || 'null') || {};
      if (en && s.enabled === false) en.checked = false;
      if (cl) cl.checked = !!s.closeToTray;
    } catch (e) { /* ignore */ }
    function apply() {
      const enabled = !en || en.checked !== false;   // 控件缺失或未定义时按「启用」处理
      const closeToTray = !!(cl && cl.checked);
      try { localStorage.setItem('songwave.tray', JSON.stringify({ enabled, closeToTray })); } catch (e) { /* ignore */ }
      if (window.songwave.tray) {
        window.songwave.tray({ action: enabled ? 'on' : 'off', options: { closeToTray, minimizeToTray: closeToTray } });
      }
    }
    if (en) en.onchange = apply;
    if (cl) cl.onchange = apply;
    apply();
  }
  function updateTrayTooltip() {
    if (!window.songwave.tray) return;
    const it = current >= 0 ? playlist[current] : null;
    window.songwave.tray({ action: 'tooltip', text: it ? (it.name + ' - ' + (it.artist || '')) : '声浪 SongWave' });
  }

  // ================= v2.0.0：批量下载（模板 / 并发 / 分组 / 歌词 / 封面） =================
  let dlBatchRunning = false;
  function dlOptions() {
    return {
      template: ($('dl-template') || {}).value || '{artist} - {name}',
      concurrency: Number(($('dl-concurrency') || {}).value) || 3,
      groupByPlaylist: !!($('dl-group') || {}).checked,
      saveLyric: !!($('dl-lyric') || {}).checked,
      embedCover: !!($('dl-embed-cover') || {}).checked,
      embedLyric: !!($('dl-embed-lyric') || {}).checked,
    };
  }
  async function downloadAll() {
    if (!window.songwave.downloadBatch) return;
    if (dlBatchRunning) { setStatus('已有批量下载在进行', 2500); return; }
    const items = playlist.filter((x) => x.type !== 'local');
    if (!items.length) { setStatus('播放列表里没有可下载的在线歌曲', 2500); return; }
    const opts = dlOptions();
    const saveDir = await ensureSaveDir();
    const progEl = $('dl-progress');
    setStatus('正在解析下载地址（0/' + items.length + '）…', 0);
    const tasks = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        const pr = await window.songwave.getPlayUrl({ source: it.source, id: it.id, extKey: it.extKey, songmid: it.songmid, hash: it.hash, copyrightId: it.copyrightId, quality: it.quality });
        if (!pr || !pr.ok) continue;
        let lyrics = '';
        if (opts.saveLyric || opts.embedLyric) {
          try {
            const lr = await window.songwave.getLyric({ source: it.source, id: it.id, extKey: it.extKey });
            if (lr && lr.ok && lr.data) lyrics = lr.data.lrc || '';
          } catch (e) { /* ignore */ }
        }
        tasks.push({ url: pr.url, name: it.name, artist: it.artist, album: it.album, source: it.source, cover: it.cover, lyrics, index: i + 1 });
      } catch (e) { /* 跳过失败项 */ }
      if (progEl) progEl.textContent = '解析地址 ' + (i + 1) + '/' + items.length;
    }
    if (!tasks.length) { setStatus('没有可下载的歌曲（取链全部失败）', 5000); return; }
    dlBatchRunning = true;
    setStatus('开始下载 ' + tasks.length + ' 首…', 0);
    const r = await window.songwave.downloadBatch({
      items: tasks, saveDir, playlistName: '声浪下载', options: opts,
    });
    dlBatchRunning = false;
    if (!r || !r.ok) { setStatus('批量下载失败：' + ((r && r.error) || ''), 6000); return; }
    const s = r.summary || {};
    setStatus('批量下载完成：成功 ' + (s.ok || 0) + ' 首' + (s.failed ? '，失败 ' + s.failed + ' 首' : ''), 8000);
    if (progEl) progEl.textContent = '完成：成功 ' + (s.ok || 0) + ' / 失败 ' + (s.failed || 0);
  }

  function bindV2Controls() {
    // 发现页
    document.querySelectorAll('#chart-platforms .chip').forEach((b) => {
      b.onclick = () => {
        curChartPlatform = b.dataset.plat || 'netease';
        document.querySelectorAll('#chart-platforms .chip').forEach((x) => x.classList.toggle('active', x === b));
        loadCharts();
      };
    });
    const rec = $('btn-recommend'); if (rec) rec.onclick = loadRecommend;
    const cr = $('btn-charts-refresh'); if (cr) cr.onclick = loadCharts;
    // 我的歌单
    const create = $('btn-create-playlist');
    if (create) create.onclick = () => {
      const input = $('new-playlist-name');
      const name = input ? String(input.value || '').trim() : '';
      if (!name) { setStatus('请输入歌单名称', 2000); return; }
      myPlaylists.push({ id: 'pl-' + Date.now(), name, songs: [] });
      if (input) input.value = '';
      saveMyPlaylists(); renderMyPlaylists();
      setStatus('已新建歌单《' + name + '》', 2500);
    };
    // 桌面歌词浮窗
    const dw = $('dl-window');
    if (dw) dw.onchange = () => toggleLyricWindow(dw.checked);
    const dwl = $('dl-winlock');
    if (dwl) dwl.onchange = () => {
      if (window.songwave.lyricWindow) window.songwave.lyricWindow({ locked: dwl.checked, style: dlStylePayload() });
      setStatus(dwl.checked ? '浮窗已锁定（鼠标穿透）' : '浮窗已解锁', 2200);
    };
    // 歌词选项
    const lt = $('lyr-trans'); const lr2 = $('lyr-roma'); const lz = $('lyr-zh');
    if (lt) { lt.checked = !!lyrOpts.trans; lt.onchange = () => { lyrOpts.trans = lt.checked; saveLyrOpts(); rerenderLyrics(); }; }
    if (lr2) { lr2.checked = !!lyrOpts.roma; lr2.onchange = () => { lyrOpts.roma = lr2.checked; saveLyrOpts(); rerenderLyrics(); }; }
    if (lz) { lz.value = lyrOpts.zh; lz.onchange = async () => { lyrOpts.zh = lz.value; saveLyrOpts(); await loadZhTables(); rerenderLyrics(); }; }
    // 托盘
    bindTrayControls();
    // 批量下载
    const da = $('btn-dl-all'); if (da) da.onclick = downloadAll;
    const dc = $('btn-dl-cancel');
    if (dc) dc.onclick = async () => {
      if (!window.songwave.cancelDownloadBatch) return;
      const r = await window.songwave.cancelDownloadBatch();
      setStatus(r && r.ok ? '已请求取消批量下载' : '没有进行中的批量下载', 2500);
    };
  }
  /** 歌词选项变化后重绘 */
  function rerenderLyrics() {
    if (!lyricLines.length) return;
    renderLyricFromCache();
    if (isNowPlayingOpen()) renderOverlayLyric();
    renderDesktopLyric();
    pushLyricWindowData();
  }

  // —— 引导逻辑 ——

  /** 按播放条实际高度设置底部留白，避免律动贴到屏幕最底/被播放条压住 */
  let bottomPadManual = false;
  try { bottomPadManual = localStorage.getItem('songwave.bottomPadManual') === '1'; } catch (e) { /* ignore */ }
  (function bindBottomPadManual() {
    const el = document.getElementById('p-bottompad');
    if (el) {
      el.addEventListener('input', () => {
        bottomPadManual = true;
        try { localStorage.setItem('songwave.bottomPadManual', '1'); } catch (e) { /* ignore */ }
      }, { passive: true });
      // 双击恢复「自动跟随播放条」
      el.addEventListener('dblclick', () => {
        bottomPadManual = false;
        try { localStorage.removeItem('songwave.bottomPadManual'); } catch (e) { /* ignore */ }
        applyBottomPad();
      });
    }
  })();

  function applyBottomPad() {
    const bar = $('player');
    const h = bar && bar.getBoundingClientRect ? Math.round(bar.getBoundingClientRect().height) : 76;
    const label = $('v-bottompad');
    if (bottomPadManual) { if (label) label.textContent = (engine.getParam('bottomPad') || 0) + 'px（手动）'; return; }
    const pad = Math.max(48, (h || 76) + 24);
    engine.setParam('bottomPad', pad);
    if (label) label.textContent = pad + 'px 自动';
  }

  function boot() {
    if (IS_WALLPAPER) { enterWallpaperLocal(); return; }
    // 给 Song-Life 的粒子层打标记，便于背景模式下整体淡出（不改引擎源码）
    try {
      const canvases = document.querySelectorAll('canvas');
      if (canvases && canvases[1] && canvases[1].classList) canvases[1].classList.add('songwave-rings');
    } catch (e) { /* ignore */ }
    renderThemes();
    bindParams();
    bindFlipYLabel();
    // 恢复上次选择的音源
    try {
      const s = localStorage.getItem('songwave.source');
      if (s && SOURCE_LABELS[s]) {
        curSource = s;
        document.querySelectorAll('#src-chips .chip').forEach((x) => x.classList.toggle('active', x.dataset.src === curSource));
      }
    } catch (e) { /* ignore */ }
    applyBottomPad();
    window.addEventListener('resize', applyBottomPad);
    bindPanelCollapse();
    renderFxControls();
    loadFxPresets();
    applyDlStyle();
    bindDesktopLyric();
    renderDesktopLyric();
    loadMyPlaylists();
    renderMyPlaylists();
    renderMyPlaylistSongs();
    loadZhTables();
    bindV2Controls();
    // 托盘命令（播放/暂停、上下一首）
    if (window.songwave.onTrayCommand) {
      window.songwave.onTrayCommand((cmd) => {
        if (cmd === 'toggle') { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
        else if (cmd === 'next' && playlist.length && current < playlist.length - 1) { current++; renderPlaylist(); playCurrent(); }
        else if (cmd === 'prev' && playlist.length && current > 0) { current--; renderPlaylist(); playCurrent(); }
      });
    }
    // 浮窗开关状态同步
    if (window.songwave.onLyricWindowState) {
      window.songwave.onLyricWindowState((on) => {
        lyricWinOn = !!on;
        const cb = $('dl-window'); if (cb) cb.checked = !!on;
      });
    }
    loadBgState();
    bindBackgroundControls();
    loadWeList();
    loadSrcList();
    loadLibrary();
    applyPlayMode(playMode);
    applyRate(RATES[rateIdx]);
    renderSearchHistory();
    loadState();
    renderPlaylist();
    renderFavorites();
    renderHistory();
    updateFavButton();
    updateLxStatus();
    if (current >= 0 && playlist[current]) {
      // 恢复上次会话的播放列表（不自动播放，等用户点播放）
      nowTitle.textContent = playlist[current].name || playlist[current].label;
      nowArtist.textContent = [playlist[current].artist, playlist[current].album].filter(Boolean).join(' · ') || '—';
      if (playlist[current].cover) coverEl.src = playlist[current].cover;
    }
    setStatus('欢迎使用声浪 · 输入关键词搜索，或导入本地音乐', 3600);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();