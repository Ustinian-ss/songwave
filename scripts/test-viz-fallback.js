// 回归测试：引擎必须具备「无信号时回到演示动画」的逻辑（v2.0.5 修复地形冻结）
'use strict';
const fs = require('fs');
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.error('  ✘', n, d || ''); } };
const s = fs.readFileSync('app/engine.js', 'utf8');
check('有静音计时字段 silentFor', /silentFor: 0/.test(s));
check('有 useDemo() 判断', /function useDemo\(\)/.test(s));
check('静音计时会累加', /state\.silentFor \+= dt/.test(s));
check('光子能量按 useDemo 切换', /const dem = useDemo\(\);/.test(s));
check('频谱柱无信号时仍绘制（去掉低电平早退）', !/state\.audioLevel < 0\.02\) return;/.test(s));
check('频谱取值走演示数据', /demSpec\s*\n?\s*\?/.test(s) || /const demSpec = useDemo\(\)/.test(s));
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
