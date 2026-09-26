// 通过 CDP 远程调试真实应用，复现「切换歌曲后还是放那一首」
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');

const LOG = 'F:/projects/songwave/cdp-run.log';
const log = (m) => { fs.appendFileSync(LOG, m + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function main() {
  fs.writeFileSync(LOG, '');
  // 1) 以远程调试端口启动打包版
  const exe = 'F:/projects/songwave/dist/win-unpacked/声浪 SongWave.exe';
  const out = fs.openSync('F:/projects/songwave/cdp-app.log', 'a');
  const child = spawn(exe, ['--remote-debugging-port=9222'], { detached: true, stdio: ['ignore', out, out] });
  child.unref();
  log('已启动应用（远程调试 9222）pid ' + child.pid);

  // 2) 等端口就绪
  let target = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const list = JSON.parse(await httpGet('http://127.0.0.1:9222/json/list'));
      target = list.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
      if (target) break;
    } catch (e) { /* 还没起来 */ }
  }
  if (!target) { log('!! 未能连上调试端口'); process.exit(1); }
  log('已连接页面: ' + target.url);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((r) => ws.on('open', r));
  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { error: JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Runtime.enable');
  log('=== 环境 ===');
  log('playlist 长度: ' + await evalJs('document.getElementById("playlist") ? document.getElementById("playlist").children.length : -1'));
  log('audio.src: ' + await evalJs('document.getElementById("audio").src || "(空)"'));

  // 3) 搜索
  log('=== 执行搜索：周杰伦 ===');
  await evalJs('document.getElementById("search-input").value = "周杰伦"; document.getElementById("search-btn").click();');
  await sleep(6000);
  const n = await evalJs('document.getElementById("results").children.length');
  log('搜索结果条数: ' + n);
  const titles = await evalJs('Array.from(document.getElementById("results").children).slice(0,5).map(r=>r.textContent.slice(0,24)).join(" | ")');
  log('前 5 条: ' + titles);

  // 4) 点第 1 首
  log('=== 点击第 1 首 ===');
  await evalJs('document.getElementById("results").children[0].click()');
  await sleep(5000);
  log('audio.src = ' + await evalJs('document.getElementById("audio").src'));
  log('now-title = ' + await evalJs('document.getElementById("now-title").textContent'));
  log('playlist 长度 = ' + await evalJs('document.getElementById("playlist").children.length'));

  // 5) 点第 2 首（关键：src 是否变化）
  log('=== 点击第 2 首 ===');
  await evalJs('document.getElementById("results").children[1].click()');
  await sleep(5000);
  log('audio.src = ' + await evalJs('document.getElementById("audio").src'));
  log('now-title = ' + await evalJs('document.getElementById("now-title").textContent'));
  log('状态栏 = ' + await evalJs('document.getElementById("status").textContent'));

  // 6) 再点第 3 首
  log('=== 点击第 3 首 ===');
  await evalJs('document.getElementById("results").children[2] ? document.getElementById("results").children[2].click() : null');
  await sleep(5000);
  log('audio.src = ' + await evalJs('document.getElementById("audio").src'));
  log('now-title = ' + await evalJs('document.getElementById("now-title").textContent'));
  log('状态栏 = ' + await evalJs('document.getElementById("status").textContent'));
  log('paused = ' + await evalJs('document.getElementById("audio").paused'));
  log('currentTime = ' + await evalJs('document.getElementById("audio").currentTime'));

  ws.close();
  log('=== 结束 ===');
  process.exit(0);
}
main().catch((e) => { log('脚本异常: ' + ((e && e.stack) || e)); process.exit(1); });
