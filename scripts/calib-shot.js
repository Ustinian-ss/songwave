// 校准实验：改 bottomPad 前后各截一张，用来核对「引擎坐标 → 屏幕像素」的映射
// 用法：node scripts/calib-shot.js <port> [newPad]
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9234);
const newPad = Number(process.argv[3] || 400);
const paramName = process.argv[4] || "bottomPad";

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
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  ws.on('message', (m) => { const j = JSON.parse(m); if (j.id && pend.has(j.id)) { const q = pend.get(j.id); pend.delete(j.id); j.error ? q.rej(new Error(JSON.stringify(j.error))) : q.res(j.result); } });
  await new Promise((r) => ws.on('open', r));
  await send('Page.enable'); await send('Runtime.enable');
  const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true }).then((x) => x.result && x.result.value);
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(name, Buffer.from(s.data, 'base64'));
    console.log('已保存', name, '几何:', await ev('JSON.stringify(SongLife.getGeometry())'));
  };
  const before = await ev('SongLife.getParam(' + JSON.stringify(paramName) + ')');
  await shot('calib-a.png');
  // 注意：paramName 必须作为字面量拼进被求值的表达式（页面里没有 paramName 变量）
  await ev('SongLife.setParam(' + JSON.stringify(paramName) + ', ' + JSON.stringify(newPad) + ')');
  console.log('  ↳ 设置 ' + paramName + ' =', await ev('SongLife.getParam(' + JSON.stringify(paramName) + ')'));
  await new Promise((r) => setTimeout(r, 1200));
  await shot('calib-b.png');
  await ev('SongLife.setParam(' + JSON.stringify(paramName) + ', ' + JSON.stringify(before) + ')');
  console.log('已恢复 ' + paramName + ' =', before);
  ws.close(); process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
