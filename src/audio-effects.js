// 声浪 SongWave · 音效参数（纯数据 + 纯函数，便于离线测试）
// 10 段均衡器（ISO 中心频率）+ 预设 + 混响参数
'use strict';

const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const NAMES = {
  off: '关闭（原声）',
  pop: '流行',
  rock: '摇滚',
  classical: '古典',
  vocal: '人声增强',
  bass: '低音增强',
  electronic: '电子',
};

// 每段增益（dB），顺序对应 EQ_FREQS
const PRESETS = {
  off: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pop: [-1, 0, 2, 3, 2, 0, -1, -1, 0, 1],
  rock: [4, 3, 1, -1, -2, -1, 1, 3, 4, 4],
  classical: [3, 2, 1, 0, -1, -1, 0, 1, 2, 3],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  bass: [7, 6, 4, 2, 0, -1, -2, -2, -1, 0],
  electronic: [5, 4, 1, 0, -1, 0, 1, 2, 5, 6],
};

const MIN_DB = -12;
const MAX_DB = 12;

function clampGain(db) {
  const n = Number(db);
  if (!Number.isFinite(n)) return 0;
  return Math.max(MIN_DB, Math.min(MAX_DB, Math.round(n * 10) / 10));
}

/** 取预设的 10 段增益（未知预设回落到 off） */
function gainsForPreset(key) {
  const g = PRESETS[key] || PRESETS.off;
  return g.map(clampGain);
}

function listPresets() {
  return Object.keys(PRESETS).map((k) => ({ key: k, name: NAMES[k] || k, gains: gainsForPreset(k) }));
}

/** 混响脉冲响应参数（渲染层据此合成 IR） */
function reverbImpulseSpec(seconds, decay) {
  const s0 = seconds == null ? 2.4 : Number(seconds);
  const d0 = decay == null ? 2.6 : Number(decay);
  const s = Math.max(0.2, Math.min(6, Number.isFinite(s0) ? s0 : 2.4));
  const d = Math.max(0.5, Math.min(8, Number.isFinite(d0) ? d0 : 2.6));
  return { seconds: s, decay: d, sampleRateHint: 44100 };
}

function defaults() {
  return { enabled: false, preset: 'off', gains: gainsForPreset('off'), reverb: 0, preamp: 0 };
}

/** 归一化用户设置（容错：长度不足补齐、越界收敛） */
function normalizeSettings(input) {
  const base = defaults();
  const s = input && typeof input === 'object' ? input : {};
  const out = {
    enabled: !!s.enabled,
    preset: typeof s.preset === 'string' && PRESETS[s.preset] ? s.preset : base.preset,
    reverb: Math.max(0, Math.min(1, Number(s.reverb) || 0)),
    preamp: clampGain(s.preamp || 0),
    gains: base.gains.slice(),
  };
  if (Array.isArray(s.gains)) {
    for (let i = 0; i < EQ_FREQS.length; i++) {
      out.gains[i] = s.gains[i] == null ? 0 : clampGain(s.gains[i]);
    }
  } else {
    out.gains = gainsForPreset(out.preset);
  }
  return out;
}

module.exports = {
  EQ_FREQS, PRESETS, NAMES, MIN_DB, MAX_DB,
  clampGain, gainsForPreset, listPresets, reverbImpulseSpec, defaults, normalizeSettings,
};