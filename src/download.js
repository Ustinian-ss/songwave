// 声浪 SongWave · 下载模块（纯 Node，不依赖 Electron，便于离线测试）
// 支持：http/https 流式下载、跟随重定向、进度回调、取消（删除半成品）、重名自动编号
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const MAX_FILENAME = 120;
const MAX_REDIRECTS = 8;

/**
 * 清理文件名（去掉 Windows 非法字符、控制字符、超长截断）
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILENAME)
    .trim();
  return cleaned || 'download';
}

/**
 * 只允许 http/https
 * @param {string} u
 * @returns {boolean}
 */
function isValidUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/**
 * 目标路径去重：x.mp3 -> x (1).mp3 -> x (2).mp3 ...
 * @param {string} dir
 * @param {string} filename
 * @returns {string}
 */
function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let p = path.join(dir, filename);
  let i = 1;
  while (fs.existsSync(p)) {
    p = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return p;
}

function requestOnce(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (SongWave/0.5)' } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('重定向次数过多'));
        const next = new URL(res.headers.location, url).toString();
        return resolve(requestOnce(next, redirectsLeft - 1));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + status));
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('请求超时')));
  });
}

function makeCanceled() {
  const err = new Error('下载已取消');
  err.code = 'ECANCELED';
  return err;
}

/**
 * 开始一个下载任务
 * @param {string} url 仅 http/https
 * @param {string} destDir 目标目录（不存在会自动创建）
 * @param {object} [opts]
 * @param {string} [opts.filename] 文件名（默认 download）
 * @param {(p: {loaded:number, total:number, percent:number}) => void} [opts.onProgress]
 * @returns {{ promise: Promise<{filePath:string, bytes:number}>, cancel: () => void }}
 */
function downloadFile(url, destDir, opts = {}) {
  if (!isValidUrl(url)) {
    const err = new Error('不支持的下载地址（仅 http/https）');
    err.code = 'EBADURL';
    return { promise: Promise.reject(err), cancel() {} };
  }
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const filename = opts.filename ? sanitizeFilename(opts.filename) : 'download';
  fs.mkdirSync(destDir, { recursive: true });
  const filePath = uniquePath(destDir, filename);
  const partialPath = filePath + '.part';

  let canceled = false;
  let resRef = null;
  let rejectRef = null;
  let settled = false;

  const promise = new Promise((resolve, reject) => {
    rejectRef = reject;
    const failOnce = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    requestOnce(url, MAX_REDIRECTS)
      .then((res) => {
        if (canceled) { res.destroy(); return failOnce(makeCanceled()); }
        resRef = res;
        const total = Number(res.headers['content-length']) || 0;
        let loaded = 0;
        const ws = fs.createWriteStream(partialPath);
        res.on('data', (chunk) => {
          if (canceled) {
            res.destroy();
            ws.destroy();
            return;
          }
          loaded += chunk.length;
          onProgress({
            loaded,
            total,
            percent: total > 0 ? Math.round((loaded / total) * 100) : 0,
          });
        });
        ws.on('error', (e) => { res.destroy(); failOnce(e); });
        res.on('error', (e) => { ws.destroy(); failOnce(e); });
        res.pipe(ws);
        ws.on('finish', () => {
          if (canceled || settled) return;
          try {
            fs.renameSync(partialPath, filePath);
          } catch (e) {
            return failOnce(e);
          }
          settled = true;
          resolve({ filePath, bytes: loaded });
        });
      })
      .catch((e) => failOnce(canceled ? makeCanceled() : e));
  });

  return {
    promise,
    cancel() {
      if (canceled) return;
      canceled = true;
      if (resRef) resRef.destroy();
      try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath); } catch (e) { /* ignore */ }
      // 关键：主动让 promise 拒绝，否则取消后永久挂起
      if (rejectRef && !settled) {
        settled = true;
        rejectRef(makeCanceled());
      }
    },
  };
}

module.exports = { downloadFile, sanitizeFilename, isValidUrl, uniquePath };