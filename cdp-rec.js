// CDP 实测：推荐歌单是否渲染成封面网格
const { spawn } = require('child_process');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');

const LOG = 'F:/projects/songwave/cdp-rec.log';
const log = (m) => fs.appendFileSync(LOG, m + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpGet = (url) => new Promise((res, rej) => http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej));

async function main() {
  fs.writeFileSync(LOG, '');
  const out = fs.openSync('F:/projects/songwave/cdp-app2.log', 'a');
  const child = spawn('F:/projects/songwave/dist/win-unpacked/声浪 SongWave.exe', ['--remote-debugging-port=9223'], { detached: true, stdio: ['ignore', out, out] });
  child.unref();
  let target = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const list = JSON.parse(await httpGet('http://127.0.0.1:9223/json/list'));
      target = list.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
      if (target) break;
    } catch (e) { /* wait */ }
  }
  if (!target) { log('!! 未连上'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => ws.on('open', r));
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : null;
  };
  await send('Runtime.enable');

  log('=== 打开发现页 ===');
  await ev("document.querySelectorAll('#rail .rail-btn').forEach(b=>{ if(b.dataset.view==='discover') b.click(); })");
  await sleep(4000);
  log('榜单容器子节点: ' + await ev("document.getElementById('chart-list').children.length"));

  log('=== 点击「✨ 推荐歌单」 ===');
  await ev("document.getElementById('btn-recommend').click()");
  await sleep(7000);
  log('grid 容器数量: ' + await ev("document.querySelectorAll('#chart-list .pl-grid').length"));
  log('卡片数量: ' + await ev("document.querySelectorAll('#chart-list .pl-card').length"));
  log('封面图数量: ' + await ev("document.querySelectorAll('#chart-list .pl-card img').length"));
  log('播放量角标数量: ' + await ev("document.querySelectorAll('#chart-list .pl-count').length"));
  log('前 3 张卡片文本: ' + await ev("Array.from(document.querySelectorAll('#chart-list .pl-card')).slice(0,3).map(c=>c.textContent.trim()).join(' | ')"));
  log('首个封面 URL: ' + await ev("(document.querySelector('#chart-list .pl-card img')||{}).src || '(无)'"));

  log('=== 点击第 1 张卡片（载入歌单） ===');
  await ev("document.querySelectorAll('#chart-list .pl-card')[0] && document.querySelectorAll('#chart-list .pl-card')[0].click()");
  await sleep(9000);
  log('歌单详情头: ' + await ev("(document.querySelector('#chart-songs .pl-head')||{}).textContent || '(无)'"));
  log('歌曲行数: ' + await ev("document.querySelectorAll('#chart-songs .track').length"));
  log('状态栏: ' + await ev("document.getElementById('status').textContent"));
  log('=== 结束 ===');
  ws.close();
  process.exit(0);
}
main().catch((e) => { log('异常: ' + ((e && e.stack) || e)); process.exit(1); });
