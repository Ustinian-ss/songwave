// 极简 PNG 像素行分析（无第三方依赖）：node scripts/png-rows.js <file.png> [xMin] [xMax]
// 输出「每一行最大亮度」的高亮区间，用来客观判断律动有没有贴到屏幕底部。
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('只支持 8bit，当前 ' + bitDepth);
  if (interlace) throw new Error('不支持隔行扫描');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : -1;
  if (ch < 0) throw new Error('不支持的颜色类型 ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const img = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = img.subarray(y * stride, (y + 1) * stride);
    const prev = y ? img.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  return { w, h, ch, img };
}

const file = process.argv[2];
const { w, h, ch, img } = decodePNG(fs.readFileSync(file));
const xMin = Number(process.argv[3] || 0);
const xMax = Number(process.argv[4] || w);
const yMin = Number(process.argv[5] || 0);
const yMax = Number(process.argv[6] || h);
const rows = [];
for (let y = 0; y < h; y++) {
  let mx = 0, bright = 0;
  for (let x = xMin; x < Math.min(xMax, w); x++) {
    const o = y * w * ch + x * ch;
    const r = img[o], g = img[o + 1], b = img[o + 2];
    const lum = Math.max(r, g, b);
    if (lum > mx) mx = lum;
    if (lum > 90) bright++;
  }
  rows.push({ y, mx, bright });
}
const band = rows.filter((r) => r.y >= yMin && r.y < yMax);
// 找出有内容（亮像素 > 20）的最低一行
const content = band.filter((r) => r.bright > 20);
const lastContent = content.length ? content[content.length - 1] : null;
console.log('尺寸:', w + 'x' + h, '采样 x:', xMin + '-' + xMax, 'y:', yMin + '-' + yMax);
const tail = band.slice(Math.max(0, band.length - 30));
console.log('行号  最大亮度  亮像素数   (采样区底部 30 行)');
for (const r of tail) {
  console.log(String(r.y).padStart(5), String(r.mx).padStart(8), String(r.bright).padStart(9), r.bright > 20 ? '  ← 有律动内容' : '');
}
if (lastContent) console.log('最低有内容行: y =', lastContent.y, '（距采样区底', yMax - 1 - lastContent.y, 'px）');

// 亮度加权质心（判断整体上下位置；镜像时质心会关于 H/2 对称）
let wsum = 0, ysum = 0, xsum = 0;
for (const r of band) {
  for (let x = xMin; x < Math.min(xMax, w); x++) {
    const o = r.y * w * ch + x * ch;
    const lum = Math.max(img[o], img[o + 1], img[o + 2]);
    if (lum > 60) { wsum += lum; ysum += lum * r.y; xsum += lum * x; }
  }
}
if (wsum) console.log('亮度质心: y =', (ysum / wsum).toFixed(1), ' x =', (xsum / wsum).toFixed(1), ' 总亮度 =', Math.round(wsum / 1000) + 'k');

// 可选：转储某一行的亮像素分布与颜色 → 判断到底是谁画到了底部
const dumpY = Number(process.argv[7] || -1);
if (dumpY >= 0 && dumpY < h) {
  const segs = [];
  let run = null;
  for (let x = xMin; x < Math.min(xMax, w); x++) {
    const o = dumpY * w * ch + x * ch;
    const lum = Math.max(img[o], img[o + 1], img[o + 2]);
    if (lum > 90) {
      if (!run) run = { from: x, to: x, max: lum, rgb: [img[o], img[o + 1], img[o + 2]] };
      else { run.to = x; if (lum > run.max) { run.max = lum; run.rgb = [img[o], img[o + 1], img[o + 2]]; } }
    } else if (run) { segs.push(run); run = null; }
  }
  if (run) segs.push(run);
  console.log('y=' + dumpY + ' 亮段数:', segs.length);
  for (const s of segs.slice(0, 12)) {
    console.log('   x ' + s.from + '-' + s.to + '  最亮 ' + s.max + '  rgb(' + s.rgb.join(',') + ')');
  }
}
