// 声浪 SongWave · preload 接口一致性测试
// 目的：渲染层调用的每一个 window.songwave.* / window.winCtl.* 都必须在 preload 里真的暴露
// （v2.0.0 曾出现「渲染层调用了接口、preload 没暴露」导致功能静默失效，此测试防止再次发生）
// 用法：node scripts/test-preload-api.js
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

const root = path.join(__dirname, '..');
const preloadSrc = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');

function exposedInPreload(ns) {
  // 抓取 exposeInMainWorld('<ns>', { ... }) 里的键名
  const m = preloadSrc.match(new RegExp("exposeInMainWorld\\('" + ns + "'[\\s\\S]*?\\n\\}\\);"));
  if (!m) return new Set();
  const body = m[0];
  const keys = new Set();
  const re = /^\s{2}([A-Za-z0-9_]+)\s*:/gm;
  let x;
  while ((x = re.exec(body))) keys.add(x[1]);
  return keys;
}

function usedInRenderer(ns) {
  const files = fs.readdirSync(path.join(root, 'app')).filter((f) => /\.js$/.test(f));
  const used = new Set();
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(root, 'app', f), 'utf8');
    const re = new RegExp('window\\.' + ns + '\\.([A-Za-z0-9_]+)', 'g');
    let m;
    while ((m = re.exec(src))) used.add(m[1]);
  });
  return used;
}

(async () => {
  console.log('— preload 暴露 vs 渲染层调用 —');
  for (const ns of ['songwave', 'winCtl']) {
    const exposed = exposedInPreload(ns);
    const used = usedInRenderer(ns);
    const missing = Array.from(used).filter((k) => !exposed.has(k));
    console.log('  ' + ns + '：暴露 ' + exposed.size + ' 个，渲染层用到 ' + used.size + ' 个');
    check(ns + ' 无「调用了但没暴露」的接口', missing.length === 0, '缺失: ' + missing.join(', '));
  }

  // 每个 ipcRenderer.invoke 的通道，主进程都要有对应 handler
  console.log('\n— IPC 通道 vs 主进程 handler —');
  const invokeChannels = [];
  const invokeRe = /ipcRenderer\.invoke\('([^']+)'/g;
  let m;
  while ((m = invokeRe.exec(preloadSrc))) invokeChannels.push(m[1]);
  const handlers = new Set();
  const hRe = /ipcMain\.handle\('([^']+)'/g;
  while ((m = hRe.exec(mainSrc))) handlers.add(m[1]);
  const noHandler = Array.from(new Set(invokeChannels)).filter((c) => !handlers.has(c));
  console.log('  invoke 通道 ' + new Set(invokeChannels).size + ' 个，主进程 handle ' + handlers.size + ' 个');
  check('所有 invoke 通道都有 handler', noHandler.length === 0, '缺 handler: ' + noHandler.join(', '));

  // 主进程 send 的事件，preload 都要有监听（避免推了没人收）
  console.log('\n— 主进程推送 vs preload 监听 —');
  const sentEvents = [];
  const sendRe = /webContents\.send\('([^']+)'/g;
  while ((m = sendRe.exec(mainSrc))) sentEvents.push(m[1]);
  const listened = new Set();
  const lRe = /ipcRenderer\.on\('([^']+)'/g;
  while ((m = lRe.exec(preloadSrc))) listened.add(m[1]);
  const unhandled = Array.from(new Set(sentEvents)).filter((e) => !listened.has(e));
  console.log('  推送事件 ' + new Set(sentEvents).size + ' 个，preload 监听 ' + listened.size + ' 个');
  check('推送事件都有监听（或为窗口内部事件）', unhandled.length === 0, '未监听: ' + unhandled.join(', '));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
