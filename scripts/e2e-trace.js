// 追踪 audio 元素事件序列：定位"试听片段结束后报换源失败"的真实触发点
// 用法：node scripts/e2e-trace.js [port]
const http = require('http');
const WebSocket = require('ws');
const port = Number(process.argv[2] || 9254);

function targets() {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path: '/json/list' }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const page = (await targets()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  ws.on('message', (m) => { const j = JSON.parse(m); if (j.id && pend.has(j.id)) { const q = pend.get(j.id); pend.delete(j.id); j.error ? q.rej(new Error(JSON.stringify(j.error))) : q.res(j.result); } });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  const ev = async (e, aw) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: !!aw }); if (r.exceptionDetails) return { __err: r.exceptionDetails.text }; return r.result && r.result.value; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 装事件轨迹
  await ev(`(() => {
    window.__trace = [];
    const a = document.querySelector('audio');
    const t0 = performance.now();
    ['loadstart','loadedmetadata','canplay','play','playing','pause','ended','error','stalled','suspend','emptied','abort','waiting','progress','seeking','seeked'].forEach((n) => {
      a.addEventListener(n, () => window.__trace.push([Math.round(performance.now() - t0), n, +(a.currentTime || 0).toFixed(2), a.error ? a.error.code : null, (a.currentSrc || a.src || '').slice(-14)]));
    });
    return 'traced';
  })()`);
  const markStatus = () => ev(`(() => {
    const s = (document.getElementById('status') || {}).textContent;
    if (!window.__status) window.__status = [];
    const last = window.__status[window.__status.length - 1];
    if (!last || last[1] !== s) window.__status.push([Math.round(performance.now() - (window.__t0 || 0)), s]);
    return s;
  })()`);

  await ev("(()=>{const i=document.getElementById('search-input');i.value='野火';const c=document.querySelector('#src-chips .chip[data-src=\"netease\"]');if(c)c.click();window.__t0=performance.now();document.getElementById('search-btn').click();return 1})()");
  await wait(6000);
  console.log('搜索完成，首条 =', await ev("(()=>{const t=document.querySelector('#results .track');return t?t.textContent.replace(/[⤓＋]/g,''):'(无)'})()"));
  await ev("(()=>{const r=document.querySelector('#results .track');if(r)r.click();window.__t0=performance.now();return 1})()");
  for (let i = 0; i < 8; i++) { await wait(2500); await markStatus(); }
  console.log('\n=== audio 事件轨迹 ===');
  const tr = await ev('JSON.stringify(window.__trace)');
  (JSON.parse(tr || '[]')).forEach((x) => console.log('  t=' + x[0] + 'ms', x[1], 'pos=' + x[2], 'err=' + x[3], 'src…' + x[4]));
  console.log('\n=== 状态栏变化 ===');
  const st = await ev('JSON.stringify(window.__status||[])');
  (JSON.parse(st || '[]')).forEach((x) => console.log('  t=' + x[0] + 'ms  ' + x[1]));
  ws.close(); process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
