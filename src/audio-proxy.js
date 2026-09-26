// 声浪 SongWave · 本机音频代理（原因为什么需要它）
//
// 可视化的两种取音方式各有硬伤：
//   ① 直接分析 <audio>（createMediaElementSource）：最准，但**跨域且无 CORS 的 CDN**
//      （如 kw-er.kuwo.cn / kw-bj.kuwo.cn）会让 Web Audio 图变成"脏图"——分析数据恒为 0，
//      而且输出会被静音；
//   ② 系统回环（WASAPI loopback）：抓得到"别人的"播放，但 Chromium 的回环**会排除本进程自己
//      的音频**，所以本应用自己放歌时它恒为 0 —— 表现就是"律动没了、一直在演示动画"。
//
// 因此：把在线音频经本机 127.0.0.1 代理一层，并补上 `Access-Control-Allow-Origin: *`，
// 于是 <audio> 变成"带 CORS 的同源式流"→ 直接分析可用、声音照常、进度拖动也不受影响。
'use strict';

const http = require('http');

function createAudioProxy() {
  let server = null;
  let port = 0;
  const starting = [];

  function start() {
    if (server) return Promise.resolve({ port: port });
    return new Promise((resolve, reject) => {
      const s = http.createServer(handle);
      s.on('error', (e) => reject(e));
      s.listen(0, '127.0.0.1', () => {
        server = s;
        port = s.address().port;
        starting.forEach((f) => f());
        resolve({ port: port });
      });
    });
  }

  async function handle(req, res) {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/a') { res.writeHead(404); res.end(); return; }
    const target = u.searchParams.get('u');
    if (!target || !/^https?:\/\//i.test(target)) { res.writeHead(400); res.end('bad url'); return; }
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (req.headers.range) headers.Range = req.headers.range;
    let upstream;
    try {
      upstream = await fetch(target, { headers: headers, redirect: 'follow' });
    } catch (e) {
      res.writeHead(502); res.end('upstream failed'); return;
    }
    const out = {
      'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
      'Cache-Control': 'no-store',
    };
    const len = upstream.headers.get('content-length');
    if (len) out['Content-Length'] = len;
    const cr = upstream.headers.get('content-range');
    if (cr) out['Content-Range'] = cr;
    res.writeHead(upstream.status, out);
    if (!upstream.body) { res.end(); return; }
    // Node 的可读流 → 响应流（大文件也不会撑爆内存）
    const reader = upstream.body.getReader ? upstream.body.getReader() : null;
    if (!reader) { res.end(); return; }
    const pump = () => reader.read().then(({ done, value }) => {
      if (done) { res.end(); return; }
      if (!res.write(Buffer.from(value))) { res.once('drain', pump); return; }
      return pump();
    }).catch(() => { try { res.end(); } catch (e) { /* ignore */ } });
    req.on('close', () => { try { reader.cancel(); } catch (e) { /* ignore */ } });
    pump();
  }

  return {
    start: start,
    /** 把上游地址包装成本机地址（服务未启动时返回原地址） */
    wrap(url) {
      if (!server || !url) return url;
      if (!/^https?:\/\//i.test(url)) return url;   // file:// 等原样返回
      return 'http://127.0.0.1:' + port + '/a?u=' + encodeURIComponent(url);
    },
    get port() { return port; },
  };
}

module.exports = { createAudioProxy };
