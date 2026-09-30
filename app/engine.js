/* ============================================================
   Song-Life 声命 · v0.4 自适应引擎
   - 优先 WebGL（GPU）渲染
   - 无 WebGL / 老电脑自动回退到优化的 Canvas 2D
   - CPU 后端：预渲染光晕纹理 + 空间网格连线 + 降采样
   ============================================================ */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);

  const THEMES = {
    deepsea:  { name: '深海',   hue: 205, sat: 75, light: 55 },
    ocean:    { name: '冰蓝',   hue: 195, sat: 85, light: 62 },
    aurora:   { name: '极光',   hue: 160, sat: 80, light: 60 },
    emerald:  { name: '翡翠',   hue: 165, sat: 75, light: 58 },
    forest:   { name: '森林',   hue: 140, sat: 65, light: 55 },
    golden:   { name: '暖金',   hue: 45,  sat: 88, light: 58 },
    ember:    { name: '琥珀',   hue: 25,  sat: 92, light: 55 },
    lava:     { name: '熔岩',   hue: 10,  sat: 95, light: 55 },
    crimson:  { name: '血红',   hue: 350, sat: 85, light: 55 },
    coral:    { name: '珊瑚',   hue: 15,  sat: 80, light: 62 },
    nebula:   { name: '星云',   hue: 285, sat: 70, light: 60 },
    neon:     { name: '霓虹',   hue: 312, sat: 90, light: 60 },
    mono:     { name: '极简',   hue: 210, sat: 5,  light: 62 },
  };

  const P = {
    // —— 音域地形参数 ——
    height: 1.0,       // 律动强度（柱子高度倍率）
    response: 0.5,     // 响应速度
    flash: 1.0,        // 闪烁强度
    brightness: 1.0,   // 亮度
    tilt: 0.42,        // 俯视透视强度
    trail: 0.84,       // 光晕衰减
    theme: 'deepsea',
    hueShift: 0,        // 色相偏移（自定义颜色，-180~180）
    mouseWave: 1.0,     // 鼠标波动强度（0=关闭，只是轻微波动）
    barStyle: 'glass',  // 音柱材质：glass(玻璃) / solid(实心) / glow(发光) / acrylic(亚克力)
    colorA: '#67DCE7',  // 混搭主色（色板自选）
    colorB: '#FF6BAE',  // 混搭副色
    colorMix: 0,        // 混搭强度：0=主题色，1=完全自选两色渐变
    barBlur: 6,         // 材质模糊半径 px（亚克力/磨砂）
    barAlpha: 1.0,      // 材质整体透明度倍率（0.2~2）
    barGlow: 1.0,       // 高光/发光强度倍率（0~2）
    barRound: 2,        // 柱体圆角 px
    bottomPad: 96,      // 底部留白 px：给播放条/任务栏让位，避免"律动贴到屏幕最底"
    ringSize: 0.5,      // 地面光环大小倍率（0.1~1.5，默认比以前小一半）
    ringTrigger: 0,     // 光环触发：0=鼠标+音频 1=仅鼠标互动 2=仅音频节拍 3=关闭
    flipY: 1,           // 地形朝向：1 = 正立（柱子立在地面上向上生长，与 2D 保底路径一致）
                        //          0 = 旧版倒挂观感（WebGL 路径 y 轴被 FBO 二次翻转，会垂到屏幕底）
    silenceSec: 6,      // 连续无信号多少秒后才回演示动画（太短会在歌曲安静段落误判）
    silenceThreshold: 0.008,  // 低于该电平视为"没声音"（配合 silenceSec 判定静音）
    hint: '点击画面有光环 · 点「系统音频」检测正在播放的音乐',
  };

  const state = {
    alpha: 0, audioOn: false, audioLevel: 0, bass: 0, mid: 0, high: 0,
    beat: 0, time: 0, hue: THEMES.deepsea.hue, _lastBeat: 0,
    silentFor: 0,   // 连续无信号时长（秒）：超过阈值自动回演示动画，避免地形冻住
    peakLevel: 0,   // 电平峰值保持（用于判断"真的没声音"而不是安静段落
  };

  const rings = [];

  // ============================================================
  // 音阶光电系统：每个音阶对应一个光电点，带彗星尾
  // ============================================================
  // ============================================================
  // 音域地形：3D 俯视的柱子网格（参照 Sonic Topography 音域回响）
  // ============================================================
  const GRID_SIZE = 48;
  const photons = [];

  function initPhotons() {
    photons.length = 0;
    for (let gz = 0; gz < GRID_SIZE; gz++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const nx = (gx / (GRID_SIZE - 1)) * 2 - 1;
        const nz = (gz / (GRID_SIZE - 1)) * 2 - 1;
        const r = Math.sqrt(nx * nx + nz * nz);
        photons.push({
          nx: nx, nz: nz, r: r,
          energy: 0,
          flash: 0,
          height: 0,
          rawSize: 0,
          size: 0,
          depth: 1,
          hue: 0, sat: 80, light: 60,
          x: W / 2, y: H / 2,
          alive: false,
        });
      }
    }
  }

  function bandEnergy(r) {
    if (!freqData) return 0;
    const fb = freqData.length;
    const idx = Math.floor(Math.pow(r, 1.3) * fb * 0.8);
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, idx - 1); j <= Math.min(fb - 1, idx + 2); j++) {
      sum += freqData[j] / 255;
      cnt++;
    }
    return cnt ? sum / cnt : 0;
  }

  function demoEnergy(r, time) {
    // 模拟真实频谱：低频（中心）持续强，高频（边缘）有节拍闪烁，整体连续
    const lowBase = 0.32 + 0.16 * Math.sin(time * 0.05);
    const beat = Math.pow(Math.max(0, Math.sin(time * 0.13)), 3);
    const melody = 0.5 + 0.5 * Math.sin(time * 0.09 - r * 4);
    const ripple = Math.max(0, Math.sin(r * 9 - time * 0.18)) * 0.22;
    const fall = Math.pow(Math.max(0, 1 - r * 0.55), 1.5);
    const e = (lowBase + beat * 0.5 + melody * 0.18 + ripple) * fall;
    return Math.max(0.08, e);
  }

  function updatePhotons(dt) {
    if (!photons.length) initPhotons();
    const t = theme();
    const groundW = W * 0.46;
    // 整个音域地形抬到播放条之上：底部留白同时压缩地面纵深与柱高，
    // 否则最近一排柱子（H*0.74）与底部频谱会一起贴到屏幕最下沿
    const stageH = Math.max(240, H - (Number(P.bottomPad) || 0));
    const maxH = stageH * 0.42 * P.height;
    for (let i = 0; i < photons.length; i++) {
      const p = photons[i];
      const dem = useDemo();
      const te = dem ? demoEnergy(p.r, state.time * 0.6) : bandEnergy(p.r);
      // 帧率无关平滑：每帧系数换算为 pow(base, dt)（dt=1 表示 60fps 一帧）
      const respK = 1 - Math.pow(1 - P.response, dt);
      p.energy += (te - p.energy) * respK;
      const en = p.energy;
      p.flash *= Math.pow(0.85, dt);
      if (!dem) {
        if (state.beat > 0.3) p.flash = Math.max(p.flash, state.beat);
      } else {
        const db = Math.pow(Math.max(0, Math.sin(state.time * 0.1)), 4);
        if (db > 0.6) p.flash = Math.max(p.flash, db);
      }
      p.hue = P.colorMix > 0 ? (hueAt(Math.min(1, p.r)) + p.r * 40) % 360 : (t.hue + p.r * 150) % 360;
      p.sat = t.sat;
      p.light = t.light + (p.height / maxH) * 18;
      // 鼠标波动：滑过音域时局部轻微抬升（纯增量，不影响核心能量）
      let mouseBoost = 0;
      if (P.mouseWave > 0 && pointer.moved) {
        const dx = p.x - pointer.x, dy = p.y - pointer.y;
        const R = Math.max(W, H) * 0.22;
        const d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) || 1;
          mouseBoost = maxH * 0.12 * P.mouseWave * (1 - d / R);
        }
      }
      const targetH = en * maxH + p.flash * 20 * P.flash + mouseBoost;
      const riseK = 1 - Math.pow(en > p.height / maxH ? 0.45 : 0.65, dt);
      p.height += (targetH - p.height) * riseK;
      p.rawSize = 4 + en * 9 + p.flash * 5;
      p.alive = p.height > 0.5;
      // 3D 地面透视（摄像机斜上方俯视，远边缩小）
      const persp = 1 / (1 + (p.nz + 1) * P.tilt);
      const sx = W / 2 + p.nx * groundW * persp;
      const gz = (p.nz + 1) * 0.5 * stageH * 0.5;
      const sy = stageH * 0.71 - gz - p.height * persp;
      p.depth = persp;
      p.x = sx;
      p.y = sy;
      p.size = p.rawSize * persp;
    }
  }

  const canvas = document.getElementById('stage');
  let W = 0, H = 0, dpr = 1, renderScale = 1;

  // 光环叠加层：无论粒子后端是 WebGL 还是 Canvas，光环都用 2D 绘制
  const ringLayer = document.createElement('canvas');
  ringLayer.style.position = 'fixed';
  ringLayer.style.inset = '0';
  ringLayer.style.pointerEvents = 'none';
  ringLayer.style.zIndex = '5';
  ringLayer.style.display = 'block';
  canvas.parentNode.insertBefore(ringLayer, canvas.nextSibling);
  const rctx = ringLayer.getContext('2d');

  function drawOverlay(dt) {
    rctx.clearRect(0, 0, W, H);

    // ---- 地面光环（3D：投影到音域地形所在的斜面上，近处粗亮、远处细暗）----
    if (rings.length > 0) {
      const padR = Number(P.bottomPad) || 0;
      const stageHR = Math.max(240, H - padR);
      const tiltR = Number(P.tilt) || 0.42;
      const groundWR = W * 0.46;
      const farPersp = 1 / (1 + 2 * tiltR);      // 最远排的透视系数：用于把 persp 归一化成深度
      const nearFarSpan = 1 - farPersp;
      const SEG = 84;
      rctx.globalCompositeOperation = 'lighter';
      rctx.lineCap = 'round';
      for (let i = rings.length - 1; i >= 0; i--) {
        const rg = rings[i];
        const growK = 1 - Math.pow(0.92, dt);
        rg.nr += (rg.max - rg.nr) * growK + 0.006 * dt;
        rg.alpha *= Math.pow(0.945, dt);
        if (rg.alpha < 0.02 || rg.nr > rg.max) { rings.splice(i, 1); continue; }
        let px = 0, py = 0;
        for (let s = 0; s <= SEG; s++) {
          const a = (s / SEG) * TAU;
          const nx = rg.nx + Math.cos(a) * rg.nr;
          const nz = rg.nz + Math.sin(a) * rg.nr;
          const persp = 1 / (1 + (nz + 1) * tiltR);
          const gx = W / 2 + nx * groundWR * persp;
          const gz = (nz + 1) * 0.5 * stageHR * 0.5;
          const gy = stageHR * 0.71 - gz;
          if (s > 0) {
            const depth = nearFarSpan > 0.01 ? Math.max(0, Math.min(1, (persp - farPersp) / nearFarSpan)) : 1;
            rctx.strokeStyle = 'hsla(' + rg.hue + ', 88%, ' + (58 + depth * 22) + '%, ' +
              Math.max(0.015, rg.alpha * (0.22 + depth * 1.05)).toFixed(3) + ')';
            rctx.lineWidth = (0.8 + depth * 2.6) * (1 + rg.alpha * 1.2);
            rctx.beginPath();
            rctx.moveTo(px, py);
            rctx.lineTo(gx, gy);
            rctx.stroke();
          }
          px = gx; py = gy;
        }
      }
      rctx.lineCap = 'butt';
    }

    // ---- 底部音乐频谱（音域回响）----
    drawSpectrum();

    rctx.globalCompositeOperation = 'source-over';
  }

  function drawSpectrum() {
    if (!freqData) return;
    const demSpec = useDemo();   // 无信号时用演示频谱，保持画面动起来
    // 柱数随屏宽自适应：小屏 48 柱过密
    const bars = Math.max(24, Math.min(48, Math.floor(W / 22)));
    const totalW = W * 0.7;
    const bw = totalW / bars;
    const usableH = Math.max(120, H - (Number(P.bottomPad) || 0));
    const maxH = usableH * 0.2;
    const baseY = H - Math.max(10, Number(P.bottomPad) || 10);
    const x0 = (W - totalW) / 2;
    let hue = state.hue;   // 混搭开启时按柱位逐根取色（形成渐变）
    const style = P.barStyle || 'glass';
    // 材质可调参数（亚克力/玻璃/实心/发光 都吃这几个值）
    const am = Math.max(0, Math.min(2, P.barAlpha == null ? 1 : Number(P.barAlpha)));
    const gm = Math.max(0, Math.min(2, P.barGlow == null ? 1 : Number(P.barGlow)));
    const blurPx = Math.max(0, Math.min(40, P.barBlur == null ? 0 : Number(P.barBlur)));
    const roundPx = Math.max(0, Math.min(20, P.barRound == null ? 0 : Number(P.barRound)));
    const canFilter = typeof rctx.filter === 'string';
    function roundBar(x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      rctx.beginPath();
      if (rr <= 0) { rctx.rect(x, y, w, h); return; }
      rctx.moveTo(x + rr, y);
      rctx.lineTo(x + w - rr, y);
      rctx.quadraticCurveTo(x + w, y, x + w, y + rr);
      rctx.lineTo(x + w, y + h - rr);
      rctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
      rctx.lineTo(x + rr, y + h);
      rctx.quadraticCurveTo(x, y + h, x, y + h - rr);
      rctx.lineTo(x, y + rr);
      rctx.quadraticCurveTo(x, y, x + rr, y);
      rctx.closePath();
    }
    rctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < bars; i++) {
      const idx = Math.floor(Math.pow(i / bars, 1.5) * freqData.length * 0.6);
      const v = demSpec
        ? demoEnergy(i / Math.max(1, bars - 1), state.time * 0.6)
        : freqData[idx] / 255;
      const bh = Math.max(2, v * maxH + state.bass * 6);
      const x = x0 + i * bw;
      const w = bw * 0.62;
      const top = baseY - bh;
      if (P.colorMix > 0) hue = hueAt(i / Math.max(1, bars - 1));

      if (style === 'glow') {
        // 发光材质：柔光渐晕，无实体
        const g = rctx.createLinearGradient(0, top, 0, baseY);
        g.addColorStop(0, 'hsla(' + hue + ', 90%, 80%, ' + Math.min(1, (0.5 + v * 0.5) * am * gm) + ')');
        g.addColorStop(1, 'hsla(' + hue + ', 90%, 50%, 0)');
        rctx.fillStyle = g;
        if (blurPx > 0 && canFilter) rctx.filter = 'blur(' + blurPx + 'px)';
        rctx.fillRect(x - w * 0.2, top, w * 1.4, bh);
        if (blurPx > 0 && canFilter) rctx.filter = 'none';
      } else if (style === 'solid') {
        // 实心材质：立体柱体
        const g = rctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, 'hsla(' + hue + ', 90%, 28%, ' + Math.min(1, 0.9 * am) + ')');
        g.addColorStop(0.35, 'hsla(' + hue + ', 90%, 62%, ' + Math.min(1, (0.5 + v * 0.45) * am) + ')');
        g.addColorStop(0.6, 'hsla(' + hue + ', 90%, 84%, ' + Math.min(1, (0.55 + v * 0.45) * am) + ')');
        g.addColorStop(1, 'hsla(' + hue + ', 90%, 24%, ' + Math.min(1, 0.9 * am) + ')');
        rctx.fillStyle = g;
        if (blurPx > 0 && canFilter) rctx.filter = 'blur(' + blurPx + 'px)';
        if (roundPx > 0) { roundBar(x, top, w, bh, roundPx); rctx.fill(); } else { rctx.fillRect(x, top, w, bh); }
        if (blurPx > 0 && canFilter) rctx.filter = 'none';
        rctx.fillStyle = 'hsla(' + ((hue + 20) % 360) + ', 95%, 92%, ' + Math.min(1, (0.6 + v * 0.4) * am * gm) + ')';
        rctx.fillRect(x, top - 2.5, w, 3);
      } else if (style === 'acrylic') {
        // 亚克力（磨砂玻璃）：模糊柱体 + 顶部亮边 + 内部高光 + 冷色描边
        const g = rctx.createLinearGradient(0, top, 0, baseY);
        g.addColorStop(0, 'hsla(' + hue + ', 55%, 95%, ' + Math.min(1, (0.26 + v * 0.22) * am) + ')');
        g.addColorStop(0.55, 'hsla(' + hue + ', 40%, 82%, ' + Math.min(1, (0.14 + v * 0.16) * am) + ')');
        g.addColorStop(1, 'hsla(' + hue + ', 35%, 70%, ' + Math.min(1, (0.08 + v * 0.1) * am) + ')');
        rctx.fillStyle = g;
        if (blurPx > 0 && canFilter) rctx.filter = 'blur(' + blurPx + 'px)';
        roundBar(x, top, w, bh, roundPx + 2);
        rctx.fill();
        if (blurPx > 0 && canFilter) rctx.filter = 'none';
        // 磨砂描边（亚克力的硬边）
        rctx.strokeStyle = 'hsla(' + hue + ', 60%, 97%, ' + Math.min(1, (0.22 + v * 0.3) * am) + ')';
        rctx.lineWidth = 1;
        roundBar(x + 0.5, top + 0.5, w - 1, Math.max(1, bh - 1), roundPx + 2);
        rctx.stroke();
        // 顶部亮线 + 内部镜面反光
        rctx.fillStyle = 'hsla(' + hue + ', 75%, 99%, ' + Math.min(1, (0.45 + v * 0.5) * am * gm) + ')';
        rctx.fillRect(x + 1, top + 1, w - 2, Math.max(1, 1.6));
        rctx.fillStyle = 'hsla(' + hue + ', 45%, 100%, ' + Math.min(1, 0.1 * am * gm) + ')';
        rctx.fillRect(x + w * 0.18, top + 2, Math.max(1, w * 0.16), Math.max(0, bh - 3));
      } else {
        // 玻璃材质（默认）：半透明柱体 + 高光 + 反光 + 边框
        const g = rctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, 'hsla(' + hue + ', 85%, 55%, ' + Math.min(1, (0.28 + v * 0.3) * am) + ')');
        g.addColorStop(0.5, 'hsla(' + hue + ', 85%, 78%, ' + Math.min(1, (0.34 + v * 0.35) * am) + ')');
        g.addColorStop(1, 'hsla(' + hue + ', 85%, 45%, ' + Math.min(1, (0.26 + v * 0.3) * am) + ')');
        rctx.fillStyle = g;
        if (blurPx > 0 && canFilter) rctx.filter = 'blur(' + blurPx + 'px)';
        if (roundPx > 0) { roundBar(x, top, w, bh, roundPx); rctx.fill(); } else { rctx.fillRect(x, top, w, bh); }
        if (blurPx > 0 && canFilter) rctx.filter = 'none';
        // 顶部高光（亮点）
        rctx.fillStyle = 'hsla(' + ((hue + 25) % 360) + ', 90%, 94%, ' + Math.min(1, (0.5 + v * 0.5) * am * gm) + ')';
        rctx.fillRect(x, top - 1.5, w, 2.5);
        // 玻璃边框
        rctx.strokeStyle = 'hsla(' + hue + ', 80%, 88%, ' + Math.min(1, (0.2 + v * 0.25) * am) + ')';
        rctx.lineWidth = 1;
        roundBar(x + 0.5, top + 0.5, w - 1, Math.max(1, bh - 1), roundPx);
        rctx.stroke();
        // 底部反光
        rctx.fillStyle = 'hsla(' + hue + ', 80%, 60%, ' + Math.min(1, (0.14 + v * 0.16) * am) + ')';
        rctx.fillRect(x, baseY - 2, w, 2);
      }
    }
    rctx.globalCompositeOperation = 'source-over';
  }


  /** 是否走演示动画：没有音频源，或有源但连续静音 */
  function useDemo() { return !state.audioOn || state.silentFor > (Number(P.silenceSec) || 6); }

  function theme() { const t = THEMES[P.theme] || THEMES.deepsea; return { name: t.name, hue: (t.hue + (P.hueShift || 0) + 360) % 360, sat: t.sat, light: t.light }; }

  // ---------- 色彩混搭：色板自选两色，按位置渐变 ----------
  function hexToHue(hex) {
    const s = String(hex || '').replace('#', '');
    if (s.length !== 6) return null;
    const r = parseInt(s.slice(0, 2), 16) / 255;
    const g = parseInt(s.slice(2, 4), 16) / 255;
    const b = parseInt(s.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  function hueAt(r) {
    const t = theme();
    const mix = Math.max(0, Math.min(1, P.colorMix == null ? 0 : Number(P.colorMix)));
    if (mix <= 0) return t.hue;
    const hA = hexToHue(P.colorA);
    const hB = hexToHue(P.colorB);
    if (hA == null || hB == null) return t.hue;
    const delta = ((hB - hA + 540) % 360) - 180;
    const grad = (hA + delta * Math.max(0, Math.min(1, r)) + 360) % 360;
    const back = ((t.hue - grad + 540) % 360) - 180;
    return (grad + back * (1 - mix) + 360) % 360;
  }

  // ---------- HSL -> RGB ----------
  function hsl2rgb(h, s, l) {
    const C = (1 - Math.abs(2 * l - 1)) * s;
    const hp = ((h % 360) + 360) % 360 / 60;
    const X = C * (1 - Math.abs(hp % 2 - 1));
    let r = 0, g = 0, b = 0;
    if (hp < 1) { r = C; g = X; }
    else if (hp < 2) { r = X; g = C; }
    else if (hp < 3) { g = C; b = X; }
    else if (hp < 4) { g = X; b = C; }
    else if (hp < 5) { r = X; b = C; }
    else { r = C; b = X; }
    const m = l - C / 2;
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  // ---------- 反馈效果 ----------
  // （v0.1 的 Creature 粒子系统自音域地形改版后从未参与渲染，
  //   相关死代码已移除；点击反馈保留光环效果）
  // 地面光环：坐标用与光子相同的「网格归一化坐标」(-1..1)，这样能投影到同一张地形斜面上
  function addRing(nx, nz, strength) {
    rings.push({
      nx: Math.max(-1.2, Math.min(1.2, Number(nx) || 0)),
      nz: Math.max(-1.2, Math.min(1.2, Number(nz) || 0)),
      nr: 0.02,                                   // 归一化半径（网格单位），从中心向外扩散
      max: (0.35 + Math.min(1, Math.abs(strength) || 0) * 0.9) * Math.max(0.1, Math.min(2, Number(P.ringSize) || 0.5)),
      alpha: 0.8,
      hue: (P.colorMix > 0 ? hueAt(0.35) : state.hue),
    });
  }

  /** 光环触发开关：0=鼠标+音频 1=仅鼠标互动 2=仅音频节拍 3=关闭 */
  function ringOn(kind) {
    const t = Number(P.ringTrigger) || 0;
    if (t === 3) return false;
    if (t === 1) return kind === 'mouse';
    if (t === 2) return kind === 'audio';
    return true;
  }

  /** 屏幕坐标 → 地形网格坐标（点击处生成 3D 光环用；与 updatePhotons 的投影互逆，忽略柱高） */
  function screenToGrid(x, y) {
    const padS = Number(P.bottomPad) || 0;
    const stageHS = Math.max(240, H - padS);
    const tiltS = Number(P.tilt) || 0.42;
    const groundWS = W * 0.46;
    const nz = Math.max(-1, Math.min(1, ((stageHS * 0.71 - y) / (0.5 * stageHS * 0.5)) - 1));
    const persp = 1 / (1 + (nz + 1) * tiltS);
    const nx = (x - W / 2) / Math.max(1, groundWS * persp);
    return { nx: Math.max(-1, Math.min(1, nx)), nz: nz };
  }
  // ============================================================
  // Canvas 2D 优化后端（保底方案：无独立显卡也能流畅）
  // 关键优化：预渲染光晕纹理（替代 createRadialGradient）+ 空间网格连线 + dpr 降采样
  // ============================================================
  function createCanvasRenderer() {
    const ctx = canvas.getContext('2d');
    // CPU 渲染降采样：限制 dpr，减少像素量
    const cpuDpr = Math.min(window.devicePixelRatio || 1, 1.5);

    // 预渲染光晕纹理：12 色相桶，每桶一张彩色光晕
    const GLOW_SIZE = 64;
    const HUES = 12;
    const glowTextures = [];
    for (let i = 0; i < HUES; i++) {
      const h = i / HUES * 360;
      const c = document.createElement('canvas');
      c.width = c.height = GLOW_SIZE;
      const g = c.getContext('2d');
      const [r, gg, b] = hsl2rgb(h, 0.7, 0.6);
      const grad = g.createRadialGradient(GLOW_SIZE / 2, GLOW_SIZE / 2, 0, GLOW_SIZE / 2, GLOW_SIZE / 2, GLOW_SIZE / 2);
      grad.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + b + ',0.95)');
      grad.addColorStop(0.6, 'rgba(' + r + ',' + gg + ',' + b + ',0.45)');
      grad.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + b + ',0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
      glowTextures.push(c);
    }
    function glowTex(hue) {
      const idx = Math.floor((((hue % 360) + 360) % 360) / 360 * HUES) % HUES;
      return glowTextures[idx];
    }

    // （空间网格 buildGrid 已移除：连线功能未实现，从未被调用）

    function resize() {
      canvas.width = Math.floor(W * cpuDpr);
      canvas.height = Math.floor(H * cpuDpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(cpuDpr, 0, 0, cpuDpr, 0, 0);
    }

    function render(creats, _trail, t) {
      // 坐标系统：CSS 像素，transform 已在 resize 设置为 cpuDpr
      const E = state.audioLevel;

      // 背景拖尾：半透明深色覆盖（保留上一帧 → 拖尾）
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(3,5,12,1)';  // 柱子地形每帧完全重绘，避免光晕累积过曝
      ctx.fillRect(0, 0, W, H);

      // 顶部冷色光晕（深空感）
      const topGrad = ctx.createRadialGradient(W / 2, -H * 0.15, 0, W / 2, -H * 0.15, H * 0.9);
      topGrad.addColorStop(0, 'hsla(225, 60%, 14%, 0.55)');
      topGrad.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, W, H);

      // 底部主题色氛围（随音乐 hue 流转）
      const bgGrad = ctx.createRadialGradient(W / 2, H * 0.85, 0, W / 2, H * 0.85, Math.max(W, H) * 0.75);
      bgGrad.addColorStop(0, 'hsla(' + state.hue + ', 75%, 22%, ' + (0.16 + state.bass * 0.32) + ')');
      bgGrad.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

            // 柱子地形：柱身（地面→顶点）+ 顶部光点（纹理高效绘制）
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      // 1) 柱身（竖线，底部暗 → 顶部亮）
      for (let i = 0; i < creats.length; i++) {
        const c = creats[i];
        if (!c.alive) continue;
        const baseY = c.y + c.height * c.depth;
        const en = Math.min(1, c.energy * 1.2 + c.flash * 0.5);
        ctx.strokeStyle = 'hsla(' + c.hue + ', ' + c.sat + '%, ' + (c.light + 12) + '%, ' + (0.03 + 0.14 * en) + ')';
        ctx.lineWidth = Math.max(0.5, c.rawSize * c.depth * 0.45);
        ctx.beginPath();
        ctx.moveTo(c.x, baseY);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
      // 2) 顶部光点（预渲染光晕纹理）
      for (let i = 0; i < creats.length; i++) {
        const c = creats[i];
        if (!c.alive) continue;
        const en = Math.min(1, c.energy + c.flash * 0.8);
        const d = Math.max(3, c.size * 2.0);
        const tex = glowTex(c.hue);
        ctx.globalAlpha = Math.min(1, 0.04 + en * 0.2);
        ctx.drawImage(tex, c.x - d / 2, c.y - d / 2, d, d);
        // 高亮核心
        ctx.fillStyle = 'hsla(' + c.hue + ', 30%, ' + Math.min(96, c.light + 28 + en * 22) + '%, ' + (0.22 + en * 0.28) + ')';
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(1, c.size * 0.28), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;

ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    return { render, resize };
  }
  // ============================================================
  // WebGL 后端（GPU 渲染，独显/核显时更流畅）
  // ============================================================
  function createWebGLRenderer() {
    // 先用临时 canvas 探测 WebGL 是否可用，避免绑定主 canvas 导致 2d 回退失败
    let probe = null;
    try {
      probe = document.createElement('canvas').getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    } catch (e) { probe = null; }
    if (!probe) return null;

    // WebGL 可用，才在主 canvas 上获取 context
    let gl = null;
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' })
        || canvas.getContext('experimental-webgl');
    } catch (e) { gl = null; }
    if (!gl) return null;

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { return null; }
      return sh;
    }
    function makeProgram(vsSrc, fsSrc) {
      const vs = compile(gl.VERTEX_SHADER, vsSrc);
      const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
      gl.deleteShader(vs); gl.deleteShader(fs);
      return p;
    }

    const VERT = [
      'precision mediump float;',
      'attribute vec2 a_pos;',
      'attribute float a_size;',
      'attribute vec3 a_color;',
      'uniform vec2 u_res;',
      'uniform float u_dpr;',
      'uniform float u_flipY;',
      'varying vec3 v_color;',
      'void main(){',
      '  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;',
      // FBO 离屏渲染 + 全屏 quad 的 UV 天然带一次上下翻转，这里必须只翻一次：
      // u_flipY=1 → 保持 clip.y（净效果 1:1，地形正立）；=0 → 再翻一次（旧的倒挂观感）
      '  clip.y = mix(-clip.y, clip.y, u_flipY);',
      '  gl_Position = vec4(clip, 0.0, 1.0);',
      '  gl_PointSize = a_size * u_dpr;',
      '  v_color = a_color;',
      '}'
    ].join('\n');

    const FRAG = [
      'precision mediump float;',
      'varying vec3 v_color;',
      'void main(){',
      '  vec2 q = gl_PointCoord * 2.0 - 1.0;',
      '  float d = length(q);',
      '  if (d > 1.0) discard;',
      '  float glow = pow(1.0 - d, 1.5);',
      '  float core = 1.0 - smoothstep(0.0, 0.22, d);',
      '  vec3 col = v_color * glow * 0.7 + vec3(0.9, 0.95, 1.0) * core * 0.7;',
      '  float a = glow * 0.4 + core * 0.9;',
      '  gl_FragColor = vec4(col, a);',
      '}'
    ].join('\n');

    const QUAD_VERT = [
      'precision mediump float;',
      'attribute vec2 a_pos;',
      'attribute vec2 a_uv;',
      'varying vec2 v_uv;',
      'void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); v_uv = a_uv; }'
    ].join('\n');

    const QUAD_FRAG = [
      'precision mediump float;',
      'uniform sampler2D u_tex;',
      'uniform float u_alpha;',
      'varying vec2 v_uv;',
      'void main(){',
      '  vec4 c = texture2D(u_tex, v_uv);',
      '  gl_FragColor = vec4(c.rgb, c.a * u_alpha);',
      '}'
    ].join('\n');

    const progPoint = makeProgram(VERT, FRAG);
    const progQuad = makeProgram(QUAD_VERT, QUAD_FRAG);
    if (!progPoint || !progQuad) return null;

    // 全屏 quad
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1, 0,1,   1,-1, 1,1,   -1,1, 0,0,
      -1,1, 0,0,    1,-1, 1,1,   1,1, 1,0,
    ]), gl.STATIC_DRAW);

    const MAXV = 4096;  // 容纳 48x48=2304 根柱子（尾点另加）
    const posData = new Float32Array(MAXV * 6); // x,y,size,r,g,b
    const pointBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW);

    function makeRT(w, h) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb };
    }

    let rtA = null, rtB = null, rtW = 0, rtH = 0, rdpr = 1;

    function destroyRT(rt) {
      if (!rt) return;
      try { gl.deleteTexture(rt.tex); } catch (e) {}
      try { gl.deleteFramebuffer(rt.fb); } catch (e) {}
    }

    function resize() {
      const w = W * dpr, h = H * dpr, d = dpr;
      // 关键：设置 canvas 物理尺寸与 framebuffer 一致
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      if (w === rtW && h === rtH && d === rdpr && rtA && rtB) return;
      rtW = w; rtH = h; rdpr = d;
      // 先释放旧渲染目标再重建：此前直接覆盖导致反复拖拽窗口持续泄漏显存
      destroyRT(rtA); destroyRT(rtB);
      rtA = makeRT(w, h); rtB = makeRT(w, h);
    }

    function drawQuad(tex, alpha) {
      gl.useProgram(progQuad);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      const ap = gl.getAttribLocation(progQuad, 'a_pos');
      const auv = gl.getAttribLocation(progQuad, 'a_uv');
      gl.enableVertexAttribArray(ap);
      gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(auv);
      gl.vertexAttribPointer(auv, 2, gl.FLOAT, false, 16, 8);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(progQuad, 'u_tex'), 0);
      gl.uniform1f(gl.getUniformLocation(progQuad, 'u_alpha'), alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function renderParticles(creats) {
      let n = 0;
      // 主光电点（能量驱动大小和亮度）
      for (let i = 0; i < creats.length && n < MAXV; i++) {
        const c = creats[i];
        if (!c.alive) continue;
        const o = n * 6;
        const en = Math.min(1, c.energy + c.flash * 0.8);
        posData[o] = c.x; posData[o + 1] = c.y;
        posData[o + 2] = c.size * 3.5;
        const l = Math.min(0.95, (c.light + en * 30) / 100 * P.brightness);
        const rgb = hsl2rgb(c.hue, c.sat / 100, Math.max(0.15, l));
        posData[o + 3] = rgb[0] / 255; posData[o + 4] = rgb[1] / 255; posData[o + 5] = rgb[2] / 255;
        n++;
      }
      // （彗星尾绘制循环已移除：photons.tail 从未被填充，恒为空转）
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, posData.subarray(0, n * 6));
      gl.useProgram(progPoint);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
      const ap = gl.getAttribLocation(progPoint, 'a_pos');
      const asz = gl.getAttribLocation(progPoint, 'a_size');
      const acol = gl.getAttribLocation(progPoint, 'a_color');
      gl.enableVertexAttribArray(ap);
      gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(asz);
      gl.vertexAttribPointer(asz, 1, gl.FLOAT, false, 24, 8);
      gl.enableVertexAttribArray(acol);
      gl.vertexAttribPointer(acol, 3, gl.FLOAT, false, 24, 12);
      gl.uniform2f(gl.getUniformLocation(progPoint, 'u_res'), W, H);
      gl.uniform1f(gl.getUniformLocation(progPoint, 'u_flipY'), (P.flipY === 0 || P.flipY === '0') ? 0 : 1);
      gl.uniform1f(gl.getUniformLocation(progPoint, 'u_dpr'), rdpr);
      gl.drawArrays(gl.POINTS, 0, n);
    }

    function render(creats, _trail, t) {
      // 柱子地形为静态位置，每帧完全重绘（不拖尾累积，避免长时间运行变白）
      // Pass1: 完全清除 -> 画柱子 -> rtB
      gl.bindFramebuffer(gl.FRAMEBUFFER, rtB.fb);
      gl.viewport(0, 0, rtW, rtH);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.clearColor(0.012, 0.02, 0.047, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      renderParticles(creats);
      // Pass2: rtB -> 屏幕
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, rtW, rtH);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0.012, 0.02, 0.047, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawQuad(rtB.tex, 1.0);
      const tmp = rtA; rtA = rtB; rtB = tmp;
    }

    return { render, resize };
  }

  // ============================================================
  // 音频
  // ============================================================
  let audioCtx = null, analyser = null, freqData = null;
  let currentSource = null, currentStream = null;
  let fileSrcNode = null;      // MediaElementSource 必须缓存：同一元素重复创建会抛 InvalidStateError
  let speakerGain = null;      // 仅本地文件源接 destination（mic/系统音频接了会啸叫回环）
  function ensureCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.82;
      freqData = new Uint8Array(analyser.frequencyBinCount);
    }
    if (audioCtx.state === 'suspended') { audioCtx.resume(); }
  }
  function setSpeakerOut(on) {
    // 文件播放需要出声；麦克风/系统音频捕获绝不能接 destination（啸叫/回环）
    if (on && !speakerGain && audioCtx) {
      speakerGain = audioCtx.createGain();
      speakerGain.gain.value = 1;
      analyser.connect(speakerGain);
      speakerGain.connect(audioCtx.destination);
    } else if (!on && speakerGain) {
      try { analyser.disconnect(speakerGain); } catch (e) {}
      try { speakerGain.disconnect(); } catch (e) {}
      speakerGain = null;
    }
  }
  function setSource(node, stream) {
    if (currentSource) { try { currentSource.disconnect(); } catch (e) {} }
    if (currentStream) { try { currentStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    currentSource = node; currentStream = stream || null;
    node.connect(analyser);
    state.audioOn = true;
  }
  // ---------- 用户音效链（EQ / 混响等）：插在 analyser 与输出之间 ----------
  let effectNodes = [];
  function rebuildEffectChain() {
    if (!audioCtx) return;
    try { analyser.disconnect(); } catch (e) { /* ignore */ }
    let prev = analyser;
    effectNodes.forEach(function (n) {
      try { prev.connect(n); } catch (e) { /* ignore */ }
      prev = n;
    });
    if (speakerGain) { try { prev.connect(speakerGain); } catch (e) { /* ignore */ } }
  }
  function setEffects(nodes) {
    effectNodes = Array.isArray(nodes) ? nodes : [];
    if (!audioCtx) return false;
    rebuildEffectChain();
    return true;
  }
  function getAudioContext() { return audioCtx; }
  function onEnd(kind) {
    state.audioOn = false;    if (window.SongLife && window.SongLife._onSourceEnd) window.SongLife._onSourceEnd(kind);
  }
  function initSystemAudio() {
    ensureCtx();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      return Promise.reject(new Error('此环境不支持系统音频捕获'));
    }
    return navigator.mediaDevices.getDisplayMedia({ audio: true, video: false })
      .then(function (stream) {
        setSpeakerOut(false);
        setSource(audioCtx.createMediaStreamSource(stream), stream);
        stream.getAudioTracks().forEach(function (t) { t.addEventListener('ended', function () { onEnd('system'); }); });
        return 'system';
      })
      .catch(function () {
        return navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
          .then(function (stream) {
            setSpeakerOut(false);
            setSource(audioCtx.createMediaStreamSource(stream), stream);
            stream.getVideoTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
            return 'system';
          })
          .catch(function (e2) { return Promise.reject(e2); });
      });
  }
  function initMic() {
    ensureCtx();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('此环境不支持麦克风'));
    }
    return navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        setSpeakerOut(false);
        setSource(audioCtx.createMediaStreamSource(stream), stream);
        stream.getAudioTracks().forEach(function (t) { t.addEventListener('ended', function () { onEnd('mic'); }); });
        return 'mic';
      });
  }
  function initFile(el) {
    ensureCtx();
    // 缓存 MediaElementSourceNode：同一 <audio> 重复 createMediaElementSource 会抛
    // InvalidStateError（此前每次切歌都产生 unhandled rejection）
    if (!fileSrcNode || fileSrcNode.mediaElement !== el) {
      try { if (fileSrcNode) fileSrcNode.disconnect(); } catch (e) {}
      fileSrcNode = audioCtx.createMediaElementSource(el);
    }
    setSource(fileSrcNode, null);
    // 本地文件必须出声：此前音频只进 Web Audio 图不接扬声器，"选择音乐"一直无声
    setSpeakerOut(true);
    return Promise.resolve('file');
  }
  function updateAudio(dt) {
    if (!analyser || !freqData) return;
    analyser.getByteFrequencyData(freqData);
    const n = freqData.length;
    let bass = 0, mid = 0, high = 0;
    for (let i = 0; i < n; i++) {
      const v = freqData[i] / 255;
      if (i < n * 0.08) bass += v; else if (i < n * 0.4) mid += v; else high += v;
    }
    bass /= n * 0.08; mid /= n * 0.32; high /= n * 0.6;
    state.bass += (bass - state.bass) * (1 - Math.pow(0.75, dt));
    state.mid += (mid - state.mid) * (1 - Math.pow(0.8, dt));
    state.high += (high - state.high) * (1 - Math.pow(0.85, dt));
    const level = state.bass * 0.55 + state.mid * 0.3 + state.high * 0.15;
    state.audioLevel += (Math.min(level * 1.4, 1) - state.audioLevel) * (1 - Math.pow(0.7, dt));
    const beatNow = Math.max(0, state.bass - state.audioLevel * 0.6);
    // 冷却按时间（~250ms）而非"8 帧"——高刷屏上 8 帧只有 ~55ms 会连环误触发
    if (beatNow > 0.28 && state.time - state._lastBeat > 15) {
      state.beat = 1; state._lastBeat = state.time;
      if (ringOn('audio')) addRing(0, 0, state.bass);   // 从地形中心向外扩散（3D 地面圆环）
    }
    state.beat = Math.max(0, state.beat - 0.06 * dt);
    // 无信号计时：连续静音 > 2.5s 视为"没有声音在放"，改用演示动画（防止画面像死了一样）
    // 峰值保持：len 缓慢衰减，避免一个安静瞬间就归零
    state.peakLevel = Math.max(state.audioLevel, (state.peakLevel || 0) * Math.pow(0.5, dt));
    const lim = Math.max(0.008, Number(P.silenceThreshold) || 0.008);
    if (state.audioOn && state.peakLevel < lim) state.silentFor += dt;
    else state.silentFor = 0;
  }

  // ============================================================
  // 交互
  // ============================================================
  const pointer = { active: false, x: 0, y: 0, moved: false };
  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  canvas.addEventListener('pointerdown', function (e) {
    const p = pointerPos(e);
    pointer.active = true; pointer.x = p.x; pointer.y = p.y;
    // 点击反馈：能量光环
    if (ringOn('mouse')) {
      const gRing = screenToGrid(p.x, p.y);
      addRing(gRing.nx, gRing.nz, 1);
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    const p = pointerPos(e);
    pointer.x = p.x; pointer.y = p.y; pointer.moved = true;
  });
  window.addEventListener('pointerup', function () { pointer.active = false; });
  // 鼠标离开窗口后复位：否则"鼠标波动"停在最后坐标持续抬升柱子
  document.addEventListener('mouseleave', function () { pointer.moved = false; pointer.active = false; });
  window.addEventListener('blur', function () { pointer.moved = false; pointer.active = false; });

  // ============================================================
  // 后端选择 + 主循环
  // ============================================================
  let renderer = null;
  let backendName = 'canvas';

  function pickBackend() {
    const glr = createWebGLRenderer();
    if (glr) { renderer = glr; backendName = 'webgl'; return; }
    renderer = createCanvasRenderer();
    backendName = 'canvas';
  }

  let lastFrameT = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!lastFrameT) lastFrameT = now || performance.now();
    // delta-time（以 60fps 一帧为单位，钳制防切后台后跳变）：
    // 此前所有阻尼按 60fps 帧步长硬编码，144Hz 屏上动画速度快 ~2.4 倍
    const dt = Math.max(0.1, Math.min(3, ((now || performance.now()) - lastFrameT) / 16.667));
    lastFrameT = now || performance.now();
    if (state.alpha < 1) state.alpha = Math.min(1, state.alpha + 0.02 * dt);
    state.time += dt;
    updateAudio(dt);
    const t = theme();
    const targetHue = P.colorMix > 0 ? hueAt(0.5) : t.hue;
    state.hue += (targetHue - state.hue) * (1 - Math.pow(0.98, dt));

    updatePhotons(dt);

    renderer.render(photons, P.trail, state.time);
    drawOverlay(dt);
  }

  function init() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    ringLayer.width = W * dpr; ringLayer.height = H * dpr;
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pickBackend();
    if (renderer && renderer.resize) renderer.resize();
    initPhotons();
    loop();
    console.log('Song-Life 渲染后端:', backendName);
  }

  window.addEventListener('resize', function () {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    ringLayer.width = W * dpr; ringLayer.height = H * dpr;
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (renderer && renderer.resize) renderer.resize();
  });

  init();

  window.SongLife = {
    initSystemAudio: initSystemAudio,
    initMic: initMic,
    initFile: initFile,
    initAudio: initFile,
    setEffects: setEffects,
    getAudioContext: getAudioContext,
    _onSourceEnd: null,
    backend: backendName,
    setTheme: function (name) { if (THEMES[name]) P.theme = name; },
    setParam: function (key, val) { if (key in P) P[key] = val; },
    getParam: function (key) { return P[key]; },
    getThemes: function () { return Object.keys(THEMES).map(function (k) { return { key: k, name: THEMES[k].name }; }); },
    getState: function () { return state; },
    // 调试探针：暴露真实几何，供 scripts/diag-*.js 判断"律动画到哪里了"
    getGeometry: function () {
      let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, maxSize = 0;
      for (let i = 0; i < photons.length; i++) {
        const p = photons[i];
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.size > maxSize) maxSize = p.size;
      }
      return {
        W: W, H: H, dpr: dpr, backend: backendName,
        bottomPad: Number(P.bottomPad) || 0, stageH: Math.max(240, H - (Number(P.bottomPad) || 0)),
        photonYMin: minY, photonYMax: maxY, photonXMin: minX, photonXMax: maxX, maxPointSize: maxSize,
        canvasRect: (function () { const r = canvas.getBoundingClientRect(); return { top: r.top, h: r.height, w: r.width }; })(),
      };
    },
  };
})();
