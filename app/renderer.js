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
    if (!r.ok) { setStatus('搜索失败：' + r.error); return; }
    pushSearchHistory(kw);
    renderResults(r.data || []);
    setStatus(r.data && r.data.length ? `找到 ${r.data.length} 首` : '没有结果');
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
      const badge = item.source === 'lx'
        ? '<span class="t-src">' + esc(item.lxSource || 'lx') + '</span>'
        : '<span class="t-src">网易</span>';
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
    const his = $('side-history'); if (his) his.classList.toggle('hidden', key !== 'history');
    if (key === 'favorites') renderFavorites();
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
    if (it.source === 'lx') return it.lxSource || 'lx';
    const map = { netease: '网易', qq: 'QQ', kugou: '酷狗', kuwo: '酷我', migu: '咪咕', search: '搜索' };
    return map[it.source] || it.source || '';
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
    if (playMode === 'single') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    if (playMode === 'shuffle') {
      if (playlist.length === 1) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
      let n = current;
      while (n === current) n = Math.floor(Math.random() * playlist.length);
      current = n; renderPlaylist(); playCurrent(); return;
    }
    if (current < playlist.length - 1) { current++; renderPlaylist(); playCurrent(); return; }
    if (playMode === 'list') { current = 0; renderPlaylist(); playCurrent(); return; }
    setStatus('播放列表已播完');
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
  function renderLyric(main, trans) {
    lyricEl.innerHTML = '';
    lyricLines = parseLrc(main);
    activeLyricIndex = -1;
    if (!lyricLines.length) {
      lyricEl.innerHTML = '<div class="lyric-empty">暂无歌词</div>';
      return;
    }
    const transByTime = new Map();
    parseLrc(trans).forEach((l) => { if (!transByTime.has(l.t)) transByTime.set(l.t, l.text); });
    lyricLines.forEach((line, i) => {
      const div = document.createElement('div');
      div.className = 'lyric-line';
      div.textContent = line.text;
      const tr = transByTime.get(line.t);
      if (tr) div.textContent += '\n' + tr;
      // 点击歌词跳转到对应时间（对齐 LX 的歌词跳转）
      div.dataset.t = String(line.t);
      div.title = '点击跳转到 ' + fmtTime(line.t);
      div.onclick = () => seekTo(line.t + lyricOffset);
      lyricEl.appendChild(div);
    });
    updateLyricToolbar();
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
  }
  async function loadLyric(item) {
    try {
      const r = await window.songwave.getLyric({
        source: item.source,
        id: item.id,
        lxSource: item.lxSource,
      });
      if (!r.ok) { renderLyric('', ''); return; }
      renderLyric(r.data.lrc || '', r.data.tlyric || '');
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
            try { engine.initFile(audio); setStatus('系统音频无信号，已切换直连可视化', 4000); } catch (e) { /* ignore */ }
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
      setStatus('可视化已连接系统音频');
      startVizWatchdog();
    } catch (e) {
      if (typeof engine.initFile === 'function') engine.initFile(audio);
      setStatus('系统音频不可用，使用直连模式');
    }
    engineStarted = true;
  }
  async function playCurrent() {
    if (current < 0 || current >= playlist.length) return;
    const item = playlist[current];
    nowTitle.textContent = item.name || item.label || '未知歌曲';
    nowArtist.textContent = [item.artist, item.album].filter(Boolean).join(' · ') || '—';
    if (item.cover) coverEl.src = item.cover;
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
        lxSource: item.lxSource,
        quality: item.quality,
      });
      if (!r.ok) { setStatus('获取播放地址失败：' + r.error); return; }
      src = r.url;
    }
    audio.src = src;
    // 进度记忆：上次听到哪就从哪继续（开头/结尾附近不恢复）
    const saved = progressMap[trackKey(item)];
    if (saved && saved > 10) pendingSeek = saved;
    pushHistory(item);
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
  audio.addEventListener('play', () => { errorStreak = 0; btnPlay.textContent = '⏸'; });
  audio.addEventListener('pause', () => { btnPlay.textContent = '▶'; });
  audio.addEventListener('ended', () => { advanceOnEnded(); });
  // 在线直链对 VIP/版权受限歌曲会失败：自动跳到下一首（连续失败 3 次停止，防死循环）
  let errorStreak = 0;
  audio.addEventListener('error', () => {
    if (!audio.src) return;
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
  audio.addEventListener('timeupdate', () => {
    $('time-cur').textContent = fmtTime(audio.currentTime);
    if (audio.duration && Number.isFinite(audio.duration)) {
      $('time-total').textContent = fmtTime(audio.duration);
      $('progress').value = Math.round((audio.currentTime / audio.duration) * 1000);
    }
    updateLyricActive(audio.currentTime);
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
    else if ((k === 'Escape' || k === 'w' || k === 'W') && immersive) { e.preventDefault(); exitImmersive(); }
  });
  // 播放条上滚动滚轮调音量
  $('player').addEventListener('wheel', (e) => {
    e.preventDefault();
    changeVolume(e.deltaY < 0 ? 5 : -5);
  }, { passive: false });

  // —— lx 音源状态提示 ——
  function updateLxStatus() {
    const el = $('lx-status');
    if (!el) return;
    if (!window.songwave.getLxStatus) return;
    window.songwave.getLxStatus().then((s) => {
      el.classList.remove('warn');
      if (s && s.loaded) {
        el.textContent = '音源：网易云 + ' + s.name + '（' + s.sourceKeys.join(', ') + '）';
      } else if (s && s.loading) {
        el.textContent = '音源：网易云 · lx 加载中…';
      } else {
        el.textContent = '音源：网易云（lx 未加载' + (s && s.error ? '：' + s.error : '') + '）';
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

  // —— 导入外部歌单（对齐 LX：粘贴链接/文本，或从文件） ——
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
        source: item.source, id: item.id, lxSource: item.lxSource, quality: item.quality,
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
  ];
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
        saveState();
      };
      themesEl.appendChild(b);
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

  // —— 左侧功能栏（LX 风格竖向导航） ——
  document.querySelectorAll('#rail .rail-btn').forEach((b) => {
    if (b.id === 'btn-wallpaper') return;   // 壁纸按钮有独立逻辑
    b.onclick = () => {
      const view = b.dataset.view;
      document.querySelectorAll('#rail .rail-btn').forEach((x) => x.classList.toggle('active', x === b));
      if (view === 'search' || view === 'list' || view === 'lyric' || view === 'favorites' || view === 'history') {
        switchTab(view);
      } else if (view === 'panel') {
        const p = $('panel');
        if (p) p.classList.toggle('open');
        b.classList.toggle('active', !!(p && p.classList.contains('open')));
      }
    };
  });

  // —— 音源管理（lx 自定义源：粘贴链接导入） ——
  const srcListEl = $('src-list');
  const srcHintEl = $('src-hint');

  function renderSrcItems(items, state) {
    if (!srcListEl) return;
    srcListEl.innerHTML = '';
    if (!items || !items.length) {
      srcListEl.innerHTML = '<div class="we-empty">还没有音源脚本，把 lx 音源链接粘到上面点「导入」</div>';
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
    if (srcHintEl && state && state.loaded) {
      srcHintEl.textContent = '已就绪平台：' + (state.sourceKeys.join(', ') || '—');
    }
  }
  async function loadSrcList() {
    if (!window.songwave.srcList || !srcListEl) return;
    let r = null;
    try { r = await window.songwave.srcList(); } catch (e) { r = null; }
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
    if (!window.songwave.srcImportLx) return;
    setStatus('正在从 LX Music 读取音源…', 0);
    const r = await window.songwave.srcImportLx();
    if (!r || !r.ok) { setStatus('从 LX 导入失败：' + ((r && r.error) || ''), 8000); return; }
    renderSrcItems(r.items, r.state);
    updateLxStatus();
    setStatus('已从 LX 导入 ' + r.imported.length + ' 个音源' +
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
    if (refreshBtn) refreshBtn.onclick = loadSrcList;
    const lxBtn = $('src-import-lx');
    if (lxBtn) lxBtn.onclick = importFromLx;
    const dirBtn = $('src-import-dir');
    if (dirBtn) dirBtn.onclick = importFromDir;
  }

  // —— 引导逻辑 ——
  function boot() {
    if (IS_WALLPAPER) { enterWallpaperLocal(); return; }
    // 给 Song-Life 的粒子层打标记，便于背景模式下整体淡出（不改引擎源码）
    try {
      const canvases = document.querySelectorAll('canvas');
      if (canvases && canvases[1] && canvases[1].classList) canvases[1].classList.add('songwave-rings');
    } catch (e) { /* ignore */ }
    renderThemes();
    bindParams();
    // 恢复上次选择的音源
    try {
      const s = localStorage.getItem('songwave.source');
      if (s && SOURCE_LABELS[s]) {
        curSource = s;
        document.querySelectorAll('#src-chips .chip').forEach((x) => x.classList.toggle('active', x.dataset.src === curSource));
      }
    } catch (e) { /* ignore */ }
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