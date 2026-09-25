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
    setStatus('搜索中…', 4000);
    const r = await window.songwave.search(kw);
    if (!r.ok) { setStatus('搜索失败：' + r.error); return; }
    renderResults(r.data || []);
    setStatus(r.data && r.data.length ? `找到 ${r.data.length} 首` : '没有结果');
  }
  $('search-btn').onclick = doSearch;
  $('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

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
  }
  function renderPlaylist() {
    playlistEl.innerHTML = '';
    playlist.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'track' + (i === current ? ' active' : '');
      row.innerHTML =
        '<span class="t-name">' + esc(it.name || it.label) + '</span>' +
        '<span class="t-artist">' + esc(it.artist || '') + '</span>' +
        (it.type === 'local' ? '' : '<button class="t-dl" title="下载">⤓</button>') +
        '<button class="t-remove" title="移出列表">✕</button>';
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
      lyricEl.appendChild(div);
    });
  }
  function updateLyricActive(t) {
    if (!lyricLines.length) return;
    let idx = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].t <= t) idx = i;
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
  async function ensureEngine() {
    if (engineStarted) return;
    try {
      await engine.initSystemAudio();
      setStatus('可视化已连接系统音频');
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
  audio.addEventListener('ended', () => {
    if (current < playlist.length - 1) { current++; renderPlaylist(); playCurrent(); }
    else setStatus('播放列表已播完');
  });
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
  audio.addEventListener('timeupdate', () => {
    $('time-cur').textContent = fmtTime(audio.currentTime);
    if (audio.duration && Number.isFinite(audio.duration)) {
      $('time-total').textContent = fmtTime(audio.duration);
      $('progress').value = Math.round((audio.currentTime / audio.duration) * 1000);
    }
    updateLyricActive(audio.currentTime);
  });
  $('progress').addEventListener('input', (e) => {
    if (audio.duration && Number.isFinite(audio.duration)) {
      audio.currentTime = (Number(e.target.value) / 1000) * audio.duration;
    }
  });
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
    // 回填主题高亮
    themesEl.querySelectorAll('.theme').forEach((b) => b.classList.toggle('active', b.dataset.key === st.theme));
  }

  // —— 壁纸模式（模仿 Wallpaper Engine） ——
  let wallpaperOn = false;
  function applyWallpaperParams(p) {
    if (!p) return;
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
  function enterWallpaperLocal() {
    // 壁纸窗口自身的启动逻辑：只留可视化，铺满整屏
    document.body.classList.add('wallpaper');
    ensureEngine();
    if (window.songwave.onWallpaperParams) {
      window.songwave.onWallpaperParams((p) => applyWallpaperParams(p));
    }
    // Esc 退出壁纸模式
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && window.songwave.setWallpaper) window.songwave.setWallpaper(false);
    });
  }
  const wallpaperBtn = $('btn-wallpaper');
  if (wallpaperBtn) {
    wallpaperBtn.onclick = async () => {
      if (!window.songwave.setWallpaper) return;
      wallpaperOn = !wallpaperOn;
      wallpaperBtn.classList.toggle('active', wallpaperOn);
      const r = await window.songwave.setWallpaper(wallpaperOn);
      if (r && r.on) {
        if (window.songwave.pushWallpaperParams) window.songwave.pushWallpaperParams(currentWallpaperParams());
        setStatus('壁纸模式已开启（桌面底层，Esc 退出）', 4000);
      } else {
        wallpaperOn = false;
        wallpaperBtn.classList.remove('active');
        setStatus('壁纸模式已关闭', 2500);
      }
    };
  }

  // —— 引导逻辑 ——
  function boot() {
    if (IS_WALLPAPER) { enterWallpaperLocal(); return; }
    renderThemes();
    bindParams();
    loadState();
    renderPlaylist();
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