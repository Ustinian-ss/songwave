// CDP 实测 v2：用截图对比 + 计算样式排查「地形不动」
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const http = require('http');
const LOG = 'F:/projects/songwave/cdp-viz2.log';
const log = (m) => fs.appendFileSync(LOG, m + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpGet = (url) => new Promise((res, rej) => http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej));

async function main() {
  fs.writeFileSync(LOG, '');
  const out = fs.openSync('F:/projects/songwave/cdp-app-viz2.log', 'a');
  const child = spawn('F:/projects/songwave/dist/win-unpacked/声浪 SongWave.exe', ['--remote-debugging-port=9226'], { detached: true, stdio: ['ignore', out, out] });
  child.unref();
  let target = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try { const l = JSON.parse(await httpGet('http://127.0.0.1:9226/json/list')); target = l.find((t) => t.type === 'page' && /index\.html/.test(t.url || '')); if (target) break; } catch (e) {}
  }
  if (!target) { log('!! 未连上'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => ws.on('open', r));
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
  await send('Runtime.enable');
  await send('Page.enable');

  log('=== 样式检查（画面是否被遮挡/透明） ===');
  log('body.className = ' + JSON.stringify(await ev('document.body.className')));
  log('#stage opacity = ' + await ev("getComputedStyle(document.getElementById('stage')).opacity"));
  log('#stage display = ' + await ev("getComputedStyle(document.getElementById('stage')).display"));
  log('#stage 尺寸 = ' + await ev("(function(){var c=document.getElementById('stage');return c.width+'x'+c.height+' (css '+(c.clientWidth||0)+'x'+(c.clientHeight||0)+')';})()"));
  log('#we-bg 是否隐藏 = ' + await ev("document.getElementById('we-bg').classList.contains('hidden')"));
  log('canvas 数量 = ' + await ev("document.querySelectorAll('canvas').length"));
  log('第二个 canvas(粒子层) 尺寸 = ' + await ev("(function(){var c=document.querySelectorAll('canvas')[1];return c?(c.width+'x'+c.height):'(无)';})()"));
  log('渲染后端 = ' + await ev("(window.SongLife&&window.SongLife.backend)||'(未知)'"));

  log('=== 截图对比（合成后的真实画面） ===');
  const shot = async (tag) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const data = (r.result && r.result.data) || '';
    const h = crypto.createHash('md5').update(data).digest('hex').slice(0, 12);
    log(tag + ' 截图哈希: ' + h + ' | 大小: ' + data.length);
    return h;
  };
  const h1 = await shot('t0');
  await sleep(2000);
  const h2 = await shot('t+2s');
  await sleep(2000);
  const h3 = await shot('t+4s');
  log(h1 !== h2 || h2 !== h3 ? '✅ 画面在动' : '❌ 画面冻结');
  log('=== 结束 ===');
  ws.close(); process.exit(0);
}
main().catch((e) => { log('异常: ' + ((e && e.stack) || e)); process.exit(1); });
