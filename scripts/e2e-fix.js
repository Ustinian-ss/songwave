// 端到端验证：搜索野火 → 酷我搜索 → 播放无版权的网易歌 → 自动换源
// 用法：node scripts/e2e-fix.js [port]
const http = require('http');
const WebSocket = require('ws');
const port = Number(process.argv[2] || 9250);

function targets() {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path: '/json/list' }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const page = (await targets()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  ws.on('message', (m) => { const j = JSON.parse(m); if (j.id && pend.has(j.id)) { const q = pend.get(j.id); pend.delete(j.id); j.error ? q.rej(new Error(JSON.stringify(j.error))) : q.res(j.result); } });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  const ev = async (expr, awaitPromise) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r.exceptionDetails) return { __error: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || 'evaluate 失败' };
    return r.result && r.result.value;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log('① 酷我搜索「野火」');
  console.log('   →', await ev("window.songwave.search('野火','kuwo').then(r=>JSON.stringify({ok:r.ok,n:(r.data||[]).length,fallbackFrom:r.fallbackFrom||null,first:(r.data||[])[0]&&(r.data[0].name+' / '+r.data[0].artist)}))", true));

  console.log('② 网易无版权歌（野火-戾格 1981028372）取链');
  console.log('   →', await ev("window.songwave.getPlayUrl({source:'netease',id:1981028372,name:'野火',artist:'戾格',durationMs:232000}).then(r=>JSON.stringify(r))", true));

  console.log('③ 换源候选（排除网易）');
  console.log('   →', await ev("window.songwave.altSources({name:'野火',artist:'戾格',durationMs:232000,excludeSources:['netease']}).then(r=>JSON.stringify({ok:r.ok,n:(r.alternatives||[]).length,list:(r.alternatives||[]).slice(0,4).map(a=>a.source+':'+a.name)}))", true));

  console.log('④ 酷我这条取链（扩展音源脚本失败时走内置原生）');
  console.log('   →', await ev("window.songwave.getPlayUrl({source:'kuwo',id:'239211505',extKey:'kw',name:'野火',artist:'戾格',durationMs:232000}).then(r=>JSON.stringify({ok:r.ok,via:r.via,warn:r.warn||'',err:r.error||'',urlHead:(r.url||'').slice(0,48)}))", true));

  console.log('⑤ 完整界面路径：输入野火 → 选酷我 → 点搜索');
  await ev("(()=>{const i=document.getElementById('search-input');i.value='野火';const c=document.querySelector('#src-chips .chip[data-src=\"kuwo\"]');if(c)c.click();document.getElementById('search-btn').click();return 'clicked'})()");
  await wait(6000);
  console.log('   选中音源 =', await ev("(document.querySelector('#src-chips .chip.active')||{}).textContent"));
  console.log('   结果条数 =', await ev("document.querySelectorAll('#results .track').length"));
  console.log('   首条标注 =', await ev("(document.querySelector('#results .track .t-src')||{}).textContent"));
  console.log('   状态栏 =', await ev("(document.getElementById('status')||{}).textContent"));

  console.log('⑥ 点第一条播放，看是否真的出声');
  await ev("(()=>{const r=document.querySelector('#results .track');if(r)r.click();return 'clicked'})()");
  await wait(9000);
  console.log('   audio.src =', await ev("(document.querySelector('audio').src||'').slice(0,70)"));
  console.log('   播放状态  =', await ev("(()=>{const a=document.querySelector('audio');return JSON.stringify({paused:a.paused,currentTime:+a.currentTime.toFixed(2),duration:+(a.duration||0).toFixed(1),error:a.error?a.error.code:null,readyState:a.readyState})})()"));
  console.log('   状态栏 =', await ev("(document.getElementById('status')||{}).textContent"));

  console.log('⑦ 完整复现用户场景：网易搜索野火 → 点「野火-戾格」(无版权) → 应自动换源并出声');
  await ev("(()=>{const i=document.getElementById('search-input');i.value='野火';const c=document.querySelector('#src-chips .chip[data-src=\"netease\"]');if(c)c.click();document.getElementById('search-btn').click();return 1})()");
  await wait(6000);
  console.log('   音源 =', await ev("(document.querySelector('#src-chips .chip.active')||{}).textContent"),
    '| 首条 =', await ev("(()=>{const t=document.querySelector('#results .track');return t?t.textContent.replace(/[⤓＋]/g,''):''})()"));
  await ev("(()=>{const r=document.querySelector('#results .track');if(r)r.click();return 1})()");
  for (const s of [4, 8, 14]) {
    await wait(s * 1000 - (s === 4 ? 0 : 4000));
    console.log('   +' + s + 's →', await ev("(()=>{const a=document.querySelector('audio');return JSON.stringify({src:(a.src||'').slice(0,42),paused:a.paused,t:+a.currentTime.toFixed(2),dur:+(a.duration||0).toFixed(1),err:a.error?a.error.code:null,status:(document.getElementById('status')||{}).textContent})})()"));
  }
  ws.close(); process.exit(0);
})().catch((e) => { console.error('E2E 失败:', e.message); process.exit(1); });
