// 声浪 SongWave · 下载队列（并发 / 命名模板 / 按歌单分组 / 歌词与封面嵌入）
// 依赖注入：downloader（默认用 src/download.js）、fs，便于离线测试
'use strict';

const path = require('path');
const fsDefault = require('fs');
const { renderTemplate, groupDirName, writeTagsToFile } = require('./id3');

/**
 * @param {object} opts
 * @param {number} [opts.concurrency=3]
 * @param {Function} [opts.downloadFile] (url, dir, {filename, onProgress}) => {promise, cancel}
 * @param {object} [opts.fs]
 * @param {Function} [opts.fetchBuffer] (url) => Promise<Buffer> 用于取封面/歌词
 */
function createDownloadQueue(opts = {}) {
  const fs = opts.fs || fsDefault;
  const concurrency = Math.max(1, Math.min(8, Number(opts.concurrency) || 3));
  const downloadFile = opts.downloadFile || require('./download').downloadFile;
  const fetchBuffer = opts.fetchBuffer || null;

  const tasks = [];
  const results = [];
  const errors = [];
  let running = 0;
  let canceled = false;
  let seq = 0;
  const handlers = { progress: [], done: [], error: [], finish: [] };

  const on = (evt, fn) => { if (handlers[evt]) handlers[evt].push(fn); };
  const emit = (evt, payload) => { (handlers[evt] || []).forEach((f) => { try { f(payload); } catch (e) { /* ignore */ } }); };

  function add(task) {
    const id = ++seq;
    tasks.push(Object.assign({}, task, { _id: id }));
    return id;
  }

  async function runOne(task) {
    const o = task.options || {};
    const saveDir = o.groupByPlaylist && task.playlistName
      ? path.join(task.saveDir, groupDirName(task.playlistName))
      : task.saveDir;
    fs.mkdirSync(saveDir, { recursive: true });
    const filename = renderTemplate(o.template || '{artist} - {name}', Object.assign({ index: task.index }, task.meta || {}));
    const job = downloadFile(task.url, saveDir, {
      filename,
      onProgress: (p) => emit('progress', {
        id: task._id, name: (task.meta && task.meta.name) || filename,
        loaded: p.loaded, total: p.total, percent: p.percent,
      }),
    });
    task._job = job;
    const r = await job.promise;

    // 下载歌词文件
    let lyricPath = null;
    if (o.saveLyric && task.lyrics) {
      lyricPath = r.filePath.replace(/\.[^.]+$/, '.lrc');
      try { fs.writeFileSync(lyricPath, String(task.lyrics), 'utf8'); } catch (e) { lyricPath = null; }
    }
    // 嵌入封面 / 歌词标签
    if (o.embedCover || o.embedLyric) {
      let cover = null;
      if (o.embedCover && (o.coverFile || task.coverUrl) && fetchBuffer) {
        try {
          if (o.coverFile && fs.existsSync(o.coverFile)) cover = fs.readFileSync(o.coverFile);
          else cover = await fetchBuffer(task.coverUrl);
        } catch (e) { cover = null; }
      }
      try {
        writeTagsToFile(r.filePath, {
          title: task.meta && task.meta.name,
          artist: task.meta && task.meta.artist,
          album: task.meta && task.meta.album,
          lyrics: o.embedLyric ? task.lyrics : null,
          cover,
          coverMime: cover ? undefined : 'image/jpeg',
        });
      } catch (e) { /* 标签写入失败不影响下载结果 */ }
    }
    return { id: task._id, filePath: r.filePath, bytes: r.bytes, lyricPath, name: (task.meta && task.meta.name) || filename };
  }

  async function worker() {
    for (;;) {
      if (canceled) return;
      const task = tasks.shift();
      if (!task) return;
      running++;
      try {
        const res = await runOne(task);
        results.push(res);
        emit('done', res);
      } catch (e) {
        const err = { id: task._id, name: (task.meta && task.meta.name) || '', error: String(e && e.message || e) };
        errors.push(err);
        emit('error', err);
      } finally {
        running--;
      }
    }
  }

  async function start() {
    canceled = false;
    const workers = [];
    for (let i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.all(workers);
    emit('finish', { results, errors });
    return { results, errors };
  }

  function cancelAll() {
    canceled = true;
    tasks.length = 0;
    return true;
  }

  return {
    add, start, cancelAll, on,
    get size() { return tasks.length; },
    get running() { return running; },
    get concurrency() { return concurrency; },
    summary() { return { total: results.length + errors.length, ok: results.length, failed: errors.length }; },
  };
}

module.exports = { createDownloadQueue };