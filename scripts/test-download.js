// 声浪 SongWave · 下载模块离线测试（本地 HTTP 服务器，无需网络/Electron）
// 用法：node scripts/test-download.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { downloadFile, sanitizeFilename, isValidUrl, uniquePath } = require('../src/download');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'songwave-dl-'));
  const good = () => ({ ok: false, message: '不该走到这里' });

  // 1) 文件名清理
  check('清理非法字符', sanitizeFilename('a/b\\c:d*e?f"g<h>i|j') === 'a_b_c_d_e_f_g_h_i_j');
  check('控制字符被清理', sanitizeFilename('x\u0000y\u0007z') === 'x_y_z');
  check('空名回退', sanitizeFilename('   ') === 'download');
  check('超长截断', sanitizeFilename('a'.repeat(500)).length <= 120);

  // 2) URL 白名单
  check('http 合法', isValidUrl('http://a.com/x.mp3') === true);
  check('https 合法', isValidUrl('https://a.com/x.mp3') === true);
  check('file 拒绝', isValidUrl('file:///c:/x.mp3') === false);
  check('ftp 拒绝', isValidUrl('ftp://a.com/x') === false);
  check('乱码拒绝', isValidUrl('not a url') === false);

  // 3) 重名自动编号
  const dir = path.join(tmp, 'uniq');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.mp3'), 'x');
  fs.writeFileSync(path.join(dir, 'a (1).mp3'), 'x');
  check('重名编号到 (2)', path.basename(uniquePath(dir, 'a.mp3')) === 'a (2).mp3');

  // 4) 正常下载（含进度回调）
  const payload = crypto.randomBytes(256 * 1024);
  const srv1 = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length });
    res.end(payload);
  });
  const dlDir = path.join(tmp, 'dl');
  const progresses = [];
  try {
    const job = downloadFile(`http://127.0.0.1:${srv1.address().port}/song.mp3`, dlDir, {
      filename: '测试 歌曲.mp3',
      onProgress: (p) => progresses.push(p),
    });
    const r = await job.promise;
    check('下载成功返回路径', r.filePath === path.join(dlDir, '测试 歌曲.mp3'));
    check('字节数与源一致', r.bytes === payload.length);
    check('文件已落盘', fs.statSync(r.filePath).size === payload.length);
    check('进度事件 ≥ 1', progresses.length >= 1);
    check('进度 total 正确', progresses.every((p) => p.total === payload.length));
    check('进度 loaded 不超 total', progresses.every((p) => p.loaded <= p.total));
    check('最终进度 100%', progresses[progresses.length - 1].percent === 100);
  } catch (e) {
    check('正常下载不抛错', false, e.message);
  } finally {
    srv1.close();
  }

  // 5) 重定向跟随
  const body = Buffer.from('redirected-content');
  const srvB = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  const srvA = await startServer((req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${srvB.address().port}/final.mp3` });
    res.end();
  });
  try {
    const job = downloadFile(`http://127.0.0.1:${srvA.address().port}/a`, path.join(tmp, 'redir'), { filename: 'r.mp3' });
    const r = await job.promise;
    check('302 重定向跟随成功', r.bytes === body.length);
  } catch (e) {
    check('302 重定向跟随成功', false, e.message);
  } finally {
    srvA.close(); srvB.close();
  }

  // 6) 取消下载（先等首个进度事件再取消）
  const big = crypto.randomBytes(8 * 1024 * 1024);
  const srvBig = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Length': big.length });
    res.write(big.slice(0, 4096));
    const timer = setInterval(() => {
      try { res.write(big.slice(0, 4096)); } catch (e) { clearInterval(timer); }
    }, 5);
    res.on('close', () => clearInterval(timer));
  });
  try {
    const cancelDir = path.join(tmp, 'cancel');
    const job = downloadFile(`http://127.0.0.1:${srvBig.address().port}/big.mp3`, cancelDir, {
      filename: 'big.mp3',
      onProgress: () => job.cancel(),
    });
    const err = await job.promise.then(() => null, (e) => e);
    check('取消后 promise 以 ECANCELED 拒绝', err && err.code === 'ECANCELED', err && err.message);
    const leftovers = fs.existsSync(cancelDir) ? fs.readdirSync(cancelDir) : [];
    check('取消后无残留文件', leftovers.length === 0, leftovers.join(','));
  } finally {
    srvBig.close();
  }

  // 7) 非法 URL
  const bad = await downloadFile('file:///c:/x.mp3', tmp, {}).promise.then(() => null, (e) => e);
  check('非法 URL 拒绝', bad && bad.code === 'EBADURL');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('测试运行异常:', e);
  process.exit(1);
});