// CDP 精确探测：推荐歌单为什么没渲染
const { spawn } = require('child_process');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');
const LOG = 'F:/projects/songwave/cdp-probe.log';
const log = (m) => fs.appendFileSync(LOG, m + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpGet = (url) => new Promise((res, rej) => http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej));

async function main() {
  fs.writeFileSync(LOG, '');
  const out = fs.openSync('F:/projects/songwave/cdp-app3.log', 'a');
  const child = spawn('F:/projects/songwave/dist/win-unpacked/声浪 SongWave.exe', ['--remote-debugging-port=9224'], { detached: true, stdio: ['ignore', out, out] });
  child.unref();
  let target = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try { const l = JSON.parse(await httpGet('http://127.0.0.1:9224/json/list')); target = l.find((t) => t.type === 'page' && /index\.html/.test(t.url || '')); if (target) break; } catch (e) {}
  }
  if (!target) { log('!! 未连上'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      errors.push((d && d.exception && d.exception.description) || (d && d.text) || 'unknown');
    }
  });
  await new Promise((r) => ws.on('open', r));
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return 'EXC:' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description);
    return r.result && r.result.result ? r.result.result.value : null;
  };
  await send('Runtime.enable');

  log('typeof window.songwave.charts = ' + await ev('typeof (window.songwave&&window.songwave.charts)'));
  log('直接调用 IPC(action=recommend): ' + await ev("(async()=>{try{const r=await window.songwave.charts({action:'recommend',limit:6});return 'ok items='+(r&&r.items?r.items.length:'?')+' err='+(r&&r.error||'');}catch(e){return 'threw:'+e.message}})()"));
  log('btn-recommend 存在: ' + await ev("!!document.getElementById('btn-recommend')"));
  log('btn-recommend.onclick 已绑定: ' + await ev("typeof (document.getElementById('btn-recommend')||{}).onclick"));

  log('--- 点击后 ---');
  await ev("document.getElementById('btn-recommend').click()");
  await sleep(8000);
  log('chart-list 子节点: ' + await ev("document.getElementById('chart-list').children.length"));
  log('chart-list innerHTML 前 200: ' + JSON.stringify(await ev("document.getElementById('chart-list').innerHTML.slice(0,200)")));
  log('状态栏: ' + await ev("document.getElementById('status').textContent"));
  log('渲染层异常: ' + (errors.length ? errors.slice(0, 3).join(' || ') : '(无)'));
  log('=== 结束 ===');
  ws.close(); process.exit(0);
}
main().catch((e) => { log('脚本异常: ' + ((e && e.stack) || e)); process.exit(1); });
