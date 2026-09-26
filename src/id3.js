// 声浪 SongWave · 下载增强：命名模板 / 并发队列 / 歌词与封面嵌入
// 说明：ID3v2 标签由本模块自行拼装（不依赖任何第三方库）
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------- 命名模板 ----------------
/**
 * 渲染文件名模板
 * 支持占位符：{name} {artist} {album} {source} {index} {quality} {date}
 * @param {string} template 例如 "{artist} - {name}"
 * @param {object} meta { name, artist, album, source, index, quality }
 * @param {object} [opts] { ext: '.mp3', date: Date }
 */
function renderTemplate(template, meta = {}, opts = {}) {
  const d = opts.date instanceof Date ? opts.date : new Date();
  const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const map = {
    name: meta.name || '未知歌曲',
    artist: meta.artist || '',
    album: meta.album || '',
    source: meta.source || '',
    index: meta.index == null ? '' : String(meta.index),
    quality: meta.quality || '',
    date,
  };
  let out = String(template || '{artist} - {name}');
  Object.keys(map).forEach((k) => { out = out.split('{' + k + '}').join(map[k]); });
  out = out.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  // 去掉模板里没用到的空占位带来的多余分隔符
  out = out.replace(/\s*-\s*-\s*/g, ' - ').replace(/^[\s\-_.]+|[\s\-_.]+$/g, '');
  if (!out) out = map.name;
  const ext = opts.ext || '.mp3';
  return /\.(mp3|flac|m4a|wav|ogg|webm|mp4)$/i.test(out) ? out : out + ext;
}

/** 按歌单分组时的子目录名（已做非法字符清理） */
function groupDirName(playlistName) {
  const s = String(playlistName || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return s || '未分组';
}

// ---------------- ID3v2.3 标签拼装 ----------------
function synchsafe(size) {
  return [((size >> 21) & 0x7f), ((size >> 14) & 0x7f), ((size >> 7) & 0x7f), (size & 0x7f)];
}

/** 文本帧（编码 0x01 = UTF-16LE 带 BOM，避免中文乱码） */
function textFrame(id, text) {
  const body = Buffer.concat([
    Buffer.from([0x01, 0xff, 0xfe]),
    Buffer.from(String(text || ''), 'utf16le'),
    Buffer.from([0x00, 0x00]),
  ]);
  const head = Buffer.alloc(10);
  head.write(id, 0, 'ascii');
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** 注释/歌词帧 USLT */
function usltFrame(lyrics, lang = 'chi') {
  const desc = Buffer.from([0xff, 0xfe, 0x00, 0x00]);
  const body = Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from(String(lang || 'chi').slice(0, 3).padEnd(3, ' '), 'ascii'),
    desc,
    Buffer.from(String(lyrics || ''), 'utf16le'),
  ]);
  const head = Buffer.alloc(10);
  head.write('USLT', 0, 'ascii');
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** 图片帧 APIC（封面） */
function apicFrame(imageBuffer, mime = 'image/jpeg', desc = 'cover', pictureType = 3) {
  const body = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from(String(mime || 'image/jpeg'), 'ascii'),
    Buffer.from([0x00]),
    Buffer.from([pictureType]),
    Buffer.from(String(desc || ''), 'latin1'),
    Buffer.from([0x00]),
    imageBuffer,
  ]);
  const head = Buffer.alloc(10);
  head.write('APIC', 0, 'ascii');
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

/**
 * 生成完整的 ID3v2.3 标签块
 * @param {object} meta { title, artist, album, lyrics, cover(Buffer), coverMime }
 * @returns {Buffer}
 */
function buildId3v2(meta = {}) {
  const frames = [];
  if (meta.title) frames.push(textFrame('TIT2', meta.title));
  if (meta.artist) frames.push(textFrame('TPE1', meta.artist));
  if (meta.album) frames.push(textFrame('TALB', meta.album));
  if (meta.lyrics) frames.push(usltFrame(meta.lyrics));
  if (meta.cover && meta.cover.length) frames.push(apicFrame(meta.cover, meta.coverMime || guessImageMime(meta.cover)));
  const body = Buffer.concat(frames);
  const head = Buffer.alloc(10);
  head.write('ID3', 0, 'ascii');
  head[3] = 3;      // v2.3
  head[4] = 0;      // revision
  head[5] = 0;      // flags
  const size = synchsafe(body.length);
  head[6] = size[0]; head[7] = size[1]; head[8] = size[2]; head[9] = size[3];
  return Buffer.concat([head, body]);
}

function guessImageMime(buf) {
  if (!buf || buf.length < 4) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
}

/** 解析 ID3v2 头（用于校验写出的标签） */
function parseId3v2(buf) {
  if (!buf || buf.length < 10 || buf.slice(0, 3).toString('ascii') !== 'ID3') return null;
  const major = buf[3];
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const frames = {};
  let pos = 10;
  const end = Math.min(buf.length, 10 + size);
  while (pos + 10 <= end) {
    const id = buf.slice(pos, pos + 4).toString('ascii');
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = buf.readUInt32BE(pos + 4);
    if (len <= 0 || pos + 10 + len > buf.length) break;
    frames[id] = buf.slice(pos + 10, pos + 10 + len);
    pos += 10 + len;
  }
  return { major, size, frames, frameIds: Object.keys(frames) };
}

/** 把 ID3 标签写入音频文件（原地重写：标签 + 原音频数据） */
function writeTagsToFile(filePath, meta = {}) {
  const audio = fs.readFileSync(filePath);
  let payload = audio;
  const existing = parseId3v2(audio);
  if (existing) {
    const total = 10 + existing.size;
    payload = audio.slice(total);
  }
  const tag = buildId3v2(meta);
  fs.writeFileSync(filePath, Buffer.concat([tag, payload]));
  return { tagBytes: tag.length, audioBytes: payload.length };
}

module.exports = {
  renderTemplate, groupDirName,
  buildId3v2, parseId3v2, writeTagsToFile,
  _internal: { textFrame, usltFrame, apicFrame, synchsafe, guessImageMime },
};