// 声浪 SongWave · 下载增强 / 简繁转换 / 排行榜 测试（离线）
// 用法：node scripts/test-extras.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const id3 = require('../src/id3');
const { createDownloadQueue } = require('../src/download-queue');
const zh = require('../src/zh-convert');
const { createCharts, mapQqTopList, mapKugouRank, mapNeteaseRecommend } = require('../src/charts');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

// ============ 1) 命名模板 ============
console.log('— 命名模板 —');
check('默认模板 {artist} - {name}',
  id3.renderTemplate('{artist} - {name}', { artist: '周杰伦', name: '晴天' }) === '周杰伦 - 晴天.mp3');
check('支持 {album}/{index}/{source}',
  id3.renderTemplate('{index}. {name} [{album}]', { index: 3, name: '晴天', album: '叶惠美' }) === '3. 晴天 [叶惠美].mp3');
check('非法字符被清理',
  id3.renderTemplate('{name}', { name: 'a/b:c*d?e"f<g>h|i' }) === 'a_b_c_d_e_f_g_h_i.mp3');
check('空字段不留多余分隔符',
  id3.renderTemplate('{artist} - {name}', { name: '纯音乐' }) === '纯音乐.mp3');
check('已有扩展名不重复追加',
  id3.renderTemplate('{name}', { name: '晴天.mp3' }) === '晴天.mp3');
check('分组目录名会清理', id3.groupDirName('我的/歌单:v1') === '我的_歌单_v1' && id3.groupDirName('') === '未分组');

// ============ 2) ID3 标签 ============
console.log('\n— ID3v2 标签 —');
const tag = id3.buildId3v2({ title: '晴天', artist: '周杰伦', album: '叶惠美', lyrics: '[00:01.00]第一句', cover: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) });
const parsed = id3.parseId3v2(tag);
check('生成的标签可被解析', !!parsed && parsed.major === 3, JSON.stringify(parsed && parsed.major));
check('含标题/歌手/专辑帧', ['TIT2', 'TPE1', 'TALB'].every((f) => parsed.frameIds.includes(f)), parsed.frameIds.join(','));
check('含歌词帧 USLT', parsed.frameIds.includes('USLT'));
check('含封面帧 APIC', parsed.frameIds.includes('APIC'));
check('JPEG 封面 MIME 识别', id3._internal.guessImageMime(Buffer.from([0xff, 0xd8, 0xff])) === 'image/jpeg');
check('PNG 封面 MIME 识别', id3._internal.guessImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47])) === 'image/png');
check('中文以 UTF-16 存储（不乱码）', tag.includes(Buffer.from('晴', 'utf16le')), 'utf16le 编码检查');

// 写入文件后再解析（含旧标签覆盖）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'songwave-id3-'));
const mp3 = path.join(tmp, 't.mp3');
fs.writeFileSync(mp3, Buffer.concat([Buffer.alloc(32, 0xaa)]));   // 模拟音频数据
const w1 = id3.writeTagsToFile(mp3, { title: 'A', lyrics: 'x' });
check('写入标签成功', w1.tagBytes > 0 && w1.audioBytes === 32, JSON.stringify(w1));
const re1 = id3.parseId3v2(fs.readFileSync(mp3));
check('写入后可读出标题帧', re1.frameIds.includes('TIT2'));
const w2 = id3.writeTagsToFile(mp3, { title: 'B' });
const re2 = id3.parseId3v2(fs.readFileSync(mp3));
check('重复写入不会叠加旧标签', re2.frameIds.includes('TIT2') && !re2.frameIds.includes('USLT'), re2.frameIds.join(','));
check('音频数据长度保持', fs.readFileSync(mp3).length === (10 + re2.size) + 32);

// ============ 3) 下载队列（并发 / 命名 / 分组 / 歌词） ============
console.log('\n— 下载队列 —');
let active = 0, maxActive = 0;
const fakeDownload = (url, dir, opts) => {
  active++; maxActive = Math.max(maxActive, active);
  const p = new Promise((resolve) => setTimeout(() => {
    active--;
    fs.writeFileSync(path.join(dir, opts.filename), 'audio');
    resolve({ filePath: path.join(dir, opts.filename), bytes: 5 });
  }, 20));
  return { promise: p, cancel() {} };
};

(async () => {
  const q = createDownloadQueue({ concurrency: 2, downloadFile: fakeDownload, fs, fetchBuffer: async () => Buffer.from([0xff, 0xd8, 0xff]) });
  check('并发数已生效', q.concurrency === 2, String(q.concurrency));
  const doneNames = [];
  q.on('done', (r) => doneNames.push(path.basename(r.filePath)));
  const dir = path.join(tmp, 'dl');
  for (let i = 1; i <= 5; i++) {
    q.add({ url: 'http://x/' + i, saveDir: dir, playlistName: '我的歌单', index: i, lyrics: '[00:01.00]词' + i,
      meta: { name: '歌' + i, artist: '歌手' + i },
      options: { template: '{index}. {artist} - {name}', groupByPlaylist: true, saveLyric: true } });
  }
  const r = await q.start();
  check('全部下载完成', r.results.length === 5, JSON.stringify(q.summary()));
  check('没有失败项', r.errors.length === 0, JSON.stringify(r.errors));
  check('并发不超过上限', maxActive <= 2, '峰值并发 ' + maxActive);
  const groupDir = path.join(dir, '我的歌单');
  check('按歌单分组落盘', fs.existsSync(groupDir), groupDir);
  check('命名模板生效', fs.existsSync(path.join(groupDir, '1. 歌手1 - 歌1.mp3')), doneNames.join(','));
  check('歌词文件已保存', fs.existsSync(path.join(groupDir, '1. 歌手1 - 歌1.lrc')));
  check('歌词内容正确', fs.readFileSync(path.join(groupDir, '1. 歌手1 - 歌1.lrc'), 'utf8').indexOf('词1') >= 0);

  // 错误也要被收集
  const q2 = createDownloadQueue({ concurrency: 1, downloadFile: () => ({ promise: Promise.reject(new Error('取链失败')), cancel() {} }), fs });
  q2.add({ url: 'http://bad', saveDir: dir, meta: { name: 'x' }, options: {} });
  const r2 = await q2.start();
  check('失败任务被记录', r2.errors.length === 1 && /取链失败/.test(r2.errors[0].error), JSON.stringify(r2.errors));

  // ============ 4) 简繁转换 ============
  console.log('\n— 简繁转换 —');
  const size = zh.tableSize();
  check('映射表规模足够', size.s2t > 800, JSON.stringify(size));
  check('基本转换', zh.toTraditional('这个项目很不错') === '這個項目很不錯');
  check('歧义：头发 -> 頭髮', zh.toTraditional('头发') === '頭髮');
  check('歧义：发展 -> 發展', zh.toTraditional('发展') === '發展');
  check('歧义：干净 -> 乾淨', zh.toTraditional('干净') === '乾淨');
  check('歧义：面条 -> 麵條', zh.toTraditional('面条') === '麵條');
  check('歧义：台湾 -> 臺灣', zh.toTraditional('台湾') === '臺灣');
  check('繁体转回简体', zh.toSimplified('後來這個項目') === '后来这个项目');
  check('往返一致', zh.toSimplified(zh.toTraditional('夜曲是一首好听的歌')) === '夜曲是一首好听的歌');
  check('空输入安全', zh.toTraditional('') === '' && zh.toTraditional(null) === '');

  // ============ 5) 排行榜与推荐 ============
  console.log('\n— 排行榜 / 推荐歌单 —');
  const RESP = {
    'personalized': { result: [{ id: 1, name: '夏日歌单', picUrl: 'http://c/1.jpg', playCount: 12345, trackCount: 20 }] },
    'playlist/detail': { playlist: { name: '热歌榜', coverImgUrl: 'http://c/hot.jpg', tracks: [{ id: 11, name: '晴天', ar: [{ name: '周杰伦' }], al: { name: '叶惠美' }, dt: 269000 }] } },
    'toplist_cp': { songlist: [{ data: { songmid: 'M1', songname: '夜曲', singer: [{ name: '周杰伦' }], albumname: '十一月的萧邦', albummid: 'A1', interval: 227 } }] },
    'rank/song': { data: { info: [{ hash: 'H1', songname: '起风了', singername: '买辣椒也用券', duration: 325 }] } },
  };
  const charts = createCharts({
    fetchImpl: async (url) => {
      const key = Object.keys(RESP).find((k) => String(url).includes(k));
      if (!key) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify(RESP[key]) };
    },
  });
  check('三个平台都有榜单', ['netease', 'qq', 'kugou'].every((p) => charts.list(p).length > 0), JSON.stringify(charts.platforms));
  check('榜单条目带平台标记', charts.list('qq').every((c) => c.platform === 'qq'));
  const nc = await charts.fetchChart('netease', '3778678', 10);
  check('网易榜单单曲解析', nc.items.length === 1 && nc.items[0].name === '晴天', JSON.stringify(nc.items[0] && nc.items[0].name));
  const qc = await charts.fetchChart('qq', '26', 10);
  check('QQ 榜单解析并保留 songmid', qc.items[0].songmid === 'M1' && qc.items[0].extKey === 'tx');
  const kc = await charts.fetchChart('kugou', '8888', 10);
  check('酷狗榜单解析并保留 hash', kc.items[0].hash === 'H1' && kc.items[0].extKey === 'kg');
  const rec = await charts.recommend(6);
  check('推荐歌单解析', rec.length === 1 && rec[0].name === '夏日歌单' && rec[0].playCount === 12345, JSON.stringify(rec[0]));
  let threw = false;
  try { await charts.fetchChart('unknown', '1'); } catch (e) { threw = true; }
  check('未知平台报错', threw);
  check('映射函数可直接调用', mapQqTopList(RESP.toplist_cp).length === 1 && mapKugouRank(RESP['rank/song']).length === 1 && mapNeteaseRecommend(RESP.personalized).length === 1);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
