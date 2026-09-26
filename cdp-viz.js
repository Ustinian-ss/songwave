// CDP 实测：可视化地形是否在动（两次采样 canvas 像素，比较哈希）
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const http = require('http');
const LOG = 'F:/projects/songwave/cdp-viz.log';
const log = (m) => fs.appendFileSync(LOG, m + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpGet = (url) => new Promise((res, rej) => http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej));

async function main() {
  fs.writeFileSync(LOG, '');
  const out = fs.openSync('F:/projects/songwave/cdp-app-viz.log', 'a');
  const child = spawn('F:/projects/songwave/dist/win-unpacked/声浪 SongWave.exe', ['--remote-debugging-port=9225'], { detached: true, stdio: ['ignore', out, out] });
  child.unref();
  let target = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try { const l = JSON.parse(await httpGet('http://127.0.0.1:9225/json/list')); target = l.find((t) => t.type === 'page' && /index\.html/.test(t.url || '')); if (target) break; } catch (e) {}
  }
  if (!target) { log('!! 未连上'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => ws.on('open', r));
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
  await send('Runtime.enable');

  const grab = async () => {
    const dataUrl = await ev("(function(){try{var c=document.getElementById('stage');return c.toDataURL('image/png').slice(-2000);}catch(e){return 'ERR:'+e.message}})()");
    return crypto.createHash('md5').update(String(dataUrl)).digest('hex').slice(0, 12);
  };
  log('=== 画面是否在动（默认状态：未播放任何音频） ===');
  const h1 = await grab(); log('t0 采样哈希: ' + h1);
  await sleep(2500);
  const h2 = await grab(); log('t+2.5s 哈希: ' + h2);
  await sleep(2500);
  const h3 = await grab(); log('t+5.0s 哈希: ' + h3);
  log(h1 !== h2 || h2 !== h3 ? '✅ 画面在动（哈希变化）' : '❌ 画面冻结（哈希相同）');

  log('=== 引擎状态 ===');
  log('audioOn = ' + await ev("(window.SongLife&&window.SongLife.getState)?window.SongLife.getState().audioOn:'n/a'"));
  log('audioLevel = ' + await ev("(window.SongLife&&window.SongLife.getState)?window.SongLife.getState().audioLevel:'n/a'"));
  log('silentFor = ' + await ev("(window.SongLife&&window.SongLife.getState)?window.SongLife.getState().silentFor:'n/a'"));
  log('时间 state.time = ' + await ev("(window.SongLife&&window.SongLife.getState)?window.SongLife.getState().time.toFixed(1):'n/a'"));
  log('=== 结束 ===');
  ws.close(); process.exit(0);
}
main().catch((e) => { log('异常: ' + ((e && e.stack) || e)); process.exit(1); });
