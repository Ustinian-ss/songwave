// 回归测试：坏音源脚本不能打崩进程 / 不能拖死加载
// 用法：node scripts/test-source-resilience.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSourceManager } = require('../src/sources/source-manager');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'songwave-resilience-'));

// ① 正常脚本（立即声明能力）
const GOOD = [
  "const { EVENT_NAMES, on, send } = globalThis.lx;",
  "send(EVENT_NAMES.inited, { sources: { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } });",
  "on(EVENT_NAMES.request, () => Promise.resolve({ url: 'http://mock/x.mp3' }));",
].join('\n');

// ② 加载后异步抛错（模拟 ext-latest：在 .finally 里 throw）
const THROWS_ASYNC = [
  "const { EVENT_NAMES, on, send } = globalThis.lx;",
  "Promise.resolve().then(() => { throw new Error('服务器异常'); });",
  "setTimeout(async () => { await Promise.resolve(); throw new Error('服务器异常-延迟'); }, 30);",
  "on(EVENT_NAMES.request, () => Promise.reject(new Error('noop')));",
].join('\n');

// ③ 永不声明能力（模拟需要联网校验、离线一直不 inited）
const NEVER_INITED = [
  "const { EVENT_NAMES, on, send } = globalThis.lx;",
  "globalThis.lx.request('http://127.0.0.1:1/never', { method: 'get' }, () => {});",
].join('\n');

// ④ 用到浏览器 API（很多脚本会注册 window 错误处理 / 计时器）
const USES_BROWSER_API = [
  "const { EVENT_NAMES, on, send } = globalThis.lx;",
  "window.addEventListener('error', () => {});",
  "document.addEventListener('unhandledrejection', () => {});",
  "setInterval(() => {}, 100000);",
  "send(EVENT_NAMES.inited, { sources: { kg: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } });",
].join('\n');

const files = {
  good: path.join(tmp, 'good.js'),
  throws: path.join(tmp, 'throws.js'),
  never: path.join(tmp, 'never.js'),
  browser: path.join(tmp, 'browser.js'),
};
fs.writeFileSync(files.good, GOOD);
fs.writeFileSync(files.throws, THROWS_ASYNC);
fs.writeFileSync(files.never, NEVER_INITED);
fs.writeFileSync(files.browser, USES_BROWSER_API);

(async () => {
  console.log('— 音源加载健壮性 —');
  const mgr = createSourceManager({ dir: path.join(tmp, 'sources'), initTimeoutMs: 1500 });

  // 通过 addFromFile 注册（会先探测一次）
  const eGood = await mgr.addFromFile(files.good, { name: '正常源' });
  const eBrowser = await mgr.addFromFile(files.browser, { name: '浏览器API源' });
  const eThrows = await mgr.addFromFile(files.throws, { name: '异步抛错源' });
  const eNever = await mgr.addFromFile(files.never, { name: '永不inited源' });

  check('正常脚本探测通过', eGood.ok === true, JSON.stringify(eGood.error));
  check('使用浏览器 API 的脚本也能加载', eBrowser.ok === true, JSON.stringify(eBrowser.error));
  check('异步抛错脚本被标记失败而非崩溃', eThrows.ok === false, JSON.stringify(eThrows.error));
  check('永不 inited 的脚本超时失败', eNever.ok === false && /inited|超时/.test(eNever.error || ''), eNever.error);

  // 并行加载：总耗时不应是各失败脚本超时之和
  const t0 = Date.now();
  const list = await mgr.loadEnabled();
  const total = Date.now() - t0;
  console.log('  并行加载 4 个源用时', total, 'ms');
  check('并行加载（不是串行累加）', total < 3000, '耗时 ' + total + 'ms（串行会是 1.5s×2 以上）');
  check('加载过程没有中断（仍返回全部结果）', list.length === 4, String(list.length));
  const okNames = list.filter((x) => x.source).map((x) => x.entry.name);
  check('可用源包含正常源与浏览器API源', okNames.includes('正常源') && okNames.includes('浏览器API源'), okNames.join(','));
  check('失败源不阻断可用源', okNames.length === 2, okNames.join(','));

  // 注册表回写
  const reg = mgr.list();
  check('探测结果已写回注册表', reg.every((e) => typeof e.ok === 'boolean'), JSON.stringify(reg.map((e) => e.name + ':' + e.ok)));

  // 进程仍存活（关键：坏脚本没有把进程打崩）
  check('进程存活（坏脚本未导致崩溃）', true);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试运行异常（说明存在未兜住的异常）:', e);
  process.exit(1);
});
