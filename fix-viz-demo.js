// v2.0.5：可视化在「无音频信号」时自动回到演示动画，避免地形冻结
const fs = require('fs');
const p = 'app/engine.js';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// 1) state 增加静音计时
const oldState = "    beat: 0, time: 0, hue: THEMES.deepsea.hue, _lastBeat: 0,";
const newState = "    beat: 0, time: 0, hue: THEMES.deepsea.hue, _lastBeat: 0,\n    silentFor: 0,   // 连续无信号时长（秒）：超过阈值就回到演示动画，避免地形冻住";
if (!s.includes(oldState)) { console.log('!! state 锚点未找到'); process.exit(1); }
s = s.replace(oldState, newState);

// 2) updateAudio 里累计静音时长
const oldUpd = '  function updateAudio(dt) {\n    if (!analyser || !freqData) return;\n    analyser.getByteFrequencyData(freqData);';
const newUpd = [
  '  function updateAudio(dt) {',
  '    if (!analyser || !freqData) return;',
  '    analyser.getByteFrequencyData(freqData);',
].join('\n');
if (!s.includes(oldUpd)) { console.log('!! updateAudio 锚点未找到'); process.exit(1); }
s = s.replace(oldUpd, newUpd);

// 在 updateAudio 末尾（state.audioLevel 赋值后）累计静音
const oldLevel = '    state.audioLevel =';
const idx = s.indexOf(oldLevel);
if (idx < 0) { console.log('!! audioLevel 未找到'); process.exit(1); }
// 找该函数体的结束（下一个 "\n  }\n"）
const fnEnd = s.indexOf('\n  }\n', idx);
if (fnEnd < 0) { console.log('!! updateAudio 结尾未找到'); process.exit(1); }
const inject = [
  '',
  '    // 无信号计时：静音超过 2.5s 就认为“没有在放声音”，改用演示动画（防止画面像死了一样）',
  '    if (state.audioOn && state.audioLevel < 0.01) state.silentFor += dt;',
  '    else state.silentFor = 0;',
].join('\n');
s = s.slice(0, fnEnd) + inject + s.slice(fnEnd);

// 3) 统一的“是否用演示动画”判断
const oldThemeFn = '  function theme() {';
const helper = [
  '  /** 当前是否应该走演示动画：没有音频源，或有源但连续静音 */',
  '  function useDemo() { return !state.audioOn || state.silentFor > 2.5; }',
  '',
  oldThemeFn,
].join('\n');
if (!s.includes(oldThemeFn)) { console.log('!! theme 锚点未找到'); process.exit(1); }
s = s.replace(oldThemeFn, helper);

// 4) 光子能量：演示/真实切换
const oldPhotons = '      const te = state.audioOn ? bandEnergy(p.r) : demoEnergy(p.r, state.time * 0.6);';
const newPhotons = '      const dem = useDemo();\n      const te = dem ? demoEnergy(p.r, state.time * 0.6) : bandEnergy(p.r);';
if (!s.includes(oldPhotons)) { console.log('!! 光子能量锚点未找到'); process.exit(1); }
s = s.replace(oldPhotons, newPhotons);

// 5) 光子闪烁判断
const oldFlash = '      if (state.audioOn) {\n        if (state.beat > 0.3) p.flash = Math.max(p.flash, state.beat);\n      } else {';
const newFlash = '      if (!dem) {\n        if (state.beat > 0.3) p.flash = Math.max(p.flash, state.beat);\n      } else {';
if (!s.includes(oldFlash)) { console.log('!! 闪烁锚点未找到'); process.exit(1); }
s = s.replace(oldFlash, newFlash);

// 6) 频谱柱：静音时用演示数据画，别整块不画
const oldSpec = '    if (!freqData || state.audioLevel < 0.02) return;';
const newSpec = '    if (!freqData) return;\n    const demSpec = useDemo();   // 没有信号时用演示频谱，保持画面动起来';
if (!s.includes(oldSpec)) { console.log('!! 频谱入口锚点未找到'); process.exit(1); }
s = s.replace(oldSpec, newSpec);

const oldSpecV = '      const idx = Math.floor(Math.pow(i / bars, 1.5) * freqData.length * 0.6);\n      const v = freqData[idx] / 255;';
const newSpecV = [
  '      const idx = Math.floor(Math.pow(i / bars, 1.5) * freqData.length * 0.6);',
  '      const v = demSpec',
  '        ? demoEnergy(i / Math.max(1, bars - 1), state.time * 0.6)',
  '        : freqData[idx] / 255;',
].join('\n');
if (!s.includes(oldSpecV)) { console.log('!! 频谱取值锚点未找到'); process.exit(1); }
s = s.replace(oldSpecV, newSpecV);

fs.writeFileSync(p, s);
console.log('engine.js：无信号时自动回到演示动画 ✅');
