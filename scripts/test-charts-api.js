// 防呆测试：src/charts 导出的是工厂函数，主进程必须用 createCharts() 实例
// （v2.0.3 前曾把工厂当实例用，导致整个「发现页」静默失效）
'use strict';
const fs = require('fs');
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.error('  ✘', n, d || ''); } };

const mod = require('../src/charts');
check('模块导出 createCharts 工厂', typeof mod.createCharts === 'function');
check('模块本身没有 recommend（是工厂而非实例）', typeof mod.recommend === 'undefined', typeof mod.recommend);

const inst = mod.createCharts({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
['list', 'fetchChart', 'recommend', 'fetchPlaylist'].forEach((k) => {
  check('实例具备 ' + k + '()', typeof inst[k] === 'function');
});

const mainSrc = fs.readFileSync('electron/main.js', 'utf8');
check('main.js 使用 createCharts() 实例', /require\('\.\.\/src\/charts'\)\.createCharts\(\)/.test(mainSrc));
check('main.js 不再把工厂当实例直接用', !/const charts = require\('\.\.\/src\/charts'\);\n/.test(mainSrc));

// 渲染层调用到的 charts action 都要在 handler 里被支持
const rendererSrc = fs.readFileSync('app/renderer.js', 'utf8');
const actions = new Set();
let m; const re = /charts\(\{\s*action:\s*'([^']+)'/g;
while ((m = re.exec(rendererSrc))) actions.add(m[1]);
[...actions].forEach((a) => {
  check("主进程支持 action='" + a + "'", new RegExp("'" + a + "'").test(mainSrc));
});
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
