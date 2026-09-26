// 声浪 SongWave · 极简只读 SQLite 读取器（无第三方依赖）
//
// 用途：读取其它播放器（LX Music）本地数据库里的「歌曲 → 已解析播放地址」缓存，
// 从而在音源脚本后端失效时仍能继续播放（这正是那些播放器自己能继续播的原因）。
// 只实现需要的部分：rowid 表、整表扫描、TEXT/INTEGER 列、WAL 回放、忽略溢出页。
'use strict';

const fs = require('fs');

function readU16(b, o) { return (b[o] << 8) | b[o + 1]; }
function readU32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }

/** SQLite varint（最多 9 字节） */
function varint(buf, off) {
  let v = 0;
  for (let i = 0; i < 9; i++) {
    const byte = buf[off + i];
    if (i === 8) { v = v * 256 + byte; return { value: v, size: 9 }; }
    v = v * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return { value: v, size: i + 1 };
  }
  return { value: v, size: 9 };
}

/** 把 -wal 里已提交的页覆盖回主库镜像（校验 salt，避免回放上一代的陈旧帧） */
function applyWal(image, walPath, pageSize) {
  let wal;
  try { wal = fs.readFileSync(walPath); } catch (e) { return image; }
  if (wal.length < 32) return image;
  const magic = readU32(wal, 0);
  if (magic !== 0x377f0682 && magic !== 0x377f0683) return image;
  // WAL 自己的页大小（offset 8）优先，避免与主库不一致时按错帧长切分
  let walPageSize = readU32(wal, 8);
  if (!walPageSize || walPageSize < 512) walPageSize = pageSize;
  const salt1 = readU32(wal, 16);
  const salt2 = readU32(wal, 20);
  const frameSize = 24 + walPageSize;
  const frames = Math.floor((wal.length - 32) / frameSize);
  for (let i = 0; i < frames; i++) {
    const base = 32 + i * frameSize;
    // 帧头：页号(4) 提交后页数(4) salt1(4) salt2(4) checksum1(4) checksum2(4)
    if (readU32(wal, base + 8) !== salt1 || readU32(wal, base + 12) !== salt2) continue;
    const pageNo = readU32(wal, base);
    if (!pageNo || pageNo < 1) continue;
    const src = base + 24;
    const dst = (pageNo - 1) * pageSize;
    if (dst + pageSize > image.length) continue;
    wal.copy(image, dst, src, src + pageSize);
  }
  return image;
}

function loadImage(file, pageSizeHint) {
  const buf = fs.readFileSync(file);
  let pageSize = pageSizeHint || readU16(buf, 16);
  if (pageSize === 1) pageSize = 65536;
  if (!pageSize || pageSize < 512) pageSize = 4096;
  const image = Buffer.from(buf);
  applyWal(image, file + '-wal', pageSize);
  return { image: image, pageSize: pageSize };
}

/** 解析一条记录（varint 头 + serial types） */
function parseRecord(buf, off, end) {
  const h = varint(buf, off);
  // 注意：SQLite 记录头长度**包含长度字段自身**，数据区从 off + h.value 开始
  const headerEnd = off + h.value;
  let p = off + h.size;
  const types = [];
  while (p < headerEnd) { const t = varint(buf, p); types.push(t.value); p += t.size; }
  const vals = [];
  let d = headerEnd;
  for (const t of types) {
    if (t === 0) { vals.push(null); }
    else if (t >= 1 && t <= 6) {
      let v = 0;
      for (let i = 0; i < t; i++) v = v * 256 + buf[d + i];
      vals.push(v);
      d += t;
    } else if (t === 8) { vals.push(0); }
    else if (t === 9) { vals.push(1); }
    else if (t >= 12 && t % 2 === 0) { const n = (t - 12) / 2; vals.push(buf.subarray(d, d + n)); d += n; }
    else if (t >= 13) { const n = (t - 13) / 2; vals.push(buf.toString('utf8', d, d + n)); d += n; }
    else { vals.push(null); }
  }
  return vals;
}

/** 遍历一棵表 b-tree（叶子页） */
function walk(rootPage, ctx, onRow) {
  const { image, pageSize } = ctx;
  const stack = [rootPage];
  while (stack.length) {
    const pn = stack.pop();
    // 注意：第 1 页的前 100 字节是文件头，所以"页头字段"从 pageBase+100 开始；
    // 但 cell 指针数组里的偏移是相对**页首**（pageBase）计算的 —— 两者不能混用。
    const pageBase = (pn - 1) * pageSize;
    const base = pageBase + (pn === 1 ? 100 : 0);
    if (pageBase + pageSize > image.length + pageSize) continue;
    const type = image[base];
    const nCells = readU16(image, base + 3);
    if (process.env.SW_SQLITE_DEBUG) console.log('[sqlite] 页 ' + pn + ' 类型=' + type + ' cell数=' + nCells + ' base=' + base);
    if (type === 5) {   // 内部页
      for (let i = 0; i < nCells; i++) {
        const cell = readU16(image, base + 12 + i * 2);
        stack.push(readU32(image, pageBase + cell));   // 左子页
      }
      stack.push(readU32(image, base + 8));        // 最右子页
    } else if (type === 13) {   // 叶子页
      for (let i = 0; i < nCells; i++) {
        const cell = readU16(image, base + 8 + i * 2);
        const cellAbs = pageBase + cell;
        if (cellAbs >= image.length) continue;
        const plen = varint(image, cellAbs);
        const rowid = varint(image, cellAbs + plen.size);
        const recOff = cellAbs + plen.size + rowid.size;
        try { onRow(parseRecord(image, recOff, recOff + plen.value)); }
        catch (e) { if (process.env.SW_SQLITE_DEBUG) console.log('[sqlite] 行解析失败 @' + recOff + ':', (e && e.message) || e); }
      }
    }
  }
}

/**
 * 读取整张表的行（返回对象数组，列名来自 schema 的 CREATE TABLE 语句）
 * @param {string} file 数据库文件
 * @param {string} table 表名
 */
function readTable(file, table) {
  const probe = fs.readFileSync(file);
  let pageSize = readU16(probe, 16);
  if (pageSize === 1) pageSize = 65536;
  if (!pageSize || pageSize < 512) pageSize = 4096;
  const ctx = loadImage(file, pageSize);

  // 1) 从 sqlite_master 找表的根页与建表语句
  let rootPage = 0;
  let sql = '';
  walk(1, ctx, (row) => {
    // sqlite_master: type, name, tbl_name, rootpage, sql
    if (process.env.SW_SQLITE_DEBUG) console.log('[sqlite] master 行:', JSON.stringify(row).slice(0, 120));
    if (row && row[1] === table) { rootPage = row[3]; sql = String(row[4] || ''); }
  });
  if (!rootPage) return [];

  // 2) 列名
  const cols = [];
  const m = /\(([\s\S]*)\)/.exec(sql);
  if (m) {
    m[1].split(',').forEach((seg) => {
      const name = seg.trim().replace(/^["'`[]|["'`\]]$/g, '').split(/\s+/)[0];
      if (name && !/^(primary|unique|foreign|constraint|check)$/i.test(name)) cols.push(name.replace(/^["'`[]|["'`\]]$/g, ''));
    });
  }

  const rows = [];
  walk(rootPage, ctx, (vals) => {
    const o = {};
    vals.forEach((v, i) => { o[cols[i] || ('c' + i)] = v; });
    rows.push(o);
  });
  return rows;
}

module.exports = { readTable };
