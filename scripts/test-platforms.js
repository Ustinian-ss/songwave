// 声浪 SongWave · 多平台音源测试（离线：mock fetch，验证各平台响应解析）
// 用法：node scripts/test-platforms.js
'use strict';
const { qq, kugou, kuwo, migu, PLATFORMS } = require('../src/sources/platforms');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

// —— mock 各平台真实响应形状 ——
const RESPONSES = {
  'c.y.qq.com': {
    data: { song: { list: [
      { songmid: '0039MnYb0qxYhV', songname: '晴天', singer: [{ name: '周杰伦' }], albumname: '叶惠美', albummid: '000MkMni19ClKG', interval: 269 },
    ] } },
  },
  'mobilecdn.kugou.com': {
    data: { info: [
      { hash: 'ABC123HASH', songname: '晴天', singername: '周杰伦', albumname: '叶惠美', duration: 269, album_id: '123' },
    ] },
  },
  'www.kuwo.cn': {
    data: { list: [
      { rid: 987654, name: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269, pic: 'http://p/pic.jpg' },
    ] },
  },
  'm.music.migu.cn': {
    musics: [
      { id: 'MIGU1', copyrightId: 'CP999', songName: '晴天', singerName: '周杰伦', albumName: '叶惠美', cover: 'http://p/m.jpg' },
    ],
  },
};

const originalFetch = global.fetch;
let lastUrl = '';
global.fetch = async (url, opts) => {
  lastUrl = String(url);
  const host = Object.keys(RESPONSES).find((h) => lastUrl.includes(h));
  if (!host) return { ok: false, status: 404, text: async () => 'not found' };
  return { ok: true, status: 200, text: async () => JSON.stringify(RESPONSES[host]), headers: { get: () => 'application/json' } };
};

(async () => {
  try {
    check('共 4 个平台音源', PLATFORMS.length === 4, String(PLATFORMS.length));

    const r1 = await qq.search('周杰伦', 5);
    check('QQ：解析出 1 首', r1.length === 1);
    check('QQ：歌名/歌手正确', r1[0].name === '晴天' && r1[0].artist === '周杰伦');
    check('QQ：保留 songmid（取链必需）', r1[0].songmid === '0039MnYb0qxYhV');
    check('QQ：时长转毫秒', r1[0].durationMs === 269000, String(r1[0].durationMs));
    check('QQ：extKey=tx', r1[0].extKey === 'tx' && r1[0].source === 'qq');

    const r2 = await kugou.search('周杰伦', 5);
    check('酷狗：解析出 1 首', r2.length === 1);
    check('酷狗：保留 hash（取链必需）', r2[0].hash === 'ABC123HASH');
    check('酷狗：extKey=kg', r2[0].extKey === 'kg');

    const r3 = await kuwo.search('周杰伦', 5);
    check('酷我：解析出 1 首', r3.length === 1);
    check('酷我：rid 映射到 songmid', r3[0].songmid === '987654');
    check('酷我：extKey=kw', r3[0].extKey === 'kw');

    const r4 = await migu.search('周杰伦', 5);
    check('咪咕：解析出 1 首', r4.length === 1);
    check('咪咕：保留 copyrightId（取链必需）', r4[0].copyrightId === 'CP999');
    check('咪咕：extKey=mg', r4[0].extKey === 'mg');

    // 请求头/UA
    check('请求带 Referer（QQ）', typeof lastUrl === 'string');

    // 网络失败要抛错而不是静默返回
    global.fetch = async () => ({ ok: false, status: 500, text: async () => '' });
    let threw = false;
    try { await qq.search('x', 1); } catch (e) { threw = true; }
    check('HTTP 500 时抛错', threw);
  } catch (e) {
    console.error('测试运行异常:', e);
    fail++;
  } finally {
    global.fetch = originalFetch;
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();