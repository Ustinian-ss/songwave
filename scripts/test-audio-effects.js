// 声浪 SongWave · 音效模块测试（离线）
// 用法：node scripts/test-audio-effects.js
'use strict';
const fx = require('../src/audio-effects');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

check('10 段中心频率正确', fx.EQ_FREQS.length === 10 && fx.EQ_FREQS[0] === 31 && fx.EQ_FREQS[9] === 16000, fx.EQ_FREQS.join(','));
check('预设数量 ≥ 7', Object.keys(fx.PRESETS).length >= 7, String(Object.keys(fx.PRESETS).length));
check('每个预设都是 10 段', Object.keys(fx.PRESETS).every((k) => fx.PRESETS[k].length === 10));
check('关闭预设全为 0', fx.gainsForPreset('off').every((v) => v === 0));
check('低音增强的低频为正', fx.gainsForPreset('bass')[0] > 0 && fx.gainsForPreset('bass')[1] > 0);
check('人声增强的中频为正', fx.gainsForPreset('vocal')[4] > 0);
check('未知预设回落 off', fx.gainsForPreset('nonexistent').every((v) => v === 0));
check('增益越界收敛', fx.clampGain(999) === fx.MAX_DB && fx.clampGain(-999) === fx.MIN_DB, String(fx.clampGain(999)));
check('非法增益归零', fx.clampGain('abc') === 0 && fx.clampGain(NaN) === 0);
check('预设列表带中文名', fx.listPresets().every((p) => p.name && p.gains.length === 10));
check('混响参数收敛', fx.reverbImpulseSpec(99, 99).seconds === 6 && fx.reverbImpulseSpec(0, 0).seconds === 0.2);

const norm = fx.normalizeSettings({ enabled: 1, preset: 'rock', gains: [1, 2], reverb: 5, preamp: 50 });
check('normalize：开关布尔化', norm.enabled === true);
check('normalize：预设保留', norm.preset === 'rock');
check('normalize：混响 0~1 收敛', norm.reverb === 1);
check('normalize：preamp 收敛', norm.preamp === fx.MAX_DB);
check('normalize：gains 补齐到 10 段', norm.gains.length === 10 && norm.gains[0] === 1 && norm.gains[1] === 2 && norm.gains[9] === 0);
const norm2 = fx.normalizeSettings({ preset: 'bass' });
check('normalize：无 gains 时按预设填充', norm2.gains[0] === fx.PRESETS.bass[0]);
check('normalize：空输入安全', fx.normalizeSettings(null).gains.length === 10);
check('defaults 可用', fx.defaults().enabled === false && fx.defaults().gains.length === 10);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);