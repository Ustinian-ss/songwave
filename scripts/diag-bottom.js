// 判断「谁画到了屏幕最底」：读取光环图层像素 + 改 bottomPad 做对照实验
// 用法：node scripts/diag-bottom.js [port]
const http = require('http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9232);

function targets() {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path: '/json/list' }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

const PROBE = `(() => {
  const cv = document.querySelectorAll('canvas');
  const layer = cv[1];
  const g = layer.getContext('2d');
  const d = g.getImageData(0, 0, layer.width, layer.height).data;
  const scale = layer.height / window.innerHeight;
  let lowest = -1, lowestX = -1, count = 0;
  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      const o = (y * layer.width + x) * 4;
      const a = d[o + 3];
      if (a > 40 && Math.max(d[o], d[o + 1], d[o + 2]) > 60) { count++; if (y > lowest) { lowest = y; lowestX = x; } }
    }
  }
  const pl = document.getElementById('player');
  const r = pl ? pl.getBoundingClientRect() : null;
  return JSON.stringify({
    winH: window.innerHeight, dpr: scale,
    bottomPad: window.SongLife.getParam('bottomPad'),
    playerTop: r ? Math.round(r.top) : null,
    layerTouchesBottom: lowest < 0 ? null : Math.round(lowest / scale),
    layerLowestX: lowestX < 0 ? null : Math.round(lowestX / scale),
    paintedPixels: count,
  });
})()`;

(async () => {
  const list = await targets();
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = new Map();
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  ws.on('message', (m) => { const msg = JSON.parse(m); if (msg.id && pend.has(msg.id)) { const p = pend.get(msg.id); pend.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); } });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  const ev = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true }).then((r) => r.result && r.result.value);

  console.log('① 当前状态:', await ev(PROBE));
  const before = await ev('window.SongLife.getParam("bottomPad")');
  await ev('window.SongLife.setParam("bottomPad", 400)');
  await new Promise((r) => setTimeout(r, 900));
  console.log('② bottomPad=400 对照:', await ev(PROBE));
  await ev('window.SongLife.setParam("bottomPad", ' + Number(before) + ')');
  await new Promise((r) => setTimeout(r, 400));
  console.log('③ 已恢复 bottomPad =', before);
  ws.close(); process.exit(0);
})().catch((e) => { console.error('诊断失败:', e.message); process.exit(1); });
