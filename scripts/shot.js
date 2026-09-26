// CDP 截图：node scripts/shot.js <port> <out.png> [waitMs]
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9231);
const out = process.argv[3] || 'shot.png';
const wait = Number(process.argv[4] || 3000);

function targets() {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path: '/json/list' }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const list = await targets();
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('没有找到 page target: ' + JSON.stringify(list.map((t) => t.type)));
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let id = 0;
  const pend = new Map();
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  ws.on('message', (m) => {
    const msg = JSON.parse(m);
    if (msg.id && pend.has(msg.id)) { const p = pend.get(msg.id); pend.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await new Promise((r) => setTimeout(r, wait));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  // 顺带把关键几何读回来，便于核对
  const ev = await send('Runtime.evaluate', {
    expression: `(() => { const p = document.getElementById('player'); const r = p ? p.getBoundingClientRect() : null; return JSON.stringify({ winH: window.innerHeight, playerTop: r ? Math.round(r.top) : null, playerH: r ? Math.round(r.height) : null, bottomPad: window.SongLife && SongLife.getParam ? SongLife.getParam('bottomPad') : null }); })()`,
    returnByValue: true,
  });
  console.log('几何:', ev.result && ev.result.value);
  console.log('已保存', out, fs.statSync(out).size, 'bytes');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('截图失败:', e.message); process.exit(1); });
